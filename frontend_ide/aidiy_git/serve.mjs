// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createGitPanel} from './パネル.mjs';
import repository from './リポジトリ.cjs';
export async function startGit(project,{port=0,strict=false,linked=false,checkTools,workspace=true}={}){
 await repository.requireGitProject(project,{workspace});
 const panel=createGitPanel(project,{standalone:true,linked,checkTools});
 const server=createServer(async(req,res)=>{
  const actual=server.address()?.port;
  const hosts=[`127.0.0.1:${actual}`,`localhost:${actual}`];
  if(!hosts.includes(req.headers.host)||req.headers.origin&&!hosts.some(host=>req.headers.origin==='http://'+host)||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403).end();return;}
  try{if(!await panel.handle(req,res,new URL(req.url,'http://127.0.0.1')))res.writeHead(404).end();}
  catch{if(!res.destroyed&&!res.writableEnded)res.writeHead(500).end();}
 });
 server.listen(port,'127.0.0.1');
 try{await once(server,'listening');}
 catch(error){
  if(error.code!=='EADDRINUSE'||strict){panel.close();throw error;}
  server.listen(0,'127.0.0.1');await once(server,'listening');
 }
 const url=`http://127.0.0.1:${server.address().port}/`;
 server.once('close',panel.close);
 const close=()=>new Promise((resolve,reject)=>{panel.close();server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());});
 return {url,publicUrl:url,server,close};
}
