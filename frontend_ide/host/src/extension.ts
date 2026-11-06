/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

import * as vscode from 'vscode';
import { usableFolder, folderRequired } from './workspace-folder';
import { developmentHtml } from './vscode-html';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { コードモデル読込, コードモデル保存, モデル保存先, コード設定保存先, 検証回数読込, 検証回数保存 } from './model-preferences';
import { Hermes既定モデル, オフラインモデル候補, オフラインモデル保存先, オフライン実行 } from '../aidiy_code/src/offline';
import { 起動解決 } from './runner';
import { extensionCoreConnection } from './extension-installation';
import { CodeConnection, コード選択 } from './code-connection';
import { InputPrediction } from './input-prediction';
import { validateFileUpload, fileAttachment, isDuplicateAttachment, type ChatAttachment } from './file-attachments';
import type { Packet } from '../aidiy_live/src/protocol';
import { streamControlOf, visibleStreamContent, type コードパケット } from './protocol';
import { 会話保存先, 会話一覧, 会話書込, 会話削除, 会話本文上限, 履歴メッセージ長さ, type 保存履歴 } from './conversation-store';

interface メッセージ { 種別: 'user' | 'assistant' | 'error'; 本文: string; 添付?: ChatAttachment }
interface 会話 { メッセージ: メッセージ[]; 作業URI: string; コアセッションID?: string; HermesセッションID?: string; provider: string; model: string; モデル選択済み?: boolean }
interface 保存会話 extends 会話 { id: string; 更新日時: number; 初回依頼?: string }
interface 会話履歴 { 現在ID: string; 一覧: 保存会話[] }
interface 添付 { 名前: string; 本文: string }

// 会話履歴はプロジェクトの _AIDIY/aidiy_code/histories/ に保存し、単独起動版・開発スペースとも共用する（共通形へ変換）。
const 履歴へ = (item: 保存会話): 保存履歴 => ({
  id: item.id, 更新日時: item.更新日時, 初回依頼: item.初回依頼, メッセージ: item.メッセージ, provider: item.provider, model: item.model,
  モデル選択済み: item.モデル選択済み, 実行モード: 'online', セッションID: item.コアセッションID, HermesセッションID: item.HermesセッションID,
});
const 会話へ = (item: 保存履歴, 作業URI: string): 保存会話 => {
  const offline = item.実行モード === 'offline';
  return {
    id: item.id, 更新日時: item.更新日時, 初回依頼: item.初回依頼, 作業URI, provider: item.provider, model: item.model, モデル選択済み: item.モデル選択済み,
    メッセージ: item.メッセージ.filter(message => ['user', 'assistant', 'error'].includes(message.種別)) as メッセージ[],
    // 単独起動版のオフライン会話は Hermes のセッションとして続ける（AIコアのセッションには渡さない）
    コアセッションID: offline ? undefined : item.セッションID, HermesセッションID: item.HermesセッションID ?? (offline ? item.セッションID : undefined),
  };
};

class Hermesチャット implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private 会話: 会話;
  private 添付?: 添付;
  private 実行中 = false;
  private 停止中 = false;
  private モデル反映中 = false;
  private 進捗: string[] = [];
  private 保存待ち: PromiseLike<void> = Promise.resolve();
  private 破棄済み = false;
  private 会話ID: string = randomUUID();
  private 履歴: 保存会話[] = [];
  /** 旧版が workspaceState に残した履歴のうち、今開いていないフォルダの分（開いた時に移す）。 */
  private 旧履歴: 保存会話[] = [];
  private readonly 書込待ち = new Map<string, 保存会話>();
  private 書込タイマー?: ReturnType<typeof setTimeout>;
  private 最終モデル: { provider: string; model: string };
  private オフラインモデル: { provider: string; model: string };
  private readonly オフライン保存先 = オフラインモデル保存先(モデル保存先('code'));
  private readonly 設定保存先 = コード設定保存先(モデル保存先('code'));
  /** 最後に選んだオンラインの検証回数。未保存なら0回。 */
  private 検証回数 = 0;
  // 起動時の候補を固定せず、現在の会話のフォルダから診断結果を読み直す。
  private get オフライン候補(): { id: string; label: string }[] {
    const folder = this.会話 ? this.現在フォルダ() : this.選択フォルダ();
    return オフラインモデル候補(this.context.extensionPath, folder?.uri.fsPath ?? this.context.extensionPath);
  }
  private オフラインジョブ?: ReturnType<typeof オフライン実行>;
  private 最終作業URI?: vscode.Uri;
  private connection?: CodeConnection;
  private 接続フォルダ = '';
  private 自動接続 = true;
  private prediction: InputPrediction;
  private readonly ログ = vscode.window.createOutputChannel('AiDiy Code');

  constructor(private readonly context: vscode.ExtensionContext) {
    this.prediction = new InputPrediction(context.extensionPath, () => ({
      projectPath: this.connection?.projectPath || '', conversationId: this.会話ID,
      sessionId: this.connection?.session || '', enabled: !this.破棄済み && !!this.view && vscode.workspace.isTrusted
        && this.自動接続 && !this.オフライン使用() && !this.実行中 && !this.モデル変更中(),
    }));
    const config = vscode.workspace.getConfiguration('aidiyHermes');
    const offlineModels = this.オフライン候補;
    const defaultModel = Hermes既定モデル(context.extensionPath, this.選択フォルダ()?.uri.fsPath ?? context.extensionPath);
    const offlineSaved = コードモデル読込(this.オフライン保存先);
    const offlineModel = offlineSaved?.provider === 'aidiy_hermes' && offlineModels.some(item => item.id === offlineSaved.model)
      ? offlineSaved.model : offlineModels.some(item => item.id === defaultModel) ? defaultModel : 'same';
    this.オフラインモデル = { provider: 'aidiy_hermes', model: offlineModel };
    this.検証回数 = 検証回数読込(this.設定保存先) ?? 0;
    const old = context.workspaceState.get<会話>('会話');
    const saved = context.workspaceState.get<会話履歴>('会話履歴');
    this.旧履歴 = Array.isArray(saved?.一覧) ? saved.一覧.filter(item => typeof item?.id === 'string' && Array.isArray(item.メッセージ) && typeof item.作業URI === 'string') : [];
    this.履歴読込();
    const selected = this.履歴.find(item => item.id === saved?.現在ID);
    this.最終モデル = コードモデル読込() ?? context.globalState.get<{ provider: string; model: string }>('最終モデル')
      ?? (selected?.モデル選択済み ? { provider: selected.provider, model: selected.model }
      : old?.モデル選択済み ? { provider: old.provider, model: old.model }
        : { provider: config.get('provider', ''), model: config.get('model', '') });
    if (selected) {
      this.会話ID = selected.id;
      this.会話 = { ...selected, メッセージ: [...selected.メッセージ] };
    } else if (!saved && old && (old.メッセージ.length || old.コアセッションID)) {
      this.会話 = old;
      this.保存();
    } else {
      this.会話 = { メッセージ: [], 作業URI: '', ...this.最終モデル, モデル選択済み: true };
    }
    this.最終モデル = コード選択(this.最終モデル);
    Object.assign(this.会話, コード選択(this.会話));
    const 作業更新 = (editor: vscode.TextEditor | undefined) => {
      if (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)) this.最終作業URI = editor.document.uri;
      if (this.会話 && !this.会話.作業URI) this.接続更新();
      this.通知();
    };
    作業更新(vscode.window.activeTextEditor);
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(作業更新),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.書込実行(); this.履歴読込();
        if (!this.現在フォルダ()) {
          this.prediction.clear(); this.オフラインジョブ?.停止(); this.オフラインジョブ = undefined;
          this.connection?.dispose(); this.connection = undefined; this.接続フォルダ = '';
          this.実行中 = false; this.停止中 = false; this.添付 = undefined; this.進捗 = [];
          this.会話 = { メッセージ: [], 作業URI: '', ...this.最終モデル, モデル選択済み: true }; this.会話ID = randomUUID();
        }
        this.接続更新(); this.通知();
      })
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    const nonce = randomBytes(24).toString('hex');
    const resource = (path: string) => view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, path)).toString();
    view.webview.html = developmentHtml(resource, view.webview.cspSource, nonce, { kind: 'code' });
    view.webview.onDidReceiveMessage(message => {
      void this.受信(message).catch(error => this.エラー(error));
    }, undefined, this.context.subscriptions);
    view.onDidDispose(() => { if (this.view === view) { this.view = undefined; this.prediction.clear(); this.オフラインジョブ?.停止(); this.connection?.disconnect(); this.接続フォルダ = ''; } }, undefined, this.context.subscriptions);
    view.onDidChangeVisibility(() => this.通知(), undefined, this.context.subscriptions);
  }

  private フォルダ一覧() { return (vscode.workspace.workspaceFolders ?? []).filter(item => usableFolder(item)); }
  private 選択フォルダ(): vscode.WorkspaceFolder | undefined {
    const folders = this.フォルダ一覧();
    const active = this.最終作業URI && vscode.workspace.getWorkspaceFolder(this.最終作業URI);
    return folders.find(item => item.uri.toString() === active?.uri.toString()) ?? folders[0];
  }
  private 現在フォルダ(): vscode.WorkspaceFolder | undefined {
    const folders = this.フォルダ一覧();
    // 再開する会話は開始時のフォルダを維持し、別プロジェクトへ履歴を渡さない。
    if (this.会話.作業URI) return folders.find(item => item.uri.toString() === this.会話.作業URI);
    return this.選択フォルダ();
  }
  private モデル変更中(): boolean { return this.モデル反映中 || this.connection?.modelChanging === true; }
  private オフライン使用(): boolean { return !this.connection?.connected || Boolean(this.オフラインジョブ); }
  private 通知(): void {
    if (this.破棄済み) return;
    this.prediction.sync();
    const folder = this.現在フォルダ();
    void this.view?.webview.postMessage({
      type: 'state', ...this.会話, 会話ID: this.会話ID, 添付: this.添付?.名前, 実行中: this.実行中, 進捗: this.進捗,
      ...(this.オフライン使用() ? this.オフラインモデル : {}),
      オフライン対応: true, 実行モード: this.オフライン使用() ? 'offline' : 'online',
      自動接続: this.自動接続, 停止中: this.停止中, 検証回数: this.検証回数,
      履歴: this.履歴.filter(item => item.作業URI === folder?.uri.toString())
        .sort((a, b) => b.更新日時 - a.更新日時)
        .map(item => ({ id: item.id, 題名: this.題名(item), 更新日時: item.更新日時 })),
      作業フォルダ: folder ? { 名前: folder.name, パス: folder.uri.fsPath } : null,
      接続プロジェクトパス: this.connection?.projectPath || '', 接続世代: this.connection?.epoch ?? 0,
      新規可能: Boolean(this.選択フォルダ()), 信頼済み: vscode.workspace.isTrusted,
      モデル変更中: this.モデル変更中(), 接続済み: this.connection?.connected === true, 接続中: this.connection?.接続中 === true, 接続エラー: this.connection?.error || ''
    });
  }
  private 題名(item: 会話): string {
    return ('初回依頼' in item && typeof item.初回依頼 === 'string' ? item.初回依頼 : item.メッセージ.find(message => message.種別 === 'user')?.本文)?.replace(/\s+/g, ' ').slice(0, 160) || '新しい会話';
  }
  private フォルダパス(作業URI: string): string | undefined {
    return this.フォルダ一覧().find(item => item.uri.toString() === 作業URI)?.uri.fsPath;
  }
  /** 開いているフォルダごとに _AIDIY/aidiy_code/histories/ から読む。旧版の workspaceState の履歴は、そのフォルダへ移す。 */
  private 履歴読込(): void {
    const 一覧: 保存会話[] = [];
    for (const folder of this.フォルダ一覧()) {
      const uri = folder.uri.toString();
      try {
        const list = 会話一覧(会話保存先(folder.uri.fsPath));
        const ids = new Set(list.map(item => item.id));
        for (const item of this.旧履歴.filter(entry => entry.作業URI === uri && !ids.has(entry.id))) {
          会話書込(会話保存先(folder.uri.fsPath, true)!, 履歴へ(item)); list.push(履歴へ(item)); ids.add(item.id);
        }
        this.旧履歴 = this.旧履歴.filter(entry => entry.作業URI !== uri);
        一覧.push(...list.map(item => 会話へ(item, uri)));
      } catch (error) { this.ログ.appendLine(`会話履歴を読み込めません (${folder.name}): ${String(error)}`); }
    }
    this.履歴 = 一覧;
  }
  /** 応答の途中経過ごとに書かないよう、まとめてプロジェクトへ書き込む。 */
  private 書込実行(): void {
    clearTimeout(this.書込タイマー); this.書込タイマー = undefined;
    for (const entry of this.書込待ち.values()) {
      const path = this.フォルダパス(entry.作業URI);
      if (!path) continue;
      try { 会話書込(会話保存先(path, true)!, 履歴へ(entry)); } catch (error) { this.ログ.appendLine(`会話を保存できません: ${String(error)}`); }
    }
    this.書込待ち.clear();
  }
  private 保存(更新日時を変更 = true): void {
    // 大量の会話による workspaceState 肥大化を防ぐ。AIコアの履歴はコアセッションIDで継続する。
    let サイズ = 0;
    const messages = this.会話.メッセージ.slice(-60).reverse().filter(item => (サイズ += 履歴メッセージ長さ(item)) <= 会話本文上限).reverse();
    this.会話.メッセージ = messages;
    if (this.会話.作業URI && (messages.length || this.会話.コアセッションID)) {
      const previous = this.履歴.find(item => item.id === this.会話ID);
      const snapshot = JSON.parse(JSON.stringify({ ...this.会話, メッセージ: messages, id: this.会話ID,
        初回依頼: previous?.初回依頼 ?? this.会話.メッセージ.find(item => item.種別 === 'user')?.本文.replace(/\s+/g, ' ').slice(0, 160),
        更新日時: 更新日時を変更 ? Date.now() : previous?.更新日時 ?? Date.now() })) as 保存会話;
      this.履歴 = [snapshot, ...this.履歴.filter(item => item.id !== this.会話ID)];
      this.書込待ち.set(snapshot.id, snapshot);
      this.書込タイマー ??= setTimeout(() => this.書込実行(), 500);
    }
    // workspaceState には今の会話IDと、まだ移していない旧版の履歴だけを残す
    const snapshot: 会話履歴 = { 現在ID: this.会話ID, 一覧: this.旧履歴 };
    this.保存待ち = this.保存待ち.then(() => this.context.workspaceState.update('会話履歴', snapshot)).then(undefined, error => {
      this.ログ.appendLine(`会話を保存できません: ${String(error)}`);
    });
  }
  private エラー(error: unknown): void {
    const text = error instanceof Error ? error.message : String(error);
    this.会話.メッセージ.push({ 種別: 'error', 本文: text });
    this.保存(); this.通知();
  }
  操作可能(): boolean { return vscode.workspace.isTrusted && !!this.現在フォルダ(); }
  private 信頼確認(): void {
    if (!this.現在フォルダ()) throw new Error(folderRequired);
    if (!vscode.workspace.isTrusted) throw new Error('ワークスペースを信頼してから実行してください。');
  }
  private 会話変更(type: 'new' | 'selectHistory' | 'deleteHistory', id: unknown, requestId: unknown): void {
    const result = (ok: boolean, message = '', uncertain = false) => {
      if (typeof requestId !== 'string' || !requestId || requestId.length > 128 || requestId.includes('\0')) return;
      void this.view?.webview.postMessage({ type: 'conversationChangeResult', requestId, ok, message, uncertain,
        会話ID: this.会話ID, projectPath: this.現在フォルダ()?.uri.fsPath || '' });
    };
    const rejection = this.実行中 || this.オフラインジョブ || this.モデル変更中() ? '実行中またはモデル変更中は会話を切り替えられません。'
      : type !== 'new' && (typeof id !== 'string' || !this.履歴.some(item => item.id === id && item.作業URI === this.現在フォルダ()?.uri.toString())) ? '会話がありません。一覧を確認してください。' : '';
    if (rejection) { this.通知(); result(false, rejection); return; }
    try {
      if (type === 'new') this.新規();
      else if (type === 'selectHistory') this.履歴選択(id as string);
      else this.履歴削除(id as string);
      result(true);
    } catch (error) {
      // 変更途中の例外は適用状況を断定せず、受信側に旧会話を再公開させない。
      result(false, error instanceof Error ? error.message : String(error), true);
      throw error;
    }
  }
  private 作業フォルダ(): vscode.WorkspaceFolder {
    const folder = this.現在フォルダ();
    if (!folder) throw new Error('作業フォルダを VS Code で開いてください。以前のフォルダを閉じた場合は、新しい会話を開始してください。');
    return folder;
  }
  private 起動設定(folder: vscode.WorkspaceFolder) {
    const config = vscode.workspace.getConfiguration('aidiyHermes', folder.uri);
    return 起動解決(config.get('cliPath', 'aidiy_hermes'), config.get('pythonPath', ''), folder.uri.fsPath);
  }

  private async 受信(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const data = message as Record<string, unknown>;
    const type = data.メッセージ識別 ?? data.type;
    if (type === 'openFolder') { await vscode.commands.executeCommand('workbench.action.files.openFolder'); return; }
    if (type !== 'ready' && !this.操作可能()) {
      this.通知();
      const message = !this.現在フォルダ() ? folderRequired : 'ワークスペースを信頼してください。';
      if (type === 'sendFile') void this.view?.webview.postMessage({ type: 'fileUploadResult', requestId: data.requestId, ok: false, message });
      if (['new', 'selectHistory', 'deleteHistory'].includes(String(type))) void this.view?.webview.postMessage({ type: 'conversationChangeResult', requestId: data.requestId, ok: false, message });
      if (type === 'chooseModel') void this.view?.webview.postMessage({ type: 'modelCatalogError', provider: data.provider, message });
      return;
    }
    switch (data.メッセージ識別 ?? data.type) {
      case 'ready': this.接続更新(); this.通知(); break;
      case 'predictInput': {
        const view = this.view;
        const result = await this.prediction.predict(data);
        if (!this.破棄済み && view && this.view === view) void view.webview.postMessage(result);
        break;
      }
      case 'cancelPrediction': this.prediction.cancel(data.requestId); break;
      case 'sendFile': {
        if (typeof data.requestId !== 'string' || !data.requestId || data.requestId.length > 128) return;
        try {
          this.信頼確認(); this.作業フォルダ();
          if (this.実行中 || this.モデル変更中()) throw new Error('実行中またはモデル変更中はファイルを添付できません。');
          if (this.オフライン使用() || !this.connection?.connected) throw new Error('ファイル添付はAIコア接続中に使用できます。');
          if (!Number.isSafeInteger(data.connectionEpoch) || data.connectionEpoch !== this.connection.epoch
              || data.conversationId !== this.会話ID || data.sessionId !== this.connection.session || data.projectPath !== this.connection.projectPath || !this.connection.projectPath)
            throw new Error('会話または接続が変わりました。ファイルを選び直してください。');
          const file = validateFileUpload({name: data.name, base64: data.base64});
          if (!this.connection.send({ メッセージ識別: 'input_file', メッセージ内容: file.base64, ファイル名: file.name })) throw new Error('AIコアへファイルを送信できません。');
          void this.view?.webview.postMessage({ type: 'fileUploadResult', requestId: data.requestId, ok: true });
        } catch (error) {
          void this.view?.webview.postMessage({ type: 'fileUploadResult', requestId: data.requestId, ok: false, message: error instanceof Error ? error.message : 'ファイルを送信できません。' });
        }
        break;
      }
      case 'autoConnect':
        if (typeof data.enabled !== 'boolean') throw new Error('自動接続の指定が不正です。');
        if (this.実行中 || this.オフラインジョブ || this.モデル変更中()) throw new Error('実行中またはモデル変更中は自動接続を変更できません。');
        if (data.enabled) this.信頼確認();
        if (this.自動接続 === data.enabled) { this.通知(); break; }
        this.自動接続 = data.enabled; this.接続更新(true); this.通知(); break;
      case 'connect':
      case 'disconnect':
        if (this.実行中 || this.オフラインジョブ || this.モデル変更中()) throw new Error('実行中またはモデル変更中は接続を変更できません。');
        if ((data.メッセージ識別 ?? data.type) === 'connect') this.信頼確認();
        this.自動接続 = (data.メッセージ識別 ?? data.type) === 'connect'; this.接続更新(true); this.通知(); break;
      case 'input_text':
      case 'input_request':
        if (typeof data.メッセージ内容 === 'string') {
          await this.送信(data.メッセージ内容, data.self_check_loop);
        }
        break;
      case 'cancel_run':
        if (!this.実行中 || this.停止中) break;
        this.停止中 = true;
        if (this.オフラインジョブ) this.オフラインジョブ.停止();
        else if (!this.connection?.send({ メッセージ識別: 'cancel_run', メッセージ内容: '強制停止！' })) {
          this.停止中 = false; this.通知(); throw new Error('AIコアへ停止要求を送信できません。');
        }
        this.通知(); break;
      case 'new': this.会話変更('new', data.id, data.requestId); break;
      case 'selectHistory': this.会話変更('selectHistory', data.id, data.requestId); break;
      case 'deleteHistory': this.会話変更('deleteHistory', data.id, data.requestId); break;
      case 'attach': await this.選択添付(); break;
      case 'removeAttachment': if (!this.実行中) { this.添付 = undefined; this.通知(); } break;
      case 'settings': await vscode.commands.executeCommand('aidiyHermes.settings'); break;
      case 'chooseModel': await this.モデル候補通知(data.provider); break;
      case 'setModel': await this.モデル反映(data.provider, data.model); break;
      case 'setSelfCheckLoop': this.検証回数 = 検証回数保存(data.count, this.設定保存先); break;
      case 'terminal': await this.ターミナル(); break;
      case 'logs': this.ログ.show(true); break;
      case 'link':
        if (typeof data.url === 'string' && /^https?:\/\//i.test(data.url)) await vscode.env.openExternal(vscode.Uri.parse(data.url));
        break;
      case 'copy': if (typeof data.text === 'string') await vscode.env.clipboard.writeText(data.text); break;
    }
  }

  private 接続更新(force = false): void {
    const folder = this.現在フォルダ();
    if (!this.自動接続 || !vscode.workspace.isTrusted || !folder || this.破棄済み) { this.connection?.dispose(); this.connection = undefined; this.接続フォルダ = ''; return; }
    if (this.connection && this.接続フォルダ !== folder.uri.fsPath) { this.connection.dispose(); this.connection = undefined; }
    if (!this.connection) {
      const { backend, authorization } = extensionCoreConnection(this.context.extensionPath, folder.uri.fsPath);
      this.connection = new CodeConnection(
        backend, packet => {
          if (!this.オフラインジョブ) this.パケット受信(packet);
        }, () => {
          if (this.connection?.connected) {
            this.会話.コアセッションID = this.connection.session;
            this.会話.provider = this.connection.model.provider; this.会話.model = this.connection.model.model;
            this.保存(false);
          } else if (!this.オフラインジョブ) { this.実行中 = false; this.停止中 = false; }
          this.通知();
        }, undefined, undefined, authorization);
    }
    if (!force && this.接続フォルダ === folder.uri.fsPath) return;
    if (!this.会話.作業URI) this.会話.作業URI = folder.uri.toString();
    this.接続フォルダ = folder.uri.fsPath;
    this.connection.start(folder.uri.fsPath, this.会話, this.会話.コアセッションID, this.会話.メッセージ);
  }
  private パケット受信(packet: Packet | コードパケット): void {
    if (this.破棄済み) return;
    void this.view?.webview.postMessage(packet);
    const text = typeof packet.メッセージ内容 === 'string' ? packet.メッセージ内容 : '';
    if (['input_file', 'output_file'].includes(packet.メッセージ識別 || '')) {
      const attachment = fileAttachment(packet, this.connection?.session || '', '1');
      if (!attachment || this.会話.メッセージ.some(item => isDuplicateAttachment(item.添付, attachment))) return;
      this.会話.メッセージ.push({ 種別: attachment.kind === 'input_file' ? 'user' : 'assistant', 本文: attachment.name, 添付: attachment });
    } else if (packet.メッセージ識別 === 'output_stream') {
      const control = streamControlOf(text);
      if (control === 'start') this.実行中 = true;
      else if (control === 'cancel' && !this.オフラインジョブ) this.実行中 = false;
      else if (!control && text) {
        const line = visibleStreamContent(text);
        this.ログ.appendLine(line); this.進捗 = [...this.進捗, line.slice(0, 4000)].slice(-100);
      }
    } else if (packet.メッセージ識別 === 'output_text' || packet.メッセージ識別 === 'output') {
      if (text) this.会話.メッセージ.push({ 種別: 'assistant', 本文: text });
      if (!this.オフラインジョブ) this.実行中 = false;
    } else if (['error', 'cancel_run', 'output_end'].includes(packet.メッセージ識別 || '')) {
      if (text) this.会話.メッセージ.push({ 種別: 'error', 本文: text });
      if (!this.オフラインジョブ) this.実行中 = false;
    } else return;
    if ('実行中' in packet && typeof packet.実行中 === 'boolean') this.実行中 = packet.実行中;
    if (this.オフラインジョブ) this.実行中 = true;
    if (!this.実行中) this.停止中 = false;
    this.保存(); this.通知();
  }
  private async 候補取得(provider = ''): Promise<{ id: string; label: string }[]> {
    this.信頼確認(); this.接続更新();
    if (this.オフライン使用()) {
      return provider === 'aidiy_hermes' ? this.オフライン候補 : provider ? [] : [{ id: 'aidiy_hermes', label: 'aidiy_hermes' }];
    }
    if (!this.connection) throw new Error('作業フォルダを開いてください。');
    return this.connection.catalog(provider);
  }

  private async モデル候補通知(value: unknown): Promise<void> {
    if (this.実行中 || typeof value !== 'string' || value.length > 200) return;
    try {
      const items = await this.候補取得(value);
      if (!this.破棄済み) await this.view?.webview.postMessage({ type: 'modelCatalog', provider: value, items });
    } catch (error) {
      if (!this.破棄済み) await this.view?.webview.postMessage({ type: 'modelCatalogError', provider: value, message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async モデル反映(providerValue: unknown, modelValue: unknown): Promise<void> {
    if (this.実行中 || this.オフラインジョブ || this.モデル変更中()) return;
    this.モデル反映中 = true; this.通知();
    try { await this.モデル反映処理(providerValue, modelValue); }
    finally { this.モデル反映中 = false; this.通知(); }
  }
  private async モデル反映処理(providerValue: unknown, modelValue: unknown): Promise<void> {
    if (this.実行中 || typeof providerValue !== 'string' || typeof modelValue !== 'string'
      || providerValue.length > 200 || modelValue.length > 300 || modelValue === '__manual__') return;
    const selectedProvider = providerValue.trim();
    const selectedModel = modelValue.trim();
    this.信頼確認();
    if (this.オフライン使用()) {
      if (selectedProvider !== 'aidiy_hermes' || !this.オフライン候補.some(item => item.id === selectedModel))
        throw new Error('オフライン用のHermesモデルを選択してください。');
      this.オフラインモデル = コードモデル保存({ provider: selectedProvider, model: selectedModel }, this.オフライン保存先);
      this.通知(); return;
    }
    const projectPath = this.作業フォルダ().uri.fsPath;
    const connection = this.connection;
    if (selectedProvider) {
      const providers = await this.候補取得();
      if (!providers.some(item => item.id === selectedProvider)) throw new Error('選択したプロバイダを確認できません。');
    }
    if (!this.操作可能() || this.現在フォルダ()?.uri.fsPath !== projectPath || this.connection !== connection || !this.connection?.connected) throw new Error('接続が切れました。モデルを選び直してください。');
    const selected = コード選択({ provider: selectedProvider, model: selectedModel });
    await this.connection.setModel(selected);
    if (!this.操作可能() || this.現在フォルダ()?.uri.fsPath !== projectPath || this.connection !== connection) return;
    const persisted = コードモデル保存(selected);
    this.会話.provider = persisted.provider; this.会話.model = persisted.model;
    this.会話.モデル選択済み = true;
    this.最終モデル = { provider: this.会話.provider, model: this.会話.model };
    void this.context.globalState.update('最終モデル', this.最終モデル).then(undefined, error => this.ログ.appendLine(`モデルを保存できません: ${String(error)}`));
    this.保存(false); this.通知();
  }

  private async 送信(本文: string, 検証ループ回数: unknown = 1): Promise<void> {
    if (this.実行中 || !本文.trim()) return;
    if (this.モデル変更中()) throw new Error('モデルを変更しています。');
    this.信頼確認();
    const { provider, model } = this.会話;
    if (本文.length > 200_000 || provider.length > 200 || model.length > 300) throw new Error('入力が長すぎます。文章を分けて送信してください。');
    const folder = this.作業フォルダ();
    const fullPrompt = this.添付 ? `${本文}\n\n--- 選択コード: ${this.添付.名前} ---\n${this.添付.本文}\n--- 選択コードここまで ---` : 本文;
    const self_check_loop = typeof 検証ループ回数 === 'number' && Number.isInteger(検証ループ回数) ? Math.max(0, Math.min(3, 検証ループ回数)) : 1;
    const offline = this.オフライン使用();
    const launch = offline ? this.起動設定(folder) : undefined;
    if (!offline && !this.connection?.send({ メッセージ識別: 'input_text', メッセージ内容: fullPrompt, self_check_loop }))
      throw new Error('AIコアが未接続のため送信できません。');
    this.会話.作業URI = folder.uri.toString();
    this.会話.メッセージ.push({ 種別: 'user', 本文: fullPrompt });
    this.添付 = undefined; this.実行中 = true; this.進捗 = [];
    this.ログ.clear(); this.保存(); this.通知();
    void this.view?.webview.postMessage({ type: 'accepted' });
    if (offline) {
      try {
        const job = オフライン実行(this.context.extensionPath, folder.uri.fsPath, this.オフラインモデル.model,
          fullPrompt, this.会話.HermesセッションID, packet => { if (this.現在フォルダ()?.uri.fsPath === folder.uri.fsPath && this.会話.作業URI === folder.uri.toString()) this.パケット受信(packet); }, launch);
        this.オフラインジョブ = job;
        void job.完了.then(result => {
          if (this.破棄済み || this.オフラインジョブ !== job) return;
          if (result.セッションID || result.セッション復旧) this.会話.HermesセッションID = result.セッションID;
          if (result.停止理由) this.エラー(result.停止理由);
          else if (result.終了コード !== 0) this.エラー(`Hermesが終了コード ${result.終了コード} で終了しました。`);
        }).catch(error => { if (!this.破棄済み && this.オフラインジョブ === job) this.エラー(error); }).finally(() => {
          if (this.オフラインジョブ !== job) return;
          this.オフラインジョブ = undefined; this.実行中 = false; this.停止中 = false;
          if (!this.破棄済み) { this.保存(); this.通知(); }
        });
      } catch (error) {
        this.実行中 = false; this.通知(); throw error;
      }
    }
  }

  新規(): void {
    if (this.実行中 || this.オフラインジョブ || this.モデル変更中()) return;
    this.会話 = { メッセージ: [], 作業URI: this.選択フォルダ()?.uri.toString() ?? '', ...this.最終モデル, モデル選択済み: true };
    this.会話ID = randomUUID();
    this.添付 = undefined; this.進捗 = []; this.保存(); this.接続更新(true); this.通知();
    void this.view?.webview.postMessage({ type: 'showConversation' });
  }
  private 履歴選択(id: string): void {
    if (this.実行中 || this.オフラインジョブ || this.モデル変更中()) return;
    const entry = this.履歴.find(item => item.id === id && item.作業URI === this.現在フォルダ()?.uri.toString());
    if (!entry) return;
    this.会話ID = entry.id;
    this.会話 = { ...entry, メッセージ: [...entry.メッセージ] };
    this.添付 = undefined; this.進捗 = [];
    this.保存(false); this.接続更新(true); this.通知();
  }
  private 履歴削除(id: string): void {
    if (this.実行中 || this.オフラインジョブ || this.モデル変更中()) return;
    const entry = this.履歴.find(item => item.id === id && item.作業URI === this.現在フォルダ()?.uri.toString());
    if (!entry) return;
    this.履歴 = this.履歴.filter(item => item.id !== id);
    this.書込待ち.delete(id);
    try { const path = this.フォルダパス(entry.作業URI); if (path) 会話削除(会話保存先(path), id); }
    catch (error) { this.ログ.appendLine(`会話を削除できません: ${String(error)}`); }
    if (this.会話ID === id) {
      this.会話 = { メッセージ: [], 作業URI: entry.作業URI, ...this.最終モデル, モデル選択済み: true };
      this.会話ID = randomUUID(); this.添付 = undefined; this.進捗 = []; this.接続更新(true);
    }
    this.保存(); this.通知();
  }
  async 選択添付(): Promise<void> {
    this.信頼確認();
    if (this.実行中) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) { void vscode.window.showInformationMessage('エディターでコードを選択してから添付してください。'); return; }
    const text = editor.document.getText(editor.selection);
    if (text.length > 80_000) throw new Error('選択コードが長すぎます。80,000 文字以内で選択してください。');
    this.添付 = { 名前: `${vscode.workspace.asRelativePath(editor.document.uri)}:${editor.selection.start.line + 1}–${editor.selection.end.line + 1}`, 本文: text };
    await vscode.commands.executeCommand('aidiyHermes.chat.focus'); this.通知();
  }
  async ターミナル(): Promise<void> {
    this.信頼確認();
    const folder = this.作業フォルダ();
    const 起動 = this.起動設定(folder);
    vscode.window.createTerminal({ name: 'AiDiy Code', shellPath: 起動.実行ファイル, shellArgs: 起動.引数, cwd: folder.uri.fsPath, env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', TERMINAL_CWD: folder.uri.fsPath } }).show();
  }
  ログ表示(): void { this.ログ.show(true); }
  dispose(): void {
    this.書込実行();
    this.破棄済み = true;
    this.prediction.clear();
    if (this.オフラインジョブ) this.オフラインジョブ.停止();
    else if (this.実行中) this.connection?.send({ メッセージ識別: 'cancel_run' });
    this.connection?.dispose(); this.ログ.dispose();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const chat = new Hermesチャット(context);
  const command = (name: string, action: () => unknown) => vscode.commands.registerCommand(name, async () => {
    try {
      if (name !== 'aidiyHermes.open' && !chat.操作可能()) { await vscode.window.showInformationMessage(folderRequired); return; }
      await action(); } catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
  });
  context.subscriptions.push(chat,
    vscode.window.registerWebviewViewProvider('aidiyHermes.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }),
    command('aidiyHermes.open', () => vscode.commands.executeCommand('aidiyHermes.chat.focus')),
    command('aidiyHermes.newChat', () => chat.新規()),
    command('aidiyHermes.attachSelection', () => chat.選択添付()),
    command('aidiyHermes.settings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:aidiy.aidiy-code')),
    command('aidiyHermes.terminal', () => chat.ターミナル()),
    command('aidiyHermes.logs', () => chat.ログ表示())
  );
}
