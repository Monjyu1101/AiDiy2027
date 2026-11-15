// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReplyFoldTone} from '../src/components/コード/折畳配色.js';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('依頼中に折畳むとシアン脈動、回答で緑、展開で解除',()=>{
 const fold=createReplyFoldTone();
 fold.started();fold.collapsed(true,true);assert.equal(fold.tone.value,'online');
 fold.reply('変更しました。');assert.equal(fold.tone.value,'success');
 fold.finished();assert.equal(fold.tone.value,'success');
 fold.collapsed(false);assert.equal(fold.tone.value,'');
});
test('先頭が「!」の回答・エラー・停止は赤。赤は後続の回答で緑に戻さない',()=>{
 for(const fail of [f=>f.reply('!AIコアでエラーが発生しました'),f=>f.reply('！ 失敗'),f=>f.failed()]){
  const fold=createReplyFoldTone();
  fold.collapsed(true,true);fail(fold);assert.equal(fold.tone.value,'failure');
  fold.reply('続きの回答');assert.equal(fold.tone.value,'failure');
 }
});
test('未実行で折畳んだ場合は無色。折畳中に始まった依頼は脈動から結果色へ',()=>{
 const fold=createReplyFoldTone();
 fold.collapsed(true,false);assert.equal(fold.tone.value,'');
 fold.reply('関係のない出力');fold.failed();assert.equal(fold.tone.value,'');
 fold.started();assert.equal(fold.tone.value,'online');
 fold.finished();assert.equal(fold.tone.value,'online','回答より先に終了状態が届いても色は保つ');
 fold.reply('回答');assert.equal(fold.tone.value,'success');
 fold.started();assert.equal(fold.tone.value,'online','次の依頼で脈動に戻る');
});
test('展開中の回答は色に残らず、空の出力は無視する',()=>{
 const fold=createReplyFoldTone();
 fold.started();fold.reply('回答');fold.collapsed(true);assert.equal(fold.tone.value,'online');
 fold.reply('   ');assert.equal(fold.tone.value,'online');
 fold.reset();assert.equal(fold.tone.value,'');
});
test('Codeパネルは開始・終了・回答・エラーを配色へ伝え、折畳ボタンへ tone を渡す',()=>{
 const panel=read('../src/components/コード/コードパネル.vue');
 assert.match(panel,/watch\(panelCollapsed, collapsed => replyFold\.collapsed\(collapsed, !!state\.実行中\)\)/);
 assert.match(panel,/cancelPrediction\(\); replyFold\.started\(\); \}\n    else if \(!packet\.実行中 && state\.実行中\) replyFold\.finished\(\);/);
 assert.match(panel,/if \(!progressOnly\) replyFold\.reply\(text\);/);
 assert.match(panel,/if \(packet\.type !== 'modelCatalogError'\) replyFold\.failed\(\);/);
 assert.match(panel,/<PanelToggle :collapsed="panelCollapsed" :tone="replyFold\.tone\.value \|\| undefined"/);
});
