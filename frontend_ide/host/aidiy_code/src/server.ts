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

import { createServer, type ServerResponse } from 'node:http';
import { writeFileSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { internalAuthorization, type InternalAuthorization } from '../../src/internal-auth';
import { CodeConnection, コード選択 } from '../../src/code-connection';
import { InputPrediction } from '../../src/input-prediction';
import { validateFileUpload, fileAttachment, isDuplicateAttachment } from '../../src/file-attachments';
import { ローカル接続先 } from '../../aidiy_live/local-backend.cjs';
import { streamControlOf, visibleStreamContent, type コードパケット } from '../../src/protocol';
import { コードモデル読込, コードモデル保存, モデル保存先, コード設定保存先, 検証回数読込, 検証回数保存 } from '../../src/model-preferences';
import { 接続元許可 } from '../../src/forwarded-origin';
import { 会話保存先, 会話一覧, 会話書込, 会話削除, 会話本文上限, 履歴メッセージ長さ, type 履歴メッセージ } from '../../src/conversation-store';
import { オフライン実行, オフラインモデル候補, オフラインモデル保存先, Hermes既定モデル } from './offline';
import type { Packet } from '../../aidiy_live/src/protocol';

// 単独画面と拡張で AIコア接続・メッセージ形式・描画を共用する。
export async function 単独起動(project: string, backend?: string, initialModel: { provider?: string; model?: string; offline?: boolean; lockedMode?: boolean; keepAlive?: boolean } = {}, modelFile = モデル保存先('code'), runOffline = オフライン実行, historyFolder?: string, authorization?: InternalAuthorization, createSocket?: ConstructorParameters<typeof CodeConnection>[3]) {
  const root = resolve(__dirname, '../..');
  const folder = resolve(project);
  if (!statSync(folder).isDirectory()) throw new Error('作業フォルダがありません。');
  const savedModel = コードモデル読込(modelFile);
  const defaultModel = { provider: 'aidiy_hermes', model: Hermes既定モデル(root, folder) };
  const requestedProvider = initialModel.provider?.trim(), requestedModel = initialModel.model?.trim();
  const remembered = !requestedModel && (!requestedProvider || requestedProvider === savedModel?.provider) ? savedModel : undefined;
  const offlineFile = オフラインモデル保存先(modelFile);
  const offlineSaved = コードモデル読込(offlineFile);
  // 最後に選んだオンラインの検証回数を次回も使う（未保存なら0回）。
  const optionsFile = コード設定保存先(modelFile);
  // 診断で保存し直した候補を、再起動せず一覧表示と選択検証の両方へ反映する。
  const offlineModels = () => オフラインモデル候補(root, folder);
  const offlineModelAllowed = (model: string) => offlineModels().some(item => item.id === model);
  const modeModels = {
    online: コード選択(initialModel.offline ? savedModel ?? {provider:'',model:''}
      : remembered ?? (!requestedProvider && !requestedModel ? {provider:'',model:''}
        : { provider: requestedProvider || 'aidiy_hermes', model: requestedModel || (requestedProvider === 'aidiy_hermes' ? defaultModel.model : '') })),
    offline: { provider: 'aidiy_hermes', model: offlineSaved?.provider === 'aidiy_hermes' && offlineModelAllowed(offlineSaved.model)
      ? offlineSaved.model : offlineModelAllowed(defaultModel.model) ? defaultModel.model : 'same' },
  };
  if (initialModel.offline && (requestedProvider || requestedModel)) {
    const selected = コード選択({ provider: requestedProvider || 'aidiy_hermes', model: requestedModel || modeModels.offline.model });
    if (selected.provider !== 'aidiy_hermes') throw new Error('オフラインでは aidiy_hermes だけを使用できます。');
    if (!offlineModelAllowed(selected.model)) throw new Error('オフラインのモデルは same または aidiy_diag の一覧から選択してください。');
    modeModels.offline = selected;
  }
  const state = {
    type: 'state', navigationRunSupported: true, 会話ID: randomUUID() as string, 作業URI: folder, 信頼済み: true,
    作業フォルダ: { 名前: basename(folder), パス: folder },
    ...modeModels[initialModel.offline ? 'offline' : 'online'],
    オフライン対応: true, 実行モード: (initialModel.offline ? 'offline' : 'online') as 'online' | 'offline',
    自動接続: !initialModel.offline, 接続済み: false, 接続中: false, 接続エラー: '', モデル変更中: false,
    検証回数: 検証回数読込(optionsFile) ?? 0,
    メッセージ: [] as 履歴メッセージ[], 進捗: [] as string[], 実行中: false, 停止中: false,
    セッションID: undefined as string | undefined, 接続プロジェクトパス: '', 接続世代: 0,
    HermesセッションID: undefined as string | undefined,
    履歴: [] as { id: string; 題名: string; 更新日時: number }[]
  };
  type 保存会話 = { id: string; メッセージ: typeof state.メッセージ; セッションID?: string; HermesセッションID?: string; 実行モード: 'online' | 'offline'; provider: string; model: string; 更新日時: number; 初回依頼?: string };
  // 会話履歴はプロジェクトの _AIDIY/aidiy_code/histories/ に保存し、次回の起動や VS Code 拡張とも共用する
  const 履歴フォルダ = (create = false) => historyFolder ?? 会話保存先(folder, create);
  let history: 保存会話[] = 会話一覧(履歴フォルダ()).map(item => ({ ...item, 実行モード: item.実行モード ?? 'online' }));
  const 履歴表示 = () => [...history].sort((a, b) => b.更新日時 - a.更新日時)
    .map(item => ({ id: item.id, 題名: `${item.実行モード === 'offline' ? '[オフライン] ' : ''}${item.初回依頼 || '新しい会話'}`, 更新日時: item.更新日時 }));
  state.履歴 = 履歴表示();
  // 応答の途中経過ごとに書かないよう、まとめて書き込む（終了時は残りを書き出す）
  const 書込待ち = new Map<string, 保存会話>();
  let 書込タイマー: NodeJS.Timeout | undefined;
  const 書込実行 = () => {
    clearTimeout(書込タイマー); 書込タイマー = undefined;
    for (const entry of 書込待ち.values()) {
      try { 会話書込(履歴フォルダ(true)!, entry); } catch (error) { console.error(`会話を保存できません: ${String(error)}`); }
    }
    書込待ち.clear();
  };
  const 書込予約 = (entry: 保存会話) => { 書込待ち.set(entry.id, entry); 書込タイマー ??= setTimeout(書込実行, 500); };
  let offlineJob: ReturnType<typeof オフライン実行> | undefined;
  const clients = new Set<ServerResponse>();
  let 接続開始済み = false;
  let closed = false;
  const token = randomBytes(24).toString('hex');
  const prefix = `/${token}/`;
  let origin = '';
  let allowed: 接続元許可 | undefined;
  let idle: NodeJS.Timeout | undefined;
  const broadcast = (packet: unknown) => { for (const client of clients) client.write(`data: ${JSON.stringify(packet)}\n\n`); };
  type NavigationRun = { id: string; offline: boolean; started: boolean; reply: boolean; failed: boolean; cancelling?: boolean };
  let navigationRun: NavigationRun | undefined;
  // 中止要求が送信要求より先に届いても、遅延した送信を実行しない。IDは再利用不可。
  const navigationRequests = new Set<string>();
  const navigationResult = (status: 'accepted' | 'succeeded' | 'failed' | 'cancelled', message = '', settled = false) => {
    const run = navigationRun;
    if (!run) return;
    if (status !== 'accepted') navigationRun = undefined;
    // 切断・終了要求だけを実終了と扱わず、画面が安全に明示再開できる時点を伝える。
    broadcast({ type: 'navigationRunResult', requestId: run.id, status, message, settled });
  };
  // 自動接続ONでは再試行を継続し、未接続中とHermes実行中は単独実行の状態を画面へ返す。
  const オフライン使用 = () => state.実行モード === 'offline' || !state.接続済み || Boolean(offlineJob);
  const 表示状態 = () => オフライン使用() ? { ...state, 実行モード: 'offline',
    ...(state.実行モード === 'offline' ? {} : modeModels.offline),
    セッションID: state.実行モード === 'offline' ? state.セッションID : state.HermesセッションID } : state;
  const prediction = new InputPrediction(root, () => ({ projectPath: connection.projectPath, conversationId: state.会話ID,
    sessionId: connection.session, enabled: !closed && state.自動接続 && !オフライン使用() && !state.実行中 && !state.モデル変更中 }));
  const notify = () => { prediction.sync(); broadcast(表示状態()); };
  const save = (更新日時を変更 = true) => {
    if (!state.メッセージ.length && !state.セッションID) return;
    const previous = history.find(item => item.id === state.会話ID);
    const entry: 保存会話 = { id: state.会話ID, メッセージ: [...state.メッセージ], セッションID: state.セッションID,
      HermesセッションID: state.HermesセッションID,
      実行モード: state.実行モード, provider: state.provider, model: state.model, 更新日時: 更新日時を変更 ? Date.now() : previous?.更新日時 ?? Date.now(),
      初回依頼: previous?.初回依頼 ?? state.メッセージ.find(message => message.種別 === 'user')?.本文.replace(/\s+/g, ' ').slice(0, 160) };
    history = [entry, ...history.filter(item => item.id !== entry.id)];
    state.履歴 = 履歴表示();
    書込予約(entry);
  };
  const trimHistory = () => {
    let size = 0;
    state.メッセージ = state.メッセージ.slice(-60).reverse().filter(item => (size += 履歴メッセージ長さ(item)) <= 会話本文上限).reverse();
  };
  const receive = (packet: Packet | コードパケット) => {
    if (closed) return;
    broadcast(packet);
    const text = typeof packet.メッセージ内容 === 'string' ? packet.メッセージ内容 : '';
    const navigation = navigationRun;
    if (navigation) {
      const control = packet.メッセージ識別 === 'output_stream' ? streamControlOf(text) : undefined;
      const requestId = (packet as Packet).navigationRequestId;
      if (['error', 'cancel_run'].includes(packet.メッセージ識別 || '') || control === 'cancel' || /^\s*!/.test(text)) navigation.failed = true;
      if (!navigation.offline && requestId === navigation.id && control === 'start') navigation.started = true;
      if (navigation.offline || navigation.started) {
        if (['output_text', 'output'].includes(packet.メッセージ識別 || '') && text.trim() && !/^【(?:検証|自己改善)(?:開始|完了)】/.test(text)) navigation.reply = true;
      }
      if (!navigation.offline && requestId === navigation.id && packet.メッセージ識別 === 'output_end' && packet.実行中 === false) {
        navigationResult(navigation.cancelling ? 'cancelled' : (packet as Packet).navigationStatus === 'succeeded' && !navigation.failed && navigation.started && navigation.reply ? 'succeeded' : 'failed',
          navigation.failed ? 'Codeの実行が失敗または停止しました。' : !navigation.reply ? 'Codeの回答を確認できません。' : '', true);
      }
    }
    if (['input_file', 'output_file'].includes(packet.メッセージ識別 || '')) {
      const attachment = fileAttachment(packet, connection.session, '1');
      if (!attachment) return;
      if (state.メッセージ.some(item => isDuplicateAttachment(item.添付, attachment))) return;
      state.メッセージ.push({ 種別: attachment.kind === 'input_file' ? 'user' : 'assistant', 本文: attachment.name, 添付: attachment });
    } else if (packet.メッセージ識別 === 'output_stream') {
      const control = streamControlOf(text);
      if (control === 'start') state.実行中 = true;
      else if (control === 'cancel') state.実行中 = false;
      else if (!control && text) state.進捗 = [...state.進捗, visibleStreamContent(text).slice(0, 4000)].slice(-100);
    } else if (packet.メッセージ識別 === 'output_text' || packet.メッセージ識別 === 'output') {
      if (text) state.メッセージ.push({ 種別: 'assistant', 本文: text });
      state.実行中 = false;
    } else if (['error', 'cancel_run', 'output_end'].includes(packet.メッセージ識別 || '')) {
      if (text) state.メッセージ.push({ 種別: 'error', 本文: text });
      state.実行中 = false;
    } else return;
    if ('実行中' in packet && typeof packet.実行中 === 'boolean') state.実行中 = packet.実行中;
    // 中断の途中通知や無関係なidleでは、所有する要求の実行ロックを解除しない。
    if (offlineJob || navigationRun) state.実行中 = true;
    if (!state.実行中) state.停止中 = false;
    trimHistory(); save(); notify();
  };
  const connection = new CodeConnection(backend || ローカル接続先(root, folder), packet => {
    if (state.実行モード === 'online' && !offlineJob) receive(packet);
  }, () => {
    if (state.実行モード !== 'online' || closed) return;
    state.モデル変更中 = connection.modelChanging;
    state.接続済み = connection.connected; state.接続中 = connection.接続中; state.接続エラー = connection.error;
    state.接続プロジェクトパス = connection.projectPath; state.接続世代 = connection.epoch;
    if (connection.connected) {
      state.セッションID = connection.session;
      state.provider = connection.model.provider; state.model = connection.model.model;
    } else if (!offlineJob) { state.実行中 = false; state.停止中 = false; navigationResult('failed', 'Codeの接続が切れました。'); }
    notify();
  }, createSocket, undefined, authorization || internalAuthorization(new URL(backend || ローカル接続先(root, folder)), [root, folder]));
  const reconnect = () => {
    if (!state.自動接続 || state.実行モード === 'offline') { connection.disconnect(); state.接続済み = false; state.接続中 = false; state.接続エラー = ''; state.モデル変更中 = false; notify(); }
    else connection.start(folder, { provider: state.provider, model: state.model }, state.セッションID, state.メッセージ);
  };
  const newConversation = () => {
    state.会話ID = randomUUID(); state.メッセージ = []; state.進捗 = []; state.セッションID = undefined; state.HermesセッションID = undefined;
    Object.assign(state, modeModels[state.実行モード]); reconnect(); notify();
  };
  const execute = (text: string, 検証ループ回数: unknown = 1) => {
    if (オフライン使用()) {
      // 検証回数に関係なくHermesを1回だけ直接実行する。バックアップ・検証ループはない。
      state.実行中 = true; state.進捗 = [];
      state.メッセージ.push({ 種別: 'user', 本文: text }); trimHistory();
      save(); broadcast({ type: 'accepted', ...(navigationRun ? { navigationRequestId: navigationRun.id } : {}) }); navigationResult('accepted'); notify();
      try {
        const manualOffline = state.実行モード === 'offline';
        const job = runOffline(root, folder, manualOffline ? state.model : modeModels.offline.model, text,
          manualOffline ? state.セッションID : state.HermesセッションID, receive);
        offlineJob = job;
        const ownedNavigation = navigationRun;
        void job.完了.then(result => {
          if (closed) return;
          if (ownedNavigation && navigationRun === ownedNavigation) {
            navigationResult(ownedNavigation.cancelling ? 'cancelled' : !ownedNavigation.failed && ownedNavigation.reply && !result.停止理由 && result.終了コード === 0 ? 'succeeded' : 'failed',
              result.停止理由 || (result.終了コード !== 0 ? `Hermes終了コード: ${result.終了コード}` : !ownedNavigation.reply ? 'Codeの回答を確認できません。' : ''), true);
          }
          if (result.セッションID) {
            state.HermesセッションID = result.セッションID;
            if (manualOffline) state.セッションID = result.セッションID;
          } else if (result.セッション復旧) {
            state.HermesセッションID = undefined;
            if (manualOffline) state.セッションID = undefined;
          }
          if (result.停止理由 || result.終了コード !== 0) receive({ メッセージ識別: 'error', メッセージ内容: result.停止理由 || result.ログ || `Hermes終了コード: ${result.終了コード}` });
        }).catch(error => { navigationResult('failed', String(error)); receive({ メッセージ識別: 'error', メッセージ内容: String(error) }); })
          .finally(() => { offlineJob = undefined; state.実行中 = false; state.停止中 = false; if (!closed) { save(); notify(); } });
      } catch (error) {
        navigationResult('failed', String(error));
        receive({ メッセージ識別: 'error', メッセージ内容: String(error) });
      }
      return;
    }
    const self_check_loop = typeof 検証ループ回数 === 'number' && Number.isInteger(検証ループ回数) ? Math.max(0, Math.min(3, 検証ループ回数)) : 1;
    if (!connection.send({ メッセージ識別: 'input_text', メッセージ内容: text, self_check_loop, ...(navigationRun ? { navigationRequestId: navigationRun.id } : {}) })) throw new Error('AIコアが未接続のため送信できません。');
    state.実行中 = true; state.進捗 = [];
    state.メッセージ.push({ 種別: 'user', 本文: text }); trimHistory();
    save(); broadcast({type:'accepted', ...(navigationRun ? { navigationRequestId: navigationRun.id } : {})}); navigationResult('accepted'); notify();
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const reply = (code: number, value: unknown) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
    try {
      // ローカル（Codespaces ではポート転送先も）専用。別サイトからの CLI 実行、DNS rebinding を受け付けない。
      if (!allowed?.host(req.headers.host) || !req.url?.startsWith(prefix)) { reply(404, {error:'Not found'}); return; }
      if (req.headers.origin && !allowed.origin(req.headers.origin)) { reply(403, {error:'Forbidden'}); return; }
      const url = new URL(req.url, origin);
      const route = url.pathname.slice(prefix.length);
      if (req.method === 'GET' && route === 'events') {
        clearTimeout(idle);
        res.writeHead(200, {'Content-Type':'text/event-stream', Connection:'keep-alive'});
        clients.add(res); res.write(`data: ${JSON.stringify(表示状態())}\n\n`);
        if (!接続開始済み) { 接続開始済み = true; reconnect(); }
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        res.on('close', () => {
          clearInterval(heartbeat); clients.delete(res);
          if (!clients.size) prediction.clear();
          if (!closed && !clients.size && !initialModel.lockedMode && !initialModel.keepAlive) idle = setTimeout(() => { void close(); }, 60_000);
        });
        return;
      }
      if (req.method === 'GET' && route === 'catalog') {
        const provider = url.searchParams.get('provider') ?? '';
        if (provider.length > 200) { reply(400, {error:'Provider too long'}); return; }
        if (オフライン使用() && provider && provider !== 'aidiy_hermes') { reply(400, {error:'オフラインでは aidiy_hermes だけを使用できます。'}); return; }
        const items = オフライン使用()
          ? provider ? offlineModels() : [{ id:'aidiy_hermes', label:'aidiy_hermes' }]
          : await connection.catalog(provider);
        reply(200, provider ? { models: items } : { providers: items }); return;
      }
      if (req.method === 'POST' && route === 'message') {
        if (!allowed.origin(req.headers.origin) || !req.headers['content-type']?.startsWith('application/json')) { reply(403, {error:'Forbidden'}); return; }
        const requestEpoch = connection.epoch;
        req.setEncoding('utf8');
        let body = '', bytes = 0;
        for await (const chunk of req) { bytes += Buffer.byteLength(chunk, 'utf8'); if (bytes > 20 * 1024 * 1024) { reply(413, {error:'Message too long'}); return; } body += chunk; }
        const data = JSON.parse(body);
        const type = data.メッセージ識別 ?? data.type;
        // IDE埋め込み時は、親画面で選んだ利用モードを維持する。
        if (initialModel.lockedMode && ['autoConnect', 'executionMode', 'connect', 'disconnect'].includes(type)) {
          reply(409, {error:'接続モードはAiDiy IDEの利用開始画面で変更してください。'}); return;
        }
        if (type === 'predictInput') {
          void prediction.predict(data).then(result => { if (!closed) broadcast(result); });
          reply(200, {ok:true}); return;
        }
        if (type === 'cancelPrediction') { prediction.cancel(data.requestId); reply(200, {ok:true}); return; }
        if (type === 'cancel_run') {
          if (data.navigationRequestId !== undefined) {
            if (typeof data.navigationRequestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(data.navigationRequestId)) { reply(400, {error:'実行IDが不正です。'}); return; }
            if (navigationRequests.size >= 10000 && !navigationRequests.has(data.navigationRequestId)) { reply(409, {error:'Codeを開き直してください。'}); return; }
            navigationRequests.add(data.navigationRequestId);
            if (navigationRun?.id !== data.navigationRequestId) { reply(200, {ok:true, navigationPending:false}); return; }
          }
          const ownedNavigation = navigationRun;
          // HTTP応答は停止要求の受付だけ。terminalは実際のoutput_end/プロセス終了まで待つ。
          if (ownedNavigation) ownedNavigation.cancelling = true;
          if ((!state.実行中 && !ownedNavigation) || state.停止中) { reply(200, {ok:true, navigationPending:!!navigationRun}); return; }
          state.停止中 = true;
          if (offlineJob) offlineJob.停止();
          else if (!connection.send({ メッセージ識別: 'cancel_run', メッセージ内容: '強制停止！' })) {
            state.停止中 = false; notify(); reply(409, {error:'AIコアが未接続です。'}); return;
          }
          notify();
        } else if (type === 'autoConnect') {
          if (typeof data.enabled !== 'boolean') { reply(400, {error:'自動接続の指定が不正です。'}); return; }
          if (state.実行中 || offlineJob || navigationRun || connection.modelChanging) { reply(409, {error:'実行中またはモデル変更中は自動接続を変更できません。'}); return; }
          if (state.自動接続 === data.enabled) { reply(200, {ok:true}); return; }
          state.自動接続 = data.enabled;
          if (data.enabled && state.実行モード === 'offline') {
            save(false);
            state.実行モード = 'online'; newConversation();
          } else { reconnect(); notify(); }
        } else if (type === 'setSelfCheckLoop') {
          // 実行中でも選び直せる。次回の起動でもこの回数から始める。
          try { state.検証回数 = 検証回数保存(data.count, optionsFile); }
          catch { reply(400, {error:'検証回数の指定が不正です。'}); return; }
        } else if (type === 'disconnect' || type === 'connect') {
          if (state.実行中 || offlineJob || navigationRun || connection.modelChanging) { reply(409, {error:'実行中またはモデル変更中は接続を変更できません。'}); return; }
          if (state.実行モード === 'offline') { reply(409, {error:'オフラインではAIコアへ接続しません。'}); return; }
          state.自動接続 = type === 'connect';
          接続開始済み = true; reconnect();
        }
        else if (connection.modelChanging) { reply(409, {error:'モデルを変更しています。'}); return; }
        else if (state.実行中 || offlineJob || navigationRun) { reply(409, {error:'実行中です。'}); return; }
        else if (type === 'executionMode') {
          if (!['online','offline'].includes(data.mode)) { reply(400, {error:'実行モードが不正です。'}); return; }
          if (state.実行モード !== data.mode) {
            save(false);
            state.自動接続 = data.mode === 'online'; state.実行モード = data.mode; newConversation();
          }
        }
        else if (type === 'sendFile') {
          if (オフライン使用()) { reply(409, {error:'ファイル添付はAIコア接続中に使用できます。'}); return; }
          if (!Number.isSafeInteger(data.connectionEpoch) || data.connectionEpoch !== connection.epoch || requestEpoch !== connection.epoch
              || data.conversationId !== state.会話ID || data.sessionId !== connection.session || data.projectPath !== connection.projectPath || !connection.projectPath) {
            reply(409, {error:'会話または接続が変わりました。ファイルを選び直してください。'}); return;
          }
          let file;
          try { file = validateFileUpload({name: data.name, base64: data.base64}); }
          catch (error) { reply(400, {error: error instanceof Error ? error.message : 'ファイルが不正です。'}); return; }
          if (!connection.send({ メッセージ識別: 'input_file', メッセージ内容: file.base64, ファイル名: file.name })) {
            reply(409, {error:'AIコアへファイルを送信できません。'}); return;
          }
        } else if (type === 'input_text') {
          if (typeof data.メッセージ内容 !== 'string' || !data.メッセージ内容.trim() || data.メッセージ内容.length > 200000) { reply(400, {error:'入力が空か長すぎます。'}); return; }
          if (data.navigationRequestId !== undefined) {
            const displayed = 表示状態();
            if (typeof data.navigationRequestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(data.navigationRequestId)) { reply(400, {error:'実行IDが不正です。'}); return; }
            if (navigationRequests.has(data.navigationRequestId) || navigationRequests.size >= 10000) { reply(409, {error:'この実行IDは再送できません。'}); return; }
            navigationRequests.add(data.navigationRequestId);
            // 自動接続中の一時offline表示でNavigatorだけが先走り、Hermesへ迂回しない。
            if (state.自動接続 && (!connection.connected || connection.接続中 || connection.modelChanging)) {
              reply(409, {error:'Codeのオンライン接続がまだ確定していません。接続完了後に自動航行を再開してください。'}); return;
            }
            if (data.projectPath !== folder || data.conversationId !== state.会話ID
                || data.sessionId !== (displayed.セッションID || '') || data.connectionEpoch !== state.接続世代
                || requestEpoch !== connection.epoch || state.停止中) { reply(409, {error:'Codeのプロジェクト・会話・接続状態が変わりました。'}); return; }
            navigationRun = { id: data.navigationRequestId, offline: オフライン使用(), started: false, reply: false, failed: false };
          }
          try { execute(data.メッセージ内容, data.self_check_loop); }
          catch (error) { navigationResult('failed', error instanceof Error ? error.message : String(error)); throw error; }
        } else if (type === 'new') {
          newConversation();
        } else if (type === 'selectHistory') {
          const entry = history.find(item => item.id === data.id);
          if (!entry) { reply(404, {error:'会話がありません。'}); return; }
          if (initialModel.lockedMode && entry.実行モード !== (initialModel.offline ? 'offline' : 'online')) {
            reply(409, {error:'この会話は別の利用モードで開いてください。'}); return;
          }
          // 履歴のモデルはその会話だけへ復元し、モード別の最終手動選択は維持する。
          state.実行モード = entry.実行モード;
          if (state.実行モード === 'offline') state.自動接続 = false;
          state.会話ID = entry.id; state.メッセージ = [...entry.メッセージ]; state.セッションID = entry.セッションID;
          state.HermesセッションID = entry.HermesセッションID;
          state.provider = entry.provider; state.model = entry.model; state.進捗 = []; reconnect(); notify();
        } else if (type === 'deleteHistory') {
          const entry = history.find(item => item.id === data.id);
          if (!entry) { reply(404, {error:'会話がありません。'}); return; }
          history = history.filter(item => item.id !== data.id);
          state.履歴 = state.履歴.filter(item => item.id !== data.id);
          書込待ち.delete(data.id);
          try { 会話削除(履歴フォルダ(), data.id); } catch (error) { console.error(`会話を削除できません: ${String(error)}`); }
          if (state.会話ID === data.id) {
            newConversation();
          }
          notify();
        } else if (type === 'model') {
          if (typeof data.provider !== 'string' || typeof data.model !== 'string' || data.provider.length > 200 || data.model.length > 300) { reply(400, {error:'モデル指定が不正です。'}); return; }
          const selected = コード選択({ provider: data.provider, model: data.model });
          const offline = オフライン使用();
          if (offline && selected.provider !== 'aidiy_hermes') { reply(400, {error:'オフラインでは aidiy_hermes だけを使用できます。'}); return; }
          if (offline && !offlineModelAllowed(selected.model)) { reply(400, {error:'オフラインのモデルは一覧から選択してください。'}); return; }
          if (!offline) await connection.setModel(selected);
          コードモデル保存(selected, offline ? offlineFile : modelFile);
          modeModels[offline ? 'offline' : 'online'] = selected;
          if (!offline || state.実行モード === 'offline') { state.provider = selected.provider; state.model = selected.model; }
          save(false); notify();
        } else { reply(400, {error:'Unknown message'}); return; }
        reply(200, {ok:true, ...(type === 'cancel_run' ? { navigationPending: !!navigationRun } : {})}); return;
      }
      // 画面は frontend_ide の Vue 画面（IDE / Code 単独起動）が提供し、このサーバーは API だけを返す。
      reply(404, {error:'Not found'});
    } catch (error) { if (!res.headersSent) reply(500, {error: error instanceof Error ? error.message : '処理に失敗しました。'}); else res.end(); }
  });
  async function close() {
    if (closed) return; navigationResult('cancelled', 'Code画面を閉じました。'); closed = true;
    prediction.clear();
    書込実行();
    clearTimeout(idle);
    if (offlineJob) { offlineJob.停止(); await offlineJob.完了.catch(() => {}); }
    if (state.実行モード === 'online' && state.実行中) connection.send({ メッセージ識別: 'cancel_run' });
    connection.dispose();
    for (const client of clients) client.end(); clients.clear();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    clearTimeout(idle);
  }
  await new Promise<void>((resolve, reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('起動できません。');
  origin = `http://127.0.0.1:${address.port}`;
  allowed = new 接続元許可(address.port);
  if (allowed.初回待機時間 !== undefined && !initialModel.lockedMode && !initialModel.keepAlive) idle = setTimeout(() => { void close(); }, allowed.初回待機時間);
  return {url:origin+prefix, publicUrl:allowed.公開URL(prefix), close};
}

if (require.main === module) {
  const project = process.argv[2] || process.cwd();
  void 単独起動(project, undefined, process.argv[4] ? JSON.parse(process.argv[4]) : {}).then(app => {
    if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({url:app.url, publicUrl:app.publicUrl, pid:process.pid}), 'utf8');
    else console.log(`AiDiy Code: ${app.url}`);
    process.on('SIGINT', () => { void app.close(); });
    process.on('SIGTERM', () => { void app.close(); });
  }).catch(error => { console.error(String(error)); process.exitCode = 1; });
}
