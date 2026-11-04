// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {createServer}=require('node:http');
const {mkdir,readdir,readFile,writeFile,unlink}=require('node:fs/promises');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
const {projectIdentity}=require('./project-profile.cjs');

// 別プロセスの単独Code / Liveも既存の下書きRouterへ渡す。ページにHTTP権限を公開しない。
async function createSharedDraftBridge({directory,records,router,readState,sessionKey}){
 const token=randomUUID(),routes=new Map();let port;
 const same=(a,b)=>{try{return projectIdentity(a).key===projectIdentity(b).key;}catch{return false;}};
 const owners=()=>[...records.values()].filter(r=>!r.owner&&['ide','code','live'].includes(r.kind)&&!r.window.isDestroyed());
 async function local(projectPath){
  const groups=await Promise.all(owners().map(async owner=>{const list=await router.list(owner);return list.ok&&same(projectPath,list.projectPath)?{owner,list}:null;}));
  return groups.filter(Boolean);
 }
 const server=createServer(async(req,res)=>{
  const reply=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  if(req.method!=='POST'||req.headers.origin||req.headers.host!==`127.0.0.1:${port}`||!req.url.startsWith('/'+token+'/')){reply({ok:false},403);return;}
  try{
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>20*1024*1024)throw Error('要求が大きすぎます。');chunks.push(chunk);}
   const text=Buffer.concat(chunks).toString('utf8');
   const data=JSON.parse(text);if(typeof data.projectPath!=='string')throw Error('プロジェクトが不正です。');
   const groups=await local(data.projectPath);
   if(req.url===`/${token}/list`){reply({ok:true,targets:groups.flatMap(({list})=>list.targets.map(t=>({...t,targetSessionKey:list.sessionKey})))});return;}
   if(req.url===`/${token}/insert`){
    const group=groups.find(({list})=>list.targets.some(t=>t.id===data.targetId));
    if(!group)throw Error('連携先が閉じられました。');
    reply(await router.insert(group.owner,{...data,sessionKey:data.targetSessionKey,projectPath:group.list.projectPath}));return;
   }
   reply({ok:false},404);
  }catch(error){reply({ok:false,error:error.message},400);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});port=server.address().port;server.unref();
 await mkdir(directory,{recursive:true});const file=join(directory,`${process.pid}-${token}.json`);
 await writeFile(file,JSON.stringify({pid:process.pid,port,token}),{flag:'wx',mode:0o600});
 const request=async(peer,method,body)=>{
  const response=await fetch(`http://127.0.0.1:${peer.port}/${peer.token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(method==='list'?1500:6000)});
  const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'連携先に接続できません。');return result;
 };
 async function state(source){const value=await readState(source.owner||source);if(source.window.isDestroyed()||!value.active)throw Error('Browserの利用が終了しました。');return value;}
 return{
  async list(source){
   const current=await state(source),targets=[];
   const files=(await readdir(directory)).filter(n=>/^\d+-[\da-f-]+\.json$/.test(n)).slice(0,128);
   await Promise.all(files.map(async name=>{try{
    const peer=JSON.parse(await readFile(join(directory,name),'utf8'));
    if(!Number.isInteger(peer.port)||peer.port<1||peer.port>65535||!/^[-\da-f]{36}$/.test(peer.token))return;
    if(!Number.isSafeInteger(peer.pid)||peer.pid<=0)return;
    try{process.kill(peer.pid,0);}catch(error){if(error.code==='ESRCH')await unlink(join(directory,name)).catch(()=>{});return;}
    const list=await request(peer,'list',{projectPath:current.project.path});
    for(const target of list.targets){routes.set(target.id,{peer,target,projectPath:current.project.path});targets.push(target);}
   }catch{/* 終了済み・応答しないプロセスは候補にしない。 */}}));
   if(routes.size>256){const keep=new Set(targets.map(t=>t.id));for(const id of routes.keys())if(!keep.has(id))routes.delete(id);}
   return{ok:true,sessionKey:sessionKey(current),projectPath:current.project.path,mode:current.mode,targets,frontmostTargetId:targets.length===1?targets[0].id:''};
  },
  async insert(source,data){
   const current=await state(source),route=routes.get(data?.targetId);
   if(!route||data.sessionKey!==sessionKey(current)||!same(data.projectPath,current.project.path)||!same(route.projectPath,current.project.path)||data.contextId!==route.target.contextId)throw Error('連携先や利用状態が変わりました。選び直してください。');
   return request(route.peer,'insert',{...data,targetSessionKey:route.target.targetSessionKey});
  },
  async close(){await unlink(file).catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 };
}
module.exports={createSharedDraftBridge};
