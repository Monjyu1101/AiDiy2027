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
import { consoleInputMode } from '../aidiy_console/input-mode.mjs';
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
// xtermの公開parser境界を模擬する。実際の分割CSIの解析はブラウザー検証で確認する。
function modeFixture(platform = 'Win32') {
 const handlers = new Map(), sent = [];
 const register = (id, callback) => { const key = JSON.stringify(id); handlers.set(key, callback); return { dispose: () => handlers.delete(key) }; };
 const terminal = { parser: { registerCsiHandler: register, registerEscHandler: register } };
 const handle = consoleKeyHandler(data => sent.push(data), { platform, terminal });
 return { handle, sent, handlers,
  mode(enabled, params = [9001]) { return handlers.get(JSON.stringify({ prefix: '?', final: enabled ? 'h' : 'l' }))(params); },
  ris() { return handlers.get(JSON.stringify({ final: 'c' }))(); },
 };
}
const enterRecords = state => `\x1b[13;28;${state & 8 ? 10 : 13};1;${state};1_\x1b[13;28;${state & 8 ? 10 : 13};0;${state};1_`;
test('Console Win32文字入力: Ctrl+EnterのLFとAlt+EnterのCRを修飾情報と同時に保持する', () => {
 const f = modeFixture(); f.mode(true);
 for (const [extra, character, state] of [
  [{ ctrlKey: true }, 10, 8], [{ ctrlKey: true, shiftKey: true }, 10, 24],
  [{ ctrlKey: true, altKey: true }, 10, 10], [{ ctrlKey: true, altKey: true, shiftKey: true }, 10, 26],
  [{ altKey: true }, 13, 2], [{ altKey: true, shiftKey: true }, 13, 18], [{ shiftKey: true }, 13, 16],
 ]) {
  f.handle(event('Enter', extra));
  const records = [...f.sent.pop().matchAll(/\x1b\[([\d;]+)_/g)].map(match => match[1].split(';').map(Number));
  // ネイティブAPIはVK/Cs、文字ストリームの読み手はUcを使う。両方を検証する。
  assert.deepEqual(records, [[13, 28, character, 1, state, 1], [13, 28, character, 0, state, 1]]);
 }
 f.handle.dispose();
});
test('Console ConPTY: 要求された時だけ全7組の修飾EnterをWin32 down/upで一度送る', () => {
 for (const platform of ['Win32', 'MacIntel', 'Linux x86_64']) {
  const f = modeFixture(platform);
  f.handle(event('Enter', { shiftKey: true })); assert.equal(f.sent.pop(), '\x1b[13;2u');
  assert.equal(f.mode(true, [1, 9001, 2004]), false, '同じCSIの既存モードもxtermへ渡す');
  for (let modifiers = 1; modifiers < 8; modifiers++) {
   const extra = { shiftKey: !!(modifiers & 1), altKey: !!(modifiers & 2), ctrlKey: !!(modifiers & 4) };
   const state = (extra.shiftKey ? 16 : 0) | (extra.altKey ? 2 : 0) | (extra.ctrlKey ? 8 : 0);
   for (const code of ['Enter', 'NumpadEnter']) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
     const e = event('Enter', { ...extra, code, type }); assert.equal(f.handle(e), false); assert.ok(e.prevented && e.stopped);
    }
    assert.deepEqual(f.sent.splice(0), [enterRecords(state | (code === 'NumpadEnter' ? 256 : 0))]);
   }
  }
  f.handle(event('Enter', { shiftKey: true, location: 3 })); assert.equal(f.sent.pop(), enterRecords(272));
  for (const repeat of [false, true, true]) f.handle(event('Enter', { ctrlKey: true, repeat }));
  assert.deepEqual(f.sent.splice(0), Array(3).fill(enterRecords(8)));
  f.handle.dispose(); assert.equal(f.handlers.size, 0);
 }
});
test('Console ConPTY: 通常Enter・IME・AltGr・Meta・clipboardを変更しない', () => {
 const f = modeFixture(); f.mode(true);
 for (const type of ['keydown', 'keypress', 'keyup']) {
  for (const extra of [{}, { shiftKey: true, isComposing: true }, { ctrlKey: true, keyCode: 229 },
   { shiftKey: true, metaKey: true }, { altKey: true, ctrlKey: true, getModifierState: name => name === 'AltGraph' }]) {
   const e = event('Enter', { type, ...extra }); assert.equal(f.handle(e), true); assert.equal(e.prevented, undefined);
  }
  for (const key of ['c', 'v']) { const e = event(key, { type, ctrlKey: true }); assert.equal(f.handle(e), false); assert.equal(e.prevented, undefined); }
 }
 assert.deepEqual(f.sent, []);
 f.handle(event('d', { ctrlKey: true })); assert.equal(f.sent.pop(), '\x04');
 f.handle.dispose();
});
test('Console ConPTY: 解除・再接続・RISでリセットし、別端末や他モードを混同しない', () => {
 const f = modeFixture(), other = modeFixture();
 const check = expected => { f.handle(event('Enter', { shiftKey: true })); assert.equal(f.sent.pop(), expected); };
 f.mode(true, [19001, [9001, 1], 2004]); check('\x1b[13;2u');
 f.mode(true); check(enterRecords(16));
 other.handle(event('Enter', { shiftKey: true })); assert.equal(other.sent.pop(), '\x1b[13;2u');
 f.mode(false, [2004]); check(enterRecords(16));
 assert.equal(f.mode(false), false); check('\x1b[13;2u');
 f.mode(true); f.handle.reset(); check('\x1b[13;2u');
 f.mode(true); assert.equal(f.ris(), false); check('\x1b[13;2u');
 f.mode(true); f.handle.dispose(); f.handle.dispose(); check('\x1b[13;2u');
 assert.equal(f.handlers.size, 0); other.handle.dispose();
});
test('Console実xterm parser: 分割/複合CSI・既存モード・解除・RISを透過して追跡する', async () => {
 const require = createRequire(import.meta.url), { Terminal } = require('@xterm/xterm');
 const terminal = new Terminal(), sent = [];
 const handle = consoleKeyHandler(data => sent.push(data), { terminal });
 const write = data => new Promise(resolve => terminal.write(data, resolve));
 const check = expected => { handle(event('Enter', { shiftKey: true })); assert.deepEqual(sent.splice(0), [expected]); };
 try {
  await write('\x1b[>7u'); check('\x1b[13;2u'); // Kitty対応を偽って宣言しない。
  await write('\x1b[?90'); check('\x1b[13;2u');
  await write('01;1;2004h'); check(enterRecords(16));
  assert.equal(terminal.modes.applicationCursorKeysMode, true);
  assert.equal(terminal.modes.bracketedPasteMode, true);
  terminal.clear(); check(enterRecords(16));
  await write('\x1b[?1l'); check(enterRecords(16));
  assert.equal(terminal.modes.applicationCursorKeysMode, false);
  await write('\x1b[?9001;2004l'); check('\x1b[13;2u');
  assert.equal(terminal.modes.bracketedPasteMode, false);
  await write('\x1b[?9001;2004h'); await write('\x1bc'); check('\x1b[13;2u');
  assert.equal(terminal.modes.bracketedPasteMode, false);
  await write('\x1b[?9001h'); handle.reset(); terminal.reset(); check('\x1b[13;2u');
  handle.dispose(); await write('\x1b[?9001h'); check('\x1b[13;2u');
 } finally { handle.dispose(); terminal.dispose(); }
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


test('Consoleモード保存: 分割・制御中断・文字列内ESCの解釈を実xtermと照合する', async () => {
 const { Terminal } = createRequire(import.meta.url)('@xterm/xterm');
 const cases = ['\x1b[?9001h', '\x1b[?9001l', '\x1bc', '\x9b?9001;2004h', '\x1b[?19001h',
  '\x1b[?9001:1h', '\x1b[?1:2;9001h', '\x1b[?9001;1:2h', '\x1b[?9001\x18h', '\x1b[?90\x1b[?2004h', '\x1b[?9001\nh',
  '\x1b]0;title\x1b[?9001h\x07', '\x1bPpayload\x1b[?9001l\x1b\\', '\x1b c',
  '\x1b[?9001 h', '\x1b[?0009001h', '\x1b[>4;2m', '\x1b[>7u'];
 const terminal = new Terminal(), mode = consoleInputMode(), sent = [];
 const handle = consoleKeyHandler(data => sent.push(data), { terminal });
 try {
  for (const source of cases) {
   mode.write('\x1bc'); handle.reset(); terminal.reset();
   for (const character of source) {
   mode.write(character); await new Promise(resolve => terminal.write(character, resolve));
   handle(event('Enter', { shiftKey: true }));
   assert.equal(sent.pop() === enterRecords(16), mode.enabled, JSON.stringify(source));
   }
  }
 } finally { handle.dispose(); terminal.dispose(); }
});
