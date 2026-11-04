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

import { パネルサービス } from './接続パネル/パネル中継';

// Electron 版の worker。操作はブラウザ版と共通（パネル中継.ts）で、ここは IPC の中継だけを受け持つ。
const send = (data: object) => { if (process.connected) process.send?.(data); };
const service = パネルサービス(send);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { await service.終了(); process.exit(0); }
  catch { process.exit(1); }
}
process.on('message', async (message: { id?: number; action?: string; value?: unknown }) => {
  if (message.action === 'shutdown') { void shutdown(); return; }
  send({ id: message.id, ...await service.要求(message.action, message.value) });
});
process.on('disconnect', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
