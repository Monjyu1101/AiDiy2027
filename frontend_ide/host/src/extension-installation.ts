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
import { isAbsolute, join } from 'node:path';
import { ローカル接続先 } from '../aidiy_live/local-backend.cjs';
import { internalAuthorization, type InternalAuthorization } from './internal-auth';

const installationUnavailable = () => new Error('AiDiy の配置元を参照できません。配置先から Code / Live を再セットアップし、VS Code を再読み込みしてください。');
const connectionUnavailable = () => new Error('ローカル Core の接続設定を読み込めません。AiDiy の配置先と共通設定を確認してください。');

function installationRoot(extensionPath: string): string | undefined {
  const file = join(extensionPath, 'aidiy-installation.json');
  let stat;
  try { stat = lstatSync(file); }
  catch (error) {
    // 記録のない旧版・開発ホストだけ従来の探索を使う。壊れた記録では別配置へ進まない。
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw installationUnavailable();
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw installationUnavailable();
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!value || value.version !== 1 || typeof value.root !== 'string'
    || !isAbsolute(value.root) || value.root.includes('\0')
    || Object.keys(value).some(key => !['version', 'root'].includes(key))) throw installationUnavailable();
  return value.root;
}

function verifiedRoot(root: string): string {
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || !existsSync(join(root, '_config', 'AiDiy_key.json'))
    || !existsSync(join(root, 'backend_server', 'core_main.py'))) throw installationUnavailable();
  return realpathSync(root);
}

/** 配置済み拡張の記録は接続単位で固定し、秘密は毎要求で同じ配置から読み直す。 */
export function extensionCoreConnection(extensionPath: string, projectPath?: string | null): { backend: string; authorization: InternalAuthorization } {
  let recorded = true;
  try {
    const root = installationRoot(extensionPath);
    recorded = root !== undefined;
    const pinnedRoot = root === undefined ? undefined : verifiedRoot(root);
    const folders = pinnedRoot ? [pinnedRoot] : [extensionPath, projectPath];
    const backend = ローカル接続先(...folders);
    const authorization = internalAuthorization(new URL(backend), folders);
    return { backend, authorization: () => {
      if (root !== undefined) {
        try { if (verifiedRoot(root) !== pinnedRoot) throw installationUnavailable(); }
        catch { throw installationUnavailable(); }
      }
      return authorization();
    } };
  } catch {
    // Webview の初期化は止めず、認証境界で明確な再セットアップ案内を返す。通信は行わない。
    const error = recorded ? installationUnavailable() : connectionUnavailable();
    return { backend: 'http://127.0.0.1:8091', authorization: () => { throw error; } };
  }
}
