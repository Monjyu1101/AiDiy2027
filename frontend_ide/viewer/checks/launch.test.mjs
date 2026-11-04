// -*- coding: utf-8 -*-
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { projectFolder, useBrowser, forwardedOrigin } from '../launch-options.mjs';
import { startServer } from '../server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const codeRoot = fileURLToPath(new URL('../web/', import.meta.url));
const codespaces = { CODESPACES: 'true', CODESPACE_NAME: 'test-space', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' };

test('起動したフォルダを採用し、明示指定と不正な引数を区別する', () => {
  assert.equal(projectFolder([], undefined, codeRoot), projectFolder(['web'], undefined, root));
  assert.equal(projectFolder([], codeRoot, root), projectFolder([], undefined, codeRoot));
  assert.throws(() => projectFolder(['web'], root), /1つ/);
  assert.throws(() => projectFolder([], '  '), /値/);
  assert.throws(() => projectFolder(['not-existing-aidiy-folder'], undefined, root), /ありません/);
});

test('Windows・GUI Linux は Electron、Codespaces・headless Linux は Web', () => {
  assert.equal(useBrowser({}, 'win32'), false);
  assert.equal(useBrowser({}, 'darwin'), false);
  assert.equal(useBrowser({ DISPLAY: ':0' }, 'linux'), false);
  assert.equal(useBrowser({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), false);
  assert.equal(useBrowser({}, 'linux'), true);
  assert.equal(useBrowser({ ...codespaces, DISPLAY: ':0' }, 'linux'), true);
  assert.equal(forwardedOrigin(8097, codespaces), 'https://test-space-8097.app.github.dev');
  assert.equal(forwardedOrigin(8097, {}), undefined);
  assert.equal(forwardedOrigin(8097, { ...codespaces, CODESPACE_NAME: 'bad/path' }), undefined);
});

test('Codespaces の実際の転送 Host / Origin のみ許可し、別サイトや別 Codespace は拒否', async () => {
  const started = await startServer(codeRoot, undefined, { env: codespaces });
  const get = headers => new Promise((done, reject) => {
    const req = request(new URL('api/connection', started.url), { headers }, res => {
      res.resume(); res.on('end', () => done(res.statusCode));
    }); req.on('error', reject); req.end();
  });
  try {
    const origin = new URL(started.publicUrl).origin;
    const actualPort = started.server.address().port;
    assert.ok(actualPort > 0);
    assert.equal(started.publicUrl, `https://test-space-${actualPort}.app.github.dev/`);
    assert.equal(await get({ host: new URL(origin).host, origin }), 200);
    assert.equal(await get({ origin }), 200); // proxy が Host を localhost に置換しても動く
    assert.equal(await get({ host: 'other-space-8097.app.github.dev' }), 403);
    assert.equal(await get({ origin: 'https://evil.example' }), 403);
    assert.equal(await get({ 'sec-fetch-site': 'cross-site' }), 403);
  } finally { started.server.closeAllConnections(); await new Promise(done => started.server.close(done)); }
});

test('CLI はポート未指定でも別々の空きポートを取得し、起動フォルダをルートにする', { timeout: 10000 }, async () => {
  const existing = await startServer(root);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../launch.mjs', import.meta.url)), '--no-open'], {
    cwd: codeRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const ended = once(child, 'exit');
  let output = '';
  try {
    const url = await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('CLI 起動タイムアウト: ' + output)), 5000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.on('data', data => {
        output += data;
        const match = /AiDiy IDE: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output);
        if (match) { clearTimeout(timer); done(match[1]); }
      });
      child.stderr.on('data', data => { output += data; });
    });
    const data = await (await fetch(url + 'api/connection')).json();
    assert.notEqual(url, existing.url);
    assert.notEqual(new URL(url).port, '8097'); // 旧既定値への回帰を検出
    assert.equal(data.project.path, projectFolder([], undefined, codeRoot));
    assert.equal(data.connected, false);
    assert.equal((await fetch(url + 'api/galaxy')).status, 503);
    assert.equal((await fetch(url + 'development/app.js')).status, 200);
  } finally {
    child.kill(); await ended;
    existing.server.closeAllConnections(); await new Promise(done => existing.server.close(done));
  }
});
