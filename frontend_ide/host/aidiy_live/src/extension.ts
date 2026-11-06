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
import { usableFolder, folderRequired } from '../../src/workspace-folder';
import { developmentHtml } from '../../src/vscode-html';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extensionCoreConnection } from '../../src/extension-installation';
import { LiveHost, microphonePython } from './host';
import { ライブモデル読込, ライブモデル保存 } from '../../src/model-preferences';

class LiveView implements vscode.WebviewViewProvider, vscode.Disposable {
  private host?: LiveHost;
  private view?: vscode.WebviewView;
  private browser?: Awaited<ReturnType<typeof import('./server').ライブ起動>>;
  private generation = 0;
  private boundFolder = '';
  private viewResources: vscode.Disposable[] = [];
  ready = false;
  constructor(private context: vscode.ExtensionContext) {}
  private folder() {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const folder = (uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined)
      || vscode.workspace.workspaceFolders?.find(folder => usableFolder(folder));
    return vscode.workspace.isTrusted && usableFolder(folder) && folder ? { 名前: folder.name, パス: folder.uri.fsPath } : null;
  }
  folderChanged() {
    if (this.view && this.boundFolder !== (this.folder()?.パス || '')) this.resolveWebviewView(this.view);
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.host?.dispose(); this.viewResources.splice(0).forEach(item => item.dispose());
    this.view = view; this.ready = false;
    const folder = this.folder(); this.boundFolder = folder?.パス || '';
    const viewGeneration = ++this.generation;
    const { backend, authorization } = extensionCoreConnection(this.context.extensionPath, this.folder()?.パス);
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media'), vscode.Uri.joinPath(this.context.extensionUri, 'dist')] };
    const resource = (path: string) => view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, path)).toString();
    const nonce = randomBytes(24).toString('hex');
    view.webview.html = developmentHtml(resource, view.webview.cspSource, nonce, { kind: 'live', live: { host: true, backend, captureUrl: resource('media/capture.js'), 作業フォルダ: this.folder(), 保存モデル設定: ライブモデル読込() } });
    const pending: { message: unknown; size: number }[] = [];
    let pendingSize = 0;
    const host = this.host = new LiveHost(backend, message => {
      if (this.view !== view || viewGeneration !== this.generation) return;
      if (view.visible) { void view.webview.postMessage(message); return; }
      const packet = message as { type?: string; data?: string };
      // 非表示中の音声を復帰時にまとめて再生しない。会話と接続通知は保持する。
      if (packet.type === 'socket-data' && packet.data) {
        try { if (JSON.parse(packet.data).メッセージ識別 === 'output_audio') return; } catch { return; }
      }
      const size = JSON.stringify(message).length;
      pending.push({ message, size }); pendingSize += size;
      while (pending.length > 200 || pendingSize > 2_000_000) pendingSize -= pending.shift()!.size;
    }, () => microphonePython(
      vscode.workspace.getConfiguration('aidiyLive').get<string>('pythonPath', ''),
      (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath)
    ), join(this.context.extensionPath, 'dist/microphone.py'), authorization);
    const resources = this.viewResources = [
      view.webview.onDidReceiveMessage(message => {
        if (viewGeneration !== this.generation) return;
        if (message?.type === 'open-folder') { void vscode.commands.executeCommand('workbench.action.files.openFolder'); return; }
        if (message?.type !== 'ui-ready' && (!folder || this.folder()?.パス !== folder.パス)) {
          host.stop();
          if (Number.isSafeInteger(message?.id)) {
            void view.webview.postMessage({ type: 'reply', id: message.id, error: folderRequired });
            if (message.type?.startsWith('socket-')) void view.webview.postMessage({ type: 'socket-closed', id: message.id });
          }
          this.folderChanged(); return;
        }
        if (message?.type === 'ui-ready') this.ready = true;
        else if (message?.type === 'save-model' && Number.isSafeInteger(message.id) && message.id > 0) {
          try {
            ライブモデル保存(message.settings);
            void view.webview.postMessage({ type: 'reply', id: message.id, value: { ok: true } });
          } catch (error) {
            void view.webview.postMessage({ type: 'reply', id: message.id, error: error instanceof Error ? error.message : String(error) });
          }
        }
        else void host.receive(message).catch(error => { void vscode.window.showErrorMessage(String(error)); });
      }),
      view.onDidChangeVisibility(() => {
        host.visibility(view.visible);
        if (view.visible) {
          for (const item of pending.splice(0)) void view.webview.postMessage(item.message);
          pendingSize = 0; this.folderChanged();
        }
      }),
    ];
    resources.push(view.onDidDispose(() => { host.dispose(); resources.forEach(resource => resource.dispose()); if (this.view === view) { this.view = undefined; this.host = undefined; } }));
  }
  stop() { this.host?.stop(); }
  async standalone() {
    if (!this.folder()) { void vscode.window.showInformationMessage(folderRequired); return; }
    if (!vscode.workspace.isTrusted) throw new Error('ライブ会話は信頼済みのワークスペースで開いてください。');
    this.stop();
    const generation = ++this.generation;
    await this.browser?.close(); this.browser = undefined;
    const { backend, authorization } = extensionCoreConnection(this.context.extensionPath, this.folder()?.パス);
    // 配布済み Live 拡張だけで使えるブラウザ版。Code / 開発フォルダに依存しない。
    const { ライブ起動 } = await import('./server');
    const server = await ライブ起動(this.context.extensionPath, backend, true, this.folder()?.パス || null, {}, undefined, false, authorization);
    if (generation !== this.generation) { await server.close(); return; }
    this.browser = server;
    await vscode.env.openExternal(vscode.Uri.parse(server.url));
  }
  dispose() { ++this.generation; this.viewResources.splice(0).forEach(item => item.dispose()); this.host?.dispose(); this.host = undefined; this.view = undefined; void this.browser?.close(); this.browser = undefined; }
}

export function activate(context: vscode.ExtensionContext) {
  const live = new LiveView(context);
  context.subscriptions.push(live,
    vscode.window.registerWebviewViewProvider('aidiyLive.chat', live, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('aidiyLive.open', () => vscode.commands.executeCommand('aidiyLive.chat.focus')),
    vscode.commands.registerCommand('aidiyLive.stop', () => live.stop()),
    vscode.commands.registerCommand('aidiyLive.standalone', () => live.standalone()),
    vscode.commands.registerCommand('aidiyLive.settings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:aidiy.aidiy-live')),
    vscode.workspace.onDidChangeWorkspaceFolders(() => live.folderChanged()),
    vscode.window.onDidChangeActiveTextEditor(() => live.folderChanged())
  );
  return { stop: () => live.stop(), getState: () => ({ ready: live.ready }) };
}
