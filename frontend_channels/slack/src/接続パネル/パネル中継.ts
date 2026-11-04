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

import { Slackパネル } from './パネル操作';
import { 設定エラー, 設定読込 } from '../接続/接続設定';

// Electron 版（panel-worker.ts）とブラウザ版（web-server.ts）で共通の、パネル操作と通知の中継。
// 通信路（IPC / WebSocket）だけをそれぞれの入口が受け持つ。
export type パネル通知 = Record<string, unknown> & { type: 'state' | 'activity' };

export function パネルサービス(send: (data: パネル通知) => void, project = process.env.AIDIY_SLACK_PROJECT) {
  // aidiy_code / aidiy_live と同じく、起動入口で決めたプロジェクトフォルダをコードの作業フォルダにする。
  const panel = new Slackパネル(state => send({ type: 'state', state }), () => ({ ...設定読込(), ...(project ? { folder: project } : {}) }));
  panel.発言 = activity => send({ type: 'activity', activity });
  const timer = setInterval(() => panel.接続確認(), 1000);
  async function 要求(action: unknown, value: unknown): Promise<{ result?: unknown; error?: string }> {
    try {
      let result: unknown;
      switch (action) {
        case 'initial': result = await panel.初期情報(); break;
        case 'select-code': result = panel.コード選択保存(value); break;
        case 'catalog-code': result = await panel.コード候補(); break;
        case 'start': await panel.開始(); break;
        case 'auto-start': result = await panel.自動開始(); break;
        case 'stop': await panel.停止(); break;
        default: throw new Error();
      }
      return { result };
    } catch (error) {
      // 予期しない API / OS エラーの本文を画面やログへ流さない。
      return { error: error instanceof 設定エラー ? error.message : '操作できませんでした。設定・保存先を確認して再試行してください。' };
    }
  }
  async function 終了() { clearInterval(timer); await panel.終了(); }
  return { panel, 要求, 終了 };
}
