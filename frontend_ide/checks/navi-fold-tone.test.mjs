// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createActivityFoldTone} from '../src/components/開発スペース/Navi折畳配色.js';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('実行中に折畳むとシアン脈動、止まったら緑、エラーなら赤、展開で解除',()=>{
 for(const [failed,expected] of [[false,'success'],[true,'failure']]){
  const fold=createActivityFoldTone();
  fold.activity(true);fold.collapsed(true);assert.equal(fold.tone.value,'online');
  fold.activity(false,failed);assert.equal(fold.tone.value,expected);
  fold.collapsed(false);assert.equal(fold.tone.value,'');
 }
});
test('未実行で折畳んだら無色。折畳中に動き始めたら脈動し、止まったら結果色',()=>{
 const fold=createActivityFoldTone();
 fold.activity(false);fold.collapsed(true);assert.equal(fold.tone.value,'');
 fold.activity(true);assert.equal(fold.tone.value,'online');
 fold.activity(true);assert.equal(fold.tone.value,'online','実行中の継続（ナビ→コード実行→再評価）で色を変えない');
 fold.activity(false);assert.equal(fold.tone.value,'success');
 fold.activity(true);assert.equal(fold.tone.value,'online','次の実行で脈動に戻る');
});
test('展開中に終わった処理は色に残らない',()=>{
 const fold=createActivityFoldTone();
 fold.activity(true);fold.activity(false,true);fold.collapsed(true);assert.equal(fold.tone.value,'');
 fold.reset();assert.equal(fold.tone.value,'');
});
test('Naviはナビ・再評価・自動航行・内蔵Code実行を一つの実行状態にまとめ、両方の折畳ボタンへ渡す',()=>{
 const navi=read('../src/components/開発スペース/Naviパネル.vue');
 assert.match(navi,/const naviActive=computed\(\(\)=>routing\.value\|\|autopilot\.value\|\|!!codePanel\.value\?\.isRunning\?\.\(\)\);/);
 assert.match(navi,/watch\(naviActive,value=>naviFold\.activity\(value,job\.value\?\.status==='failed'\|\|!!error\.value\|\|autopilotFailed\),\{immediate:true\}\);/);
 assert.match(navi,/if\(!controller\.signal\.aborted\)autopilotFailed=true;/,'利用者の停止は赤にしない');
 assert.match(navi,/<PanelToggle :collapsed="panelCollapsed" :tone="naviFold\.tone\.value \|\| undefined"/);
 assert.match(navi,/displayTitle:\(\)=>title\.value,foldTone:naviFold,/);
 const title=read('../src/components/ファイル閲覧/別窓タイトル.js');
 assert.match(title,/tone: foldTone\?\.tone\.value \|\| undefined/);
 assert.match(title,/collapse\.collapsed = !collapse\.collapsed; foldTone\?\.collapsed\(collapse\.collapsed\);/);
 assert.match(read('../src/components/ファイル閲覧/パネル別窓.js'),/titleTools, displayTitle, foldTone \}\);/);
 assert.match(read('../src/components/コード/コードパネル.vue'),/isRunning: \(\) => !!state\.実行中 \}\);/);
});
