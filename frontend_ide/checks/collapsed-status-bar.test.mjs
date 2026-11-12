// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {parse,compileTemplate}=require('@vue/compiler-sfc');
const {transformSync}=require('esbuild');
const {createSSRApp}=require('vue');
const {renderToString}=require('@vue/server-renderer');
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const source=read('../src/components/共通表示/状態バー.vue');
const {descriptor}=parse(source);
const compiled=compileTemplate({source:descriptor.template.content,filename:'状態バー.vue',id:'collapsed-status'});
assert.deepEqual(compiled.errors,[]);
const module={exports:{}};
vm.runInNewContext(transformSync(compiled.code,{format:'cjs'}).code,{module,exports:module.exports,require});
for(const mode of ['online','offline'])for(const connected of [true,false])test(`折畳完了時はバーをinline非表示にして復元する (${mode}/${connected})`,async()=>{
 for(const hidden of [false,true,false,true,false]){
 const app=createSSRApp({data:()=>({title:'検証',status:'',mode,connected,busy:false,active:false,desktop:false,pulseStyle:{},hideConnectionBar:hidden}),render:module.exports.render});
 app.component('WindowActions',{render:()=>null});
 const html=await renderToString(app);
 assert.equal(/class="connection-bar[^>]*display:none/.test(html),hidden,html);
 assert.ok(html.includes('class="connection-bar'));
 assert.match(html,/class="panel-brand/);
 }
});
test('バー非表示時は明滅更新を停止する',()=>{
 assert.match(source,/!props\.hideConnectionBar&&props\.clockPulse/);
 assert.match(source,/props\.connected,props\.hideConnectionBar/);
});
for(const [file,state] of [
 ['コード/コードパネル.vue','panelHidden'],['ライブ/ライブパネル.vue','panelHidden'],
 ['コンソール/コンソールパネル.vue','panelHidden'],['ブラウザ/ブラウザパネル.vue','panelHidden'],
 ['開発スペース/Naviパネル.vue','panelHidden'],['タスクチーム/タスクチームパネル.vue','panelHidden'],
])test(`${file} はscoped CSSのクリップだけに頼らず非描画を伝える`,()=>{
 assert.match(read('../src/components/'+file),new RegExp(':hide-connection-bar="'+state+'"'));
});
test('IDE本体も非描画を伝える',()=>assert.match(read('../src/App.vue'),/:hide-connection-bar="ideHidden"/));
