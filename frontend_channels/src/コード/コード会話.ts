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

import { randomUUID } from 'node:crypto';
import type { 起動設定 } from '../../../frontend_ide/host/src/runner';
import { 起動解決, コード要求実行 } from '../共通連携/IDE連携';
import { Hermes会話引数 } from './Hermesモデル';
import type { Discord設定 } from '../接続/接続設定';

type 会話 = { id: string; resume?: string; job?: ReturnType<typeof コード要求実行>; touched: number };

export class Code接続 {
  private conversations = new Map<string, 会話>();
  private closed = false;
  constructor(private config: Discord設定, private launch?: 起動設定) {}

  実行中(key: string) { return !!this.conversations.get(key)?.job; }
  停止(key: string) { this.conversations.get(key)?.job?.停止(); }
  リセット(key: string) {
    if (this.実行中(key)) throw new Error('実行中です。stop で停止してから new を実行してください。');
    this.conversations.delete(key);
  }
  async 実行(key: string, text: string): Promise<string> {
    if (this.closed) throw new Error('終了処理中です。');
    if (this.実行中(key)) throw new Error('実行中です。完了を待つか stop で停止してください。');
    if (!text.trim() || text.length > 200_000) throw new Error('本文は1～200,000文字で指定してください。');
    // 利用者ごとの並行実行と、長時間稼働時の会話数に上限を設ける。
    if ([...this.conversations.values()].filter(item => item.job).length >= 4) throw new Error('同時実行数の上限です。完了後に再送してください。');
    if (!this.conversations.has(key) && this.conversations.size >= 200) {
      const oldest = [...this.conversations.entries()].filter(([, item]) => !item.job).sort((a, b) => a[1].touched - b[1].touched)[0];
      if (oldest) this.conversations.delete(oldest[0]);
    }
    const state = this.conversations.get(key) ?? { id: randomUUID(), touched: Date.now() };
    this.conversations.set(key, state);
    try {
      state.job = コード要求実行({ セッションID: state.id, チャンネル: 'code1', メッセージ識別: 'input_text', メッセージ内容: text }, {
        起動: this.launch ?? 起動解決(this.config.cli, this.config.python, this.config.folder), 作業フォルダ: this.config.folder,
        引数: Hermes会話引数(this.config.hermesModel, this.config.maxTurns, state.resume), 制限時間: this.config.timeoutMs,
      }, () => {}, state.resume);
      const result = await state.job.完了;
      if (result.セッション復旧) state.resume = undefined;
      if (result.終了コード === 0 && result.セッションID) state.resume = result.セッションID;
      const note = result.停止理由 || (result.終了コード !== 0 ? `CLI が正常終了しませんでした（終了コード: ${result.終了コード ?? '不明'}）。CLI の認証・設定をローカルで確認してください。` : '');
      return [result.回答, note].filter(Boolean).join('\n\n') || 'CLI から回答がありませんでした。';
    } finally { state.job = undefined; state.touched = Date.now(); }
  }
  async 終了() {
    this.closed = true;
    const jobs = [...this.conversations.values()].flatMap(item => item.job ? [item.job] : []);
    for (const job of jobs) job.停止('Discord Bot を終了しました。');
    await Promise.allSettled(jobs.map(job => job.完了));
    this.conversations.clear();
  }
}
