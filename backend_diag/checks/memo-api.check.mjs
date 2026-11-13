// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from '../diag/diag_main.mjs';
async function serve(t,options){
 const server=createServer({token:'memo-fixture',modelTrials:{close(){}},startManager:{close(){}},...options});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 return {origin,request:(route='',options={})=>fetch(origin+'/api/メモ'+route,{...options,headers:{Authorization:'Bearer memo-fixture','Content-Type':'application/json',...options.headers}})};
}
test('メモAPI: 認証、同一origin、GET、JSON、作成・保存、競合・安全な失敗表示',async t=>{
 const calls=[],note={id:'fixture.memo.json',本文:'付箋',保存先:'launch:fixture'},state={保存先:[],メモ:[note],警告:[]};
 const {origin,request}=await serve(t,{memoStore:{list:async()=>state,create:async body=>{calls.push(['create',body]);return note;},save:async body=>{calls.push(['save',body]);if(body.fail===409)throw Object.assign(Error('競合'),{status:409});if(body.fail)throw Error('private file details');return note;}}});
 assert.equal((await fetch(origin+'/api/メモ')).status,401);
 assert.equal((await request('/作成',{method:'POST',headers:{Authorization:'Bearer wrong'},body:'{}'})).status,401);
 assert.equal((await request('/作成',{method:'POST',headers:{Origin:'https://other.example'},body:'{}'})).status,403);
 assert.equal((await request('/保存',{method:'POST',headers:{'sec-fetch-site':'cross-site'},body:'{}'})).status,403);
 assert.equal((await request('/作成',{method:'POST',headers:{Origin:'null'},body:'{}'})).status,403);
 assert.equal((await request('/作成',{method:'POST',headers:{Origin:origin.replace('http:','https:')},body:'{}'})).status,403);
 assert.equal(calls.length,0);
 let response=await request();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),state);
 assert.equal((await request('/作成',{method:'POST',body:'{'})).status,400);
 assert.equal((await request('/作成',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,400);
 assert.equal((await request('/作成',{method:'POST',body:Buffer.from([0xff])})).status,400);
 response=await request('/作成',{method:'POST',headers:{Origin:origin},body:JSON.stringify({本文:'入力'})});assert.equal(response.status,200);assert.deepEqual(await response.json(),note);assert.deepEqual(calls[0],['create',{本文:'入力'}]);
 response=await request('/保存',{method:'POST',body:'{}'});assert.equal(response.status,200);assert.deepEqual(calls[1],['save',{}]);
 response=await request('/保存',{method:'POST',body:'{"fail":409}'});assert.equal(response.status,409);assert.equal((await response.json()).エラー,'競合');
 response=await request('/保存',{method:'POST',body:'{"fail":true}'});assert.equal(response.status,500);assert.doesNotMatch(await response.text(),/private file details/);
 assert.equal((await request('/作成')).status,405);assert.equal((await request('/保存',{method:'DELETE'})).status,405);assert.equal((await request('/不明',{method:'POST',body:'{}'})).status,404);assert.equal((await request('?extra=1')).status,400);
});
test('メモAPI: プロジェクト切替は検証済みフォルダだけ、保存先idが更新される',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'aidiy-memo-api-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const launch=path.join(root,'launch'),project=path.join(root,'project'),other=path.join(root,'other');for(const folder of [launch,project,other])await mkdir(folder);
 const validated=[];
 const {request}=await serve(t,{launchRoot:launch,appLauncher:{catalog:async()=>({起動フォルダ:project}),folders:async value=>{validated.push(value);if(value!==other)throw Object.assign(Error('フォルダが不正です。'),{status:400});return {フォルダ:value};}}});
 const first=await (await request()).json();assert.equal(first.保存先.length,2);assert.equal(first.保存先[1].パス,path.join(project,'_AIDIY','aidiy_memo'));
 const newBody={保存先:first.保存先[1].id,タイトル:'付箋',本文:'保存内容',色:'yellow',clientId:'40844c7a-63cd-435a-a104-0383be19e912',位置:{x:-1920,y:-100},サイズ:{width:200,height:140}};
 assert.equal((await request('/作成',{method:'POST',body:JSON.stringify({...newBody,タイトル:' ',本文:'  '})})).status,400);
 const created=await (await request('/作成',{method:'POST',body:JSON.stringify(newBody)})).json();assert.ok(created.id);
 const retry=await (await request('/作成',{method:'POST',body:JSON.stringify(newBody)})).json();assert.equal(retry.id,created.id);
 for(const body of ['null','[]','{}','{"フォルダ":1}','{"フォルダ":"x","extra":true}'])assert.equal((await request('/プロジェクト',{method:'POST',body})).status,400);
 assert.equal(validated.length,0);
 assert.equal((await request('/プロジェクト',{method:'POST',body:JSON.stringify({フォルダ:'invalid'})})).status,400);
 assert.equal((await request('/プロジェクト',{method:'POST',body:JSON.stringify({フォルダ:other})})).status,200);
 const second=await (await request()).json();assert.equal(second.保存先[1].パス,path.join(other,'_AIDIY','aidiy_memo'));assert.notEqual(second.保存先[1].id,first.保存先[1].id);
 const {形式,...saveBody}=created;assert.equal((await request('/保存',{method:'POST',body:JSON.stringify({...saveBody,本文:''})})).status,200);
 const readBody=JSON.stringify({保存先:created.保存先,id:created.id});
 let loaded=await request('/読込',{method:'POST',body:readBody});assert.equal(loaded.status,200);assert.equal((await loaded.json()).本文,'');
 assert.equal((await request('/読込',{method:'POST',headers:{Authorization:'Bearer invalid'},body:readBody})).status,401);
 assert.equal((await request('/読込',{method:'POST',headers:{Origin:'https://invalid.example'},body:readBody})).status,403);
 assert.equal((await request('/読込')).status,405);
 assert.equal((await request('/読込',{method:'POST',body:JSON.stringify({保存先:created.保存先,id:'../outside.txt'})})).status,400);
 assert.equal((await request('/読込',{method:'POST',body:JSON.stringify({保存先:'unknown',id:created.id})})).status,409);
 assert.equal((await request('/作成',{method:'POST',body:JSON.stringify({保存先:first.保存先[1].id,タイトル:'stale',本文:'保護',色:'yellow'})})).status,409);
 assert.equal((await request('/プロジェクト',{method:'POST',body:JSON.stringify({フォルダ:''})})).status,200);assert.equal((await (await request()).json()).保存先.length,1);
});
