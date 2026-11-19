// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実IMEではなく、実レンダラーとEditorの同期描画終了時の端末カーソルを検証する。
import test from 'node:test';
import assert from 'node:assert/strict';
import headless from '@xterm/headless';
import {TuiMainScreen} from '../packages/tui/src/tui-main-screen.ts';
import {TuiAltScreen} from '../packages/tui/src/tui-alt-screen.ts';
import {Input} from '../packages/tui/src/components/input.ts';
await import('../packages/coding-agent/src/experimental/source-resolver.ts');
const {CustomEditor} = await import('../packages/coding-agent/src/modes/interactive/components/custom-editor.ts');

for(const Renderer of [TuiMainScreen,TuiAltScreen])for(const visible of [false,true]){
 test(`${Renderer.name}: 1往復・差分・縮小後も同期終了時に入力カーソルを確定（可視=${visible}）`,async()=>{
  const output=[];
  const terminal=new Proxy({columns:40,rows:14,write:s=>output.push(s),hideCursor:()=>output.push('\x1b[?25l'),showCursor:()=>output.push('\x1b[?25h')},{get:(o,k)=>k in o?o[k]:()=>{}});
  const tui=new Renderer(terminal,visible);
  const emulator=new headless.Terminal({cols:40,rows:14,allowProposedApi:true});
  let conversation=['ready'],tail=['F'.repeat(40)];
  const editor=new CustomEditor(tui,{borderColor:s=>s,selectList:{}},{matches:()=>false},{embedWorkingStatus:true});
  tui.addChild({render:()=>conversation,invalidate(){}});
  tui.addChild(editor);
  tui.addChild({render:()=>tail,invalidate(){}});
  tui.setFocus(editor);
  const position=()=>[emulator.buffer.active.cursorX,emulator.buffer.active.cursorY];
  async function frame(label,expectedX,focused=true){
   tui.renderNow();
   const writes=output.splice(0),bytes=writes.join(''),commits=[];
   // xtermは同期描画中でも各writeのparse後にtextareaを更新する。小さいframeを分割しない。
   const frameStart=writes.findIndex(s=>s.includes('\x1b[?2026h'));
   if(frameStart!==-1){
    assert.ok(writes[frameStart].includes('\x1b[?2026l'),`${label}: 描画とIME復帰を同じwriteへ`);
    assert.equal(frameStart,writes.length-1,`${label}: 復帰後に描画writeが残らない`);
   }
   for(const part of bytes.split(/(\x1b\[\?2026l)/)){
    await new Promise(resolve=>emulator.write(part,resolve));
    if(part==='\x1b[?2026l')commits.push(position());
   }
   for(const cursor of commits)assert.deepEqual(cursor,position(),`${label}: 同期確定後にカーソルが動かない`);
   if(focused&&expectedX!==undefined)assert.equal(position()[0],expectedX,`${label}: 日本語の入力列`);
   const visibility=[...bytes.matchAll(/\x1b\[\?25([hl])/g)].at(-1)?.[1];
   assert.equal(visibility,focused&&visible?'h':'l',`${label}: 明示カーソル設定・非入力時を維持`);
  }
  try{
   tui.start();await frame('初回',0);
   editor.handleInput('日本');await frame('日本語入力',4);
   editor.onSubmit=text=>{
    conversation=[`user: ${text}`,'assistant: streaming'];
    editor.setWorkingStatusIndicator({renderInBorder:()=> 'working',renderSpinnerInBorder:()=> '*'});
   };
   editor.handleInput('\r');assert.equal(editor.getText(),'');await frame('送信後',0);
   editor.setWorkingStatusIndicator(undefined);
   conversation=['user: 日本','assistant: completed response','turn ended'];await frame('1往復完了',0);
   await frame('変更なし',0);
   const dialog=new Input();
   const overlay=tui.showOverlay(dialog,{width:24});
   assert.equal(editor.focused,false);assert.equal(dialog.focused,true);
   await frame('応答後ダイアログ',undefined);
   overlay.hide();assert.equal(editor.focused,true);
   await frame('ダイアログ終了後の入力復帰',0);
   const notice=tui.showOverlay({render:()=>['選択してください'],invalidate(){}},{width:24});
   await frame('非入力ダイアログ',undefined,false);
   notice.hide();await frame('非入力ダイアログ終了',0);
   tail=['F'.repeat(40),'extra','extra'];await frame('追加表示',0);
   tail=['F'.repeat(40)];await frame('末尾行削除',0);
   tui.setFocus(null);await frame('入力フォーカスなし',undefined,false);
   tui.setFocus(editor);editor.setText('次');await frame('フォーカス復帰',2);
  }finally{tui.stop();emulator.dispose();}
 });
}

test('MainScreen: 1 MiB境界直前でもIME復帰制御列を分割しない',()=>{
 const output=[];
 const terminal=new Proxy({columns:40,rows:14,write:s=>output.push(s),hideCursor:()=>output.push('\x1b[?25l'),showCursor:()=>output.push('\x1b[?25h')},{get:(o,k)=>k in o?o[k]:()=>{}});
 const tui=new TuiMainScreen(terminal,false);
 let padding='';
 const editor=new CustomEditor(tui,{borderColor:s=>s,selectList:{}},{matches:()=>false});
 tui.addChild({render:()=>[padding+'response'],invalidate(){}});
 tui.addChild(editor);
 tui.addChild({render:()=>['footer'],invalidate(){}});
 tui.setFocus(editor);
 try{
  tui.start();output.length=0;tui.renderNow(true);
  const baseline=output.splice(0).join('');
  const tail=baseline.match(/\x1b\[\d+A\x1b\[1G\x1b\[\?25l\x1b\[\?2026l$/)?.[0];
  assert.ok(tail);
  // 幅を増やさないSGRで、カーソル制御列の開始をchunk末尾1文字前へ置く。
  const count=1024*1024-1-(baseline.length-tail.length);
  const remainder=count%4;
  padding='\x1b[0m'.repeat(Math.floor(count/4)-remainder)+'\x1b[00m'.repeat(remainder);
  tui.renderNow(true);
  const writes=output.splice(0);
  assert.equal(writes.length,2);
  assert.equal(writes[0].length,1024*1024-1);
  assert.equal(writes[1],tail);
  assert.ok(writes.every(value=>value.length<=1024*1024));
 }finally{tui.stop();}
});
