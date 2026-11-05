// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse,compileTemplate} from '@vue/compiler-sfc';
import {createNavigationMessage} from '../src/components/開発スペース/Navigationメッセージ.js';

function fixture(){
 const timers=new Map(),writes=[];let id=0;
 const message=createNavigationMessage(text=>writes.push(text),{schedule:callback=>{timers.set(++id,callback);return id;},cancel:id=>timers.delete(id)});
 return{...message,timers,writes,text:()=>writes.at(-1),flush(){const callbacks=[...timers.values()];timers.clear();for(const callback of callbacks)callback();}};
}
for(const event of [{type:'click',pointerType:'mouse'},{type:'click',pointerType:'touch'},{type:'keydown',key:'a'},{type:'keydown',key:'Tab'},{type:'wheel'},{type:'touchmove'}]){
 test(`最下部通知は次の${event.pointerType||event.key||event.type}操作の後で消え、操作を妨げない`,()=>{
  const f=fixture();f.show('完了しました');
  f.dismiss({...event,preventDefault:()=>assert.fail('既定動作を止めない'),stopPropagation:()=>assert.fail('伝播を止めない')});
  assert.equal(f.text(),'完了しました','操作中はクリック先のレイアウトを維持する');f.flush();assert.equal(f.text(),'');
 });
}
test('表示を発生させた同じクリックでは通知を消さない',()=>{
 const f=fixture();f.dismiss({type:'click'});f.show('停止しました');f.flush();assert.equal(f.text(),'停止しました');
 f.dismiss({type:'click'});f.show('新しい通知');f.flush();assert.equal(f.text(),'新しい通知');
});
test('遅延消去は同文の再通知を含む後続メッセージを消さない',()=>{
 const f=fixture();f.show('接続できません');f.dismiss({type:'click'});f.dismiss({type:'wheel'});
 f.show('接続できません');f.flush();assert.equal(f.text(),'接続できません');
 f.dismiss({type:'keydown',key:'Escape'});f.flush();assert.equal(f.text(),'');
});
for(const key of ['Enter',' ','Spacebar'])test(`ボタンの${JSON.stringify(key)}から生じるclickを一つの操作として扱う`,()=>{
 const f=fixture();f.show('実行中');f.dismiss({type:'keydown',key,target:{closest:()=>({})}});f.flush();assert.equal(f.text(),'実行中');
 f.dismiss({type:'click'});f.show('停止しました');f.flush();assert.equal(f.text(),'停止しました');
 f.dismiss({type:'keydown',key,target:{closest:()=>null}});f.flush();assert.equal(f.text(),'','入力欄のキー操作なら消す');
});
test('破棄後のタイマー・遅延通知は画面を書き換えない',()=>{
 const f=fixture();f.show('元の通知');f.dismiss({type:'click'});const late=[...f.timers.values()][0];
 f.dispose();assert.equal(f.timers.size,0);late();f.show('遅延通知');f.dismiss({type:'click'});f.flush();assert.deepEqual(f.writes,['元の通知']);
});
test('Naviの通知処理はcaptureで先に記録し、非表示Codeの停止操作を通知と独立して維持する',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/Navigationパネル.vue',import.meta.url),'utf8');
 const {descriptor}=parse(source);assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:'Navigationパネル.vue',id:'navigation-message'}).errors,[]);
 for(const event of ['click.capture','keydown.capture','wheel.capture.passive','touchmove.capture.passive'])assert.ok(source.includes(`@${event}="autopilotMessage.dismiss"`));
 assert.match(source,/v-if="autopilotStatus\|\|\(autopilot&&!codeOpen\)" class="navigation-autopilot-status"/);
 assert.match(source,/v-if="autopilot&&!codeOpen" type="button" @click="stopAutopilot\(\)"/);
 assert.match(source,/onClick:event=>\{autopilotMessage.dismiss\(event\);toggleCode\(\);\}/,'別窓のタイトル操作も対象');
 assert.equal((source.match(/autopilotStatus\.value\s*=/g)||[]).length,1,'全ての通知を同じ世代管理へ通す');
 assert.match(source,/autopilotMessage\.dispose\(\)/);
});
