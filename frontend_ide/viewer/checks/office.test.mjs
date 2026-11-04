// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, rm, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { startServer } from '../server.mjs';
import { createCoreConnection } from '../core-connection.mjs';
import { createFixtures } from './fixtures.mjs';

test('文書API・依存配信・アクセス境界', async t => {
  const tempRoot = resolve(tmpdir());
  const root = await mkdtemp(join(tempRoot, 'aidiy-ide-office-'));
  let server;
  try {
    await createFixtures(root);
    await writeFile(join(root, 'sample.pptx'), 'format routing fixture');
    const large = await open(join(root, 'large.pdf'), 'w');
    await large.truncate(50 * 1024 * 1024 + 1); await large.close();
    const connection = createCoreConnection(root, { target: 'http://127.0.0.1:8091', fetcher: async () => ({ ok: true, json: async () => ({ status: 'ok', name: 'aidiy_code_agents' }) }) });
    await connection.connect();
    const started = await startServer(root, 0, { connection }); server = started.server;
    const get = (path, headers = {}) => new Promise((done, reject) => {
      const req = request(new URL(path, started.url), { headers }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }); req.on('error', reject); req.end();
    });
    await t.test('Office / PDF の分類とバイナリ取得', async () => {
      for (const [file, format] of [['日本語文書.docx', 'word'], ['売上.xlsx', 'excel'], ['一覧.csv', 'excel'], ['sample.pptx', 'powerpoint'], ['sample.pdf', 'pdf']]) {
        const result = await get(`api/file?path=${encodeURIComponent(file)}`);
        assert.equal(result.status, 200);
        const data = JSON.parse(result.body); assert.equal(data.kind, 'office'); assert.equal(data.format, format); assert.equal(data.tooLarge, false);
        const raw = await get(`api/document?path=${encodeURIComponent(file)}`);
        assert.equal(raw.status, 200); assert.equal(raw.body.length, data.size);
        assert.equal(raw.headers['content-type'], 'application/octet-stream');
      }
      assert.equal(JSON.parse((await get('api/file?path=sample.js')).body).kind, 'text');
    });
    await t.test('対象外ファイル・範囲外パス・容量超過を拒否', async () => {
      for (const path of ['sample.js', '../AGENTS.md', '../sample.pdf', 'missing.pdf']) assert.equal((await get(`api/document?path=${encodeURIComponent(path)}`)).status, 404);
      assert.equal((await get('api/document?path=large.pdf')).status, 413);
      assert.equal(JSON.parse((await get('api/file?path=large.pdf')).body).tooLarge, true);
      assert.equal((await get('/', { host: 'invalid.example' })).status, 403);
      assert.equal((await get('api/raw?path=sample.pdf')).status, 404);
    });
    await t.test('表示資産はローカルで取得し、任意の依存ファイルは公開しない', async () => {
      for (const asset of ['jszip.js', 'docx.js', 'xlsx.js', 'chart.js', 'pptx.js', 'pdf.mjs', 'pdf.worker.mjs']) {
        const response = await get(`office-vendor/${asset}`); assert.equal(response.status, 200, asset); assert(response.body.length > 100);
      }
      assert.equal((await get('office-vendor/package.json')).status, 404);
      assert.equal((await get('office-vendor/cmaps/..%2fpackage.json')).status, 404);
      for (const path of ['office.html', 'office.css', 'office.js', 'licenses.html']) assert.equal((await get(path)).status, 200);
      // 画面本体は frontend_ide の Vue 画面が配信し、Vue 移行前の画面ファイルは配信しない。
      for (const path of ['app.js', 'style.css', 'layout.js', 'connection.js', 'panels.js', 'desktop.js']) assert.equal((await get(path)).status, 404, path);
      const html = await get('office.html');
      assert.match(html.headers['content-security-policy'], /connect-src 'self' blob:/);
      assert.match(html.headers['content-security-policy'], /frame-ancestors 'self'/);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    const back = relative(tempRoot, resolve(root));
    if (!back || back.startsWith('..') || isAbsolute(back)) throw new Error('一時フォルダの範囲を確認できません。');
    await rm(root, { recursive: true, force: true });
  }
});
