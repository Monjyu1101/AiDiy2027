// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import {期限入力表示,期限見出し,期限を変換,期限経過} from '../memo/ui/src/期限表示.mjs';
import {自動保存を作成} from '../memo/ui/src/自動保存.mjs';

test('ローカル時刻から変換し、分単位・ちょうど期限到達の判定',()=>{
 const before=process.env.TZ;
 process.env.TZ='Asia/Tokyo';
 try{
  const input='2027-01-02T03:04',utc='2027-01-01T18:04:00.000Z';
  assert.equal(期限を変換(input),utc);assert.equal(期限入力表示(utc),input);assert.equal(期限見出し(utc),'01/02 03:04');
  assert.equal(期限経過(utc,Date.parse(utc)-1),false);assert.equal(期限経過(utc,Date.parse(utc)),true);
  assert.equal(期限を変換('2027-02-29T03:04'),null);assert.equal(期限を変換(''),null);
  assert.equal(期限経過(null,Date.parse(utc)),false);
  process.env.TZ='America/New_York';
  assert.equal(期限を変換('2027-03-14T02:30'),null,'夏時間の存在しない時刻を拒否');
 }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('期限を追加・解除して保存キューへ渡し、既存の下書きを失わない',async()=>{
 const calls=[];
 const model=自動保存を作成({sourceId:'launch:test',api:async(route,{body})=>{
  calls.push({route,body});return {id:'fixture.memo.json',revision:String(calls.length),保存先:'launch:test'};
 }});
 assert.equal(model.snapshot().blankNew,true);
 const 期限='2027-01-01T18:04:00.000Z';
 model.edit({本文:'入力中'},{defer:true});model.edit({期限},{defer:true});
 assert.equal(model.snapshot().draft.期限,期限);
 assert.equal(await model.flush(),true);
 assert.equal(calls[0].body.本文,'入力中');assert.equal(calls[0].body.期限,期限);
 model.edit({期限:null},{defer:true});assert.equal(await model.flush(),true);
 assert.equal(calls[1].body.期限,null);assert.equal(model.snapshot().dirty,false);
 model.dispose();
});
