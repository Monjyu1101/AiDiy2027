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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
// テスト内の模擬パスは / 区切りのため、Windows でも posix の結合を使う。
const { dirname, join } = posix;
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseArgs } from 'node:util';

type 起動記録 = { executable: string; args: string[]; options: any };
// Windows の C:\ 区切りも posix の結合で扱えるよう、模擬パスは / 区切りにそろえる。
const 区切り = (value: string | URL) => fileURLToPath(value).replaceAll('\\', '/');

// 起動コード全体を実行し、Electron・時刻・ファイル・共通の起動処理だけを置き換える。
async function 起動実行(options: { argv: string[]; electron: boolean; ready: (count: number) => object; storageError?: boolean }) {
  const moduleUrl = new URL('../panel/launch.mjs', import.meta.url).href;
  const source = readFileSync(fileURLToPath(moduleUrl), 'utf8').replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.url', 'moduleUrl').replaceAll('process.exit(', 'return process.exit(');
  const files = new Map<string, string>(), starts: number[] = [], spawned: 起動記録[] = [];
  const messages: string[] = [], warnings: string[] = [], errors: string[] = [], opened: string[] = [];
  const directories: string[] = [], logs: string[] = [], reads: string[] = [], removed: string[] = [], profiles: string[] = [];
  let clock = 0, probes = 0, exitCode: number | undefined;
  await runInNewContext(`(async () => { ${source} })()`, {
    moduleUrl, dirname, join, programDataDirectory: (project: string, name: string, _root: string, children: string[] = []) => join(project, '_AIDIY', name, ...children), preparePrivateDirectory: (folder: string) => folder, fileURLToPath: 区切り, pathToFileURL, URL, parseArgs,
    プロジェクト引数書式: '[作業フォルダ]', プロジェクトフォルダ決定: () => '/project', ブラウザ自動判定: () => false,
    ブラウザ版表示: async (url: string, value: { profile: string }) => { opened.push(url); profiles.push(value.profile); return true; },
    ブラウザ版へ切替: (error: Error) => { warnings.push(error.message); }, ウィンドウ: { パネル高さ: 414 },
    Date: class extends Date { static now() { return clock; } },
    process: { argv: ['node', 'launch.mjs', ...options.argv], execPath: '/node', platform: 'linux', env: {},
      exit(code: number) { exitCode = code; },
      get exitCode() { return exitCode; }, set exitCode(value: number | undefined) { exitCode = value; },
      kill(pid: number, signal: number) {
        assert.equal(pid, 999); assert.equal(signal, 0);
        if (++probes >= 3) throw Object.assign(new Error(), { code: 'ESRCH' });
      },
    },
    console: { log: (value: string) => messages.push(value), error: (value: string) => errors.push(value) },
    setTimeout(callback: () => void, ms: number) { clock += ms; queueMicrotask(callback); },
    randomUUID: () => 'restart-test', createRequire: () => ({ resolve: () => '/electron/package.json' }),
    mkdirSync(file: string) { directories.push(file); if (options.storageError) throw new Error('一時保存先へ書き込めません'); },
    openSync(file: string) { logs.push(file); return 10; }, closeSync() {},
    existsSync: (file: string) => (options.electron && file === '/electron/dist/electron') || files.has(file),
    unlinkSync(file: string) { removed.push(file); files.delete(file); },
    readFileSync(file: string) {
      if (file === '/electron/package.json') return '{"version":"1.0.0"}';
      if (file === '/electron/path.txt') return 'electron';
      if (file === '/electron/dist/version') return '1.0.0';
      reads.push(file); assert.ok(files.has(file)); return files.get(file);
    },
    spawnSync: () => ({ status: 0 }),
    spawn(executable: string, args: string[], spawnOptions: any) {
      spawned.push({ executable, args, options: spawnOptions });
      starts.push(clock);
      files.set(spawnOptions.env.AIDIY_DISCORD_READY, JSON.stringify(options.ready(starts.length)));
      // --wait でも、シグナル終了済みの子の exit を再度待たない。
      return Object.assign(new EventEmitter(), { exitCode: null, signalCode: 'SIGTERM', unref() {} });
    },
  });
  return { exitCode, starts, spawned, messages, warnings, errors, opened, directories, logs, reads, removed, profiles };
}

test('終了中のパネルは起動成功とせず、旧プロセス終了後に再起動して表示を確認する', async () => {
  const result = await 起動実行({ argv: ['--wait', '--connect'], electron: true, ready: count => count === 1 ? { closing: true, pid: 999 } : { windowShown: true } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.starts, [0, 200]);
  assert.equal(result.spawned[0].options.env.AIDIY_DISCORD_CONNECT, '1');
  assert.equal(result.messages.length, 1); assert.match(result.messages[0], /パネルを開き/);
  assert.deepEqual(result.warnings, []); assert.deepEqual(result.opened, []);
  const ready = result.spawned[0].options.env.AIDIY_DISCORD_READY;
  assert.match(ready, /\/temp\/aidiy_discord\/runtime\/restart-test\.ready\.json$/);
  assert.equal(result.spawned[1].options.env.AIDIY_DISCORD_READY, ready);
  assert.deepEqual(result.removed, [ready], '既存の再起動通知だけを消して同じruntimeで再確認する');
  assert.ok(result.reads.every(file => file === ready));
  assert.deepEqual(result.errors, []);
});

test('Electron が使えない時は理由を表示してブラウザ版に切り替える（3本共通の規則）', async () => {
  const result = await 起動実行({ argv: ['--connect'], electron: false,
    ready: () => ({ windowShown: true, url: 'http://127.0.0.1:1/local/', publicUrl: 'https://example-1.app.github.dev/local/' }) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /_setup\.py/);
  assert.equal(result.spawned.length, 1);
  const [server] = result.spawned;
  assert.equal(server.executable, '/node');
  assert.match(server.args.at(-1)!, /src\/web-server\.ts$/);
  assert.equal(server.options.windowsHide, true, 'ブラウザ版のサーバーは画面を持たない');
  assert.equal(server.options.env.AIDIY_DISCORD_CONNECT, '1');
  assert.deepEqual(result.opened, ['https://example-1.app.github.dev/local/'], 'Codespaces では転送先の URL を開く');
  assert.deepEqual(result.errors, []);
});

test('既存ブラウザ版を検出したら、別の画面を開かず成功終了する', async () => {
  const result = await 起動実行({ argv: ['--browser'], electron: false, ready: () => ({ alreadyRunning: true }) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.spawned.length, 1);
  assert.match(result.messages[0], /起動済み/);
  assert.deepEqual(result.opened, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.errors, []);
});

test('Electron / Web のログ・readyは配置先temp、browser-profileは起動プロジェクトに分離する', async () => {
  const frontend = 区切り(new URL('..', new URL('../panel/launch.mjs', import.meta.url)));
  const temporary = join(frontend, '..', '..', 'temp', 'aidiy_discord');
  for (const browser of [false, true]) {
    const result = await 起動実行({ argv: browser ? ['--browser'] : [], electron: !browser,
      ready: () => ({ windowShown: true, url: 'http://127.0.0.1:1/' }) });
    const ready = join(temporary, 'runtime', 'restart-test.ready.json');
    assert.deepEqual(result.directories, [join(temporary, 'logs'), join(temporary, 'runtime')]);
    assert.deepEqual(result.logs, ['stdout', 'stderr'].map(name => join(temporary, 'logs', `restart-test.${name}.log`)));
    assert.equal(result.spawned[0].options.env.AIDIY_DISCORD_READY, ready);
    assert.equal(result.spawned[0].options.env.AIDIY_DISCORD_PROJECT, '/project', '閲覧プロジェクトの選択は変えない');
    assert.deepEqual(result.reads, [ready]);
    assert.deepEqual(result.profiles, browser ? [join('/project', '_AIDIY', 'aidiy_discord', 'browser-profile')] : []);
    assert.deepEqual(result.removed, [], '旧ログや保存profileの移動・削除をしない');
    assert.deepEqual(result.errors, []);
  }
});

test('一時保存先へ書き込めない場合は起動せず、旧outへの保存へ退避しない', async () => {
  const result = await 起動実行({ argv: ['--browser'], electron: false, storageError: true, ready: () => ({ windowShown: true }) });
  assert.equal(result.exitCode, 1);
  assert.equal(result.spawned.length, 0);
  assert.equal(result.directories.length, 1);
  assert.match(result.directories[0], /\/temp\/aidiy_discord\/logs$/);
  assert.deepEqual(result.logs, []);
  assert.deepEqual(result.profiles, []);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.errors, ['一時保存先へ書き込めません']);
});

test('既定で自動接続し、--no-connect の時だけ未接続で開く（Slack と同じ起動引数）', async () => {
  for (const [argv, connect] of [[[], '1'], [['--connect'], '1'], [['--no-connect'], '0']] as const) {
    const result = await 起動実行({ argv: [...argv], electron: true, ready: () => ({ windowShown: true }) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.spawned[0].options.env.AIDIY_DISCORD_CONNECT, connect, argv.join(' '));
    assert.match(result.messages[0], connect === '1' ? /自動接続/ : /「接続」で接続/);
  }
});
