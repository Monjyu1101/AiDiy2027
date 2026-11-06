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

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { プロジェクト引数書式, プロジェクトフォルダ決定, ブラウザ自動判定, ブラウザ版表示, ブラウザ版へ切替, ウィンドウ } from '../../../frontend_ide/host/scripts/launch-project.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const usage = `aidiy_discord ${プロジェクト引数書式} [--browser] [--check] [--no-connect]`;
let options, projectRoot;
try {
  const parsed = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {
    project: { type: 'string' }, browser: { type: 'boolean' }, check: { type: 'boolean' }, connect: { type: 'boolean' }, 'no-connect': { type: 'boolean' }, wait: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  options = parsed.values;
  if (!options.help) projectRoot = プロジェクトフォルダ決定(parsed.positionals, options.project);
} catch (error) { console.error(`${error.message}\n使用方法: ${usage}`); process.exit(1); }
if (options.help) {
  console.log(`${usage}\nLive・コードの前回の選択でパネルを開きます。作業フォルダ未指定時は起動したフォルダをプロジェクトにします。Codespaces・画面のない Linux では --browser を省略してもブラウザ版で開きます。起動すると前回の設定で自動接続します（初回は接続せずモデル設定画面を開きます）。--no-connect は未接続で開きます（--connect は従来の指定として受け付けます）。`);
  process.exit(0);
}
// 単独起動・Diag・全体起動とも自動接続する。切断するとモデル選択の画面に戻る。
const args = [...(options.check ? ['--check'] : []), ...(options['no-connect'] ? [] : ['--connect']), ...(options.wait ? ['--wait'] : [])];
// 通常起動・自動接続とも、Electron を探す／起動する前に共通の設定検証を通す。
// --check 以外は成功ログを省略し、入力したトークン自体はどの出力にも含めない。
const checkOnly = args.includes('--check');
const result = spawnSync(process.execPath, ['--import', pathToFileURL(join(root, 'node_modules/tsx/dist/loader.mjs')).href, join(root, 'src/main.ts'), '--check'], {
  cwd: root, stdio: ['ignore', checkOnly ? 'inherit' : 'ignore', 'inherit'], windowsHide: true, timeout: 30_000,
});
if (result.error) console.error('Discord の起動前チェックを実行できませんでした。セットアップを確認してください。');
if (result.status !== 0 || checkOnly) process.exit(result.status ?? 1);
// 明示しなくても、Codespaces・画面のない Linux ではブラウザ版にする（3本共通の規則は launch-project.mjs）。
const requestedBrowser = !!options.browser || ブラウザ自動判定();
// 起動ログ・完了通知だけを配置先リポジトリのtempへ分離する。
const temporary = join(root, '..', '..', 'temp', 'aidiy_discord');
const logs = join(temporary, 'logs'), runtime = join(temporary, 'runtime');
// ブラウザ版 profile はチャンネル自身の生成物にまとめる。
const browserProfile = join(root, 'out', 'aidiy_discord', 'browser-profile');

// パネルを起動し、終了コードを返す。開けなければ理由を例外で返す。
async function パネル起動(browser) {
  let executable = process.execPath;
  if (!browser) {
    const setupMessage = `専用ウィンドウにはセットアップ済みの Electron が必要です。python "${join(root, '_setup.py')}" を実行してください。`;
    try {
      const electronRoot = dirname(createRequire(import.meta.url).resolve('electron/package.json'));
      const expected = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
      const version = JSON.parse(readFileSync(join(electronRoot, 'package.json'), 'utf8')).version;
      if (readFileSync(join(electronRoot, 'path.txt'), 'utf8') !== expected || readFileSync(join(electronRoot, 'dist/version'), 'utf8').trim().replace(/^v/, '') !== version) throw new Error();
      executable = join(electronRoot, 'dist', expected);
      if (!existsSync(executable)) throw new Error();
    } catch { throw new Error(setupMessage); }
  }
  mkdirSync(logs, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  const id = randomUUID(), ready = join(runtime, `${id}.ready.json`);
  const env = { ...process.env, AIDIY_DISCORD_NODE: process.execPath, AIDIY_DISCORD_READY: ready, AIDIY_DISCORD_CONNECT: args.includes('--connect') ? '1' : '0', AIDIY_DISCORD_PROJECT: projectRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  let failed;
  const start = () => {
    const stdout = openSync(join(logs, `${id}.stdout.log`), 'a'), stderr = openSync(join(logs, `${id}.stderr.log`), 'a');
    // ブラウザ版は Electron の代わりに Node でパネルのサーバーを起動する（画面ファイルは共通）。
    const entry = browser ? ['--import', pathToFileURL(join(root, 'node_modules/tsx/dist/loader.mjs')).href, join(root, 'src/web-server.ts')] : [join(root, 'panel/desktop.cjs')];
    // Windows の GUI アプリには SW_HIDE を渡さず、パネルの表示を許可する。ブラウザ版のサーバーは画面を持たない。
    const child = spawn(executable, entry, { cwd: root, env, detached: !args.includes('--wait'), stdio: ['ignore', stdout, stderr], windowsHide: browser });
    closeSync(stdout); closeSync(stderr);
    child.on('error', error => { failed = error; });
    if (!args.includes('--wait')) child.unref();
    return child;
  };
  let child = start();
  // 既存パネルが終了中なら、worker回収とロック解放を待ってから1回ずつ起動し直す。
  const limit = Date.now() + 40_000;
  while (Date.now() < limit && !failed) {
    const state = existsSync(ready) ? JSON.parse(readFileSync(ready, 'utf8')) : {};
    if (state.alreadyRunning) { console.log('aidiy_discord は起動済みです。'); return 0; }
    if (state.closing && Number.isInteger(state.pid) && state.pid > 0) {
      let running = true;
      try { process.kill(state.pid, 0); }
      catch (error) { if (error.code === 'ESRCH') running = false; }
      if (!running) { unlinkSync(ready); child = start(); }
    } else if (state.windowShown) {
      // Codespaces ではポート転送先の URL を開く。$BROWSER があれば手元の PC のブラウザで開く。
      if (browser) await ブラウザ版表示(state.publicUrl || state.url, { profile: browserProfile, height: ウィンドウ.パネル高さ });
      console.log(args.includes('--connect') ? 'AiDiy Discord パネルを開きました。前回の設定で自動接続します（初回はモデルを選んで「接続」）。' : 'AiDiy Discord パネルを開きました。「接続」で接続します。');
      if (args.includes('--wait') && child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve));
      return child.exitCode ?? 0;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!failed && child.exitCode === null) try { child.kill(); } catch { /* 終了済み */ }
  throw new Error(`パネルの表示を確認できませんでした${failed ? ` (${failed.message})` : ''}。ログ: ${logs}`);
}

try { process.exit(await パネル起動(requestedBrowser)); }
catch (error) {
  if (requestedBrowser) { console.error(error.message); process.exitCode = 1; }
  else {
    // 専用ウィンドウを開けなければ、理由を表示してブラウザ版に切り替える。
    ブラウザ版へ切替(error);
    try { process.exit(await パネル起動(true)); }
    catch (fallback) { console.error(fallback.message); process.exitCode = 1; }
  }
}
