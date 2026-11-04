// -*- coding: utf-8 -*-
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useBrowser, electronExecutable } from '../launch-options.mjs';

if (useBrowser() || process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1') {
  console.log('Electron 本体の導入を省略します（Web 起動環境または ELECTRON_SKIP_BINARY_DOWNLOAD=1）。');
} else {
  const installer = fileURLToPath(new URL('../node_modules/electron/install.js', import.meta.url));
  const result = spawnSync(process.execPath, [installer], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  console.log('Electron 導入済み: ' + electronExecutable());
}
