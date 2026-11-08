// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createNavigationSound,playNavigationSound,NAVIGATION_SOUNDS} from '../ファイル機能/navigation-sound.mjs';

async function request(service,{method='POST',body,path='/api/navigation/sound'}={}){
 const req=Readable.from(body===undefined?[]:[typeof body==='string'?body:JSON.stringify(body)]);req.method=method;
 let status,data;
 const handled=await service.handle(req,{writeHead(code){status=code;return this;},end(value){data=JSON.parse(value);}},new URL('http://localhost'+path));
 return {handled,status,data};
}
const flush=()=>new Promise(done=>setImmediate(done));

test('注意・完了だけを、部品の同名の通知種別（scene auto）で受け付ける',async()=>{
 const played=[],service=createNavigationSound('/project',{state:()=>({active:true}),play:async sound=>played.push(sound)});
 for(const kind of ['注意','完了']){const r=await request(service,{body:{kind}});assert.equal(r.status,202);assert.deepEqual(r.data,{kind,queued:true});}
 await flush();
 assert.deepEqual(played,[{notification_type:'注意',scene:'auto'},{notification_type:'完了',scene:'auto'}]);
 assert.deepEqual(Object.keys(NAVIGATION_SOUNDS),['注意','完了']);assert.equal(Object.isFrozen(NAVIGATION_SOUNDS['注意']),true);
});

test('続けて受け付けた音は、前の音が終わってから順に1つずつ鳴らす',async()=>{
 const events=[],finish=[];
 const service=createNavigationSound('/project',{state:()=>({active:true}),play:sound=>new Promise(done=>{events.push('start '+sound.notification_type);finish.push(()=>{events.push('end '+sound.notification_type);done();});})});
 for(const kind of ['注意','注意','完了'])await request(service,{body:{kind}});
 await flush();assert.deepEqual(events,['start 注意']);
 finish.shift()();await flush();assert.deepEqual(events,['start 注意','end 注意','start 注意']);
 finish.shift()();await flush();finish.shift()();await flush();
 assert.deepEqual(events,['start 注意','end 注意','start 注意','end 注意','start 完了','end 完了']);
});

test('溜まりすぎた通知音は受け付けを断り、再生待ちを増やさない',async()=>{
 const service=createNavigationSound('/project',{state:()=>({active:true}),play:()=>new Promise(()=>{})});
 const results=[];for(let i=0;i<14;i++)results.push((await request(service,{body:{kind:'注意'}})).data.queued);
 assert.equal(results.filter(Boolean).length,12);assert.deepEqual(results.slice(12),[false,false]);
});

test('不正な種別・任意の通知種別・未開始・GETは再生しない',async()=>{
 const played=[];let active=true;const service=createNavigationSound('/project',{state:()=>({active}),play:async sound=>played.push(sound)});
 for(const body of [{kind:'ok'},{kind:'承認'},{kind:'終了'},{kind:'tts'},{kind:'toString'},{notification_type:'開始',scene:'tts'},{},'not json'])assert.equal((await request(service,{body})).status,400);
 assert.equal((await request(service,{method:'GET'})).status,405);
 active=false;assert.equal((await request(service,{body:{kind:'完了'}})).status,409);
 assert.equal((await request(service,{path:'/api/navigation'})).handled,false);
 await flush();assert.deepEqual(played,[]);
});

test('Tools未起動などの再生失敗は受付結果に影響しない',async()=>{
 const service=createNavigationSound('/project',{state:()=>({active:true}),play:async()=>{throw Error('offline');}});
 assert.equal((await request(service,{body:{kind:'注意'}})).status,202);await flush();
});

test('backend_tools の aidiy_notification_sounds/play へ送る',async()=>{
 const sent=[];
 const result=await playNavigationSound(fileURLToPath(new URL('..',import.meta.url)),NAVIGATION_SOUNDS['完了'],{fetcher:async(url,options)=>{sent.push({url,method:options.method,body:JSON.parse(options.body)});return {ok:true,json:async()=>({status:'ok'})};}});
 assert.deepEqual(result,{status:'ok'});
 assert.match(sent[0].url,/^http:\/\/127\.0\.0\.1:\d+\/aidiy_notification_sounds\/play$/);
 assert.deepEqual(sent[0],{url:sent[0].url,method:'POST',body:{notification_type:'完了',scene:'auto'}});
 await assert.rejects(playNavigationSound('/project',NAVIGATION_SOUNDS['注意'],{fetcher:async()=>({ok:true,json:async()=>({error:'未対応'})})}),/未対応/);
});
