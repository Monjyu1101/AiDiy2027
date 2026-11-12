// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {表示切替前にパネルを開く} from '../ui/src/components/ウィンドウ/表示切替準備.mjs';
const source=name=>readFileSync(new URL('../ui/src/'+name,import.meta.url),'utf8');
function fixture(api){return {折畳み:{value:true},非表示:{value:true},世代:{value:0},要素:{value:{style:{maxHeight:'31px'}}},api,nextTick:async()=>{}};}
for(const mode of ['normal-to-mini','normal-to-micro','mini-to-micro','mini-to-normal']){
 test(`collapsed ${mode} restores native dimensions before displaying the target`,async()=>{
  let finish;const calls=[],state=fixture({collapsePanel:async value=>{calls.push(value);return new Promise(resolve=>finish=resolve);}});
  const pending=表示切替前にパネルを開く(state);assert.deepEqual(calls,[false]);assert.equal(state.折畳み.value,true);assert.equal(state.世代.value,0);
  finish({ok:true});assert.equal(await pending,true);
  assert.equal(state.折畳み.value,false);assert.equal(state.非表示.value,false);assert.equal(state.世代.value,1);assert.equal(state.要素.value.style.maxHeight,'');
  assert.equal(await 表示切替前にパネルを開く(state),true);assert.deepEqual(calls,[false]);
 });
}
test('rejected native expansion keeps folded UI and refuses mode transition',async()=>{
 const state=fixture({collapsePanel:async()=>({ok:false})});assert.equal(await 表示切替前にパネルを開く(state),false);assert.equal(state.折畳み.value,true);assert.equal(state.非表示.value,true);assert.equal(state.世代.value,0);
});
test('Web expansion clears the clip and resets toggle state without native APIs',async()=>{
 const state=fixture();assert.equal(await 表示切替前にパネルを開く(state),true);assert.equal(state.要素.value.style.maxHeight,'');assert.equal(state.世代.value,1);
});
test('mode buttons remain usable while folded, only in-flight animation is gated',()=>{
 const app=source('App.vue');assert.match(app,/:switching="\(パネル折畳み&&!パネル非表示\)\|\|ミニ\.切替中\.value\|\|マイクロ切替中"/);
 assert.ok(app.indexOf('await 表示切替前にパネルを開く')<app.indexOf('await window.aidiyWindow.beginDisplay'));
 assert.match(app,/:is="ステータスバー" :key="パネル表示世代"/);
});
test('folded normal and mini title remove connection bar including black background',()=>{
 assert.match(source('components/ウィンドウ/ステータスバー.vue'),/v-if="!collapsed&&!hidden" class="connection-bar"/);
 assert.match(source('style.css'),/\.diag-panel\[data-collapsed="true"\]>\.connection-bar\{display:none!important\}/);
 assert.match(source('style.css'),/#app:has\(\.diag-panel\[data-collapsed="true"\]\)\{background:transparent\}/);
});

test('folded root never paints viewport-height side borders below the title',()=>{
 assert.match(source('style.css'),/#app:has\(\.diag-panel\[data-collapsed="true"\]\)\{border:0\}/);
 assert.match(source('style.css'),/#app:has\(\.diag-panel-hidden\)\{height:31px;max-height:31px;overflow:hidden\}/);
});
