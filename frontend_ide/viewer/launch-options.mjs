// -*- coding: utf-8 -*-
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

export function projectFolder(positionals, project, cwd = process.cwd()) {
  if (project !== undefined && !project.trim()) throw new Error('--project に値を指定してください。');
  if (positionals.length + (project === undefined ? 0 : 1) > 1) throw new Error('作業フォルダは1つだけ指定してください。');
  const root = resolve(cwd, project ?? positionals[0] ?? '.');
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`作業フォルダがありません: ${root}`);
  return root;
}

export function useBrowser(env = process.env, platform = process.platform) {
  return env.CODESPACES === 'true' || (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY);
}

export function forwardedOrigin(port, env = process.env) {
  const name = env.CODESPACE_NAME, domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (env.CODESPACES !== 'true' || !name || !domain) return undefined;
  if (!/^[a-zA-Z0-9-]+$/.test(name) || !/^[a-zA-Z0-9.-]+$/.test(domain)) return undefined;
  return `https://${name}-${port}.${domain}`;
}

// 起動時にダウンロードせず、セットアップ済みの自前 Electron だけを使う。
export function electronExecutable(base = import.meta.url) {
  const root = dirname(createRequire(base).resolve('electron/package.json'));
  const executable = process.platform === 'win32' ? 'electron.exe'
    : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  const path = readFileSync(join(root, 'path.txt'), 'utf8').trim();
  const version = readFileSync(join(root, 'dist/version'), 'utf8').trim().replace(/^v/, '');
  if (path !== executable || version !== JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version) {
    throw new Error('Electron の配置が不完全です。');
  }
  const full = join(root, 'dist', executable);
  if (!statSync(full).isFile()) throw new Error('Electron がありません。');
  return full;
}
