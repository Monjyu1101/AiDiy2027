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

import { createRequire } from 'node:module';

// frontend_ide/host は CommonJS。日本語名の export を ESM の静的解析に依存させず読む。
// Discord 側の部品は経由せず、Code/Hermes の共通実装だけを直接共有する。
const require = createRequire(import.meta.url);
export const { 起動解決, 会話引数, CLI実行 } = require('../../../../frontend_ide/host/src/runner.ts') as typeof import('../../../../frontend_ide/host/src/runner');
export const { コード要求実行 } = require('../../../../frontend_ide/host/src/protocol.ts') as typeof import('../../../../frontend_ide/host/src/protocol');
export const { コードモデル読込, コードモデル保存 } = require('../../../../frontend_ide/host/src/model-preferences.ts') as typeof import('../../../../frontend_ide/host/src/model-preferences');
export const { 接続元許可 } = require('../../../../frontend_ide/host/src/forwarded-origin.ts') as typeof import('../../../../frontend_ide/host/src/forwarded-origin');

export const { internalAuthorization } = require('../../../../frontend_ide/host/src/internal-auth.ts') as typeof import('../../../../frontend_ide/host/src/internal-auth');
