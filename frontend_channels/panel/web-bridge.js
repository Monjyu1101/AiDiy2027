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

'use strict';
// ブラウザ版パネル用。Electron 版の preload.cjs と同じ window.discordPanel を WebSocket で提供する。
// Vue の view.js は Electron 版と共通。購読は画面の終了時に解除する。
(() => {
  document.documentElement.classList.add('browser-mode');
  const listeners = { state: [], activity: [], meter: [], audio: [] };
  const pending = new Map();
  let sequence = 0, socket, opened;
  const fail = message => {
    for (const job of pending.values()) job.reject(new Error(message));
    pending.clear();
    for (const callback of listeners.state) callback({ phase: 'error', message, fatal: true });
  };
  function connect() {
    const url = new URL('ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    opened = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (typeof data.id === 'number') {
        const job = pending.get(data.id); if (!job) return;
        pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
        return;
      }
      for (const callback of listeners[data.type] || []) callback(data[data.type]);
    };
    socket.onclose = () => fail('パネルのサーバーとの接続が切れました。aidiy_discord を起動し直してください。');
  }
  connect();
  const request = async (action, value) => {
    await opened;
    if (socket.readyState !== WebSocket.OPEN) throw new Error('パネルのサーバーとの接続が切れています。');
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      try { socket.send(JSON.stringify({ id, action, value })); }
      catch (error) { pending.delete(id); reject(error); }
    });
  };
  const on = type => callback => {
    listeners[type].push(callback);
    return () => { listeners[type] = listeners[type].filter(item => item !== callback); };
  };
  window.discordPanel = {
    initial: () => request('initial'),
    select: value => request('select', value),
    selectFeatures: value => request('select-features', value),
    selectCode: value => request('select-code', value),
    catalogCode: provider => request('catalog-code', provider),
    start: () => request('start'),
    stop: () => request('stop'),
    monitor: on => request('monitor', on),
    // ブラウザではタブ・ウィンドウの操作をブラウザに任せる（ボタンは CSS で隠す）。
    window: async () => {},
    onState: on('state'), onActivity: on('activity'), onMeter: on('meter'), onAudio: on('audio'),
  };
})();
