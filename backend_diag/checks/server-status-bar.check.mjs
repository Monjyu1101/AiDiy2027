// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {起動状態を作成} from '../diag/ui/components/起動/起動状態.mjs';
const ids=['local','tools','core','apps','taskteam','web'];
function fixture(t){
 const config={checked:['tools','core','apps','taskteam','web'],ports:Object.fromEntries(ids.map(id=>[id,false])),fail:false,malformed:false,saveFail:false};
 const timers=[];
 const state=起動状態を作成({setTimer:fn=>{timers.push(fn);return fn;},clearTimer(){},api:async route=>{
  if(route==='api/起動/設定'){if(config.saveFail)throw Error('save failed');return {};}
  if(config.fail)throw Error('offline');
  if(route==='api/起動')return {対象:ids.map(id=>({id,設定:{起動対象:config.checked.includes(id)},状態:'未起動'})),実行中:false};
  if(route==='api/起動/ポート')return config.malformed?null:{対象:Object.entries(config.ports).map(([id,開放])=>({id,開放}))};
  return {ログ:'',位置:0};
 }});
 t.after(()=>state.終了());
 return {state,config,timers,refresh:async()=>{state.表示(true,false);await tick();await tick();}};
}
test('6サーバー全停止は黒、チェック対象全稼働はシアン、1件不足は赤',async t=>{
 const {state,config,refresh}=fixture(t);assert.equal(state.サーバー表示状態.value,'unknown');
 await refresh();assert.equal(state.サーバー表示状態.value,'offline');
 config.ports.tools=true;await refresh();assert.equal(state.サーバー表示状態.value,'disconnected');
 for(const id of config.checked)config.ports[id]=true;
 await refresh();assert.equal(state.サーバー表示状態.value,'online','チェック外Localの停止は無視');
 config.ports.apps=false;await refresh();assert.equal(state.サーバー表示状態.value,'disconnected');
 config.ports.apps=true;await refresh();assert.equal(state.サーバー表示状態.value,'online');
 for(const id of ids)config.ports[id]=false;
 await refresh();assert.equal(state.サーバー表示状態.value,'offline');
});
test('Toolsが停止でも選択対象が全稼働ならシアン、空対象やチェック外だけの稼働は赤',async t=>{
 const {state,config,refresh}=fixture(t);
 config.checked=['core'];config.ports.core=true;await refresh();assert.equal(state.サーバー表示状態.value,'online');
 config.checked=[];await refresh();assert.equal(state.サーバー表示状態.value,'disconnected');
 config.ports.core=false;await refresh();assert.equal(state.サーバー表示状態.value,'offline');
 config.ports.local=true;config.checked=['tools'];await refresh();assert.equal(state.サーバー表示状態.value,'disconnected');
});
test('取得エラー・不明・欠落・不正応答・Diag切断を正常や全停止と判定しない',async t=>{
 const {state,config,refresh}=fixture(t);
 config.checked=['core'];config.ports.core=true;await refresh();assert.equal(state.サーバー表示状態.value,'online');
 config.fail=true;await refresh();assert.equal(state.サーバー表示状態.value,'unknown');
 config.fail=false;config.ports.web=null;await refresh();assert.equal(state.サーバー表示状態.value,'unknown');
 delete config.ports.web;await refresh();assert.equal(state.サーバー表示状態.value,'unknown');
 config.ports.web=false;config.malformed=true;await refresh();assert.equal(state.サーバー表示状態.value,'unknown');
 config.malformed=false;await refresh();assert.equal(state.サーバー表示状態.value,'online');
 state.表示(false);assert.equal(state.サーバー表示状態.value,'unknown');
 await refresh();assert.equal(state.サーバー表示状態.value,'online');
 state.項目.value=[];assert.equal(state.サーバー表示状態.value,'unknown');
});
test('チェック変更に即追従し、保存失敗の巻き戻しでも色を戻す',async t=>{
 const {state,config,refresh}=fixture(t);config.checked=['core'];config.ports.core=true;await refresh();
 assert.equal(state.サーバー表示状態.value,'online');
 config.saveFail=true;const pending=state.設定変更('tools','起動対象',true);
 assert.equal(state.サーバー表示状態.value,'disconnected');await pending;assert.equal(state.サーバー表示状態.value,'online');
 config.saveFail=false;await state.設定変更('tools','起動対象',true);assert.equal(state.サーバー表示状態.value,'disconnected');
 await state.設定変更('tools','起動対象',false);assert.equal(state.サーバー表示状態.value,'online');
});
test('定期取得中は直前結果、切断後に遅い応答が来ても正常へ戻さない',async t=>{
 let release,hold=false;const timers=[];
 const state=起動状態を作成({setTimer:fn=>{timers.push(fn);return fn;},clearTimer(){},api:async route=>{
  if(route==='api/起動')return {対象:[{id:'core',設定:{起動対象:true},状態:'未起動'}],実行中:false};
  if(hold)return new Promise(resolve=>release=()=>resolve({対象:[{id:'core',開放:true}]}));
  return {対象:[{id:'core',開放:true}]};
 }});t.after(()=>state.終了());
 state.表示(true,false);await tick();await tick();assert.equal(state.サーバー表示状態.value,'online');
 hold=true;const polling=timers.at(-1)();await tick();assert.equal(state.サーバー表示状態.value,'online');
 state.表示(false);release();await polling;assert.equal(state.サーバー表示状態.value,'unknown');
});
test('通常・ミニとも起動状態をバーへ渡しTools単体に依存せず、全タブで監視する',async()=>{
 const app=await readFile(new URL('../diag/ui/App.vue',import.meta.url),'utf8');
 assert.match(app,/:is="ステータスバー"[^>]* :server-state="connected\?起動\.サーバー表示状態\.value:'unknown'"/);
 assert.doesNotMatch(app,/:is="ステータスバー"[^>]*:online="toolsOnline"/);
 assert.match(app,/起動\.表示\(online,value==='start'&&!mini\)/);
});
