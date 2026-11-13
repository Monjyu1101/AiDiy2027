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

import { 設定読込 } from './接続/接続設定';
import type { DiscordBot } from './接続/Bot接続';
import { コード起動解決 } from './共通連携/IDE連携';
import { 接続失敗案内, 接続エラー詳細, type 接続段階 } from './接続/接続エラー';

import { パネル設定読込 } from './接続パネル/パネル設定';
import { 実行コード名検証 } from './コード/Hermesモデル';

let bot: DiscordBot | undefined;
let stage: 接続段階 = '設定読込';
let token = '';
const startedAt = Date.now();
try {
  const config = 設定読込();
  const saved = パネル設定読込(config.hermesModel);
  if (saved) { config.cli = 実行コード名検証(saved.code_name); config.hermesModel = saved.code_model; }
  token = config.token;
  if (process.argv.includes('--check')) {
    stage = 'コード確認';
    コード起動解決(config.cli, config.python, config.folder, config.coreRoot);
    console.log('Discord 設定・コードCLI 起動パス: OK（外部接続は行っていません）');
  } else {
    // 設定確認だけでは Discord SDK・音声処理を読み込まない。
    const { DiscordBot } = await import('./接続/Bot接続');
    stage = 'Bot作成';
    bot = new DiscordBot(config);
    const shutdown = () => { void bot?.終了().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    stage = 'Discord接続'; await bot.起動();
  }
} catch (error) {
  console.error(`[Discord] 起動失敗（${stage}）: ${接続失敗案内(error, stage)}`);
  console.error(接続エラー詳細(error, stage, token, Date.now() - startedAt));
  await bot?.終了(); process.exitCode = 1;
}
