// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {認証セッションを作成} from '../shared/ui/認証セッション.mjs';
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
const session=(store,url='http://127.0.0.1:3456/')=>認証セッションを作成({location:new URL(url),storage:()=>store});
test('認証成功後のキーだけ同じタブの再読込へ渡す',()=>{
 const store=memory(),first=session(store,'http://127.0.0.1:3456/#token=fixture');
 assert.equal(first.初期キー,'fixture');assert.equal(session(store).初期キー,'');
 first.保存(first.初期キー);assert.equal(session(store).初期キー,'fixture');
 assert.equal(session(memory()).初期キー,'');
});
test('別origin・ポート・公開パスへキーを持ち出さない',()=>{
 const store=memory();session(store).保存('fixture');
 for(const url of ['http://localhost:3456/','http://127.0.0.1:3457/','http://127.0.0.1:3456/other/'])assert.equal(session(store,url).初期キー,'');
});
test('新しい起動URLは前回のキーを置き換え、空キーでも古いキーへ戻らない',()=>{
 const store=memory();session(store).保存('old');
 const next=session(store,'http://127.0.0.1:3456/#token=new');assert.equal(next.初期キー,'new');assert.equal(session(store).初期キー,'');
 next.保存('new');assert.equal(session(store).初期キー,'new');
 assert.equal(session(store,'http://127.0.0.1:3456/#token=').初期キー,'');assert.equal(session(store).初期キー,'');
});
test('手入力の置換と401で破棄したキーは再読込で復活しない',()=>{
 const store=memory(),auth=session(store);auth.保存('old');auth.破棄();assert.equal(session(store).初期キー,'');
 auth.保存('manual');assert.equal(session(store).初期キー,'manual');auth.破棄();assert.equal(session(store).初期キー,'');
});
test('ストレージ取得・読み書き・削除が拒否されても起動キーをメモリで利用できる',()=>{
 const failure=()=>{throw Error('blocked');};
 for(const storage of [failure,()=>({getItem:failure,setItem:failure,removeItem:failure}),()=>undefined]){
  const auth=認証セッションを作成({location:new URL('http://127.0.0.1:3456/#token=fixture'),storage});
  assert.equal(auth.初期キー,'fixture');assert.doesNotThrow(()=>{auth.保存('fixture');auth.破棄();});
  assert.equal(認証セッションを作成({location:new URL('http://127.0.0.1:3456/'),storage}).初期キー,'');
 }
});
