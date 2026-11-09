// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import size from '../host/scripts/window-size.cjs';
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
  let closed = 0, armed = 0, disposed = 0, openCalls = 0, options, desktopEnv, desktopArgs, browserOptions;
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
    './host/scripts/launch-project.mjs': { ウィンドウ: size, ブラウザで開く: async (_url, value) => { browserOptions = value; openCalls++; return opened; } },
    './デスクトップ/desktop-process.mjs': { spawnDesktop(_executable,_args,{env}) { desktopEnv=env;desktopArgs=_args;const child=new EventEmitter();child.kill=()=>{};queueMicrotask(()=>desktopFailure?child.emit('error',Error('Electron unavailable')):child.emit('message',{windowShown:true}));return child; } },
    './デスクトップ/project-profile.cjs': { projectIdentity: value => ({ path: value }) },
  };
  let source = readFileSync(new URL('../launch.mjs', import.meta.url), 'utf8');
  source = source.slice(0, source.indexOf('if(process.argv[1]'));
  const module = { exports: {} };
  vm.runInNewContext(transformSync(source, { format: 'cjs', define: { 'import.meta.url': JSON.stringify(new URL('../launch.mjs', import.meta.url).href) } }).code,
    { module, exports: module.exports, process, URL, queueMicrotask, setTimeout, clearTimeout, console: { log() {}, warn() {} }, require: id => { if (!(id in modules)) throw Error(id); return modules[id]; } });
  return { launch: module.exports.launch, messages, process, stats: () => ({ closed, armed, disposed, openCalls, options, desktopEnv, desktopArgs, browserOptions }) };
}

test('Navi, Code and Live browser app launches use the shared 900 height',async()=>{
 for(const kind of ['navi','code','live']){
  const f=fixture(true);await f.launch(kind,['--browser','--foreground']);
  assert.equal(f.stats().browserOptions.height ?? size.会話高さ,900);
  assert.equal(f.stats().options.kind,kind);assert.equal(f.messages[0].launchReady,true);
  f.process.emit('SIGTERM');await Promise.resolve();assert.equal(f.stats().closed,1);
 }
});

test('Windowsブラウザのアプリ起動は480×900、明示した設定パネルの高さは維持する',async()=>{
 const calls=[],module={exports:{}};
 const process={platform:'win32',env:{PROGRAMFILES:'C:/Program Files'}};
 const modules={
  'node:child_process':{spawn(command,args){calls.push({command,args});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}},
  'node:fs':{existsSync:()=>true,statSync:()=>({isDirectory:()=>true})},'node:path':path,'node:url':url,
  './project-storage.cjs':{},'./window-size.cjs':size,
 };
 const source=readFileSync(new URL('../host/scripts/launch-project.mjs',import.meta.url),'utf8');
 vm.runInNewContext(transformSync(source,{format:'cjs',define:{'import.meta.url':JSON.stringify(new URL('../host/scripts/launch-project.mjs',import.meta.url).href)}}).code,
  {module,exports:module.exports,process,URL,console,require:id=>{assert.ok(id in modules,id);return modules[id];}});
 const open=module.exports.ブラウザで開く;
 for(const options of [undefined,{height:undefined},{height:size.ナビ高さ}]){
  assert.equal(await open('http://127.0.0.1:9999/',options),true);
  assert.ok(calls.at(-1).args.includes('--window-size=480,900'));
 }
 assert.equal(await open('http://127.0.0.1:9999/',{height:size.パネル高さ}),true);
 assert.ok(calls.at(-1).args.includes('--window-size=480,414'));
});
