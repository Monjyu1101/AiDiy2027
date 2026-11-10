// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// aidiy_avatar の入口。aidiy_code と同じく、表示完了後すぐ呼出元へ戻る独立プロセスとして起動する。
// 子プロセスが renderer（8092、Web版も兼ねる）と Electron を所有し、Electron の終了で renderer も止める。
// 監視・自動再起動（electronmon / tsc --watch）は使わない。開発時の再読込は npm run dev を使う。
import { spawn, spawnSync, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const PORT_AVATAR = 8092;
const RENDERER_URL = `http://127.0.0.1:${PORT_AVATAR}`;

// 呼出元の cwd を、切り離す前に既存ディレクトリへ正規化する。
export function parseOptions(args, cwd = process.cwd()) {
  let alone = false, foreground = false, initialPinned = false, project;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--alone') alone = true;
    else if (args[i] === '--foreground') foreground = true;
    else if (args[i] === '--initial-pinned') initialPinned = true;
    else if (args[i] === '--project' && args[i + 1] && !args[i + 1].startsWith('--')) {
      if (project !== undefined) throw Error('--project は1回だけ指定してください。');
      project = args[++i];
    } else throw Error(`不明または不完全な引数: ${args[i]}`);
  }
  if (project !== undefined && !alone) throw Error('--project は --alone と組み合わせてください。');
  if (alone) {
    try {
      project = realpathSync(resolve(cwd, project ?? '.'));
      if (!statSync(project).isDirectory()) throw Error('not directory');
    } catch { throw Error('プロジェクトには存在するフォルダーを指定してください。'); }
  }
  return { alone, foreground, initialPinned, project };
}

export function availablePort() {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : done(port));
    });
  });
}

export function portOpen(port = PORT_AVATAR, timeout = 500) {
  return new Promise(done => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); done(value); };
    socket.setTimeout(timeout, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function waitPort(port, exited, isOpen = portOpen, timeout = 60000) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    if (exited()) throw Error('Avatarの画面サーバーが起動前に終了しました。');
    if (await isOpen(port)) return;
    await new Promise(done => setTimeout(done, 300));
  }
  throw Error('Avatarの画面サーバーの起動がタイムアウトしました。');
}

function newestMtime(folder) {
  return readdirSync(folder).filter(name => name.endsWith('.ts')).reduce((max, name) => Math.max(max, statSync(join(folder, name)).mtimeMs), 0);
}

// メイン処理は前回の変換より新しいソースがある時だけ1回変換する（監視はしない）。
export function buildMain({ run = spawnSync } = {}) {
  const output = join(root, 'dist-electron', 'main.js');
  const sources = Math.max(newestMtime(join(root, 'electron')), statSync(join(root, 'tsconfig.electron.json')).mtimeMs);
  if (existsSync(output) && statSync(output).mtimeMs >= sources) return false;
  const result = run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.electron.json'], { cwd: root, windowsHide: true, stdio: 'ignore' });
  if (result.status !== 0) throw Error('Avatarのメイン処理を変換できませんでした（tsc -p tsconfig.electron.json）。');
  return true;
}

export async function stopTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') await new Promise(done => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 }, () => done()));
  else child.kill('SIGTERM');
  if (child.exitCode !== null || child.signalCode) return;
  // taskkillの完了とNodeがexitを受け取る時点には差がある。終了通知まで待つ。
  await new Promise((done, reject) => {
    const finished = () => { clearTimeout(timer); done(); };
    const timer = setTimeout(() => { child.off('exit', finished); reject(Error(`Avatarの子プロセスを終了できませんでした（PID: ${child.pid}）。`)); }, 5000);
    child.once('exit', finished);
  });
}

function electronEnv({ alone, project, initialPinned }, url) {
  const env = { ...process.env, VITE_DEV_SERVER_URL: url, AIDIY_AVATAR_MANAGED: '1' };
  delete env.AIDIY_AVATAR_ALONE;
  delete env.AIDIY_AVATAR_PROJECT;
  delete env.AIDIY_AVATAR_CORE_URL;
  // 親の初期ピン指定は継承せず、今回の明示引数だけを使う。
  delete env.AIDIY_AVATAR_INITIAL_PINNED;
  if (initialPinned) env.AIDIY_AVATAR_INITIAL_PINNED = '1';
  if (alone) { env.AIDIY_AVATAR_ALONE = '1'; env.AIDIY_AVATAR_PROJECT = project; }
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

// 前面プロセス本体。renderer と Electron を起動し、表示完了を ready で知らせ、Electron 終了まで所有する。
export async function runAvatar({
  alone = false, initialPinned = false, project, allocatePort = availablePort,
  launch = spawn, isOpen = portOpen, build = buildMain, stop = stopTree, ready = () => {},
  electron = require('electron'), vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js'), timeout = 90000,
} = {}) {
  if (alone) project = parseOptions(['--alone', '--project', project ?? process.cwd()]).project;
  const port = alone ? await allocatePort() : PORT_AVATAR;
  const url = `http://127.0.0.1:${port}`;
  build();
  let renderer, desktop, stopping, ending = false, timer;
  const shutdown = () => {
    ending = true;
    clearTimeout(timer);
    return stopping ??= Promise.all([stop(desktop), stop(renderer)]);
  };
  const signals = ['SIGINT', 'SIGTERM'], interrupted = () => void shutdown().then(() => process.exit(0));
  for (const signal of signals) process.once(signal, interrupted);
  try {
    // 単一起動の所有者を先に確定する。ポート占有だけを起動済みとは判定しない。
    desktop = launch(electron, [join(root, 'dist-electron', 'main.js')], { cwd: root, env: electronEnv({ alone, project, initialPinned }, url), windowsHide: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const code = await new Promise((done, reject) => {
      let primary = false, shown = false, existing = false;
      const fail = error => { if (!ending) reject(error); };
      const prepareRenderer = async () => {
        if (await isOpen(port)) throw Error(`${port}が別のプロセスに使用されています。使用中のサーバーを停止してからAvatarを起動してください。`);
        if (ending) return;
        renderer = launch(process.execPath, alone ? [vite, '--mode', 'avatar-alone', '--host', '127.0.0.1', '--port', String(port), '--strictPort'] : [vite], { cwd: root, windowsHide: true, stdio: 'ignore' });
        let rendererExited = false;
        renderer.once('error', error => { rendererExited = true; fail(error); });
        renderer.once('exit', code => { rendererExited = true; fail(Error(`Avatarの画面サーバーが終了しました（終了コード: ${code}）。`)); });
        await waitPort(port, () => ending || rendererExited, isOpen);
        if (!ending && desktop.connected) desktop.send({ avatarRendererReady: true });
      };
      timer = setTimeout(() => fail(Error('Avatarの画面表示がタイムアウトしました。')), timeout);
      desktop.on('message', message => {
        if (ending) return;
        if (message?.avatarExisting && !existing) {
          existing = true;
          clearTimeout(timer);
          ready({ existingWindow: true });
        } else if (message?.avatarPrimary && !primary) {
          primary = true;
          void prepareRenderer().catch(fail);
        } else if (message?.avatarShown && !shown) {
          shown = true;
          clearTimeout(timer);
          ready({ pid: process.pid, url });
        }
      });
      desktop.once('error', fail);
      // 窓を閉じて Electron が終わったら、Web版の renderer も一緒に止める。
      desktop.once('exit', exitCode => {
        ending = true;
        clearTimeout(timer);
        if (!shown && !existing) reject(Error(`Avatarが画面表示前に終了しました（終了コード: ${exitCode}）。`));
        else done(exitCode ?? 0);
      });
    });
    await shutdown();
    return code;
  } catch (error) {
    await shutdown();
    throw error;
  } finally {
    for (const signal of signals) process.removeListener(signal, interrupted);
  }
}

// 呼出元から切り離した子プロセスを起動し、表示完了の通知を受けたら戻る。
export async function launchDetached({ alone = false, initialPinned = false, project, launch = spawn, stop = stopTree, timeout = 120000, log = console.log } = {}) {
  const child = launch(process.execPath, [fileURLToPath(import.meta.url), '--foreground', ...(initialPinned ? ['--initial-pinned'] : []), ...(alone ? ['--alone', '--project', project] : [])], {
    cwd: root, env: { ...process.env, AIDIY_LAUNCHER_CHILD: '1' }, detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    const result = await new Promise((done, reject) => {
      const timer = setTimeout(() => finish(Error('Avatarの起動がタイムアウトしました。')), timeout);
      const finish = (error, value) => { clearTimeout(timer); child.off('message', message); child.off('exit', exit); child.off('error', failure); error ? reject(error) : done(value); };
      const message = value => { if (value?.launchReady) finish(null, value); else if (value?.launchError) finish(Error(value.launchError)); };
      const exit = code => finish(Error(`Avatarを起動できませんでした（終了コード: ${code}）。`));
      const failure = error => finish(error);
      child.on('message', message); child.once('exit', exit); child.once('error', failure);
    });
    if (child.connected) child.disconnect();
    child.unref();
    log(result.existingWindow ? '起動済みのAvatar画面を前面に表示しました。' : `AiDiy Avatarを起動しました（${result.url ?? RENDERER_URL}/）。`);
    return result;
  } catch (error) {
    if (child.connected) child.disconnect();
    await stop(child);
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`aidiy_avatar [--foreground]\naidiy_avatar_alone [--project <folder>] [--foreground]\n  Electron版Avatarを独立プロセスで起動し、すぐ戻ります。ログイン画面を閉じるとWeb版（${RENDERER_URL}/）も停止します。`);
    return;
  }
  const options = parseOptions(args);
  if (!options.foreground) { await launchDetached(options); return; }
  const child = process.env.AIDIY_LAUNCHER_CHILD === '1' && !!process.send;
  const ready = message => {
    if (child) { process.send?.({ launchReady: true, ...message }); process.disconnect?.(); }
    else console.log(message.existingWindow ? '起動済みのAvatar画面を前面に表示しました。' : `AiDiy Avatarを起動しました（${message.url ?? RENDERER_URL}/）。`);
  };
  try {
    process.exitCode = await runAvatar({ ...options, ready });
  } catch (error) {
    if (child && process.connected) process.send({ launchError: error.message });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
