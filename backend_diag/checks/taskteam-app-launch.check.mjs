// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {createAppLauncher} from '../diag/起動/アプリ起動.mjs';
import {createTaskTeamStatus} from '../diag/起動/TaskTeam接続.mjs';
import {createServer} from '../diag/diag_main.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'diag-taskteam-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('catalog order and backend availability update without disabling other apps',async t=>{
 const root=await fixture(t);let online=false;
 const m=createAppLauncher({chromeInstalled:async()=>true,root,taskTeamStatus:async()=>({利用可能:online,無効理由:online?'':'backend stopped'})});
 let data=await m.catalog();assert.deepEqual(data.対象.map(x=>x.id),['avatar','task','team','ide','navi','console','code','live','chrome','browser']);
 assert.equal(data.対象[1].利用可能,false);assert.equal(data.対象[2].利用可能,false);assert.equal(data.対象[0].利用可能,undefined);
 online=true;data=await m.catalog();assert.equal(data.対象[1].利用可能,true);assert.equal(data.対象[2].利用可能,true);
});
test('launch rechecks backend and serializes pending Task/Team clicks; no spawn while offline',async t=>{
 const root=await fixture(t);let online=true,release;const calls=[];
 const m=createAppLauncher({chromeInstalled:async()=>true,root,taskTeamStatus:async()=>({利用可能:online,無効理由:'backend stopped'}),spawnFn(command,args,options){calls.push({args,options});const child=new EventEmitter();child.unref=()=>{};release=()=>child.emit('spawn');return child;}});
 await m.catalog();online=false;for(const id of ['task','team'])await assert.rejects(m.launch(id,root),{status:409});assert.equal(calls.length,0);
 online=true;for(const id of ['task','team']){
  release=null;const first=m.launch(id,root);while(!release)await new Promise(r=>setImmediate(r));
  await assert.rejects(m.launch(id,root),{status:409});release();assert.equal((await first).受付,true);
  assert.deepEqual(calls.at(-1).args,[join(root,'frontend_ide','launch.mjs'),'--app',id,'--project',root,'--new-window']);
 }
});
test('status uses configured loopback health, rejects wrong service/redirect/error and bad config',async t=>{
 const root=await fixture(t);await mkdir(join(root,'_config'));let body={status:'OK',service:'backend_taskteam'},status=200,requests=0;
 const server=http.createServer((req,res)=>{requests++;assert.equal(req.url,'/health');assert.equal(req.headers.authorization,undefined);res.writeHead(status,{'content-type':'application/json',location:'https://invalid.example'}).end(JSON.stringify(body));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const port=server.address().port,file=join(root,'_config','AiDiy_key.json');await writeFile(file,JSON.stringify({PORT_TASKTEAM:String(port),SECRET:'never-forward'}));
 const check=createTaskTeamStatus({root,timeoutMs:200});assert.deepEqual(await check(),{利用可能:true,ポート:port,無効理由:''});
 body={status:'OK',service:'other'};assert.equal((await check()).利用可能,false);status=302;assert.equal((await check()).利用可能,false);
 const count=requests;await writeFile(file,JSON.stringify({PORT_TASKTEAM:'https://evil.invalid'}));assert.equal((await check()).利用可能,false);assert.equal(requests,count);
});
test('health timeout and connection errors fail closed; missing config defaults to 8093',async t=>{
 const root=await fixture(t);let port;
 const check=createTaskTeamStatus({root,timeoutMs:10,request(options){port=options.port;const req=new EventEmitter();req.end=()=>{};req.destroy=()=>{};return req;}});
 assert.equal((await check()).利用可能,false);assert.equal(port,8093);
 const bad=createAppLauncher({chromeInstalled:async()=>true,root,taskTeamStatus:async()=>{throw Error('private');}});
 assert.equal((await bad.catalog()).対象[1].利用可能,false);await assert.rejects(bad.launch('task',root),error=>error.status===409&&!error.message.includes('private'));
});
test('authenticated HTTP catalog awaits availability and POST denies stale enabled state',async t=>{
 const root=await fixture(t);let online=true;
 const server=createServer({token:'test',appLauncher:createAppLauncher({chromeInstalled:async()=>true,root,taskTeamStatus:async()=>({利用可能:online})}),modelTrials:{close(){}},startManager:{close(){}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}/`,headers={Authorization:'Bearer test','Content-Type':'application/json'};
 assert.equal((await (await fetch(base+'api/アプリ起動',{headers})).json()).対象[1].利用可能,true);
 for(const id of ['task','team']){const icon=await fetch(base+`AiDiy_${id}.png`);assert.equal(icon.status,200);assert.equal(icon.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await icon.arrayBuffer()),await readFile(new URL(`../diag/ui/components/アプリ起動/アイコン/AiDiy_${id}.png`,import.meta.url)));}
 online=false;assert.equal((await fetch(base+'api/アプリ起動/開始',{method:'POST',headers,body:JSON.stringify({対象:'task',フォルダ:root})})).status,409);
});
