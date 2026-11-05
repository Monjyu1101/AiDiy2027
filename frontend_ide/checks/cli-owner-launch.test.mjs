// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import * as cliTitles from '../src/components/コンソール/CLIタイトル.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { parseArgs } from 'node:util';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

// 実launch関数を使い、ブラウザ・Electron・HTTPサーバー・CLIは全てmockする。
function fixture(opened, browser = true, desktopFailure = false) {
  let closed = 0, armed = 0, disposed = 0, openCalls = 0, options, desktopEnv, desktopArgs;
  const messages = [], process = new EventEmitter();
  Object.assign(process, { argv: [], env: { AIDIY_LAUNCHER_CHILD: '1' }, cwd: () => '/fixture', pid: 123, send: value => messages.push(value) });
  const app = { url: 'http://127.0.0.1:9999/', publicUrl: 'http://127.0.0.1:9999/', close: async () => { closed++; } };
  const modules = {
    './src/components/コンソール/CLIタイトル.js': cliTitles,
    'node:child_process': { spawn() { throw Error('process spawning is forbidden in fixture'); } },
    'node:fs': { existsSync: () => true }, 'node:path': path, 'node:url': url, 'node:util': { parseArgs },
    './server.mjs': { startDevelopment: async (_project, value) => { options = value; return app; } },
    './aidiy_console/cli-launch.mjs': { validateCliOptions() {}, resolveCliLaunch: async id => ({id,name:id==='aidiy_hermes'?'AiDiy Hermes':'GitHub Copilot CLI'}) },
    './aidiy_console/cli-session.mjs': { createCliOwnerLifetime: () => ({ arm: () => armed++, dispose: () => disposed++, started() {} }) },
    './viewer/launch-options.mjs': { projectFolder: () => '/fixture', useBrowser: () => browser, electronExecutable: () => 'fixture-electron' },
    './host/scripts/launch-project.mjs': { ブラウザで開く: async () => { openCalls++; return opened; } },
    './デスクトップ/desktop-process.mjs': { spawnDesktop(_executable,_args,{env}) { desktopEnv=env;desktopArgs=_args;const child=new EventEmitter();child.kill=()=>{};queueMicrotask(()=>desktopFailure?child.emit('error',Error('Electron unavailable')):child.emit('message',{windowShown:true}));return child; } },
    './デスクトップ/project-profile.cjs': { projectIdentity: value => ({ path: value }) },
  };
  let source = readFileSync(new URL('../launch.mjs', import.meta.url), 'utf8');
  source = source.slice(0, source.indexOf('if(process.argv[1]'));
  const module = { exports: {} };
  vm.runInNewContext(transformSync(source, { format: 'cjs', define: { 'import.meta.url': JSON.stringify(new URL('../launch.mjs', import.meta.url).href) } }).code,
    { module, exports: module.exports, process, URL, queueMicrotask, setTimeout, clearTimeout, console: { log() {}, warn() {} }, require: id => { if (!(id in modules)) throw Error(id); return modules[id]; } });
  return { launch: module.exports.launch, messages, process, stats: () => ({ closed, armed, disposed, openCalls, options, desktopEnv, desktopArgs }) };
}

test('CLIのブラウザ起動失敗: 所有サーバーを閉じ、launchReadyを返さない', async () => {
  const f = fixture(false);
  await assert.rejects(f.launch('console', ['--cli', 'copilot', '--cli-auto-approve', '--browser', '--foreground']), /ブラウザで開けません/);
  assert.equal(f.stats().closed, 1); assert.equal(f.stats().disposed, 1); assert.equal(f.stats().armed, 0); assert.equal(f.stats().openCalls, 1);
  assert.equal(f.messages.length, 0);
});

test('CLIのブラウザ起動成功: 初回開始期限を設け、放棄通知で所有サーバーを閉じる', async () => {
  const f = fixture(true);
  await f.launch('console', ['--cli', 'copilot', '--cli-auto-approve', '--browser', '--foreground']);
  assert.equal(f.stats().armed, 1); assert.equal(f.messages[0].launchReady, true); assert.equal(f.stats().closed, 0);
  await f.stats().options.onCliAbandoned(); assert.equal(f.stats().closed, 1); assert.equal(f.stats().disposed, 1);
});

test('通常Consoleのブラウザ起動失敗は既存のURL手動表示を維持する', async () => {
  const f = fixture(false);
  await f.launch('console', ['--browser', '--foreground']);
  assert.equal(f.messages[0].launchReady, true); assert.equal(f.stats().closed, 0); assert.equal(f.stats().armed, 0);
  f.process.emit('SIGTERM'); await Promise.resolve(); assert.equal(f.stats().closed, 1);
});


test('CLI launch forwards the selected display name to Electron and clears inherited names for ordinary Console',async()=>{
 for(const cli of [true,false]){
  const f=fixture(true,false);f.process.env.AIDIY_DEVELOPMENT_CLI_NAME='inherited stale title';
  await f.launch('console',[...(cli?['--cli','copilot']:[]),'--foreground']);
  assert.equal(f.stats().desktopEnv.AIDIY_DEVELOPMENT_CLI_NAME,cli?'GitHub Copilot CLI':'');
  assert.equal(f.stats().desktopEnv.AIDIY_DEVELOPMENT_CLI_WINDOW,cli?'1':'0');
  assert.equal(f.stats().desktopEnv.AIDIY_DEVELOPMENT_PROJECT,'/fixture');
  f.process.emit('SIGTERM');await Promise.resolve();
 }
});


test('Hermes launch sends only the shortened title to Electron, keeping the CLI ID',async()=>{
 const f=fixture(true,false);await f.launch('console',['--cli','aidiy_hermes','--foreground']);
 assert.equal(f.stats().desktopEnv.AIDIY_DEVELOPMENT_CLI_NAME,'Hermes');
 assert.equal(f.stats().options.cli,'aidiy_hermes');
 f.process.emit('SIGTERM');await Promise.resolve();
});


test('Standalone Browserは画面なし環境でもElectronへ正しい引数を渡し、終了でサーバーを停止する',async()=>{
 const f=fixture(true,true);await f.launch('browser',['--foreground','--new-window']);
 assert.equal(f.stats().openCalls,0);assert.equal(f.stats().options.kind,'browser');
 assert.deepEqual(Array.from(f.stats().desktopArgs).slice(-2),['--app','browser']);
 assert.equal(f.stats().desktopEnv.AIDIY_DEVELOPMENT_KIND,'browser');
 assert.equal(f.stats().desktopEnv.AIDIY_DEVELOPMENT_NEW_WINDOW,'1');
 assert.equal(f.messages[0].launchReady,true);
 f.process.emit('SIGTERM');await Promise.resolve();assert.equal(f.stats().closed,1);
});

test('Standalone BrowserのElectron失敗はWebへ切り替えず、サーバーを終了する',async()=>{
 const f=fixture(true,true,true);
 await assert.rejects(f.launch('browser',['--foreground']),/Electron unavailable/);
 assert.equal(f.stats().openCalls,0);assert.equal(f.stats().closed,1);assert.equal(f.messages.length,0);
});
