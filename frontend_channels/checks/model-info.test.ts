// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { authFixture } from './internal-auth-fixture';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {モデル情報取得} from '../src/モデル情報/モデル情報';

test('APIはセッションを作らず初期値と候補を取得し、通信・形式エラーはファイル参照へ戻す',async(t)=>{
 const fixture = authFixture(); t.after(fixture.cleanup);
 const data={モデル設定:{LIVE_AI_NAME:'freeai_live'},available_models:{live_models:{freeai_live:{model:'Model'}},live_voices:{freeai_live:{Zephyr:'Voice'}},chat_models:{},code_models:{}}};
 const request:typeof fetch=async(input,options)=>{
  assert.equal(String(input),encodeURI('http://127.0.0.1:8091/core/AIコア/モデル情報/取得'));
  assert.deepEqual(JSON.parse(String(options?.body)),{セッションID:''});
  assert.equal(options?.method,'POST');
  return Response.json({status:'OK',data});
 };
 const info=await モデル情報取得('ws://127.0.0.1:8091/core/ws/AIコア',request,fixture.root, {wait: async () => {}});
 assert.deepEqual(info?.settings,data.モデル設定);
 assert.deepEqual(info?.catalog.voices,data.available_models.live_voices);
 for(const response of [Response.json({status:'NG'}),Response.json({status:'OK',data:{}}),new Response('',{status:503}),Response.json({status:'OK',data:{...data,available_models:{}}})]){
  assert.equal(await モデル情報取得('ws://127.0.0.1:8091',async()=>response, fixture.root, {wait: async () => {}}),undefined);
 }
 assert.equal(await モデル情報取得('ws://127.0.0.1:8091',async()=>{throw Error('offline');}, fixture.root, {wait: async () => {}}),undefined);
});
