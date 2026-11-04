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

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type InternalAuthorization = () => Record<string, string>;
const unavailable = () => new Error('ローカル Core の内部認証を利用できません。配置先と Core の起動状態を確認してください。');

/** ブラウザへ渡さず、各要求・再接続の直前に読む。任意の作業フォルダより配置先を優先する。 */
export function internalAuthorization(target: URL, folders: (string | null | undefined)[]): InternalAuthorization {
  return () => {
    try {
      if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password
        || target.pathname !== '/' || target.search || target.hash) throw unavailable();
      const visited = new Set<string>();
      let root = '';
      for (const folder of folders) {
        if (!folder) continue;
        let current = resolve(folder);
        while (!visited.has(current)) {
          visited.add(current);
          // 接続先ポートの探索と同じ最初の設定ファイルに固定。別フォルダへの黙った切替はしない。
          const config = join(current, '_config', 'AiDiy_key.json');
          if (existsSync(config)) {
            if (!existsSync(join(current, 'backend_server', 'core_main.py'))) throw unavailable();
            const settings = JSON.parse(readFileSync(config, 'utf8').replace(/^\uFEFF/, ''));
            const port = Number(settings.PORT_CORE ?? 8091);
            if (!Number.isInteger(port) || port < 1 || port > 65535 || target.origin !== `http://127.0.0.1:${port}`) throw unavailable();
            root = realpathSync(current); break;
          }
          const parent = dirname(current); if (parent === current) break;
          current = parent;
        }
        if (root) break;
      }
      if (!root) throw unavailable();
      let file = root;
      for (const part of ['_AIDIY', 'backend_core', 'internal_auth.json']) {
        file = join(file, part);
        if (lstatSync(file).isSymbolicLink()) throw unavailable();
      }
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.size > 16384) throw unavailable();
      const value = JSON.parse(readFileSync(file, 'utf8'));
      if (value.token_type !== 'bearer' || typeof value.access_token !== 'string'
        || !/^[A-Za-z0-9._~-]{16,12000}$/.test(value.access_token)
        || typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at))
        || Date.parse(value.expires_at) <= Date.now()) throw unavailable();
      return { Authorization: `Bearer ${value.access_token}` };
    } catch { throw unavailable(); }
  };
}

/** undici は WebSocketInit.headers をサポート。URL / connect packet に秘密を入れない。 */
export function internalSocket(url: string | URL, headers: Record<string, string>): WebSocket {
  const { WebSocket: HeaderWebSocket } = require('undici') as typeof import('undici');
  return new HeaderWebSocket(url, { headers }) as unknown as WebSocket;
}
