// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import { setTimeout as delay } from 'node:timers/promises';
import { internalAuthorization } from '../共通連携/IDE連携';
import { プロジェクトルート } from './接続設定';

/** 設定を解決した配置先だけを参照する。作業フォルダや画面入力から秘密を探索しない。 */
export function Core認証(coreUrl: string, root = プロジェクトルート): Record<string, string> {
  const url = Core接続元(coreUrl);
  return internalAuthorization(url, [root])();
}

function Core接続元(coreUrl: string): URL {
  const url = new URL(coreUrl);
  if (!['http:', 'ws:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || url.username || url.password || url.search || url.hash
    || !['/', '/core/ws/AIコア'].includes(decodeURIComponent(url.pathname))) {
    throw new Error('内部認証は配置先のローカル Core にだけ利用できます。');
  }
  url.protocol = 'http:'; url.pathname = '/';
  return url;
}

export type Core復旧設定 = { signal?: AbortSignal; wait?: (ms: number, signal?: AbortSignal) => Promise<void> };
/** 初期化・読み取り専用の復旧専用。チャットや業務要求の再送には使わない。 */
export async function Core準備待機<T>(probe: () => Promise<T | undefined>, options: Core復旧設定 = {}): Promise<T | undefined> {
  const wait = options.wait ?? (async (ms, signal) => { await delay(ms, undefined, { signal }); });
  for (const ms of [0, 250, 500, 1000, 2000]) {
    options.signal?.throwIfAborted();
    if (ms) await wait(ms, options.signal);
    options.signal?.throwIfAborted();
    const value = await probe();
    options.signal?.throwIfAborted();
    if (value !== undefined) return value;
  }
}

/** モデル候補の読み取りだけを最大5回。拒否済みの同じトークンは再送しない。 */
export async function Coreモデル要求(coreUrl: string, request: typeof fetch, root?: string, options: Core復旧設定 = {}) {
  const url = Core接続元(coreUrl);
  url.pathname = '/core/AIコア/モデル情報/取得';
  let rejected = '';
  return Core準備待機(async () => {
    let authorization: Record<string, string>;
    try { authorization = Core認証(coreUrl, root); } catch { return; }
    if (authorization.Authorization === rejected) return;
    let response: Response;
    try {
      response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authorization },
        redirect: 'error', body: JSON.stringify({ セッションID: '' }),
        signal: AbortSignal.any([AbortSignal.timeout(1500), ...(options.signal ? [options.signal] : [])]) });
    } catch { return; }
    if ([401, 403].includes(response.status)) {
      rejected = authorization.Authorization; await response.body?.cancel(); return;
    }
    if ([502, 503, 504].includes(response.status)) { await response.body?.cancel(); return; }
    return response;
  }, options);
}
