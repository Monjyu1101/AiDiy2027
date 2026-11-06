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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { Client, Events, type VoiceChannel } from 'discord.js';
import type { DiscordGatewayAdapterLibraryMethods } from '@discordjs/voice';
import { WebSocket, WebSocketServer } from 'ws';
import { request, Agent } from 'undici';
import { Discord通信, Gateway戦略 } from '../../src/接続/ネットワーク接続';
import { DiscordBot } from '../../src/接続/Bot接続';
import { Live接続 } from '../../src/ライブ/ライブ会話';
import { config, waitFor } from '../helpers';

const tls = { key: readFileSync(new URL('./network-key.fixture', import.meta.url)), cert: readFileSync(new URL('./network-cert.fixture', import.meta.url)) };
const sockets = new Set<net.Socket>();
const track = (socket: net.Socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
const targets: string[] = [];
let tlsPort = 0, gatewayHost = 'gateway.discord.gg', hanging = false, hangingGateway = false, receivedAuth = false;
const server = https.createServer(tls, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url?.endsWith('/gateway/bot')) res.end(JSON.stringify({ url: `wss://${gatewayHost}:${tlsPort}`, shards: 1,
    session_start_limit: { total: 1000, remaining: 1000, reset_after: 1000, max_concurrency: 1 } }));
  else res.end('{"ok":true}');
});
server.on('connection', track);
const gateway = new WebSocketServer({ server });
let resumed = false, identified = false;
gateway.on('connection', socket => {
  socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 10_000 } }));
  socket.on('message', data => {
    const packet = JSON.parse(data.toString());
    if (packet.op === 1) socket.send('{"op":11,"d":null}');
    if (packet.op === 2) {
      identified = true;
      socket.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { v: 10, session_id: 'session',
        resume_gateway_url: `wss://resume.discord.gg:${tlsPort}`, user: { id: '555555555555555555', username: 'Test', discriminator: '0', bot: true },
        guilds: [], application: { id: '555555555555555555', flags: 0 } } }));
    }
    if (packet.op === 6) { resumed = true; socket.send('{"op":0,"t":"RESUMED","s":2,"d":{}}'); }
  });
});
const proxy = http.createServer();
proxy.on('connection', track);
proxy.on('connect', (req, client, head) => {
  client.once('end', () => client.destroy());
  targets.push(req.url!);
  receivedAuth ||= req.headers['proxy-authorization'] === `Basic ${Buffer.from('proxy-user:proxy-password').toString('base64')}`;
  if (hanging || (hangingGateway && req.url?.startsWith('gateway.discord.gg:'))) { client.resume(); return; }
  const upstream = net.connect(tlsPort, '127.0.0.1'); track(upstream);
  upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
  upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
  client.once('close', () => upstream.destroy()); upstream.once('close', () => client.destroy());
});
server.listen(0, '127.0.0.1'); proxy.listen(0, '127.0.0.1');
await Promise.all([once(server, 'listening'), once(proxy, 'listening')]);
tlsPort = (server.address() as net.AddressInfo).port;
const proxyUrl = `http://proxy-user:proxy-password@127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
const original = https.globalAgent, originalRequest = https.request;
for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']) delete process.env[key];
process.env.HTTPS_PROXY = proxyUrl;
try {
  const network = new Discord通信({ HTTPS_PROXY: proxyUrl });
  const client = new Client({ intents: [], rest: { agent: network.rest, api: `https://discord.test:${tlsPort}/api` }, ws: { buildStrategy: Gateway戦略 } });
  try {
    const ready = once(client, Events.ClientReady);
    await client.login('test-bot-token'); await ready;
    assert.equal(identified, true); assert.equal(client.isReady(), true);
    const resumedEvent = once(client, Events.ShardResume);
    for (const socket of gateway.clients) socket.terminate();
    await resumedEvent; assert.equal(resumed, true);
    assert.ok(targets.includes(`discord.test:${tlsPort}`));
    assert.ok(targets.includes(`gateway.discord.gg:${tlsPort}`));
    assert.ok(targets.includes(`resume.discord.gg:${tlsPort}`)); assert.equal(receivedAuth, true);
    // ローカルAIコアと同じ localhost WSS は既定agent経由でもプロキシへ流さない。
    const count = targets.length;
    const local = new WebSocket(`wss://127.0.0.1:${tlsPort}`);
    local.on('error', () => {}); await once(local, 'open'); local.terminate();
    assert.equal(targets.length, count);
  } finally { await Promise.all([client.destroy(), network.終了()]); }
  assert.equal(https.globalAgent, original); assert.equal(https.request, originalRequest);
  await waitFor(() => sockets.size === 0);

  for (const env of [{}, { HTTPS_PROXY: proxyUrl, NO_PROXY: '*' }, { https_proxy: proxyUrl, no_proxy: 'localhost' }]) {
    for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']) delete process.env[key];
    Object.assign(process.env, env);
    gatewayHost = 'localhost';
    const direct = new Discord通信(env);
    const count = targets.length;
    const directClient = new Client({ intents: [], rest: { agent: direct.rest, api: `https://localhost:${tlsPort}/api` }, ws: { buildStrategy: Gateway戦略 } });
    try {
      const response = await request(`https://localhost:${tlsPort}`, { dispatcher: direct.rest });
      assert.equal(response.statusCode, 200); await response.body.dump();
      const ready = once(directClient, Events.ClientReady);
      await directClient.login('test-bot-token'); await ready;
      assert.equal(directClient.isReady(), true);
      assert.equal(targets.length, count);
    } finally { await Promise.all([directClient.destroy(), direct.終了()]); }
  }
  gatewayHost = 'gateway.discord.gg';

  // 実voice SDKとLiveのadapterを使い、音声専用WSSも非443ポートへCONNECTする。
  // Voice Ready以降のUDPはこのHTTPプロキシ検証には含めない。
  async function voiceCheck(endpoint: string, env: NodeJS.ProcessEnv, proxied: boolean) {
    for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']) delete process.env[key];
    Object.assign(process.env, env);
    let methods!: DiscordGatewayAdapterLibraryMethods;
    const settings = config();
    const channel = { id: settings.voiceChannelId, guild: { id: settings.guildId,
      voiceAdapterCreator: (callbacks: DiscordGatewayAdapterLibraryMethods) => {
        methods = callbacks;
        return { sendPayload: () => true, destroy: () => {} };
      } } } as unknown as VoiceChannel;
    let closed = 0;
    const live = new Live接続(settings, channel, async () => {}, () => { closed++; });
    const connecting = live.接続();
    const rejected = assert.rejects(connecting, /Discordボイス接続/);
    const before = targets.length;
    const upgraded = hanging ? undefined : once(gateway, 'connection');
    try {
      methods.onVoiceStateUpdate({ guild_id: settings.guildId, channel_id: channel.id,
        user_id: settings.userId, session_id: 'private-voice-session', deaf: false, mute: false,
        self_deaf: false, self_mute: false, suppress: false, self_video: false, request_to_speak_timestamp: null });
      methods.onVoiceServerUpdate({ guild_id: settings.guildId, endpoint, token: 'private-voice-token' });
      if (proxied) await waitFor(() => targets.length > before);
      if (upgraded) await upgraded;
      assert.equal(targets.length - before, proxied ? 1 : 0);
      if (proxied) assert.equal(targets.at(-1), endpoint);
      // AIコアと同じローカルWSSは音声経路登録中も直接接続。
      if (!hanging) {
        const local = new WebSocket(`wss://127.0.0.1:${tlsPort}`);
        local.on('error', () => {}); await once(local, 'open'); local.terminate();
        assert.equal(targets.length - before, proxied ? 1 : 0);
      }
    } finally { live.終了(); await rejected; }
    assert.equal(closed, 1);
    assert.equal(https.request, originalRequest);
    await waitFor(() => sockets.size === 0);
  }
  await voiceCheck(`resume.discord.gg:${tlsPort}`, { HTTPS_PROXY: proxyUrl }, true);
  await voiceCheck(`localhost:${tlsPort}`, { HTTPS_PROXY: proxyUrl }, false);
  await voiceCheck(`localhost:${tlsPort}`, { HTTPS_PROXY: proxyUrl, NO_PROXY: '*' }, false);
  hanging = true;
  await voiceCheck(`resume.discord.gg:${tlsPort}`, { HTTPS_PROXY: proxyUrl }, true);
  hanging = false;

  // CONNECT応答前の停止でもプロキシへのTCP接続を回収する。
  hanging = true;
  const stopped = new Discord通信({ HTTPS_PROXY: proxyUrl }); stopped.Gateway開始();
  const count = targets.length;
  const pending = new WebSocket(`wss://gateway.discord.gg:${tlsPort}`);
  pending.on('error', () => {});
  await waitFor(() => targets.length > count);
  const closed = new Promise<void>(resolve => pending.once('close', () => resolve()));
  await stopped.終了(); await closed;
  assert.equal(https.globalAgent, original); assert.equal(https.request, originalRequest);
  const failed = new Discord通信({ HTTPS_PROXY: proxyUrl });
  const before = targets.length;
  const restPending = request(`https://discord.test:${tlsPort}`, { dispatcher: failed.rest }).catch(() => undefined);
  await waitFor(() => targets.length > before); await failed.終了(); await restPending;

  // 本体のログイン失敗時にも、workerの環境から取得したプロキシを回収する。
  hanging = false;
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']) delete process.env[key];
  process.env.HTTPS_PROXY = proxyUrl;
  const bot = new DiscordBot(config());
  bot.client.login = async () => { throw new Error('mock login failed'); };
  await assert.rejects(bot.起動(), /mock login failed/);
  assert.equal((bot.client.options.rest?.agent as Agent).destroyed, true);
  assert.equal(https.globalAgent, original); assert.equal(https.request, originalRequest);
  // 実SDKの初回Gateway CONNECT中に停止しても再接続用の通信を残さない。
  hangingGateway = true;
  const connectingBot = new DiscordBot(config());
  connectingBot.client.rest.options.api = `https://discord.test:${tlsPort}/api`;
  const attempts = targets.filter(target => target.startsWith('gateway.discord.gg:')).length;
  void connectingBot.起動().catch(() => {});
  await waitFor(() => targets.filter(target => target.startsWith('gateway.discord.gg:')).length > attempts);
  await connectingBot.終了();
  await waitFor(() => sockets.size === 0);
  assert.equal(https.request, originalRequest);
  hangingGateway = false;
  console.log('network integration: OK');
} finally {
  for (const socket of gateway.clients) socket.terminate();
  for (const socket of sockets) socket.destroy();
  await Promise.all([new Promise<void>(resolve => gateway.close(() => resolve())),
    new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => proxy.close(() => resolve()))]);
}
