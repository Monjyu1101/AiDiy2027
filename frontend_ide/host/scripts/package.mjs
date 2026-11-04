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

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('..', import.meta.url));
const vscePackage = createRequire(import.meta.url).resolve('@vscode/vsce/package.json');
const vsce = join(dirname(vscePackage), JSON.parse(readFileSync(vscePackage, 'utf8')).bin.vsce);
for (const [folder, name] of [[root, 'aidiy-code'], [join(root, 'aidiy_live'), 'aidiy-live']]) {
  const result = spawnSync(process.execPath, [vsce, 'package', '--no-dependencies', '--allow-missing-repository', '--out', join(root, 'dist', `${name}-0.1.0.vsix`)], { cwd: folder, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
