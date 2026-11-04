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

import { 設定読込, 設定エラー } from './接続/接続設定';
import { 起動解決 } from './共通連携/IDE連携';
import { SlackBot, エラー案内 } from './接続/Bot接続';

// 全体起動の終了後も Bot は継続する。出力先のパイプが閉じても書込みエラーで停止しない。
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});

let bot: SlackBot | undefined;
try {
  const config = 設定読込();
  if (process.argv.includes('--check')) {
    起動解決(config.cli, config.python, config.folder);
    console.log('Slack 設定・Hermes 起動パス: OK（外部接続は行っていません）');
  } else {
    bot = new SlackBot(config);
    const shutdown = () => { void bot?.終了().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    await bot.起動();
  }
} catch (error) {
  // 設定・Slack API のエラーだけを案内し、例外オブジェクト（token を含み得る）は出力しない。
  const text = error instanceof 設定エラー || error instanceof Error && error.constructor === Error ? error.message : エラー案内(error);
  console.error(`[Slack] 起動失敗: ${text}`);
  await bot?.終了().catch(() => {}); process.exitCode = 1;
}
