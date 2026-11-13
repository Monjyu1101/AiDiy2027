// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createMemoHandler} from '../memo/http.mjs';
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'aidiy-memo-solo-'));t.after(()=>rm(root,{recursive:true,force:true}));const system=path.join(root,'system'),launch=path.join(root,'launch'),project=path.join(root,'project');for(const dir of [system,launch,project])await mkdir(dir);return {system,launch,project};}
async function call(handler,route,body,headers={}){const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=body===undefined?'GET':'POST';req.headers={host:'127.0.0.1:1234',origin:'http://127.0.0.1:1234','content-type':'application/json',...headers};let response;assert.equal(await handler(req,route,(status,data)=>response={status,data}),true);return response;}
test('単体APIは配置元専用。通常無効時にproject設定・起動rootを一切読まない',async t=>{
 const {system,launch}=await fixture(t);let catalogs=0,roots=0,folders=0;const handler=createMemoHandler({systemRoot:system,launchRoot:launch,getLaunchRoot:async()=>{roots++;throw Error('unexpected launch root');},isNormalEnabled:()=>false,appLauncher:{catalog:async()=>{catalogs++;throw Error('unexpected catalog');},folders:async()=>{folders++;throw Error('unexpected folders');}}});
 assert.equal((await call(handler,'api/メモ')).status,403);assert.equal((await call(handler,'api/メモ/作成',{})).status,403);
 const list=await call(handler,'api/メモ/単体');assert.equal(list.status,200);assert.equal(list.data.保存先.length,1);assert.equal(list.data.保存先[0].パス,path.join(system,'_AIDIY','aidiy_memo'));
 const created=await call(handler,'api/メモ/単体/作成',{保存先:list.data.保存先[0].id,タイトル:'単体',本文:'test',色:'yellow'});assert.equal(created.status,200);
 const {形式,...body}=created.data;const saved=await call(handler,'api/メモ/単体/保存',{...body,本文:'更新'});assert.equal(saved.status,200);assert.equal((await call(handler,'api/メモ/単体/読込',{保存先:body.保存先,id:body.id})).data.本文,'更新');
 assert.equal((await call(handler,'api/メモ/単体/プロジェクト',{フォルダ:launch})).status,404);assert.equal((await call(handler,'api/メモ/単体/読込',{保存先:body.保存先,id:body.id},{origin:'https://other.example'})).status,403);
 assert.equal(catalogs,0);assert.equal(roots,0);assert.equal(folders,0);
});
test('通常catalogは有効なGET一覧だけで読み、単体保存先とは混ぜない',async t=>{
 const {system,launch,project}=await fixture(t);let enabled=false,current=launch,catalogs=0;const handler=createMemoHandler({systemRoot:system,launchRoot:launch,getLaunchRoot:async()=>current,isNormalEnabled:()=>enabled,appLauncher:{catalog:async()=>{catalogs++;return {起動フォルダ:project};},folders:async folder=>({フォルダ:folder})}});
 await call(handler,'api/メモ');assert.equal(catalogs,0);enabled=true;const list=await call(handler,'api/メモ');assert.equal(list.data.保存先.length,2);assert.equal(catalogs,1);
 const created=await call(handler,'api/メモ/作成',{保存先:list.data.保存先[0].id,タイトル:'通常',本文:'test',色:'blue'});assert.equal(created.status,200);assert.equal(catalogs,1);
 await call(handler,'api/メモ/読込',{保存先:created.data.保存先,id:created.data.id});assert.equal(catalogs,1);await call(handler,'api/メモ/単体');assert.equal(catalogs,1);
 current=project;const changed=await call(handler,'api/メモ');assert.equal(changed.data.保存先.length,1);assert.equal(changed.data.保存先[0].パス,path.join(project,'_AIDIY','aidiy_memo'));assert.equal(catalogs,2);
});
