// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {アプリ状態を作成} from '../ui/src/components/アプリ起動/アプリ状態.mjs';
import {アプリアイコン} from '../ui/src/components/アプリ起動/アプリアイコン.mjs';
const catalog=online=>({対象:[{id:'avatar'},{id:'task',利用可能:online,無効理由:online?'':'TaskTeam 未起動'},{id:'team',利用可能:online,無効理由:online?'':'TaskTeam 未起動'},{id:'code'}]});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Task/Team fail closed until checked and track backend start/stop without blocking Code',async()=>{
 let online=false,launches=0;const state=アプリ状態を作成({api:async path=>path.endsWith('/開始')?(launches++,{受付:true}):catalog(online)});state.フォルダ.value='/project';
 assert.equal(state.利用可能('task'),false);await state.起動('task');assert.equal(launches,0);
 await state.読込();assert.equal(state.利用可能('team'),false);assert.equal(state.不可理由('task'),'TaskTeam 未起動');
 await state.起動('code');assert.equal(launches,1);
 online=true;await state.読込();assert.equal(state.利用可能('task'),true);await state.起動('task');await state.起動('team');assert.equal(launches,3);
 online=false;await state.読込();await state.起動('team');assert.equal(launches,3);
});
test('background polling refreshes all tabs; disconnect and late response cannot re-enable Task',async()=>{
 let callback,release,delay;const state=アプリ状態を作成({api:()=>new Promise(resolve=>release=resolve),schedule:(fn,ms)=>{callback=fn;delay=ms;return 1;},unschedule:()=>{callback=null;}});
 state.接続(true);release(catalog(true));await flush();assert.equal(state.利用可能('task'),true);assert.equal(delay,2500);
 callback();state.接続(false);release(catalog(true));await flush();assert.equal(state.利用可能('task'),false);assert.equal(callback,null);
 state.接続(true);release(catalog(true));await flush();assert.equal(state.利用可能('team'),true);state.終了();assert.equal(state.利用可能('team'),false);assert.equal(callback,null);
});
test('catalog request failure disables only backend-gated apps',async()=>{
 let fail=false;const state=アプリ状態を作成({api:async()=>{if(fail)throw Error('offline');return catalog(true);}});await state.読込();fail=true;await state.読込();assert.equal(state.利用可能('task'),false);assert.equal(state.利用可能('team'),false);assert.equal(state.利用可能('code'),true);
});
test('all launcher sizes gate Task/Team and expose disabled reason; app owns polling lifecycle',async()=>{
 for(const name of ['アプリ起動パネル.vue','ミニアプリ起動.vue','マイクロランチャー.vue']){const s=await readFile(new URL('../ui/src/components/アプリ起動/'+name,import.meta.url),'utf8');assert.match(s,/利用可能\(item.id\)/);assert.match(s,/不可理由\(item.id\)/);}
 const app=await readFile(new URL('../ui/src/App.vue',import.meta.url),'utf8');assert.match(app,/アプリ\.接続\(value\)/);assert.match(app,/アプリ\.終了\(\)/);
});
test('Task/Team use local PNG copies with readable fixed caption images',async()=>{
 for(const id of ['task','team']){assert.equal(アプリアイコン[id],`AiDiy_${id}.png`);const png=await readFile(new URL(`../ui/src/components/アプリ起動/アイコン/AiDiy_${id}.png`,import.meta.url));assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512);assert.deepEqual(png,await readFile(new URL(`../static/AiDiy_${id}.png`,import.meta.url)));}
});
