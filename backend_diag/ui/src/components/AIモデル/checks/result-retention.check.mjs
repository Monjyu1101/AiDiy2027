// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {AIモデル状態を作成} from '../AIモデル状態.mjs';
import {TRIAL_FAMILIES} from '../../../../../モデル試行/defaults.mjs';

const audioId='a'.repeat(32);
const catalog={区分:Object.fromEntries(TRIAL_FAMILIES.map(f=>[f,{プロバイダ:[{id:'test',モデル:[{id:'one',利用可能:true},{id:'two',利用可能:true}],音声:[{id:'voice'}]}]}]))};
function fixture(){
 let attempt=0,fail='',chats=[];const revoked=[],calls=[];
 const s=AIモデル状態を作成({接続可能:()=>true,createURL:()=>`blob:live-${attempt}`,revokeURL:url=>revoked.push(url),api:async(path,method,_signal,_format,body)=>{
  calls.push({path,method,body});
  if(path==='api/AIモデル')return catalog;
  if(path==='api/モデル試行/チャット成功'&&method==='DELETE'){chats=[];return {};}
  if(method==='DELETE')return {};
  if(path.endsWith('/開始')){attempt++;if(fail==='start')throw Error('start failed');return {実行ID:'run',チャット成功:chats};}
  if(path.includes('/音声/'))return new Blob([new Uint8Array(100)],{type:'audio/wav'});
  const family=path.split('/').at(-1).replace('CODE1','CODE');
  if(fail===family)throw Error('request failed');
  if(family==='CHAT')chats=[{プロバイダ:'test',モデル:'one'}];
  return {状態:'OK',応答:`${family}-${attempt}`,説明:`説明-${family}-${attempt}`,チャット成功:chats,...(family==='LIVE'?{音声ファイル:{id:audioId,MIME:'audio/wav',長さms:1200}}:{})};
 }});
 return {s,calls,revoked,setFailure:value=>{fail=value;}};
}

test('batch then each single retry retains every unrelated result, description and Live audio',async()=>{
 for(const family of TRIAL_FAMILIES){const f=fixture(),{s}=f;try{
  await s.読込();await s.開始(true);const before=JSON.parse(JSON.stringify(s.結果一覧.value));
  s.区分変更(family);await s.開始();
  for(const other of TRIAL_FAMILIES)if(other!==family)assert.deepEqual(s.結果一覧.value[other],before[other],`${family} must retain ${other}`);
  assert.equal(s.結果一覧.value[family].応答,`${family}-2`);
  if(family!=='LIVE'){assert.equal(s.音声状態.value[audioId].url,'blob:live-1');assert.deepEqual(f.revoked,[]);}
 }finally{s.終了();}}
});

test('single request/start failure changes only target and cannot reuse stale CHAT qualification',async()=>{
 for(const failure of ['CHAT','start']){const f=fixture(),{s}=f;try{
  await s.読込();await s.開始(true);const before=JSON.parse(JSON.stringify(s.結果一覧.value));f.setFailure(failure);s.区分変更('CHAT');await s.開始();
  assert.equal(s.結果一覧.value.CHAT.状態,'NG');
  for(const other of TRIAL_FAMILIES.filter(x=>x!=='CHAT'))assert.deepEqual(s.結果一覧.value[other],before[other]);
  assert.deepEqual(s.チャット成功.value,[]);assert.equal(s.予測条件.value.テスト可能,false);
  assert.equal(s.音声状態.value[audioId].url,'blob:live-1');
 }finally{s.終了();}}
});

test('editing a model invalidates only its own result, but CHAT edit invalidates prediction eligibility',async()=>{
 const {s}=fixture();try{
  await s.読込();await s.開始(true);const before=JSON.parse(JSON.stringify(s.結果一覧.value));
  s.区分変更('DECISION');s.変更('model','two');assert.equal(s.結果.value,null);assert.equal(s.予測条件.value.テスト可能,true);
  for(const other of TRIAL_FAMILIES.filter(x=>x!=='DECISION'))assert.deepEqual(s.結果一覧.value[other],before[other]);
  s.区分変更('CHAT');s.変更('model','two');assert.equal(s.結果.value,null);assert.equal(s.予測条件.value.テスト可能,false);
  assert.deepEqual(s.結果一覧.value.PREDICTION,before.PREDICTION);
 }finally{s.終了();}
});
