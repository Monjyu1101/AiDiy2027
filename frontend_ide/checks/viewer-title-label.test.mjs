// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('detached Viewer follows selected filename and real connection transitions',()=>{
 let render,sync,name='日本語.txt',online=true;
 const source={classList:{contains:v=>v==='online'&&online}};
 const owner={document:{querySelector:s=>s.includes('connection-bar')?source:null},MutationObserver:class{constructor(fn){sync=fn}observe(){}disconnect(){}},aidiyWindow:{}};
 const child={name:'viewer',document:{createElement:()=>({remove(){}})}};
 const host={prepend(){},classList:{add(){},remove(){}}};
 const context={createApp:x=>{render=x.render;return{mount(){},unmount(){}}},reactive:x=>x,h:(component,props,slots)=>({component,props,slots}),StatusBar:'status',PanelToggle:'toggle',WindowActions:'actions',createPanelWindowApi:()=>({})};
 vm.runInNewContext(read('src/components/ファイル閲覧/別窓タイトル.js').replace(/^import .*;$/gm,'').replace('export function','function')+'\nthis.mount=mountPanelTitle',context);
 const cleanup=context.mount(host,child,owner,'AiDiy IDE / Viewer - 日本語.txt','panel-viewer',{displayTitle:()=>`AiDiy IDE / Viewer - ${name}`});
 assert.equal(render().props.title,'AiDiy IDE / Viewer - 日本語.txt');
 assert.equal(render().props.status,undefined);assert.equal(render().props.connected,true);
 name='参照先.md';assert.equal(render().props.title,'AiDiy IDE / Viewer - 参照先.md');
 online=false;sync();assert.equal(render().props.connected,false);
 online=true;sync();assert.equal(render().props.connected,true);cleanup();
});
test('both Viewer entry points use the full title and shared connected label',()=>{
 const session=read('src/components/ファイル閲覧/閲覧セッション.vue');
 assert.match(session,/title:`AiDiy IDE \/ Viewer - \$\{props.file.name\}`/);
 assert.match(session,/displayTitle:\(\)=>`AiDiy IDE \/ Viewer - \$\{viewer.value\?\.selectedFile\(\)\?\.name\|\|props.file.name\}`/);
 const standalone=read('src/components/ファイル閲覧/閲覧ウィンドウ.vue');
 assert.match(standalone,/:title="`AiDiy IDE \/ Viewer - \$\{name\}`"/);
 assert.doesNotMatch(standalone,/status="別ウィンドウ"/);
 assert.match(read('src/components/共通表示/状態バー.vue'),/connected \? '接続済' : '未接続'/);
});
