// -*- coding: utf-8 -*-
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolsTarget } from '../ファイル機能/ai-search.mjs';

// Live と同じ規則: AiDiy 配置先を優先し、共通設定から PORT_CORE だけを使う。
export function coreTarget(...folders) {
  const visited = new Set();
  for (const folder of folders) {
    let current = resolve(folder);
    while (!visited.has(current)) {
      visited.add(current);
      const path = join(current, '_config', 'AiDiy_key.json');
      if (existsSync(path)) {
        let settings;
        try { settings = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
        catch { throw new Error('共通設定 AiDiy_key.json を読み込めません。'); }
        const port = Number(settings.PORT_CORE ?? 8091);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('共通設定 PORT_CORE は1〜65535の整数で指定してください。');
        return `http://127.0.0.1:${port}`;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return 'http://127.0.0.1:8091';
}

export function createCoreConnection(project, { target, fetcher = fetch, interval = 10000, timeout = 1500, keepActive = false } = {}) {
  let backend, configError;
  // backend は Code / Live 子パネルの接続先。IDE の疎通確認先とは分ける。
  try { backend = target || coreTarget(fileURLToPath(new URL('.', import.meta.url)), project); }
  catch (error) { configError = error.message; }
  let startedAt = keepActive ? Date.now() : null;
  let mode = keepActive ? 'online' : 'initial', connected = false, wanted = false, message = configError || '', pending, controller, timer, generation = 0, disposed = false;
  // 接続済みの定期確認は表示を維持し、初回接続・切断後の再接続だけを接続中にする。
  const state = () => ({ mode, startedAt, active: startedAt !== null, connected, connecting: !!pending && !connected, wanted, message, backend: backend || '',
    project: { name: basename(project), path: project } });
  async function check() {
    if (!wanted || disposed) return state();
    if (pending) return pending;
    const run = generation;
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    pending = (async () => {
      try {
        if (configError) throw new Error(configError);
        // Console と同じ tools ポートの軽量 ping で確認する。
        const tools = target || await toolsTarget(project);
        signal.throwIfAborted();
        const response = await fetcher(new URL('/aidiy_code_agents/ping', tools), {
          signal,
        });
        if (!response.ok) throw new Error(`AiDiy tools が応答エラーを返しました（HTTP ${response.status}）。`);
        const result = await response.json();
        if (result.status !== 'ok' || result.name !== 'aidiy_code_agents') {
          throw new Error('AiDiy tools の接続確認に失敗しました。');
        }
        if (run === generation && wanted) { if (startedAt === null) startedAt = Date.now(); connected = true; message = ''; }
      } catch (error) {
        if (run === generation && wanted) {
          connected = false;
          // 利用開始後の tools 停止は接続状態だけを変える。作業・Code子窓の寿命とは分ける。
          if (startedAt === null) {
            mode = 'initial'; wanted = false;
            clearInterval(timer); timer = undefined;
          }
          message = configError || (error.name === 'TimeoutError' ? 'AiDiy tools の応答がタイムアウトしました。' : 'AiDiy tools に接続できません。AiDiy を起動してください。');
        }
      }
      return state();
    })();
    const task = pending;
    try { await task; } finally { if (run === generation) pending = undefined; }
    return state();
  }
  function disconnect() {
    ++generation; mode = 'initial'; startedAt = null; wanted = false; connected = false; message = configError || '';
    controller?.abort(); pending = undefined;
    clearInterval(timer); timer = undefined;
    return state();
  }
  return {
    state, check,
    async connect() {
      if (disposed) return state();
      if (mode !== 'online') disconnect();
      mode = 'online'; wanted = true;
      if (!timer) { timer = setInterval(() => void check(), interval); timer.unref?.(); }
      return check();
    },
    disconnect,
    offline() {
      if (disposed) return state();
      disconnect(); mode = 'offline'; startedAt = Date.now(); message = '';
      return state();
    },
    close() { disposed = true; disconnect(); },
  };
}
