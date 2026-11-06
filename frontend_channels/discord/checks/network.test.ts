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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { Discord通信, Discord音声通信, プロキシ経路 } from '../src/接続/ネットワーク接続';

test('HTTP(S)_PROXY の大小文字、HTTPS優先・HTTPへの代替、NO_PROXYとローカル除外', () => {
  const lower = 'http://lower.test:8000', upper = 'http://upper.test:8000';
  assert.equal(プロキシ経路({})('https://discord.com'), '');
  assert.equal(プロキシ経路({ HTTP_PROXY: upper })('wss://gateway.discord.gg'), upper);
  const route = プロキシ経路({ HTTP_PROXY: upper, http_proxy: lower, HTTPS_PROXY: upper, https_proxy: lower,
    NO_PROXY: '*', no_proxy: 'discord.com:443, .discord.gg, *.example.test' });
  assert.equal(route('https://discord.com'), '');
  assert.equal(route('https://discord.com:444'), lower);
  assert.equal(route('https://resume.discord.gg'), '');
  assert.equal(route('https://a.example.test'), '');
  assert.equal(route('https://notdiscord.com'), lower);
  assert.equal(route('http://example.org'), lower);
  for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '[::1]']) assert.equal(route(`https://${host}:8091`), '');
  assert.equal(プロキシ経路({ HTTPS_PROXY: upper, NO_PROXY: '*' })('https://discord.com'), '');
  assert.equal(プロキシ経路({ HTTPS_PROXY: upper })('http://example.org'), '');
  assert.throws(() => プロキシ経路({ HTTPS_PROXY: 'invalid-secret-proxy' }), error => {
    assert.doesNotMatch(String(error), /invalid-secret/); return true;
  });
});

test('通信終了は冪等で、Gatewayのrequest関数を復元し、再接続時に新たに取得する', async () => {
  const original = https.request, originalAgent = https.globalAgent;
  for (let i = 0; i < 2; i++) {
    const network = new Discord通信({ HTTPS_PROXY: 'http://127.0.0.1:8000' });
    network.Gateway開始(); assert.notEqual(https.request, original);
    assert.equal(https.globalAgent, originalAgent);
    const other = new Discord通信({ HTTPS_PROXY: 'http://127.0.0.1:8000' });
    try { assert.throws(() => other.Gateway開始(), /既に接続中/); }
    finally { await other.終了(); }
    const stopped = network.終了(); assert.equal(network.終了(), stopped);
    await stopped; assert.equal(https.request, original); assert.equal(network.rest.destroyed, true);
    assert.throws(() => network.Gateway開始(), /終了/);
  }
  const direct = new Discord通信({}); direct.Gateway開始();
  assert.equal(https.request, original); await direct.終了();
});

test('音声WSSの接続先・ポートごとにNO_PROXYを適用し、停止後にrequestを復元する', () => {
  const original = https.request;
  const direct = new Discord音声通信({ HTTPS_PROXY: 'http://proxy.test:8000', NO_PROXY: '.discord.media:8443' });
  try {
    direct.接続先登録('voice.discord.media:8443');
    assert.match(direct.接続先, /voice.discord.media:8443 \/ 直接接続/);
    assert.equal(https.request, original);
    direct.接続先登録('voice.discord.media:2053');
    assert.match(direct.接続先, /voice.discord.media:2053 \/ プロキシ経由/);
    assert.notEqual(https.request, original);
  } finally { direct.終了(); direct.終了(); }
  assert.equal(https.request, original);
});

test('実SDKでREST・Gateway・resume・音声WSS・NO_PROXY・直接接続・接続途中の停止をローカル検証', { timeout: 60_000 }, async () => {
  // 単独では約5秒。全試験の並列実行中は CPU 負荷で遅くなるため、上限に余裕を持たせる。
  // テスト用証明書だけを子プロセスで信頼する。製品のTLS検証は緩和しない。
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('./fixtures/network-runner.ts', import.meta.url))],
    { env: { ...process.env, NODE_EXTRA_CA_CERTS: fileURLToPath(new URL('./fixtures/network-cert.fixture', import.meta.url)) }, timeout: 58_000 });
  assert.match(stdout, /network integration: OK/);
  assert.doesNotMatch(stdout + stderr, /proxy-user|proxy-password|test-bot-token|private-voice/);
});
