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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { プロキシ経路, Slack通信, SlackAPIエラー } from '../src/接続/ネットワーク接続';

test('HTTP(S)_PROXY の大小文字、HTTPS優先・HTTPへの代替、NO_PROXYとローカル除外', () => {
  const lower = 'http://lower.test:8000', upper = 'http://upper.test:8000';
  assert.equal(プロキシ経路({})('https://slack.com/api/'), '');
  assert.equal(プロキシ経路({ HTTP_PROXY: upper })('https://slack.com/api/'), upper);
  const route = プロキシ経路({ HTTP_PROXY: upper, http_proxy: lower, HTTPS_PROXY: upper, https_proxy: lower, no_proxy: 'slack.com:443, .example.test' });
  assert.equal(route('https://slack.com/api/'), '');
  assert.equal(route('https://slack.com:444/api/'), lower);
  assert.equal(route('https://a.example.test'), '');
  assert.equal(route('https://notslack.com'), lower);
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(route(`https://${host}:8091`), '');
  assert.throws(() => プロキシ経路({ HTTPS_PROXY: 'invalid-secret-proxy' }), error => { assert.doesNotMatch(String(error), /invalid-secret/); return true; });
});

async function 偽API(handler: (method: string, body: URLSearchParams, auth: string, count: number) => { status?: number; headers?: Record<string, string>; body?: unknown }) {
  let count = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const reply = handler(req.url!.slice(1), new URLSearchParams(raw), String(req.headers.authorization), ++count);
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers }).end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? { ok: true }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}/`, count: () => count, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

test('Web API はフォーム形式で token を送り、ok:false は Slack のエラーコードだけを返す', async () => {
  const api = await 偽API((method, body, auth) => method === 'auth.test'
    ? { body: { ok: auth === 'Bearer xoxb-secret', team_id: 'T1' } }
    : { body: { ok: false, error: body.get('channel') === 'C1' ? 'not_in_channel' : 'x' } });
  const network = new Slack通信('xoxb-secret', {}, api.base);
  try {
    assert.equal(network.経路, '直接接続');
    assert.equal((await network.呼出('auth.test', {})).team_id, 'T1');
    await assert.rejects(network.呼出('chat.postMessage', { channel: 'C1', text: 'x' }), (error: SlackAPIエラー) => {
      assert.ok(error instanceof SlackAPIエラー); assert.equal(error.error, 'not_in_channel');
      assert.doesNotMatch(error.message + JSON.stringify(error), /xoxb-secret/); return true;
    });
  } finally { await network.終了(); await api.close(); }
});

test('429 は Retry-After に従って再試行し、HTTP エラー・不正応答はコードに変換する', async () => {
  const api = await 偽API((method, _body, _auth, count) => method === 'retry'
    ? count < 2 ? { status: 429, headers: { 'retry-after': '1' } } : { body: { ok: true, value: count } }
    : method === 'down' ? { status: 503, body: '' } : { body: 'not json' });
  const network = new Slack通信('xoxb-secret', {}, api.base);
  try {
    assert.equal((await network.呼出('retry', {})).value, 2);
    await assert.rejects(network.呼出('down', {}), { error: 'http_503' });
    await assert.rejects(network.呼出('broken', {}), { error: 'invalid_response' });
  } finally { await network.終了(); await api.close(); }
});

test('終了は冪等で、待機中の再試行と以後の呼出を closed で止める', async () => {
  const api = await 偽API(() => ({ status: 429, headers: { 'retry-after': '30' } }));
  const network = new Slack通信('xoxb-secret', {}, api.base);
  try {
    const pending = network.呼出('wait', {}).then(() => undefined, (error: SlackAPIエラー) => error);
    while (api.count() < 1) await new Promise(resolve => setTimeout(resolve, 10));
    await new Promise(resolve => setTimeout(resolve, 50));
    const stopped = network.終了(); assert.equal(network.終了(), stopped); await stopped;
    assert.equal((await pending)?.error, 'closed');
    await assert.rejects(network.呼出('after', {}), { error: 'closed' });
  } finally { await api.close(); }
});
