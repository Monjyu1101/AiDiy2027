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
