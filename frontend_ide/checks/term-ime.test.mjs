// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import xterm from '@xterm/xterm';
import { termImeAnchor } from '../src/components/ターミナル/IME入力位置.js';
// 実xterm Core/CompositionHelperを実行。DOM測定とevent phaseのみfixture。Windows実IMEではない。
const root = fileURLToPath(new URL('../node_modules/@xterm/xterm/src/', import.meta.url));
// 任意のjsdom実行では、本物のHTMLTextAreaElementとDOMのcapture/bubble順も確認する。
const dom = process.env.AIDIY_TEST_JSDOM ? new (await import(process.env.AIDIY_TEST_JSDOM)).JSDOM('<!doctype html><body>') : null;
const result = await build({entryPoints:[root+'browser/input/CompositionHelper.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{common:root+'common',browser:root+'browser'},tsconfigRaw:{compilerOptions:{experimentalDecorators:true}}});
const { CompositionHelper } = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
class Textarea {
 value='';style={};listeners=[];selectionStart=0;selectionEnd=0;
 addEventListener(type,fn,capture=false){this.listeners.push({type,fn,capture});}
 removeEventListener(type,fn,capture=false){this.listeners=this.listeners.filter(x=>x.type!==type||x.fn!==fn||x.capture!==capture);}
 start(){for(const capture of [true,false])for(const x of [...this.listeners])if(x.type==='compositionstart'&&x.capture===capture)x.fn();}
}
for(const enabled of [false,true])test(`IME開始時の古い右端アンカー (補正=${enabled})`,async()=>{
 const terminal=new xterm.Terminal({cols:40,rows:14}),core=terminal._core,textarea=dom ? dom.window.document.createElement('textarea') : new Textarea();
 const start=()=>dom ? textarea.dispatchEvent(new dom.window.CompositionEvent('compositionstart',{bubbles:true,data:''})) : textarea.start();
 const view={style:{},classList:{add(){},remove(){}},getBoundingClientRect:()=>({width:0,height:20})};
 const render={refreshRows(){},dimensions:{css:{cell:{width:9,height:20}}}},sent=[];
 const helper=new CompositionHelper(textarea,view,core._bufferService,core.optionsService,{triggerDataEvent:data=>sent.push(data)},render);
 core.textarea=textarea;core._compositionHelper=helper;core._renderService=render;
 textarea.addEventListener('compositionstart',()=>helper.compositionstart());
 const hook=enabled?termImeAnchor(terminal):null;
 try{
  // 応答後に実カーソルは戻っているが、textareaの右端位置だけ古い状態。
  await new Promise(done=>terminal.write('user: test\r\nassistant: completed\r\n'+'─'.repeat(40)+'\x1b[7;3H',done));
  assert.equal(core.buffer.x,2);assert.equal(core.buffer.y,6);
  textarea.style.left='351px';textarea.style.top='100px';
  textarea.value='既存';textarea.selectionStart=textarea.selectionEnd=2;
  start();
  assert.equal(textarea.style.left,enabled?'18px':'351px');assert.equal(textarea.style.top,enabled?'120px':'100px');
  if(enabled)assert.equal(view.style.left,'18px');
  assert.equal(textarea.value,'既存');assert.equal(textarea.selectionStart,2);assert.deepEqual(sent,[]);
  textarea.value='既存日本';helper.compositionupdate({data:'日本'});
  await new Promise(resolve=>setTimeout(resolve,5));helper.compositionend();await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(sent,['日本']);
  hook?.dispose();textarea.style.left='351px';start();assert.equal(textarea.style.left,'351px','dispose後は補正なし');
 }finally{hook?.dispose();terminal.dispose();}
});
test('未対応内部APIはno-op',()=>{termImeAnchor({textarea:new Textarea(),_core:{}}).dispose();});
test('open後に登録しunmountで解除',async()=>{
 const text=await readFile(new URL('../src/components/ターミナル/ターミナルパネル.vue',import.meta.url),'utf8');
 assert.ok(text.indexOf('terminal.open(container.value)')<text.indexOf('imeAnchor = termImeAnchor(terminal)'));
 assert.match(text,/imeAnchor\?\.dispose\(\)/);
});
