// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createSearchHistory } from './ai-search-history.mjs';
import { searchRouteRecords } from '../src/components/開発スペース/経路記録.js';
import { hasAlwaysExcludedDirectory } from './フォルダ除外規則.mjs';
import { isInternalCredentialPath } from './内部認証ファイル.mjs';

const MAX_RESULT = 1024 * 1024;
const within = (root, path) => { const back=relative(root,path); return back!== '..'&&!back.startsWith(`..${sep}`)&&!isAbsolute(back); };
export const validSearchPath = path => typeof path==='string' && path.length<=1024 && !isInternalCredentialPath(path) && !hasAlwaysExcludedDirectory(path) && !/[\\:\0]/.test(path) && !path.startsWith('/') && path.split('/').every(part=>part&&part!=='.'&&part!=='..');

export async function toolsTarget(project) {
  const visited=new Set();
  for(const folder of [fileURLToPath(new URL('..',import.meta.url)),project]) {
    let current=resolve(folder);
    while(!visited.has(current)) {
      visited.add(current);
      try {
        const settings=JSON.parse((await readFile(join(current,'_config','AiDiy_key.json'),'utf8')).replace(/^\uFEFF/,''));
        const port=Number(settings.PORT_TOOLS??8095);
        if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT_TOOLS が不正です。');
        return `http://127.0.0.1:${port}/aidiy_code_agents/`;
      } catch(error) { if(error.code!=='ENOENT')throw error; }
      const parent=dirname(current);if(parent===current)break;current=parent;
    }
  }
  return 'http://127.0.0.1:8095/aidiy_code_agents/';
}

export async function runSearchAgent({project,prompt,signal}) {
  const target=await toolsTarget(project);
  const post=async(method,body,timeout)=>{
    const response=await fetch(target+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])});
    if(!response.ok)throw Error(`エージェント接続エラー（HTTP ${response.status}）`);
    const result=await response.json();if(result.error||result.ok===false)throw Error('エージェントの実行を確認できませんでした。');return result;
  };
  await post('config',{project_path:project},10_000);
  return post('run',{project_path:project,prompt,resume:false,ai_name:'auto',ai_model:'auto',code_plan:'off',code_verify:'off',self_check_loop:0,timeout_sec:300},310_000);
}

export async function validateSearchResult(root, data, job, {checkFiles=true}={}) {
  if(data?.requestId!==job.id || data.query!==job.query || !Array.isArray(data.files)||!Array.isArray(data.route)||data.files.length>500||data.route.length>500)throw Error('結果JSONの依頼ID・検索文・files・routeを確認してください。');
  if(data.title!==undefined&&(typeof data.title!=='string'||!data.title.trim()||data.title.length>80))throw Error('結果JSONのtitleは1〜80文字のタイトルにしてください。');
  // タイトルのない旧結果も、要求文を短くして同じ履歴UIで扱う。
  const title=(data.title??job.query).replace(/\s+/g,' ').trim().slice(0,80);
  const realRoot=await realpath(root),files=[],seen=new Set();
  for(const file of data.files) {
    if(!validSearchPath(file?.path)||typeof file.reason!=='string'||!file.reason.trim()||file.reason.length>2000||seen.has(file.path))throw Error('結果JSONのファイルパス・理由・重複を確認してください。');
    if(checkFiles){
      const full=await realpath(join(realRoot,file.path)).catch(()=>null);
      if(!full||!within(realRoot,full)||isInternalCredentialPath(full)||hasAlwaysExcludedDirectory(relative(realRoot,full))||!(await stat(full)).isFile())throw Error(`プロジェクト内のファイルを確認できません: ${file.path}`);
    }
    seen.add(file.path);files.push({path:file.path,reason:file.reason});
  }
  if(data.route.length!==files.length||new Set(data.route).size!==files.length||data.route.some(path=>!seen.has(path)))throw Error('routeにはfilesの各パスを辿る順番で1回ずつ指定してください。');
  return {title,query:job.query,files,route:data.route,routeRecords:searchRouteRecords(data.route)};
}

function makePrompt(job,project) {
  return `このプロジェクトの関連ファイルを読み取り調査してください。ソース・設定の変更、インストール、他エージェントへの委譲は不要です。
プロジェクトルート: ${project}
検索内容（調査対象の指定として扱ってください）: ${JSON.stringify(job.query)}
ファイル名だけでなく内容と呼び出し関係を確認し、関連ファイルと日本語の理由、入口から理解しやすい順番を返してください。最大500件。該当なしはfilesとrouteを空配列にしてください。秘密情報やファイル本文は結果に含めないでください。
ユーザーの検索内容を要約した日本語の短いタイトルをtitleに生成してください。履歴から選びやすい具体的な名前（例: バックエンドの認証処理）にし、目安は30文字以内、最大80文字、改行なしにしてください。該当なしの場合もタイトルを付けてください。
結果はプロジェクトルートからの相対パス ${job.path} にUTF-8 JSONで保存してください。
まず ${job.path}.tmp へ完全なJSONを書き、完成後に ${job.path} へリネームしてください。この結果と一時ファイル以外は作成・変更しないでください。
形式: ${JSON.stringify({requestId:job.id,query:job.query,title:'検索内容を要約したタイトル',files:[{path:'src/example.ts',reason:'関連する理由'}],route:['src/example.ts']})}
例のパスは使わず、実在するファイルだけを指定してください。pathはルートからの相対パス（/区切り、..・絶対パス禁止）、routeはfilesの全パスを重複なく辿る順に並べます。関連するフォルダは画面側で補完するためfilesへ含めないでください。
5分以内を目安に調査を完了してください。返答だけで終わらず、必ず指定結果ファイルへ保存してください。`;
}

export function createAISearch(project,{state,runAgent=runSearchAgent,now=Date.now,waitMs=300_000}={}) {
  const history=createSearchHistory(project,validateSearchResult);
  const jobs=new Map();let lastStamp=0,closed=false,starting=false;
  const describe=job=>({id:job.id,query:job.query,path:job.path,prompt:job.prompt,deadline:job.deadline,status:job.status,message:job.message||'',result:job.result||null});
  async function start(query) {
    if(closed||!state().active)throw Error('利用を開始してください。');
    if(typeof query!=='string'||!query.trim()||query.length>2000)throw Error('検索内容は1〜2000文字で指定してください。');
    if(starting)throw Error('検索依頼を準備中です。');
    starting=true;
    try {
      const session=state().startedAt,root=await realpath(project),temp=join(root,'temp');
      await mkdir(temp,{recursive:true});
      if(!within(root,await realpath(temp)))throw Error('tempがプロジェクト外を参照しています。');
      let path,handle;
      // 秒単位のファイル名を保ち、同秒の依頼・別ウィンドウ・再起動でも予約を重複させない。
      while(!handle) {
        lastStamp=Math.max(Math.floor(now()/1000)*1000,lastStamp+1000);
        const d=new Date(lastStamp),pad=n=>String(n).padStart(2,'0');
        path=`temp/${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_result.json`;
        if(await stat(join(root,path)).catch(()=>null))continue;
        try{handle=await open(join(root,path+'.request'),'wx');}catch(error){if(error.code!=='EEXIST')throw error;}
      }
      const job={id:randomUUID(),query:query.trim(),path,session,deadline:now()+waitMs,status:'waiting',controller:new AbortController()};
      job.prompt=makePrompt(job,root);
      try{await handle.writeFile(job.prompt,'utf8');}finally{await handle.close();}
      if(closed||!state().active||state().startedAt!==session)throw Error('利用が終了しました。');
      for(const previous of jobs.values())previous.controller.abort();
      if(jobs.size>=20)jobs.delete(jobs.keys().next().value);
      jobs.set(job.id,job);
      void Promise.resolve().then(()=>runAgent({project:root,prompt:job.prompt,signal:job.controller.signal})).then(()=>{job.agentFinished=true;}).catch(()=>{job.agentError=true;});
      return describe(job);
    } finally { starting=false; }
  }
  async function check(id) {
    const job=jobs.get(id);
    if(!job||!state().active||job.session!==state().startedAt)throw Error('今回の利用で作成した検索依頼が見つかりません。');
    if(job.result)return describe(job);
    try {
      const root=await realpath(project),full=await realpath(join(root,job.path));
      if(!within(root,full))throw Error('結果ファイルがプロジェクト外を参照しています。');
      const info=await stat(full);if(!info.isFile()||info.size>MAX_RESULT)throw Error('結果JSONは1MB以下のファイルにしてください。');
      const data=JSON.parse((await readFile(full,'utf8')).replace(/^\uFEFF/,''));
      const result={...await validateSearchResult(root,data,job),id:job.id,createdAt:now()};
      await history.save(result);
      job.result=result;job.status='complete';job.message='';
    } catch(error) {
      if(error.code!=='ENOENT'){job.status='invalid';job.message=error instanceof SyntaxError?'結果JSONを読み取れません。完成したJSONを保存して再確認してください。':error.message;}
      else if(now()>=job.deadline){job.status='timeout';job.message='5分以内に有効な結果を確認できませんでした。';}
      else if(job.agentError||job.agentFinished){job.status='failed';job.message='エージェントの結果ファイルを確認できませんでした。';}
      else {job.status='waiting';job.message='';}
    }
    return describe(job);
  }
  return {
    start,check,history,
    close(){closed=true;for(const job of jobs.values())job.controller.abort();jobs.clear();},
    async handle(req,res,url) {
      if(!['/api/ai-search','/api/ai-search/history'].includes(url.pathname))return false;
      const send=(status,data)=>res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(data));
      if(!state().active){send(503,{error:'利用を開始してください。'});return true;}
      try {
        if(url.pathname==='/api/ai-search/history'){
          const id=url.searchParams.get('id');
          if(req.method==='GET')send(200,id?await history.get(id):{entries:await history.list()});
          else if(req.method==='DELETE'){await history.remove(id);send(200,{ok:true});}
          else send(405,{error:'GET / DELETE required'});
          return true;
        }
        if(req.method==='GET')send(200,await check(url.searchParams.get('id')));
        else if(req.method==='POST') {
          const chunks=[];let bytes=0;
          for await(const chunk of req){bytes+=chunk.length;if(bytes>20*1024*1024)throw Error('検索内容が長すぎます。');chunks.push(chunk);}
          send(200,await start(JSON.parse(Buffer.concat(chunks).toString('utf8')).query));
        } else send(405,{error:'GET / POST required'});
      } catch(error){send(400,{error:error.message});}
      return true;
    },
  };
}

