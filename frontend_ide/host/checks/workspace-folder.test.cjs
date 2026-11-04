// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');
const { runInNewContext } = require('node:vm');
test('workspace folder: 実在ローカルディレクトリのみ許可し、ファイル・不在・仮想URIを拒否', t => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aidiy-workspace-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'file.txt'); fs.writeFileSync(file, 'fixture');
  const loaded = { exports: {} };
  runInNewContext(transformSync(fs.readFileSync('src/workspace-folder.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code,
    { module: loaded, require });
  const check = (fsPath, scheme = 'file') => loaded.exports.usableFolder({ uri: { fsPath, scheme } });
  assert.equal(check(root), true);
  assert.equal(check(file), false);
  assert.equal(check(path.join(root, 'missing')), false);
  assert.equal(check(root, 'vscode-remote'), false);
  assert.equal(check(root, 'untitled'), false);
  assert.equal(loaded.exports.usableFolder(undefined), false);
});
