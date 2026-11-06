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

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const { listFiles, PackageManager } = require('@vscode/vsce');

// minimatch の override 更新時も実際の vsce と配布用 ignore の組み合わせで検証する。
for (const [name, relative, included] of [
  ['Code', '..', ['media/AiDiy.png', 'media/.hidden.png', 'scripts/model-catalog.py']],
  ['Live', '../aidiy_live', ['dist/microphone.py', 'dist/AiDiy.png', 'dist/sending.png',
    'media/capture.js', 'media/microphone.png', 'media/speaker.png']],
]) {
  test(`${name} の VSIX は許可したファイルだけを含める`, async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), 'aidiy-vsce-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const source = join(__dirname, relative);
    await writeFile(join(cwd, 'package.json'), await readFile(join(source, 'package.json')));
    await writeFile(join(cwd, '.vscodeignore'), await readFile(join(source, '.vscodeignore')));
    const expected = ['package.json', 'README.md', 'LICENSE', 'dist/extension.js',
      'dist/THIRD_PARTY_NOTICES.txt', 'dist/development/コード.js',
      'dist/development/.hidden/data.json', ...included];
    const excluded = ['aidiy-installation.json', 'src/extension.ts', '.env', '.git/config', 'checks/private.test.cjs',
      'node_modules/private/index.js', 'dist/private.txt', 'scripts/private.py'];
    for (const file of [...expected, ...excluded].filter(file => file !== 'package.json')) {
      await mkdir(dirname(join(cwd, file)), { recursive: true });
      await writeFile(join(cwd, file), 'fixture');
    }
    const files = await listFiles({ cwd, packageManager: PackageManager.None });
    assert.deepEqual(files.sort(), expected.sort());
  });
}
