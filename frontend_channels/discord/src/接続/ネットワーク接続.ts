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

import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { WorkerShardingStrategy, type WebSocketManager } from '@discordjs/ws';
import type { ClientRequest } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AgentConnectOpts } from 'agent-base';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Agent, Pool, ProxyAgent } from 'undici';

// 起動時の環境だけを使い、URLや認証情報をログ・IPCへ渡さない。
export function プロキシ経路(env: NodeJS.ProcessEnv = process.env) {
  const httpProxy = env.http_proxy || env.HTTP_PROXY || '';
  const httpsProxy = env.https_proxy || env.HTTPS_PROXY || httpProxy;
  const noProxy = (env.no_proxy || env.NO_PROXY || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
  for (const value of new Set([httpProxy, httpsProxy])) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      decodeURIComponent(url.username); decodeURIComponent(url.password);
    } catch { throw new Error('HTTP_PROXY / HTTPS_PROXY には有効な HTTP(S) プロキシURLを指定してください。'); }
  }
  return (address: string | URL): string => {
    const url = new URL(address), host = url.hostname.toLowerCase();
    // AIコアなどのローカル接続は NO_PROXY の設定漏れでも直接接続する。
    if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host)) return '';
    const secure = url.protocol === 'https:' || url.protocol === 'wss:';
    const port = url.port || (secure ? '443' : '80');
    for (const entry of noProxy) {
      if (entry === '*') return '';
      const match = entry.match(/^(.+):(\d+)$/);
      if (match && match[2] !== port) continue;
      const name = match?.[1] || entry;
      if (name.startsWith('.') || name.startsWith('*')) {
        if (host.endsWith(name.replace(/^\*/, ''))) return '';
      } else if (host === name) return '';
    }
    return secure ? httpsProxy : httpProxy;
  };
}

let gatewayOwner: Discord通信 | undefined;

// SDKの正規拡張点でGatewayを専用スレッドへ隔離する。destroyはSDK側で
// worker.terminateまで待つため、CONNECT中断後に残る再接続も終了する。
export const Gateway戦略 = (manager: WebSocketManager) => new WorkerShardingStrategy(manager, {
  shardsPerWorker: 'all', workerPath: fileURLToPath(new URL('../gateway-worker.mjs', import.meta.url)),
});

// @discordjs/ws 1.2.3 は Node 上で ws → https.request を使う。
// ws は createConnection を渡すため https.globalAgent だけでは適用されない。
// worker 内の request に Gateway 用 agent を渡し、終了時に元の関数へ戻す。
class GatewayAgent extends HttpsProxyAgent<string> {
  private gatewaySockets = new Set<Duplex>();
  private gatewayRequests = new Set<ClientRequest>();
  constructor(url: string, private signal: AbortSignal) {
    super(url, { signal, timeout: 10_000 });
  }
  override async connect(req: ClientRequest, options: AgentConnectOpts) {
    if (this.signal.aborted) throw new Error('Discord 接続は終了しています。');
    this.gatewayRequests.add(req);
    req.once('close', () => this.gatewayRequests.delete(req));
    const socket = await super.connect(req, options);
    if (this.signal.aborted || req.destroyed) { socket.destroy(); throw new Error('Discord 接続は終了しています。'); }
    this.gatewaySockets.add(socket);
    socket.once('close', () => this.gatewaySockets.delete(socket));
    return socket;
  }
  override destroy() {
    for (const req of this.gatewayRequests) req.destroy();
    for (const socket of this.gatewaySockets) socket.destroy();
    this.gatewayRequests.clear(); this.gatewaySockets.clear(); super.destroy();
  }
}

let voiceOwner: Discord音声通信 | undefined;

// voice 0.19.2 に agent の指定APIがないため、SDKが通知した音声接続先だけを
// ws → https.request で捕捉する。Gatewayは別worker、AIコアは常に直接接続。
export class Discord音声通信 {
  private route: ReturnType<typeof プロキシ経路>;
  private agents = new Map<string, GatewayAgent>();
  private targets = new Set<string>();
  private abort = new AbortController();
  private previous?: typeof https.request;
  private request?: typeof https.request;
  private closed = false;
  private endpoint = '未通知';
  constructor(env: NodeJS.ProcessEnv = process.env) { this.route = プロキシ経路(env); }
  接続先登録(endpoint: string) {
    if (this.closed) return;
    const url = new URL(`https://${endpoint}`);
    this.endpoint = `${url.hostname}:${url.port || 443} / ${this.route(url) ? 'プロキシ経由' : '直接接続'}`;
    if (!this.route(url)) return;
    this.targets.add(`${url.hostname}:${url.port || 443}`);
    if (this.request) return;
    if (voiceOwner) throw new Error('Discord 音声通信は既に接続中です。');
    this.previous = https.request;
    const original = this.previous;
    this.request = ((...args: unknown[]) => {
      const options = args[0];
      if (options && typeof options === 'object' && !(options instanceof URL)) {
        const requestOptions = options as https.RequestOptions;
        const host = (requestOptions.hostname || requestOptions.host || '').toLowerCase();
        const target = `${host}:${requestOptions.port || 443}`;
        const proxy = this.targets.has(target) ? this.route(`https://${target}`) : '';
        if (proxy) {
          let agent = this.agents.get(proxy);
          if (!agent) { agent = new GatewayAgent(proxy, this.abort.signal); this.agents.set(proxy, agent); }
          args[0] = { ...requestOptions, agent };
        }
      }
      return Reflect.apply(original, https, args);
    }) as typeof https.request;
    https.request = this.request;
    voiceOwner = this;
  }
  get 接続先() { return this.endpoint; }
  終了() {
    if (this.closed) return;
    this.closed = true;
    if (this.request && https.request === this.request) https.request = this.previous!;
    if (voiceOwner === this) voiceOwner = undefined;
    this.abort.abort();
    for (const agent of this.agents.values()) agent.destroy();
    this.agents.clear(); this.targets.clear();
  }
}

export class Discord通信 {
  readonly rest: Agent;
  private route: ReturnType<typeof プロキシ経路>;
  private gateway?: GatewayAgent;
  private previous?: typeof https.request;
  private gatewayRequest?: typeof https.request;
  private abort = new AbortController();
  private stopped?: Promise<void>;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.route = プロキシ経路(env);
    // 安定APIの Agent factory / ProxyAgent を使う。origin ごとの dispatcher は
    // 親 Agent が所有し、destroy で待機中のREST要求も中断する。
    this.rest = new Agent({ factory: (origin, options) => {
      const proxy = this.route(origin);
      return proxy ? new ProxyAgent(proxy) : new Pool(origin, options);
    } });
  }
  Gateway開始() {
    if (this.stopped) throw new Error('Discord 接続は終了しています。');
    if (this.gateway) return;
    const proxy = this.route('https://gateway.discord.gg');
    // NO_PROXY が初期Gatewayだけを除外していても Resume の経路を用意する。
    const resumeProxy = this.route('https://resume.discord.gg');
    if (!proxy && !resumeProxy) return;
    if (gatewayOwner) throw new Error('Discord Gateway は既に接続中です。停止してから再接続してください。');
    this.previous = https.request;
    this.gateway = new GatewayAgent(proxy || resumeProxy, this.abort.signal);
    const original = this.previous;
    this.gatewayRequest = ((...args: unknown[]) => {
      const options = args[0];
      if (options && typeof options === 'object' && !(options instanceof URL)) {
        const requestOptions = options as https.RequestOptions;
        const host = (requestOptions.hostname || requestOptions.host || '').toLowerCase();
        // Gatewayとresumeのホストだけに適用。他のHTTP(S)要求はそのまま渡す。
        if ((host === 'gateway.discord.gg' || host.endsWith('.discord.gg')) &&
          this.route(`https://${host}:${requestOptions.port || 443}`)) {
          args[0] = { ...requestOptions, agent: this.gateway };
        }
      }
      return Reflect.apply(original, https, args);
    }) as typeof https.request;
    https.request = this.gatewayRequest;
    gatewayOwner = this;
  }
  終了(): Promise<void> {
    if (this.stopped) return this.stopped;
    if (this.gatewayRequest && https.request === this.gatewayRequest) https.request = this.previous!;
    if (gatewayOwner === this) gatewayOwner = undefined;
    this.abort.abort(); this.gateway?.destroy();
    this.stopped = this.rest.destroy();
    return this.stopped;
  }
}
