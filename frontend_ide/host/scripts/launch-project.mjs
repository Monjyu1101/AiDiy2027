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

// aidiy_code / aidiy_live / aidiy_discord / aidiy_slack の起動入口（各 launch.mjs）で共通に使う処理。
// 4本で次の規則を揃える。起動後の処理（画面・接続）はそれぞれの入口で異なる。
//  1. プロジェクト: 位置引数 / --project、指定がなければ起動したフォルダ。
//  2. 表示: --browser、または Codespaces・画面のない Linux ではブラウザ版。それ以外は Electron の専用ウィンドウ。
//  3. 専用ウィンドウを開けなければ、理由を表示してブラウザ版に切り替える。
//  4. ブラウザ版は $BROWSER → OS 標準の順。Codespaces の $BROWSER には localhost を渡し、VS Code に転送を任せる。
//  5. ブラウザ版は画面を閉じて60秒で終了。初回は120秒、Codespaces では初回接続まで待つ。
//  6. 接続元の許可は frontend_ide/host/src/forwarded-origin.ts（サーバー側）で共通。
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import ウィンドウ from './window-size.cjs';

export const プロジェクト引数書式 = '[作業フォルダ | --project 作業フォルダ]';

/** 位置引数または --project からプロジェクトフォルダを決め、存在しない場合は例外にする。 */
export function プロジェクトフォルダ決定(positionals = [], project, cwd = process.cwd()) {
  if (project !== undefined && !project.trim()) throw new Error('--project に値を指定してください。');
  if (positionals.length + (project === undefined ? 0 : 1) > 1) throw new Error('作業フォルダは1つだけ指定してください。');
  const folder = resolve(cwd, project ?? positionals[0] ?? '.');
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`作業フォルダがありません: ${folder}`);
  return folder;
}

/**
 * 明示指定がない時にブラウザ版で開くか。GitHub Codespaces と、画面のない Linux（DISPLAY / WAYLAND_DISPLAY なし）は
 * Electron の専用ウィンドウを表示できないためブラウザ版にする。
 */
export function ブラウザ自動判定(env = process.env, platform = process.platform) {
  if (env.CODESPACES === 'true') return true;
  return platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY;
}

/**
 * URL をブラウザで開く。VS Code / Codespaces が設定する $BROWSER（手元の PC のブラウザへ渡す）を優先し、
 * Windows は Chrome / Edge のアプリ表示、macOS は open、Linux は xdg-open の順に使う。開けなければ false。
 */
/** ブラウザ版のアプリ表示も専用ウィンドウと同じ大きさ（window-size.cjs）。Discord は height にパネル高さを渡す。 */
export { ウィンドウ };

export async function ブラウザで開く(url, { profile, height = ウィンドウ.会話高さ, ローカルURL } = {}) {
  const candidates = [];
  const browser = (process.env.BROWSER || '').split(delimiter)[0]?.trim();
  if (browser) candidates.push([browser, [ローカルURL || url]]);
  if (process.platform === 'win32') {
    const app = [
      [process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'],
      [process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'],
      [process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'],
      [process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'],
      [process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'],
    ].filter(([base]) => base).map(([base, tail]) => join(base, tail)).find(existsSync);
    if (app) candidates.push([app, [`--app=${url}`, ...(profile ? [`--user-data-dir=${profile}`] : []), '--no-first-run', '--no-default-browser-check', `--window-size=${ウィンドウ.幅},${height}`]]);
    candidates.push(['explorer.exe', [url]]);
  } else {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const found = (process.env.PATH || '').split(delimiter).filter(Boolean).map(folder => join(folder, opener)).find(existsSync);
    if (found) candidates.push([found, [url]]);
  }
  for (const [command, args] of candidates) {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      return true;
    } catch { /* 次の候補へ */ }
  }
  return false;
}

/** 4本共通の案内。ブラウザ版のサーバーが起動した後に表示する。 */
export function ブラウザ版案内(url, opened = true) {
  console.log(opened ? `ブラウザ版を起動しました: ${url}` : `ブラウザ版を起動しました。次の URL をブラウザで開いてください: ${url}`);
  console.log('画面を閉じると60秒後にサーバーも終了します。');
}

/** ブラウザ版の URL を開いて共通の案内を表示する。 */
export async function ブラウザ版表示(url, options) {
  let ローカルURL;
  if (process.env.CODESPACES === 'true') {
    const parsed = new URL(url), host = parsed.hostname;
    const prefix = `${process.env.CODESPACE_NAME}-`;
    const suffix = `.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
    const port = host.startsWith(prefix) && host.endsWith(suffix) ? host.slice(prefix.length, -suffix.length) : '';
    // localhost URL の出力で Codespaces の自動ポート転送を促す。
    if (/^\d+$/.test(port)) {
      ローカルURL = `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}${parsed.hash}`;
      console.log(`ローカル待受: ${ローカルURL}`);
    }
    console.log('初回の画面接続まで待機します。ページが開けない場合は「ポート」の転送状態を確認し、URL を再度開いてください。');
  }
  // 手で組み立てた転送先を直接開くと、VS Code の転送開始・URI 解決を経由しない。
  // $BROWSER は VS Code の --openExternal を呼ぶため、元の localhost URL を渡す。
  const opened = await ブラウザで開く(url, { ...options, ローカルURL });
  ブラウザ版案内(url, opened);
  return opened;
}

/** 専用ウィンドウを開けなかった時の共通の案内（規則3）。 */
export function ブラウザ版へ切替(error) {
  console.warn(`${error?.message || String(error)}\nブラウザ版に切り替えます。`);
}
