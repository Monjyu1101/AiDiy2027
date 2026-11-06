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

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

const source = resolve(__dirname, '../src/extension-installation.ts');
const loaded = new Module(source, module);
loaded.filename = source; loaded.paths = module.paths;
loaded._compile(buildSync({ entryPoints: [source], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22' }).outputFiles[0].text, source);
const { extensionCoreConnection } = loaded.exports;
const tokenA = 'fixture-only-not-a-real-token-A', tokenB = 'fixture-only-not-a-real-token-B';
function checkout(home, name, port = 18091) {
  const root = join(home, name), host = join(root, 'frontend_ide', 'host');
  const config = join(root, '_config', 'AiDiy_key.json');
  const file = join(root, '_AIDIY', 'backend_core', 'internal_auth.json');
  for (const dir of [host, join(root, '_config'), join(root, 'backend_server'), join(root, '_AIDIY', 'backend_core')]) mkdirSync(dir, { recursive: true });
  writeFileSync(config, JSON.stringify({ PORT_CORE: port }));
  writeFileSync(join(root, 'backend_server', 'core_main.py'), '# fixture only\n');
  return { root, host, config, file };
}
function save(f, token = tokenA) {
  writeFileSync(f.file, JSON.stringify({ token_type: 'bearer', access_token: token, expires_at: new Date(Date.now() + 3600000).toISOString() }));
}
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'aidiy-installation-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const project = join(home, 'unrelated-project'); mkdirSync(project);
  const source = checkout(home, '日本語 source with spaces'); save(source);
  const extensions = ['aidiy-code', 'aidiy-live'].map(name => {
    const path = join(home, '.vscode-server', 'extensions', name + '-0.1.0'); mkdirSync(path, { recursive: true }); return path;
  });
  return { home, source, project, extensions };
}
function stamp(extension, root) { writeFileSync(join(extension, 'aidiy-installation.json'), JSON.stringify({ version: 1, root })); }
function rejects(connection, pattern = /配置元/) {
  assert.throws(connection.authorization, error => {
    assert.match(error.message, pattern);
    for (const token of [tokenA, tokenB]) assert.ok(!String(error.stack).includes(token));
    return true;
  });
}

test('配置元: Code/Live の配置済み VSIX は別projectでも同じ記録元・独自PORT_COREを使う', t => {
  const f = fixture(t), other = checkout(f.home, 'other-running-installation', 18092); save(other, tokenB);
  for (const extension of f.extensions) {
    stamp(extension, f.source.root);
    for (const project of [f.project, other.root]) {
      const connection = extensionCoreConnection(extension, project);
      assert.equal(connection.backend, 'http://127.0.0.1:18091');
      assert.equal(connection.authorization().Authorization, `Bearer ${tokenA}`);
    }
  }
});

test('配置元: 秘密は生成時に読まず、Core起動後・日次置換後に同じrootから読み直す', t => {
  const f = fixture(t), extension = f.extensions[0]; stamp(extension, f.source.root); rmSync(f.source.file);
  const connection = extensionCoreConnection(extension, f.project);
  rejects(connection, /内部認証/);
  save(f.source); assert.equal(connection.authorization().Authorization, `Bearer ${tokenA}`);
  save(f.source, tokenB); assert.equal(connection.authorization().Authorization, `Bearer ${tokenB}`);
});

test('配置元: 記録なしの旧版と開発ホストは従来探索を維持する', t => {
  const f = fixture(t);
  assert.equal(extensionCoreConnection(f.extensions[0], f.source.root).authorization().Authorization, `Bearer ${tokenA}`);
  assert.equal(extensionCoreConnection(f.source.host, f.project).authorization().Authorization, `Bearer ${tokenA}`);
  rejects(extensionCoreConnection(f.extensions[0], f.project), /内部認証/);
});

test('配置元: 壊れた記録・相対path・外国OSのpath・未知schemaを別projectで補完しない', t => {
  const f = fixture(t), extension = f.extensions[0], marker = join(extension, 'aidiy-installation.json');
  const foreign = process.platform === 'win32' ? '/home/other/AiDiy' : 'C:\\work\\AiDiy';
  for (const payload of ['{broken', 'null', '[]', JSON.stringify({ version: 2, root: f.source.root }),
    JSON.stringify({ version: 1, root: '../source' }), JSON.stringify({ version: 1, root: foreign }),
    JSON.stringify({ version: 1, root: f.source.root, access_token: tokenA }), ' '.repeat(17000)]) {
    writeFileSync(marker, payload);
    rejects(extensionCoreConnection(extension, f.source.root));
  }
});

test('配置元: 移動/削除されたrootは再セットアップ案内とし、workspaceへ切り替えない', t => {
  const f = fixture(t), extension = f.extensions[0], other = checkout(f.home, 'other'); save(other, tokenB);
  stamp(extension, f.source.root);
  const connection = extensionCoreConnection(extension, other.root);
  renameSync(f.source.root, f.source.root + '-moved');
  rejects(connection); rejects(extensionCoreConnection(extension, other.root));
});

test('配置元: 接続中の記録書き換えでは移動せず、新接続でのみ別配置へ切り替える', t => {
  const f = fixture(t), extension = f.extensions[0], other = checkout(f.home, 'other', 18092); save(other, tokenB);
  stamp(extension, f.source.root); const old = extensionCoreConnection(extension, f.project);
  stamp(extension, other.root);
  assert.equal(old.authorization().Authorization, `Bearer ${tokenA}`);
  const next = extensionCoreConnection(extension, f.project);
  assert.equal(next.backend, 'http://127.0.0.1:18092');
  assert.equal(next.authorization().Authorization, `Bearer ${tokenB}`);
});

test('配置元: rootの設定消失時は親の別配置を探索しない', t => {
  const f = fixture(t), nested = checkout(f.source.root, 'nested'); save(nested, tokenB);
  stamp(f.extensions[0], nested.root);
  const connection = extensionCoreConnection(f.extensions[0], f.project);
  rmSync(nested.config);
  rejects(connection); rejects(extensionCoreConnection(f.extensions[0], f.source.root));
});

test('配置元: PORT_CORE変更は旧originへのBearerを拒否し、新接続で反映する', t => {
  const f = fixture(t); stamp(f.extensions[0], f.source.root);
  const connection = extensionCoreConnection(f.extensions[0], f.project);
  writeFileSync(f.source.config, JSON.stringify({ PORT_CORE: 18093 }));
  rejects(connection, /内部認証/);
  const next = extensionCoreConnection(f.extensions[0], f.project);
  assert.equal(next.backend, 'http://127.0.0.1:18093');
  assert.equal(next.authorization().Authorization, `Bearer ${tokenA}`);
});

test('配置元: marker/root/秘密ファイルのsymlinkを拒否する', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), extension = f.extensions[0], marker = join(extension, 'aidiy-installation.json');
  const outside = join(f.home, 'outside.json'); writeFileSync(outside, JSON.stringify({ version: 1, root: f.source.root }));
  symlinkSync(outside, marker); rejects(extensionCoreConnection(extension, f.source.root)); rmSync(marker);
  const linkedRoot = join(f.home, 'linked'); symlinkSync(f.source.root, linkedRoot, 'dir');
  stamp(extension, linkedRoot); rejects(extensionCoreConnection(extension, f.source.root));
  stamp(extension, f.source.root);
  renameSync(f.source.file, f.source.file + '.original'); symlinkSync(f.source.file + '.original', f.source.file);
  rejects(extensionCoreConnection(extension, f.project), /内部認証/);
});
