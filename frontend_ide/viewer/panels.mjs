// -*- coding: utf-8 -*-
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import { createRequire } from 'node:module';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const vscodeRoot = fileURLToPath(new URL('../host/', import.meta.url));
async function launch(kind, project, state) {
  if (kind === 'console') return (await import('../aidiy_console/console.mjs')).startConsole(project);
  let module;
  try { module = require(join(vscodeRoot, 'dist', `aidiy_${kind}`, 'server.cjs')); }
  catch { throw new Error('Code / Live のセットアップが必要です。frontend_ide/host のセットアップを実行してください。'); }
  return kind === 'code'
    ? module.単独起動(project, state.backend || undefined, { offline: state.mode === 'offline', lockedMode: true })
    : module.ライブ起動(vscodeRoot, state.backend || undefined, false, project);
}

// 既存の単独版を同じ公開元へ中継する。Codespacesでも追加ポートの公開は不要。
export function createPanels(project, state, launchPanel = launch) {
  const entries = new Map(), streams = new Set(), resetting = new Set();
  let generation = 0, session = '', disposed = false;
  const key = () => { const s = state(); return s.active ? `${s.mode}:${s.startedAt}` : ''; };
  const permitted = kind => state().active && (kind === 'code' || kind === 'console' || (kind === 'live' && state().mode === 'online'));
  function reset() {
    generation++;
    const previous = [...entries.values()]; entries.clear();
    for (const stream of streams) stream.destroy(); streams.clear();
    const pending = Promise.allSettled(previous.map(async entry => (await entry).app.close()));
    resetting.add(pending); void pending.finally(() => resetting.delete(pending));
    return pending;
  }
  function sync() {
    const next = key();
    if (session !== next) { session = next; void reset(); }
  }
  const timer = setInterval(sync, 250); timer.unref();
  async function open(kind, instance = '') {
    sync();
    if (disposed || !permitted(kind)) throw new Error('この利用モードでは開けません。');
    if (instance && (kind !== 'code' || !/^navi-[1-9][0-9]{0,5}$/.test(instance))) throw new Error('Navi IDが不正です。');
    const id = instance ? `${kind}:${instance}` : kind;
    if (!entries.has(id)) {
      const run = generation;
      const pending = (async () => {
        const app = await launchPanel(kind, project, state(), { instance });
        sync();
        if (run !== generation || disposed || entries.get(id) !== pending) { await app.close(); throw new Error('利用が終了しました。'); }
        const target = new URL(app.url);
        return { app, target, streams: new Set(), prefix: `/panels/${kind}${instance ? `/${instance}` : ''}${target.pathname}` };
      })();
      entries.set(id, pending);
      pending.catch(() => { if (entries.get(id) === pending) entries.delete(id); });
    }
    return (await entries.get(id)).prefix;
  }
  async function release(kind, instance) {
    sync();
    if (kind !== 'code' || !/^navi-[1-9][0-9]{0,5}$/.test(instance)) throw new Error('Navi IDが不正です。');
    const id = `${kind}:${instance}`, pending = entries.get(id);
    if (!pending) return;
    entries.delete(id);
    const closing = (async () => {
      const entry = await pending.catch(() => null);
      if (!entry) return; // 起動中の解放はopen側で終了する。
      for (const stream of entry.streams) stream.destroy();
      await entry.app.close();
    })();
    resetting.add(closing);
    try { await closing; }
    finally { resetting.delete(closing); }
  }
  async function resolve(req) {
    sync();
    const match = /^\/panels\/(code|live|console)\/(navi-[1-9][0-9]{0,5}\/)?/.exec(req.url);
    const kind = match?.[1], instance = match?.[2]?.slice(0, -1);
    const id = instance ? `${kind}:${instance}` : kind, pending = entries.get(id);
    if (disposed || !permitted(kind) || !pending) return null;
    const entry = await pending;
    sync();
    if (disposed || !permitted(kind) || entries.get(id) !== pending || !req.url.startsWith(entry.prefix)) return null;
    const tail = req.url.slice(entry.prefix.length);
    if (tail.includes('..') || tail.startsWith('/')) return null;
    return { ...entry, kind, url: new URL(entry.target.pathname + tail, entry.target.origin) };
  }
  function track(stream, entry) {
    streams.add(stream); entry.streams.add(stream);
    stream.on('close', () => { streams.delete(stream); entry.streams.delete(stream); });
    return stream;
  }
  const headers = (req, target) => {
    const result = { ...req.headers, host: target.host, origin: target.origin };
    // 転送先をブラウザ由来のヘッダーで変更させない。
    delete result['x-forwarded-host']; delete result['x-forwarded-proto']; delete result.cookie;
    return result;
  };
  async function http(req, res) {
    const entry = await resolve(req);
    if (!entry) { res.writeHead(403).end('利用できないパネルです。'); return; }
    const proxy = track(request(entry.url, { method: req.method, headers: headers(req, entry.target) }, upstream => {
      const responseHeaders = { ...upstream.headers };
      if (responseHeaders['content-security-policy']) responseHeaders['content-security-policy'] = responseHeaders['content-security-policy'].replace("frame-ancestors 'none'", "frame-ancestors 'self'");
      res.writeHead(upstream.statusCode || 502, responseHeaders);
      upstream.on('error', () => res.destroy()); upstream.pipe(res);
    }), entry);
    proxy.on('error', () => { if (!res.headersSent) res.writeHead(502).end('パネルに接続できません。'); else res.destroy(); });
    res.on('close', () => proxy.destroy());
    req.pipe(proxy);
  }
  async function upgrade(req, socket, head) {
    const entry = await resolve(req);
    if (!entry || !['live', 'console'].includes(entry.kind) || !entry.url.pathname.endsWith('/socket')) { socket.destroy(); return; }
    const proxy = track(request(entry.url, { headers: headers(req, entry.target) }), entry);
    track(socket, entry);
    proxy.on('upgrade', (response, upstream, upstreamHead) => {
      track(upstream, entry);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      upstream.pipe(socket); socket.pipe(upstream);
      upstream.on('error', () => socket.destroy()); upstream.on('close', () => socket.destroy());
      socket.on('close', () => upstream.destroy());
    });
    proxy.on('response', response => { response.resume(); socket.destroy(); });
    proxy.on('error', () => socket.destroy());
    socket.on('error', () => proxy.destroy()); socket.on('close', () => proxy.destroy());
    proxy.end();
  }
  return { open, release, http, upgrade, sync, async close() { disposed = true; clearInterval(timer); await reset(); await Promise.allSettled([...resetting]); } };
}
