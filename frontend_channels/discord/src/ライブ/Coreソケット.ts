// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import WebSocket from 'ws';
import { Core認証, Core準備待機, type Core復旧設定 } from '../接続/Core認証';

/** ws は Authorization ヘッダー対応。各ソケット・再接続で再読込し、転送を禁止する。 */
export function Coreソケット(url: string, root?: string, Socket = WebSocket): WebSocket {
  return new Socket(url, { headers: Core認証(url, root), followRedirects: false,
    handshakeTimeout: 15000, maxPayload: 20 * 1024 * 1024 });
}

/** 最初の init 以前の接続失敗だけ。音声・テキスト送信の再試行は禁止。 */
export async function Core初期接続(connect: () => Promise<void>, canRetry: () => boolean, options: Core復旧設定 = {}) {
  const ready = await Core準備待機(async () => {
    try { await connect(); return true; }
    catch (error) { if (!canRetry()) throw error; }
  }, options);
  if (!ready) throw new Error('ローカル Core の再起動後の接続準備が完了しませんでした。再接続してください。');
}
