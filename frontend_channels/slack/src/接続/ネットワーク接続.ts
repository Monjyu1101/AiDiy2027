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

import { Agent, Pool, ProxyAgent, fetch } from 'undici';

// 起動時の環境だけを使い、URLや認証情報をログへ渡さない。
export function プロキシ経路(env: NodeJS.ProcessEnv = process.env) {
  const httpProxy = env.http_proxy || env.HTTP_PROXY || '';
  const httpsProxy = env.https_proxy || env.HTTPS_PROXY || httpProxy;
  const noProxy = (env.no_proxy || env.NO_PROXY || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
  for (const value of new Set([httpProxy, httpsProxy])) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      decodeURIComponent(url.username); decodeURIComponent(url.password);
    } catch { throw new Error('HTTP_PROXY / HTTPS_PROXY には有効な HTTP(S) プロキシURLを指定してください。'); }
  }
  return (address: string | URL): string => {
    const url = new URL(address), host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host)) return '';
    const secure = url.protocol === 'https:';
    const port = url.port || (secure ? '443' : '80');
    for (const entry of noProxy) {
      if (entry === '*') return '';
      const match = entry.match(/^(.+):(\d+)$/);
      if (match && match[2] !== port) continue;
      const name = match?.[1] || entry;
      if (name.startsWith('.') || name.startsWith('*')) {
        if (host.endsWith(name.replace(/^\*/, ''))) return '';
      } else if (host === name) return '';
    }
    return secure ? httpsProxy : httpProxy;
  };
}

/** Slack Web API のエラー。error はSlackの短いエラーコードだけを持ち、token や応答全体を含めない。 */
export class SlackAPIエラー extends Error {
  constructor(readonly method: string, readonly error: string) { super(`Slack API ${method} が失敗しました（${error}）。`); }
}

export type SlackAPI = (method: string, params: Record<string, string>) => Promise<Record<string, unknown>>;

const 待機 = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new SlackAPIエラー('-', 'closed')); return; }
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(new SlackAPIエラー('-', 'closed')); };
  signal.addEventListener('abort', stop, { once: true });
});

// WebSocket を使わず、外向き HTTPS の Web API だけで送受信する。
// VPN・社内プロキシで WebSocket が通らない環境でも HTTP(S)_PROXY を経由できる。
export class Slack通信 {
  private dispatcher: Agent;
  private route: ReturnType<typeof プロキシ経路>;
  private abort = new AbortController();
  private stopped?: Promise<void>;
  constructor(private token: string, env: NodeJS.ProcessEnv = process.env, private base = 'https://slack.com/api/') {
    this.route = プロキシ経路(env);
    this.dispatcher = new Agent({ factory: (origin, options) => {
      const proxy = this.route(origin);
      return proxy ? new ProxyAgent(proxy) : new Pool(origin, options);
    } });
  }
  get 経路() { return this.route(this.base) ? 'プロキシ経由' : '直接接続'; }
  readonly 呼出: SlackAPI = async (method, params) => {
    // 429 は Retry-After に従って再試行する。待ち時間と回数に上限を設ける。
    for (let attempt = 0; ; attempt++) {
      if (this.abort.signal.aborted) throw new SlackAPIエラー(method, 'closed');
      let response;
      try {
        response = await fetch(new URL(method, this.base), {
          method: 'POST', dispatcher: this.dispatcher,
          headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
          body: new URLSearchParams(params).toString(),
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20_000)]),
        });
      } catch {
        // 通信例外には要求ヘッダーが含まれ得るため、原因オブジェクトを持ち出さない。
        throw new SlackAPIエラー(method, this.abort.signal.aborted ? 'closed' : 'network_error');
      }
      if (response.status === 429 && attempt < 3) {
        await response.body?.cancel().catch(() => {});
        const wait = Math.min(Math.max(Number(response.headers.get('retry-after')) || 1, 1), 30);
        await 待機(wait * 1000, this.abort.signal);
        continue;
      }
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new SlackAPIエラー(method, `http_${response.status}`); }
      const data = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
      if (!data || typeof data !== 'object') throw new SlackAPIエラー(method, 'invalid_response');
      if (data.ok !== true) throw new SlackAPIエラー(method, typeof data.error === 'string' ? data.error.slice(0, 80) : 'unknown_error');
      return data;
    }
  };
  終了(): Promise<void> {
    if (this.stopped) return this.stopped;
    this.abort.abort();
    this.stopped = this.dispatcher.destroy();
    return this.stopped;
  }
}
