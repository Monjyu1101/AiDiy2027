// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {toolsTarget} from '../ファイル機能/ai-search.mjs';
import repository from './リポジトリ.cjs';
const {gitAvailable,createRepository}=repository;
const prefix='/development/git';
// 公開する共通資産は固定名だけで、プロジェクトの任意ファイルを配信しない。
const ownAsset=(name,mime)=>[name,[new URL('./'+name,import.meta.url),mime]];
const assets=new Map([
 ownAsset('panel.js','text/javascript; charset=utf-8'),
 ownAsset('panel-chrome.js','text/javascript; charset=utf-8'),
 ownAsset('github-tabs.js','text/javascript; charset=utf-8'),
 ownAsset('panel.css','text/css; charset=utf-8'),
 ['toggle-drag.js',[new URL('../src/components/コード/パネル切替ドラッグ.js',import.meta.url),'text/javascript; charset=utf-8']],
 ['window-actions.js',[new URL('../src/components/共通表示/窓操作.js',import.meta.url),'text/javascript; charset=utf-8']],
 ['titlebar-colors.css',[new URL('../src/components/共通表示/タイトルバー配色.css',import.meta.url),'text/css; charset=utf-8']],
]);
const html=await readFile(new URL('./panel.html',import.meta.url),'utf8');
const fields={status:[],history:[],'tools-status':[],diff:['path','side'],stage:['revision','path'],unstage:['revision','path'],commit:['revision','message'],fetch:['revision','remote'],pull:['revision','remote'],push:['revision','remote'],'force-push':['revision','remote','confirm'],'github-pr':['remote'],'github-issue':['remote']};
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
function json(res,code,value){
 if(!res.destroyed&&!res.writableEnded)res.writeHead(code,{...headers,'content-type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
}
async function payload(req,keys){
 if(req.headers['content-type']!=='application/json')throw Error('JSON を指定してください。');
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>16384)throw Error('要求が大きすぎます。');chunks.push(chunk);}
 const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(k=>typeof value[k]==='string'&&value[k].length<=4096))throw Error('Git 操作の引数が不正です。');
 return value;
}
export async function gitToolsOnline(project,signal,fetcher=fetch,targetFor=toolsTarget){
 try{
  const target=await targetFor(project);
  // Term と同じ Tools の軽量 ping。失敗は Git の利用可否に影響しない。
  const deadline=AbortSignal.timeout(1500);
  const response=await fetcher(new URL('ping',target),{signal:signal?AbortSignal.any([signal,deadline]):deadline,redirect:'error'});
  if(!response.ok)return false;
  const result=await response.json();
  return result.status==='ok'&&result.name==='aidiy_code_agents';
 }catch{return false;}
}
export function createGitPanel(project,{state,standalone=false,linked=false,checkTools=gitToolsOnline}={}){
 const key=randomBytes(24).toString('hex'),repo=createRepository(project),controllers=new Set();let closed=false;
 const local=req=>/^(?:127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||'');
 const session=()=>standalone?'standalone':state?.().active?String(state().startedAt):'';
 function close(){closed=true;for(const controller of controllers)controller.abort();}
 async function handle(req,res,url){
  const pathname=url.pathname;
  if(!(pathname==='/api/git/available'||pathname.startsWith('/api/git/')||pathname.startsWith(prefix+'/')||standalone&&pathname==='/'))return false;
  if(!local(req)||closed){json(res,403,{error:'Git はローカルのパネルから利用してください。'});return true;}
  if(pathname==='/api/git/available'&&req.method==='GET'){
   const version=session();
   json(res,200,{available:!!version&&await gitAvailable(project)&&session()===version});return true;
  }
  if(standalone&&pathname==='/'||pathname===prefix+'/'){
   const version=session();
   if(req.method!=='GET'){res.writeHead(405).end();return true;}
   if(!version||!standalone&&url.searchParams.get('session')!==version){json(res,409,{error:'IDE の利用セッションが変わりました。'});return true;}
   const page=html.replace('__GIT_TOKEN__',key).replace('__GIT_SESSION__',version).replace('__GIT_EMBEDDED__',standalone?'0':'1').replace('__GIT_TITLE__',linked?'AiDiy IDE / Git':'AiDiy Git').replace('__PANEL_LABEL__',linked?'AiDiy IDE / Git':'AiDiy Git');
   res.writeHead(200,{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'"}).end(page);return true;
  }
  const asset=pathname.startsWith(prefix+'/')?pathname.slice(prefix.length+1):null;
  if(assets.has(asset)&&req.method==='GET'){
   const [file,mime]=assets.get(asset);
   res.writeHead(200,{...headers,'content-type':mime}).end(await readFile(file));return true;
  }
  const action=pathname.startsWith('/api/git/')?pathname.slice(9):'';
  if(!Object.hasOwn(fields,action)){json(res,404,{error:'未対応の Git 操作です。'});return true;}
  const method=['status','history','tools-status'].includes(action)?'GET':'POST';
  if(req.method!==method){json(res,405,{error:'メソッドが不正です。'});return true;}
  if(req.headers['x-aidiy-git']!==key){json(res,403,{error:'Git パネルから実行してください。'});return true;}
  const version=session();
  if(!version||req.headers['x-aidiy-git-session']!==version){json(res,409,{error:'IDE の利用セッションが変わりました。'});return true;}
  let body={};
  if(method==='POST'){
   try{body=await payload(req,fields[action]);}
   catch{json(res,400,{error:'Git 操作の引数が不正です。'});return true;}
  }
  if(closed||session()!==version){json(res,409,{error:'IDE の利用セッションが変わりました。'});return true;}
  const controller=new AbortController(),disconnect=()=>{if(!res.writableEnded)controller.abort();};
  controllers.add(controller);res.once('close',disconnect);
  // 作業セッションを閉じた後の実行・送信を防ぐ。開始済み操作の結果は Git で再確認する。
  const guard=setInterval(()=>{if(session()!==version)controller.abort();},250);guard.unref();
  try{json(res,200,action==='tools-status'?{online:await checkTools(project,controller.signal)===true}:await repo.request(action,body,controller.signal));}
  catch(error){json(res,error.status||500,{error:error.status?error.message:'Git の処理に失敗しました。'});}
  finally{clearInterval(guard);controllers.delete(controller);res.off('close',disconnect);}
  return true;
 }
 return {handle,close};
}
