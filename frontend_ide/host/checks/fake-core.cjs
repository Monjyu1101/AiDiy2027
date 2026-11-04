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

// AIコアだけを模擬する。アプリへの HTTP / SSE 通信は実際の Node サーバーを使う。
function core(defaultSettings = {}) {
  const sockets = [], requests = [], sessions = new Map();
  const models = {
    aidiy_hermes: { auto: '自動', 'openai_oauth/gpt-6.1-sol': 'OpenAI OAuth / gpt-6.1-sol' },
    copilot_cli: { auto: '自動', 'gpt-6-sol': 'GPT-6 Sol' }, codex_cli: { auto: '自動' }, claude_cli: { auto: '自動' },
  };
  const defaults = { CODE_AI1_NAME: 'aidiy_hermes', CODE_AI1_MODEL: 'openai_oauth/gpt-6.1-sol', ...defaultSettings };
  let unavailable = false, hold = false, holdCancel = false;
  let catalogWait;
  class Socket {
    readyState = 0; bufferedAmount = 0; sent = [];
    constructor(url) {
      this.url = url; sockets.push(this);
      queueMicrotask(() => {
        if (this.readyState === 3) return;
        if (unavailable) { this.onerror?.({}); return; }
        this.readyState = 1; this.onopen?.({});
      });
    }
    send(text) {
      const packet = JSON.parse(text); this.sent.push(packet);
      if (packet.type === 'connect') {
        this.channel = packet.ソケット番号;
        this.session = packet.セッションID || `session-${sessions.size + 1}`;
        if (!sessions.has(this.session)) sessions.set(this.session, { settings: { ...defaults }, replies: [] });
        queueMicrotask(() => {
          this.emit({ メッセージ識別: 'init', セッションID: this.session });
          if (this.channel === '1') for (const reply of sessions.get(this.session).replies) this.emit({ メッセージ識別: 'output_text', メッセージ内容: reply });
        });
      } else if (packet.メッセージ識別 === 'input_text') {
        const output = sockets.findLast(socket => socket.channel === '1' && socket.session === this.session && socket.readyState === 1);
        queueMicrotask(() => {
          output.emit({ メッセージ識別: 'input_text', メッセージ内容: packet.メッセージ内容 });
          output.emit({ メッセージ識別: 'output_stream', メッセージ内容: '\x02', ...(packet.実行状態通知 ? {実行中:true} : {}) });
          output.emit({ メッセージ識別: 'output_stream', メッセージ内容: '日本語の進捗' });
          if (hold) return;
          const reply = JSON.stringify({ input: packet.メッセージ内容, settings: sessions.get(this.session).settings });
          sessions.get(this.session).replies.push(reply);
          output.emit({ メッセージ識別: 'output_stream', メッセージ内容: '\x03' });
          output.emit({ メッセージ識別: 'output_text', メッセージ内容: reply });
          if (packet.実行状態通知) output.emit({メッセージ識別:'output_end',メッセージ内容:'',実行中:false});
        });
      } else if (packet.メッセージ識別 === 'cancel_run') {
        const output = sockets.findLast(socket => socket.channel === '1' && socket.session === this.session && socket.readyState === 1);
        queueMicrotask(() => {
          output.emit({ メッセージ識別: 'cancel_run', メッセージ内容: '処理中断！' });
          output.emit({ メッセージ識別: 'output_stream', メッセージ内容: '\x18' });
          output.emit({ メッセージ識別: 'output_text', メッセージ内容: '処理は強制中断しました。' });
          if (!holdCancel) output.emit({メッセージ識別:'output_end',メッセージ内容:'',実行中:false});
        });
      }
    }
    emit(packet) { this.onmessage?.({ data: JSON.stringify({ ...packet, セッションID: this.session, チャンネル: this.channel }) }); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({}); }
  }
  const request = async (url, options) => {
    if (unavailable) throw new Error('ECONNREFUSED');
    const body = JSON.parse(options.body); requests.push({ path: decodeURI(new URL(url).pathname), body });
    if (body.セッションID === '' && catalogWait) await catalogWait;
    const session = sessions.get(body.セッションID);
    if (String(url).endsWith(encodeURI('設定'))) Object.assign(session.settings, body.モデル設定);
    return { ok: true, json: async () => ({ status: 'OK', data: { available_models: { code_models: models }, モデル設定: session?.settings || defaults } }) };
  };
  return { sockets, requests, sessions, Socket, request, set unavailable(value) { unavailable = value; }, set hold(value) { hold = value; }, set holdCancel(value) { holdCancel = value; }, set catalogWait(value) { catalogWait = value; },
    install(t) {
      const originalSocket = global.WebSocket; global.WebSocket = Socket;
      t.after(() => { global.WebSocket = originalSocket; });
      const fetch = global.fetch;
      t.mock.method(global, 'fetch', (url, options) => new URL(url).port === '18091' ? request(url, options) : fetch(url, options));
    },
  };
}
module.exports = { core };
