// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevelopment } from '../server.mjs';
import { electronExecutable } from '../viewer/launch-options.mjs';
const project = mkdtempSync(join(tmpdir(), 'aidiy-console-project-')), profile = mkdtempSync(join(tmpdir(), 'aidiy-console-electron-'));
const server = await startDevelopment(project);
try {
  const env = { ...process.env, AIDIY_DEVELOPMENT_URL: server.url, AIDIY_DEVELOPMENT_KIND: 'ide', AIDIY_TEST_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronExecutable(), [fileURLToPath(new URL('../checks/console-desktop-probe.cjs', import.meta.url))], { env, windowsHide: false, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  let result; child.on('message', value => { if (value.testPassed) result = value; });
  const [code] = await once(child, 'exit'); if (code !== 0 || !result) throw Error(`Electron Console失敗: ${code}`);
  for (const url of result.urls) { let alive = false; try { await fetch(url); alive = true; } catch {} if (alive) throw Error('子サーバーが終了していません。'); }
  console.log('Electron Console: 日本語・複数窓・個別終了・IDE終了連携 OK');
} finally {
  await server.close();
  for (const path of [profile, project]) { if (!path.startsWith(join(tmpdir(), 'aidiy-console-'))) throw Error('一時パスが不正です。'); rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}
