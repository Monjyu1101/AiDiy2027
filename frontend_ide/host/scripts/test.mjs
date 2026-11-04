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

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['src/file-attachments.ts'], outfile: 'out/file-attachments.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
await build({ entryPoints: ['src/input-prediction.ts'], outfile: 'out/input-prediction.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
await build({ entryPoints: ['src/runner.ts'], outfile: 'out/runner.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
await build({ entryPoints: ['src/protocol.ts'], outfile: 'out/protocol.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
await build({ entryPoints: ['src/forwarded-origin.ts'], outfile: 'out/forwarded-origin.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
await build({ entryPoints: ['aidiy_code/src/server.ts'], outfile: 'out/aidiy_code/server.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
await build({ entryPoints: ['src/code-connection.ts'], outfile: 'out/code-connection.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
await build({ entryPoints: ['aidiy_code/src/offline.ts'], outfile: 'out/offline.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
await build({ entryPoints: ['src/conversation-store.ts'], outfile: 'out/conversation-store.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
const result = spawnSync(process.execPath, ['--test', 'checks/package.test.cjs', 'checks/internal-auth.test.cjs', 'checks/internal-auth-transport.test.cjs', 'checks/runner.test.cjs', 'checks/code-connection.test.cjs', 'checks/prediction-scope.test.cjs', 'checks/code-extension.test.cjs', 'checks/aidiy_code.test.cjs', 'checks/offline-catalog.test.cjs', 'checks/conversation-store.test.cjs', 'checks/launcher.test.cjs', 'checks/single-instance.test.cjs', 'checks/browser-mode.test.cjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
