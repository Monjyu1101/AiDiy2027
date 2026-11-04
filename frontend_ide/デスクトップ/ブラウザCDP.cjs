// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {createServer}=require('node:http');
const {mkdirSync,readFileSync,writeFileSync,unlinkSync}=require('node:fs');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
const {WebSocketServer}=require('ws');
// 同じmainで明示的に開いた窓だけを参照。別sessionのnew_tabもその窓の実接続先を返す。
const publishedPages=new WeakMap();

// Electron全体のデバッグポートは開かず、Browserの非特権WebContentsだけを公開する。
async function createBrowserCDP({directory,canUse,openPanel,allowedURL,sessionPrefix='aidiy_ide',version=process.versions.chrome}){
 if(!['aidiy_ide','aidiy_browser'].includes(sessionPrefix))throw Error('不正なBrowserセッション名です。');
 const token=randomUUID(),pages=new Map(),sockets=new Set();let port,file,name,closed=false;
 const server=createServer(async(req,res)=>{
  const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  if(req.headers.origin||req.headers.host!==`127.0.0.1:${port}`||req.method!=='GET'){json({error:'Forbidden'},403);return;}
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(!url.pathname.startsWith('/'+token+'/')){json({error:'Not found'},404);return;}
  try{
   if(closed)throw Error('Browserの利用が終了しました。');
   if(!await canUse())throw Error('tools接続中のみBrowserを操作できます。');
   const path=url.pathname.slice(token.length+1);
   if(path==='/json/version'){json({Browser:`Chrome/${version}`,'Protocol-Version':'1.3','AiDiy-Session':name,'AiDiy-Owner':token});return;}
   if(path==='/json'||path==='/json/list'){json([...pages.values()].filter(p=>!p.contents.isDestroyed()).map(describe));return;}
   if(path==='/json/new'){
    const target=url.searchParams.get('url')||'https://www.google.com/';if(!allowedURL(target))throw Error('WebのURLまたはプロジェクト内のファイルURLを指定してください。');
    const record=await openPanel(target),page=record&&publishedPages.get(record)?.();if(!page)throw Error('Browserを開けませんでした。');json(page);return;
   }
   if(path==='/close'){for(const page of [...pages.values()])page.record.window.close();json({ok:true});return;}
   const match=/^\/json\/(close|activate)\/([a-f\d-]+)$/.exec(path),page=match&&pages.get(match[2]);
   if(!page)throw Error('Browserパネルが見つかりません。');
   if(match[1]==='close')page.record.window.close();else{if(page.record.window.isMinimized())page.record.window.restore();page.record.window.show();page.record.window.focus();page.contents.focus();}
   json({ok:true});
  }catch(error){json({error:error.message},409);}
 });
 const ws=new WebSocketServer({noServer:true,maxPayload:20*1024*1024});
 server.on('upgrade',(req,socket,head)=>{
  if(req.headers.origin||req.headers.host!==`127.0.0.1:${port}`){socket.destroy();return;}
  const page=[...pages.values()].find(p=>req.url===`/${token}/devtools/page/${p.id}`);
  if(!page){socket.destroy();return;}
  ws.handleUpgrade(req,socket,head,client=>{
   sockets.add(client);const contents=page.contents,debuggerAPI=contents.debugger;
   const send=value=>{if(client.readyState===1)client.send(JSON.stringify(value));};
   const message=(_event,method,params)=>send({method,params});
   try{if(!debuggerAPI.isAttached())debuggerAPI.attach('1.3');}catch{client.close();return;}
   debuggerAPI.on('message',message);
   client.on('message',async raw=>{
    let request;try{
     request=JSON.parse(raw);if(!Number.isInteger(request.id)||typeof request.method!=='string')throw Error('不正なCDP要求です。');
     if(contents.isDestroyed()||!await canUse())throw Error('tools接続中のみBrowserを操作できます。');
     // Browser/Targetドメインを渡すとIDEや他パネルまで列挙・接続できるため公開しない。
     if(! /^(Runtime|DOM|DOMSnapshot|CSS|Page|Input|Network|Emulation|Accessibility|Log|Performance)\./.test(request.method))throw Error('Browserページ以外のCDP操作は使用できません。');
     if(request.method==='Page.navigate'&&!allowedURL(request.params?.url))throw Error('このURLは開けません。');
     const result=await debuggerAPI.sendCommand(request.method,request.params||{});send({id:request.id,result});
    }catch(error){send({id:request?.id,error:{code:-32000,message:error.message}});}
   });
   const gone=()=>client.close();contents.once('destroyed',gone);
   client.once('close',()=>{sockets.delete(client);contents.removeListener('destroyed',gone);debuggerAPI.removeListener('message',message);});
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});port=server.address().port;
 function describe(page){return{id:page.id,session:name,type:'page',title:page.contents.getTitle(),url:page.contents.getURL(),webSocketDebuggerUrl:`ws://127.0.0.1:${port}/${token}/devtools/page/${page.id}`};}
 try{
  mkdirSync(directory,{recursive:true});
  let assigned={};try{assigned=JSON.parse(readFileSync(join(directory,'../_chrome_sessions.json'),'utf8')).sessions||{};}catch{}
  for(let i=1;i<=100;i++){
   // IDE番号はBrowser窓単位。単独起動のUUIDはbridgeの生存中ずっと同じ名前を使う。
   name=sessionPrefix==='aidiy_browser'?`${sessionPrefix} ${randomUUID()}`:`${sessionPrefix} ${i}`;file=join(directory,name+'.json');
   if(Object.hasOwn(assigned,name))continue;
   try{
    const previous=JSON.parse(readFileSync(file,'utf8'));
    let alive=false;try{process.kill(previous.pid,0);alive=true;}catch{}
    if(alive)continue;unlinkSync(file);
   }catch(error){if(error.code!=='ENOENT')continue;}
   try{writeFileSync(file,JSON.stringify({name,port,token,pid:process.pid}),{flag:'wx',mode:0o600});break;}catch(error){if(error.code!=='EEXIST')throw error;file=null;}
  }
  if(!file||JSON.parse(readFileSync(file,'utf8')).token!==token)throw Error('IDEブラウザのセッションを確保できません。');
 }catch(error){server.close();ws.close();throw error;}
 function close(){if(closed)return;closed=true;for(const client of sockets)client.terminate();ws.close();server.close();try{if(JSON.parse(readFileSync(file,'utf8')).token===token)unlinkSync(file);}catch{}}
 return{name,add(record,contents){const id=randomUUID(),page={id,record,contents};pages.set(id,page);record.browserSession=name;record.browserTabId=id;publishedPages.set(record,()=>closed||contents.isDestroyed()?undefined:describe(page));contents.once('destroyed',()=>{pages.delete(id);publishedPages.delete(record);});},close};
}
module.exports={createBrowserCDP};
