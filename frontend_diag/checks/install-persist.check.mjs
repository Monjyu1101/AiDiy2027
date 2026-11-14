// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 個別確認・導入後の確認結果は、その項目だけ保存済みの導入状況へ反映し、再起動後も前回結果として表示する。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {mergeInstallResult,INSTALL_FILE} from '../diag/診断/headless.mjs';
import {createPreviousResults} from '../diag/診断/前回結果.mjs';
import {createHandler} from '../diag/diag_main.mjs';

const entries=[{id:'node',name:'Node.js',menuGroup:'ベース'},{id:'rust',name:'Rust',menuGroup:'開発環境等'},{id:'llvm-mingw',name:'llvm-mingw',menuGroup:'開発環境等'}];

test('single results update only their item and survive a restart as previous results',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'aidiy-install-persist-'));
  try{
    await writeFile(path.join(directory,INSTALL_FILE),JSON.stringify({形式:1,開始日時:'2026-11-14T00:00:00.000Z',完了日時:'2026-11-14T00:01:00.000Z',
      項目:[{id:'node',名前:'Node.js',分類:'ベース',状態:'OK',確認日時:'2026-11-14T00:00:30.000Z'},{id:'removed',名前:'旧項目',状態:'OK'}]}));
    await mergeInstallResult(entries,{id:'rust',状態:'OK',パス:'C:\\fixture\\cargo.exe',確認日時:'2026-11-14T01:00:00.000Z'},directory);
    await mergeInstallResult(entries,{id:'llvm-mingw',状態:'未検出',確認日時:'2026-11-14T01:00:01.000Z'},directory);
    const saved=JSON.parse(await readFile(path.join(directory,INSTALL_FILE),'utf8'));
    assert.deepEqual(saved.項目.map(item=>[item.id,item.状態,item.分類]),[['node','OK','ベース'],['rust','OK','開発環境等'],['llvm-mingw','未検出','開発環境等']]);
    assert.equal(saved.開始日時,'2026-11-14T00:00:00.000Z');assert.deepEqual(saved.集計,{OK:2,未検出:1});
    // 未対応の状態・未登録の項目は書き込まない。
    assert.equal(await mergeInstallResult(entries,{id:'unknown',状態:'OK'},directory),null);
    assert.equal(await mergeInstallResult(entries,{id:'rust',状態:'不明'},directory),null);
    const previous=(await createPreviousResults({directory}).snapshot()).導入状況;
    assert.deepEqual(previous.結果.map(item=>[item.id,item.状態]),[['node','OK'],['rust','OK'],['llvm-mingw','未検出']]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('handler persists individual checks only when a merge writer is configured',async()=>{
  const merged=[];
  const make=installMergeFn=>createHandler({token:'t',entries,probeFn:async entry=>({id:entry.id,状態:'OK',確認日時:new Date().toISOString()}),installMergeFn,
    previousResults:{snapshot:async()=>({})},installManagerFactory:()=>({snapshot:async()=>({}),busy:()=>false,invalidate(){},close:async()=>{}})});
  const call=handler=>new Promise(resolve=>{
    const res={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code,headers){this.statusCode=code;Object.assign(this.headers,headers||{});return this;},end(body){resolve({status:this.statusCode,body:String(body||'')});},on(){},off(){},once(){}};
    handler({method:'POST',url:'/api/'+encodeURIComponent('診断')+'/rust',headers:{authorization:'Bearer t',host:'127.0.0.1'},socket:{remoteAddress:'127.0.0.1'},on(){},[Symbol.asyncIterator]:async function*(){}},res);
  });
  const withMerge=await call(make(async(list,result)=>{merged.push(result.id);}));
  assert.equal(withMerge.status,200);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(merged,['rust']);
  const without=await call(make(null));
  assert.equal(without.status,200);assert.deepEqual(merged,['rust']);
});
