// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');
function fixture(){
 const context={computed:fn=>({get value(){return fn();}}),launching:{value:''},state:{value:{mode:'online'}},liveOpen:{value:false},browserAvailable:{value:true},panelOpen:{value:false},tab:{value:'code'},openNavigation(){},openWindow(){},openPanel(){}};
 vm.runInNewContext(source.slice(source.indexOf('const launchText='),source.indexOf('async function openWindow'))+';globalThis.desktop=desktopLaunchItems;globalThis.web=panelLaunchItems;',context);return context;
}
test('IDEメニュー: Console → Browser と Live → Avatar、起動中は両方を除き終了後復元',()=>{
 const f=fixture(),keys=()=>Array.from(f.desktop.value,item=>item.key);
 assert.deepEqual(keys(),['console','browser','navigation','code','live','avatar','task','team']);
 assert.equal(f.desktop.value.find(x=>x.key==='avatar').text,'Avatar');
 for(const kind of ['live','avatar']){f.launching.value=kind;assert.ok(!keys().includes('live'));assert.ok(!keys().includes('avatar'));}f.launching.value='';
 f.liveOpen.value=true;assert.deepEqual(keys(),['console','browser','navigation','code','task','team']);
 f.liveOpen.value=false;assert.ok(keys().includes('live'));assert.ok(keys().includes('avatar'));
 f.state.value.mode='offline';assert.deepEqual(keys(),['console','browser','code']);
});
test('Web IDEはプロセス起動のAvatarを表示せず、既存Liveタブと順序を保つ',()=>{
 const f=fixture();assert.deepEqual(Array.from(f.web.value,x=>x.key),['console','browser','navigation','code','live']);
 f.liveOpen.value=true;assert.ok(f.web.value.some(x=>x.key==='live'));
});
test('VR起動列もConsole直後Browser、Live直後Avatar',()=>{
 const toolbar=source.slice(source.indexOf('<div class="all-launchers">'),source.indexOf('<div v-if="allBusy"'));
 const labels=Array.from(toolbar.matchAll(/@click="(openWindow\('([^']+)'|openNavigation)/g),m=>m[2]||'navigation');
 assert.deepEqual(labels,['console','browser','navigation','code','live','avatar']);
 assert.match(toolbar,/v-if="state.mode==='online'&&!liveOpen[^"]*"[^\n]+openWindow\('avatar'/);
});
