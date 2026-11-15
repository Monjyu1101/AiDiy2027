// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('Diagの折畳ボタンは通常・ミニとも接続バーと同じ配色を受け取る',()=>{
 const bar=read('../diag/ui/components/ウィンドウ/ステータスバー.vue');
 assert.match(bar,/const barTone=computed\(\(\)=>props\.connected&&props\.serverState==='online'\?'online':props\.connected&&props\.serverState==='offline'\?'offline':'disconnected'\);/);
 assert.equal(bar.match(/<component :is="パネル表示切替" :collapsed="collapsed" :tone="barTone"/g)?.length,2,'通常表示とミニ表示の両方');
 assert.match(bar,/<div v-if="!collapsed&&!hidden" class="connection-bar" :class="barTone"/);
});
test('折畳中の▶は接続バーと同じ色・明滅を使い、配布CSSにも含まれる',()=>{
 for(const css of [read('../diag/ui/style.css'),read('../static/style.css')]){
  assert.match(css,/\.code-panel-mark\.tone-online\{background:(?:cyan|#0ff);animation:cyan-bar-breathe 4\.5s linear infinite\}/);
  assert.match(css,/\.code-panel-mark\.tone-disconnected\{background:(?:#ff0000|red);animation:disconnected-bar-breathe 4\.5s linear infinite\}/);
  assert.match(css,/\.code-panel-mark\.tone-offline\{background:#000\}/);
  assert.match(css,/\.connection-bar\.online\{background:(?:cyan|#0ff);animation:cyan-bar-breathe 4\.5s linear infinite\}/);
  assert.match(css,/\.connection-bar\.disconnected\{background:(?:#ff0000|red);animation:disconnected-bar-breathe 4\.5s linear infinite\}/);
 }
});
