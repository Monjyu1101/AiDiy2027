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

// 実配置の秘密ファイルや既存生成物には触れず、現行ソースをメモリ内で検証する。
const source = resolve(__dirname, '../src/internal-auth.ts');
const loaded = new Module(source, module);
loaded.filename = source;
loaded.paths = module.paths;
loaded._compile(buildSync({ entryPoints: [source], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22' }).outputFiles[0].text, source);
const { internalAuthorization } = loaded.exports;
const tokenA = 'fixture-header.fixture-payload.fixture-signature-A';
const tokenB = 'fixture-header.fixture-payload.fixture-signature-B';
const port = 18091;
const target = () => new URL(`http://127.0.0.1:${port}`);
function fixture(t, name = 'renamed-checkout') {
  const home = mkdtempSync(join(tmpdir(), 'aidiy-internal-auth-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return checkout(home, name);
}
function checkout(home, name) {
  const root = join(home, name);
  const host = join(root, 'frontend_ide', 'host');
  const file = join(root, '_AIDIY', 'backend_core', 'internal_auth.json');
  for (const path of [host, join(root, '_config'), join(root, 'backend_server'), join(root, '_AIDIY', 'backend_core')]) mkdirSync(path, { recursive: true });
  writeFileSync(join(root, '_config', 'AiDiy_key.json'), JSON.stringify({ PORT_CORE: port }));
  writeFileSync(join(root, 'backend_server', 'core_main.py'), '# fixture only\n');
  return { home, root, host, file };
}
function record(access_token = tokenA, expires_at = new Date(Date.now() + 3600000).toISOString()) {
  return { access_token, token_type: 'bearer', issued_at: new Date().toISOString(), expires_at };
}
function save(f, value = record()) { writeFileSync(f.file, JSON.stringify(value), { mode: 0o600 }); }
function authorize(f, url = target(), folders = [f.host]) { return internalAuthorization(url, folders)(); }
function rejectsWithoutSecret(action, secrets = [tokenA, tokenB]) {
  assert.throws(action, error => {
    assert.ok(error instanceof Error);
    for (const secret of secrets) assert.ok(!String(error.stack || error).includes(secret), '秘密値を例外へ出さない');
    return true;
  });
}

test('内部認証: 配置名に依存せずNode用Bearerだけを返し、日次置換を次の要求で読む', t => {
  const f = fixture(t, 'another-project-name'); save(f);
  const headers = internalAuthorization(target(), [f.host]);
  assert.deepEqual(headers(), { Authorization: `Bearer ${tokenA}` });
  const replacement = f.file + '.next';
  writeFileSync(replacement, JSON.stringify(record(tokenB)), { mode: 0o600 });
  renameSync(replacement, f.file);
  assert.deepEqual(headers(), { Authorization: `Bearer ${tokenB}` });
});

test('内部認証: 秘密ファイル不在・期限切れ・不正JSON・不正schemaは秘密値なしで拒否', t => {
  const f = fixture(t);
  rejectsWithoutSecret(() => authorize(f));
  const invalid = [record(tokenA, new Date(Date.now() - 1000).toISOString()), record(tokenA, 'not-a-date'),
    { ...record(), access_token: '' }, { ...record(), access_token: `${tokenA}\r\nInjected: yes` },
    { ...record(), token_type: 'basic' }, { ...record(), expires_at: undefined }, null, []];
  for (const value of invalid) { save(f, value); rejectsWithoutSecret(() => authorize(f)); }
  writeFileSync(f.file, `{"access_token":"${tokenA}",broken`);
  rejectsWithoutSecret(() => authorize(f));
  writeFileSync(f.file, JSON.stringify({ ...record(), padding: 'x'.repeat(1024 * 1024) }));
  rejectsWithoutSecret(() => authorize(f));
});

test('内部認証: 外部URL・別port・userinfoにはBearerを渡さない', t => {
  const f = fixture(t); save(f);
  for (const url of ['http://example.test:18091', 'https://example.test', 'http://127.0.0.1:18092',
    'http://127.0.0.1.evil.test:18091', 'http://name:password@127.0.0.1:18091'])
    rejectsWithoutSecret(() => authorize(f, new URL(url)));
});

test('内部認証: インストール元を優先し、別projectのトークンへフォールバックしない', t => {
  const install = fixture(t, 'installation'); const project = checkout(install.home, 'selected-project');
  save(install, record(tokenA)); save(project, record(tokenB));
  const headers = internalAuthorization(target(), [install.host, project.root]);
  assert.equal(headers().Authorization, `Bearer ${tokenA}`);
  rmSync(install.file);
  rejectsWithoutSecret(() => headers());
  rejectsWithoutSecret(() => authorize(install, target(), [install.host, project.root]));
});

test('内部認証: 配布済み拡張は明示された信頼済みcheckoutを使い、手掛かりなしでは拒否', t => {
  const f = fixture(t); save(f);
  const installed = join(f.home, 'extensions', 'aidiy-code'); mkdirSync(installed, { recursive: true });
  assert.equal(authorize(f, target(), [installed, f.root]).Authorization, `Bearer ${tokenA}`);
  rejectsWithoutSecret(() => authorize(f, target(), [installed]));
});

test('内部認証: secretファイルのsymlinkを拒否する', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); const outside = join(f.home, 'outside.json');
  writeFileSync(outside, JSON.stringify(record()), { mode: 0o600 });
  symlinkSync(outside, f.file);
  rejectsWithoutSecret(() => authorize(f));
});

test('内部認証: 配置markerのない設定フォルダを信用せず別projectへも進まない', t => {
  const install = fixture(t, 'installation'); const project = checkout(install.home, 'selected-project');
  save(install); save(project, record(tokenB));
  rmSync(join(install.root, 'backend_server', 'core_main.py'));
  rejectsWithoutSecret(() => authorize(install, target(), [install.host, project.root]));
});

test('内部認証: token親ディレクトリのsymlinkも拒否する', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); const outside = join(f.home, 'outside'); mkdirSync(outside);
  writeFileSync(join(outside, 'internal_auth.json'), JSON.stringify(record()), { mode: 0o600 });
  rmSync(join(f.root, '_AIDIY', 'backend_core'), { recursive: true });
  symlinkSync(outside, join(f.root, '_AIDIY', 'backend_core'), 'dir');
  rejectsWithoutSecret(() => authorize(f));
});

test('内部認証: origin以外のURL情報やHTTPS・hostname解決を持ち込まない', t => {
  const f = fixture(t); save(f);
  for (const url of [`http://127.0.0.1:${port}/core`, `http://127.0.0.1:${port}/?token=secret`,
    `http://127.0.0.1:${port}/#fragment`, `https://127.0.0.1:${port}`, `http://localhost:${port}`])
    rejectsWithoutSecret(() => authorize(f, new URL(url)));
});
