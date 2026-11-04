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

// テスト専用。実際の設定・秘密ファイルには触れない。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export function authFixture(port = 8091) {
  const root = mkdtempSync(join(tmpdir(), 'aidiy-channel-auth-'));
  for (const folder of ['_config', 'backend_server', '_AIDIY/backend_core']) mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, '_config/AiDiy_key.json'), JSON.stringify({ PORT_CORE: port }));
  writeFileSync(join(root, 'backend_server/core_main.py'), '# fixture');
  const file = join(root, '_AIDIY/backend_core/internal_auth.json');
  const rotate = (token = 'fixture-token-not-a-real-credential', expires = Date.now() + 60000) =>
    writeFileSync(file, JSON.stringify({ access_token: token, token_type: 'bearer', expires_at: new Date(expires).toISOString() }));
  rotate();
  return { root, file, rotate, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
