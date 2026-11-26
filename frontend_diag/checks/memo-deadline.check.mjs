// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {メモ色} from '../memo/ui/src/メモ編集.mjs';
import {期限入力表示,期限見出し,期限を変換,期限状態,新規期限初期値,指定期限を変換,期限の分} from '../memo/ui/src/期限表示.mjs';
import {自動保存を作成} from '../memo/ui/src/自動保存.mjs';

test('ローカル時刻をUTCに変換し、分単位の期限を検証',()=>{
 const before=process.env.TZ;
 process.env.TZ='Asia/Tokyo';
 try{
  const input='2027-01-02T03:04',utc='2027-01-01T18:04:00.000Z';
  assert.equal(期限を変換(input),utc);assert.equal(期限入力表示(utc),input);assert.equal(期限見出し(utc),'01/02 03:04');
  assert.deepEqual(期限の分,['00','15','30','45']);
  assert.equal(指定期限を変換('2027-01-02','03','04'),null);assert.equal(指定期限を変換('2027-01-02','03','15'),'2027-01-01T18:15:00.000Z');
  assert.equal(期限を変換('2027-02-29T03:04'),null);assert.equal(期限を変換(''),null);

  process.env.TZ='America/New_York';
  assert.equal(期限を変換('2027-03-14T02:30'),null,'夏時間の存在しない時刻を拒否');
 }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('未設定時の初期値はローカルの次の正時。日付・年の境界も繰り上がる',()=>{
 const before=process.env.TZ;
 process.env.TZ='Asia/Tokyo';
 try{
  assert.equal(新規期限初期値(Date.parse('2027-01-02T13:38:54+09:00')),'2027-01-02T14:00');
  assert.equal(新規期限初期値(Date.parse('2027-01-02T13:59:59+09:00')),'2027-01-02T14:00');
  assert.equal(新規期限初期値(Date.parse('2027-01-02T14:00:00+09:00')),'2027-01-02T15:00');
  assert.equal(新規期限初期値(Date.parse('2027-12-31T23:59:00+09:00')),'2028-01-01T00:00');
 }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('期限の15分前ちょうどから予告し、期限到達で背景も明滅する',()=>{
 const utc='2027-01-01T18:15:00.000Z', end=Date.parse(utc), warning=end-15*60000;
 assert.deepEqual(期限状態(null,warning),{状態:'なし',次の切替:null});
 assert.deepEqual(期限状態('invalid',warning),{状態:'なし',次の切替:null});
 assert.deepEqual(期限状態(utc,warning-1),{状態:'通常',次の切替:1});
 assert.deepEqual(期限状態(utc,warning),{状態:'予告',次の切替:15*60000});
 assert.deepEqual(期限状態(utc,end-1),{状態:'予告',次の切替:1});
 assert.deepEqual(期限状態(utc,end),{状態:'到達',次の切替:null});
 assert.deepEqual(期限状態(utc,end+1),{状態:'到達',次の切替:null});
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

test('期限の光は11配色で異なり、光っている間も本文のコントラストを保つ',()=>{
 const css=readFileSync(new URL('../memo/ui/src/メモ画面.css',import.meta.url),'utf8');
 const colors=new Set();
 const rgb=hex=>hex.match(/../g).map(channel=>Number.parseInt(channel,16));
 const luminance=color=>color.reduce((total,v,i)=>{
  const s=v/255;
  return total+[0.2126,0.7152,0.0722][i]*(s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4);
 },0);
 for(const color of メモ色){
  const rule=css.split(`.sticky-${color}{--sticky-bg:`)[1]?.split('}')[0];
  const match=rule?.match(/^#([0-9a-f]{6});--sticky-glow:#([0-9a-f]{6})(?:;--sticky-pulse-base:#([0-9a-f]{6}))?$/);
  assert.ok(match,color);
  const [,base,peak,dim=base]=match;colors.add(peak);
  assert.ok(luminance(rgb(peak))-luminance(rgb(dim))>0.12,color);
  const text=luminance(rgb(color.startsWith('vivid-')?'ffffff':'29322e'));
  for(let i=0;i<=10;i++){
   const background=luminance(rgb(dim).map((v,j)=>v+(rgb(peak)[j]-v)*i/10));
   assert.ok((Math.max(text,background)+0.05)/(Math.min(text,background)+0.05)>=4.5,color);
  }
 }
 assert.equal(colors.size,メモ色.length);
});
