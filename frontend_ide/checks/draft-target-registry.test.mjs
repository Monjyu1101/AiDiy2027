// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftTargetRegistry } from '../src/components/下書き連携/連携先登録.js';

function panel(kind='code',projectPath='/same'){
  const info={kind,projectPath,contextId:'conversation',label:kind,maxLength:200000};
  const inserted=[];
  return{info,inserted,draftTarget:()=>info,insertDraft:value=>{inserted.push(value.text);return{ok:true};}};
}
test('Web連携先は複数Code/Liveを個別IDで識別し別プロジェクトを除く',()=>{
  const registry=createDraftTargetRegistry(),one=panel(),two=panel(),live=panel('live'),other=panel('code','/other');
  const list=registry.targets([one,two,live,other],'/same');
  assert.equal(list.length,3);assert.equal(new Set(list.map(item=>item.id)).size,3);assert.equal(registry.targets([one],'/same')[0].id,list[0].id);
  const request={targetId:list[1].id,contextId:'conversation',projectPath:'/same',sessionKey:'first',text:'source'};
  assert.equal(registry.insert([one,two,live],{sessionKey:'first',projectPath:'/same'},request).ok,true);
  assert.deepEqual(two.inserted,['source']);assert.deepEqual(one.inserted,[]);assert.deepEqual(live.inserted,[]);
});
test('再マウント・会話変更・セッション変更・対象終了に古い選択を使わない',()=>{
  const registry=createDraftTargetRegistry(),original=panel(),replacement=panel();
  const item=registry.targets([original],'/same')[0];
  const request={targetId:item.id,contextId:item.contextId,projectPath:'/same',sessionKey:'first',text:'source'};
  const current={sessionKey:'first',projectPath:'/same'};
  assert.equal(registry.insert([replacement],current,request).ok,false);
  original.info.contextId='changed';assert.equal(registry.insert([original],current,request).ok,false);
  original.info.contextId='conversation';assert.equal(registry.insert([original],{...current,sessionKey:'second'},request).ok,false);
  assert.equal(registry.insert([],current,request).ok,false);assert.deepEqual(original.inserted,[]);
});
