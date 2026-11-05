// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { consoleKeyHandler } from '../src/components/コンソール/キー入力.js';
const event=(key,extra={})=>({type:'keydown',key,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra});
test('Console clipboard: 全キー段階でOSのコピー・貼付けを妨げず、制御文字も送らない',()=>{
 const sent=[],handle=consoleKeyHandler(data=>sent.push(data),{platform:'Win32'});
 for(const type of ['keydown','keypress','keyup'])for(const key of ['c','C','v','V'])for(const modifier of ['ctrlKey','metaKey'])for(const shiftKey of [false,true]){
  const e=event(key,{type,[modifier]:true,shiftKey});assert.equal(handle(e),false);assert.equal(e.prevented,undefined);
 }
 assert.deepEqual(sent,[]);
});
test('Console modified Enter: Alt・Shiftを区別し、keyup/keypressは二重送信しない',()=>{
 const sent=[],handle=consoleKeyHandler(data=>sent.push(data),{platform:'Win32'});
 for(const [modifiers,expected] of [[{altKey:true},'\x1b\r'],[{shiftKey:true},'\x1b[13;2u'],[{altKey:true,shiftKey:true},'\x1b[13;4u']]){
  for(const type of ['keydown','keypress','keyup']){const e=event('Enter',{...modifiers,type});assert.equal(handle(e),false);assert.ok(e.prevented&&e.stopped);}
  assert.equal(sent.at(-1),expected);
 }
 assert.equal(sent.length,3);
});
test('Console IMEと通常キー: 変換確定・AltGr・既存の端末制御をxtermへ委ねる',()=>{
 const handle=consoleKeyHandler(()=>assert.fail('unexpected input'));
 for(const e of [event('Enter'),event('Enter',{shiftKey:true,isComposing:true}),event('Enter',{altKey:true,keyCode:229}),event('@',{ctrlKey:true,altKey:true,getModifierState:name=>name==='AltGraph'}),event('Dead',{altKey:true}),event('A',{shiftKey:true}),event('Tab'),event('ArrowUp')]){assert.equal(handle(e),true);assert.equal(e.prevented,undefined);}
});

test('Console修飾キー: Ctrlの英字・JIS記号、AltとShiftの組合せを欠落・重複なく送信する',()=>{
 const sent=[],handle=consoleKeyHandler(data=>sent.push(data),{platform:'Win32'});
 const cases=[];
 for(const shiftKey of [false,true])for(let code=97;code<=122;code++){
  const key=String.fromCharCode(code);if(key==='c'||key==='v')continue;
  cases.push([shiftKey?key.toUpperCase():key,{ctrlKey:true,shiftKey},String.fromCharCode(code-96)]);
 }
 for(const [key,expected] of [['?',127],['/',31],['@',0],['^',30],['_',31],['\\',28],['[',27],[']',29]])cases.push([key,{ctrlKey:true},String.fromCharCode(expected)]);
 cases.push(['?',{ctrlKey:true,shiftKey:true},'\x7f'],['!',{ctrlKey:true,shiftKey:true},'\x1b[33;6u'],
  ['a',{altKey:true},'\x1ba'],['A',{altKey:true,shiftKey:true},'\x1bA'],['@',{altKey:true,keyCode:192},'\x1b@'],
  ['d',{ctrlKey:true,altKey:true},'\x1b\x04'],['Enter',{ctrlKey:true},'\x1b[13;5u'],
  ['Enter',{ctrlKey:true,altKey:true,shiftKey:true},'\x1b[13;8u'],['Tab',{ctrlKey:true},'\x1b[9;5u'],
  ['Tab',{altKey:true,shiftKey:true},'\x1b[9;4u'],['Insert',{shiftKey:true},'\x1b[2;2~'],
  ['PageUp',{shiftKey:true},'\x1b[5;2~'],['PageDown',{altKey:true},'\x1b[6;3~']);
 for(const [key,extra,expected] of cases){
  const before=sent.length;
  for(const type of ['keydown','keypress','keyup']){const e=event(key,{...extra,type});assert.equal(handle(e),false);assert.ok(e.prevented&&e.stopped);}
  assert.deepEqual(sent.slice(before),[expected],`${key} ${JSON.stringify(extra)}`);
 }
});


test('Console Mac Option: 通常文字・Shift・dead key・IMEを既定のxterm入力へ委ねる',()=>{
 for(const platform of ['MacIntel','Macintosh','MacPPC','Mac68K']){
  const handle=consoleKeyHandler(()=>assert.fail('unexpected ESC input'),{platform});
  const cases=[['@',{}],['å',{}],['Å',{shiftKey:true}],['€',{}],['Dead',{}],
   ['é',{}],['Enter',{isComposing:true}],['あ',{keyCode:229}],['あ',{isComposing:true}]];
  for(const [key,extra] of cases)for(const type of ['keydown','keypress','keyup']){
   const e=event(key,{altKey:true,...extra,type});
   assert.equal(handle(e),true,`${platform} ${key} ${type}`);
   assert.equal(e.prevented,undefined);assert.equal(e.stopped,undefined);
  }
 }
});

test('Console OS判定: 引数省略時は入力元navigator.platformを使う',()=>{
 const require=createRequire(import.meta.url),{transformSync}=require('esbuild');
 const source=readFileSync(new URL('../src/components/コンソール/キー入力.js',import.meta.url),'utf8');
 for(const platform of ['MacIntel','Win32','Linux x86_64']){
  const module={exports:{}};
  vm.runInNewContext(transformSync(source,{format:'cjs'}).code,{module,navigator:{platform}});
  const sent=[],handle=module.exports.consoleKeyHandler(data=>sent.push(data)),e=event('@',{altKey:true});
  assert.equal(handle(e),platform==='MacIntel');
  assert.deepEqual(sent,platform==='MacIntel'?[]:['\x1b@']);
 }
});

test('Console Mac: Ctrl・Ctrl+Option・修飾Enterの既存送信は維持する',()=>{
 const sent=[],handle=consoleKeyHandler(data=>sent.push(data),{platform:'MacIntel'});
 for(const [key,extra,expected] of [['d',{ctrlKey:true},'\x04'],
  ['d',{ctrlKey:true,altKey:true},'\x1b\x04'],['Enter',{altKey:true},'\x1b\r'],
  ['Enter',{altKey:true,shiftKey:true},'\x1b[13;4u']]){
  const before=sent.length;
  for(const type of ['keydown','keypress','keyup']){
   const e=event(key,{...extra,type});assert.equal(handle(e),false);assert.ok(e.prevented&&e.stopped);
  }
  assert.deepEqual(sent.slice(before),[expected]);
 }
});

test('Console Windows/Linux: Alt文字を送り、AltGraphの文字入力は奪わない',()=>{
 for(const platform of ['Win32','Linux x86_64']){
  const sent=[],handle=consoleKeyHandler(data=>sent.push(data),{platform});
  for(const [key,extra,expected] of [['@',{altKey:true},'\x1b@'],['A',{altKey:true,shiftKey:true},'\x1bA']]){
   assert.equal(handle(event(key,extra)),false);assert.equal(sent.at(-1),expected);
  }
  const before=sent.length;
  for(const type of ['keydown','keypress','keyup']){
   const e=event('@',{type,ctrlKey:true,altKey:true,getModifierState:name=>name==='AltGraph'});
   assert.equal(handle(e),true);assert.equal(e.prevented,undefined);assert.equal(e.stopped,undefined);
  }
  assert.equal(sent.length,before);
 }
});

test('Console clipboard: 実xtermのcopy/paste経路は選択モデル・日本語・bracketed pasteを保持する',()=>{
 const require=createRequire(import.meta.url),{transformSync}=require('esbuild'),module={exports:{}};
 const source=readFileSync(new URL('../node_modules/@xterm/xterm/src/browser/Clipboard.ts',import.meta.url),'utf8');
 vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module});
 const {copyHandler,handlePasteEvent}=module.exports;
 const copied=[];let prevented=false;
 copyHandler({clipboardData:{setData:(...args)=>copied.push(args)},preventDefault(){prevented=true;}},{selectionText:'xtermの選択'});
 assert.deepEqual(copied,[['text/plain','xtermの選択']]);assert.ok(prevented);
 for(const bracketedPasteMode of [false,true]){
  const sent=[],textarea={value:'old'};let stopped=false;
  handlePasteEvent({stopPropagation(){stopped=true;},clipboardData:{getData:type=>{assert.equal(type,'text/plain');return '日本語 •・·\n2行目';}}},textarea,{decPrivateModes:{bracketedPasteMode},triggerDataEvent:(data,user)=>sent.push([data,user])},{rawOptions:{}});
  assert.deepEqual(sent,[[bracketedPasteMode?'\x1b[200~日本語 •・·\r2行目\x1b[201~':'日本語 •・·\r2行目',true]]);assert.equal(textarea.value,'');assert.ok(stopped);
 }
});
