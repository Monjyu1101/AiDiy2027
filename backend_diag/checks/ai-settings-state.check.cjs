// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const req=createRequire(path.join(__dirname,'../ui/package.json'));
const source=fs.readFileSync(path.join(__dirname,'../diag/ui/components/AI設定/AI設定状態.mjs'),'utf8');
const moduleShim={exports:{}};
vm.runInNewContext(req('esbuild').transformSync(source,{format:'cjs'}).code,{module:moduleShim,exports:moduleShim.exports,require:()=>req('vue'),AbortController,setTimeout,clearTimeout});
const create=moduleShim.exports.AI設定状態を作成;
const login=async(path)=>path.endsWith('ログイン')?{status:'OK',data:{access_token:'mock-token'}}:{status:'OK',data:{セッションID:'mock-session'}};
test('explicit login only; Core token is forwarded in memory; cancel never writes',async()=>{
 const calls=[];const s=create({api:async(...args)=>{calls.push(args);return login(args[0]);}});
 assert.equal(calls.length,0);await s.ログイン('mock-user','mock-password');assert.equal(s.認証済み.value,true);
 assert.equal(calls[1][4].token,'mock-token');s.ログアウト();assert.equal(s.認証済み.value,false);assert.equal(calls.length,2);
 await assert.rejects(()=>s.request('/core/AIコア/モデル情報/設定',{}));s.終了();
});
test('disconnect invalidates delayed login and repeated login cannot duplicate request',async()=>{
 let resolve;let count=0;const s=create({api:()=>{count++;return new Promise(r=>resolve=r);}});
 const pending=s.ログイン('u','p');await s.ログイン('u','p');assert.equal(count,1);s.切断();resolve(await login('ログイン'));await pending;
 assert.equal(s.認証済み.value,false);assert.equal(count,1);s.終了();
});
test('Core auth expiry clears Core state without Diag logout; error remains secret-free',async()=>{
 let expired=false;const s=create({api:async p=>expired?{authExpired:true}:login(p)});
 await s.ログイン('u','p');expired=true;await assert.rejects(()=>s.request('/core/AIコア/モデル情報/取得',{}));
 assert.equal(s.認証済み.value,false);assert.match(s.通知.value,/有効期限/);s.終了();
});
test('mutations exclude reload/duplicate mutations; disposal cancels countdown',async()=>{
 let resolve;let calls=0;let tick;const s=create({api:async p=>{calls++;return p.endsWith('設定')?new Promise(r=>resolve=r):login(p);},setTimer:f=>(tick=f,1),clearTimer:()=>{}});
 await s.ログイン('u','p');const pending=s.request('/core/AIコア/モデル情報/設定',{});
 assert.equal(s.変更中.value,true);await s.再読込();await assert.rejects(()=>s.request('/core/AIコア/モデル情報/設定',{}));assert.equal(calls,3);
 resolve({status:'OK'});await pending;assert.equal(s.変更中.value,false);s.保存後(1);s.終了();tick();assert.equal(calls,3);
});
