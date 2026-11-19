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
import {Editor} from '../packages/tui/src/components/editor.ts';

for(const Renderer of [TuiMainScreen,TuiAltScreen])for(const visible of [false,true]){
 test(`${Renderer.name}: 1往復・差分・縮小後も同期終了時に入力カーソルを確定（可視=${visible}）`,async()=>{
  const output=[];
  const terminal=new Proxy({columns:40,rows:14,write:s=>output.push(s),hideCursor:()=>output.push('\x1b[?25l'),showCursor:()=>output.push('\x1b[?25h')},{get:(o,k)=>k in o?o[k]:()=>{}});
  const tui=new Renderer(terminal,visible);
  const emulator=new headless.Terminal({cols:40,rows:14,allowProposedApi:true});
  let conversation=['ready'],tail=['F'.repeat(40)];
  const editor=new Editor(tui,{borderColor:s=>s,selectList:{}});
  tui.addChild({render:()=>conversation,invalidate(){}});
  tui.addChild(editor);
  tui.addChild({render:()=>tail,invalidate(){}});
  tui.setFocus(editor);
  const position=()=>[emulator.buffer.active.cursorX,emulator.buffer.active.cursorY];
  async function frame(label,expectedX,focused=true){
   tui.renderNow();
   const bytes=output.splice(0).join(''),commits=[];
   for(const part of bytes.split(/(\x1b\[\?2026l)/)){
    await new Promise(resolve=>emulator.write(part,resolve));
    if(part==='\x1b[?2026l')commits.push(position());
   }
   for(const cursor of commits)assert.deepEqual(cursor,position(),`${label}: 同期確定後にカーソルが動かない`);
   if(focused)assert.equal(position()[0],expectedX,`${label}: 日本語の入力列`);
   const visibility=[...bytes.matchAll(/\x1b\[\?25([hl])/g)].at(-1)?.[1];
   assert.equal(visibility,focused&&visible?'h':'l',`${label}: 明示カーソル設定・非入力時を維持`);
  }
  try{
   tui.start();await frame('初回',0);
   editor.setText('日本');await frame('日本語入力',4);
   editor.setText('');conversation=['user: 日本','assistant: streaming'];await frame('送信後',0);
   conversation=['user: 日本','assistant: completed response','turn ended'];await frame('1往復完了',0);
   await frame('変更なし',0);
   tail=['F'.repeat(40),'extra','extra'];await frame('追加表示',0);
   tail=['F'.repeat(40)];await frame('末尾行削除',0);
   tui.setFocus(null);await frame('入力フォーカスなし',undefined,false);
   tui.setFocus(editor);editor.setText('次');await frame('フォーカス復帰',2);
  }finally{tui.stop();emulator.dispose();}
 });
}
