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
const source=read('../src/components/コード/パネル表示切替.vue');
const {descriptor}=parse(source);
const compiled=compileTemplate({source:descriptor.template.content,filename:'パネル表示切替.vue',id:'collapsed-tone'});
assert.deepEqual(compiled.errors,[]);
const module={exports:{}};
vm.runInNewContext(transformSync(compiled.code,{format:'cjs'}).code,{module,exports:module.exports,require});
const noop=()=>{};
async function render(collapsed,tone,blackExpanded=false){
 const app=createSSRApp({data:()=>({collapsed,tone,blackExpanded,disabled:false,desktop:true,button:undefined,drag:{down:noop,move:noop,up:noop,cancel:noop,click:noop}}),render:module.exports.render});
 return renderToString(app);
}
for(const tone of ['online','disconnected','offline'])test(`折畳中だけ接続状況（${tone}）の色をマーク背景に付ける`,async()=>{
 assert.match(await render(true,tone),new RegExp(`class="code-panel-mark tone-${tone}"`));
 assert.doesNotMatch(await render(false,tone),/tone-/);
});
test('toneを渡さない窓は従来どおり無色',async()=>assert.doesNotMatch(await render(true,undefined),/tone-/));
test('内容変更通知の画面は展開中も黒背景で固定',async()=>assert.match(await render(false,'online',true),/class="code-panel-mark tone-offline"/));
test('色は接続バーと同じ値・明滅を使う',()=>{
 const style=descriptor.styles[0].content,global=read('../src/style.css');
 assert.match(style,/tone-online\{--connection-color:#00ffff;animation:connection-breathe 4\.5s linear infinite\}/);
 assert.match(style,/tone-disconnected\{--connection-color:#ff0000;animation:connection-breathe 4\.5s linear infinite\}/);
 assert.match(global,/\.connection-bar\.online\{--connection-color:#00ffff;/);
 assert.match(global,/\.connection-bar\.disconnected\{--connection-color:#ff0000;/);
});
test('Liveは接続バーと同じ判定でtoneを渡す',()=>{
 assert.match(read('../src/components/ライブ/ライブパネル.vue'),/<PanelToggle :collapsed="panelCollapsed" :tone="connected \? 'online' : busy \? 'disconnected' : 'offline'"/);
});
