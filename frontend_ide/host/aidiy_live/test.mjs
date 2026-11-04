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

import { build, transform } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './build.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
await mkdir(new URL('../out/aidiy_live/', import.meta.url), { recursive: true });
for (const name of ['protocol', 'audio', 'host', 'model-catalog']) {
  if (name === 'host' || name === 'protocol') {
    await build({ entryPoints: [fileURLToPath(new URL(`src/${name}.ts`, import.meta.url))], outfile: fileURLToPath(new URL(`../out/aidiy_live/${name}.cjs`, import.meta.url)), bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
    continue;
  }
  const result = await transform(await readFile(new URL(`src/${name}.ts`, import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22' });
  await writeFile(new URL(`../out/aidiy_live/${name}.cjs`, import.meta.url), result.code);
}
const result = spawnSync(process.execPath, ['--test', 'aidiy_live/checks/live.test.cjs', 'aidiy_live/checks/host.test.cjs', 'aidiy_live/checks/extension.test.cjs', 'aidiy_live/checks/launcher.test.cjs'], { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
