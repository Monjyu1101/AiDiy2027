// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runSearchAgent, validSearchPath } from './ai-search.mjs';
import { ideDataFolder } from './ide-data.mjs';
import { hasAlwaysExcludedDirectory } from './フォルダ除外規則.mjs';
import { isInternalCredentialPath } from './内部認証ファイル.mjs';
import { normalizeDisplayUrls, normalizeDisplayUrlReason } from '../viewer/表示URL.mjs';

const within=(root,path)=>{const back=relative(root,path);return back!=='..'&&!back.startsWith(`..${sep}`)&&!isAbsolute(back);};
const validInstruction=value=>typeof value==='string'&&value.length<=4000;
export function createFileAnalysis(project,{state,runAgent=runSearchAgent,now=Date.now,waitMs=300_000,pollMs=2000}={}) {
  const jobs=new Map(),queues=new Map();let closed=false;
  function active(){if(closed||!state().active)throw Error('利用を開始してください。');}
  async function source(path) {
    if(!validSearchPath(path))throw Error('ファイルパスが不正です。');
    const root=await realpath(project),full=await realpath(join(root,path));
    if(!within(root,full))throw Error('プロジェクト外のファイルは解析できません。');
    if(isInternalCredentialPath(full))throw Error('内部認証ファイルは解析できません。');
    if(hasAlwaysExcludedDirectory(relative(root,full)))throw Error('除外フォルダ内のファイルは解析できません。');
    const info=await stat(full);if(!info.isFile())throw Error('解析するファイルを選択してください。');
    return {root,full,mtime:info.mtimeMs,size:info.size};
  }
  // 保存先は _AIDIY/aidiy_ide/file_analyses/（旧版の .aidiy/file-analysis/ は初回に移す）
  const directory=()=>ideDataFolder(project,'file_analyses',{legacy:'file-analysis',label:'解析記録'});
  const recordName=path=>createHash('sha256').update(path).digest('hex')+'.json';
  async function read(path) {
    const folder=await directory(),target=join(folder,recordName(path));
    try {
      const full=await realpath(target);
      if(!within(folder,full)||(await stat(full)).size>1100000)throw Error('解析記録を読み取れません。');
      const record=JSON.parse(await readFile(full,'utf8'));
      if(record.path!==path||!validInstruction(record.instruction)||record.result&&(typeof record.result.content!=='string'||record.result.content.length>200000))throw Error('解析記録の形式が不正です。');
      if(record.result)record.result={...record.result,displayUrls:normalizeDisplayUrls(record.result.displayUrls),displayUrlReason:normalizeDisplayUrlReason(record.result.displayUrlReason)};
      return record;
    }catch(error){if(error.code==='ENOENT')return {path,instruction:'',result:null};throw error;}
  }
  // 指示の自動保存と結果の到着が競合しても、前回結果や編集中の指示を失わない。
  function update(path,change) {
    const previous=queues.get(path)||Promise.resolve();
    const promise=previous.catch(()=>{}).then(async()=>{
      const record=await read(path),next=change(record),folder=await directory(),temp=join(folder,randomUUID()+'.tmp');
      await writeFile(temp,JSON.stringify(next),{encoding:'utf8',flag:'wx'});
      await rename(temp,join(folder,recordName(path)));return next;
    });
    queues.set(path,promise);void promise.finally(()=>{if(queues.get(path)===promise)queues.delete(path);}).catch(()=>{});
    return promise;
  }
  const describe=job=>job?{id:job.id,status:job.status,message:job.message||'',deadline:job.deadline,path:job.path,resultPath:job.resultPath,prompt:job.prompt}:null;
  function current(job){return !closed&&state().active&&state().startedAt===job.session&&jobs.get(job.path)===job;}
  function watch(job) {
    clearTimeout(job.timer);
    if(!current(job)||job.status!=='waiting')return;
    job.timer=setTimeout(()=>{void check(job).catch(()=>{}).finally(()=>watch(job));},pollMs);job.timer.unref?.();
  }
  async function check(job) {
    if(job.checking)return job.checking;
    if(job.status==='complete'||!current(job))return;
    job.checking=(async()=>{
      try {
        const root=await realpath(project),full=await realpath(join(root,job.resultPath)),info=await stat(full);
        if(!within(root,full)||!info.isFile()||info.size>1024*1024)throw Error('解析結果ファイルの保存先・サイズが不正です。');
        const data=JSON.parse((await readFile(full,'utf8')).replace(/^\uFEFF/,''));
        if(data.requestId!==job.id||data.path!==job.path||data.instruction!==job.instruction||typeof data.content!=='string'||!data.content.trim()||data.content.length>200000)throw Error('解析結果の依頼ID・対象ファイル・指示・本文を確認してください。');
        if(!current(job))return;
        await update(job.path,record=>({...record,result:{id:job.id,instruction:job.instruction,content:data.content,displayUrls:normalizeDisplayUrls(data.displayUrls),displayUrlReason:normalizeDisplayUrlReason(data.displayUrlReason),createdAt:now(),source:job.source}}));
        job.status='complete';job.message='解析結果を保存しました。';
      }catch(error){
        if(error.code!=='ENOENT'){job.status='invalid';job.message=error instanceof SyntaxError?'解析結果JSONが未完成です。結果を再確認してください。':error.message;}
        else if(now()>=job.deadline){job.status='timeout';job.message='5分以内に解析結果を確認できませんでした。';}
        else if(job.agentError||job.agentFinished){job.status='failed';job.message='エージェントの解析結果を確認できませんでした。';}
        else {job.status='waiting';job.message='最大5分間、解析結果を確認しています。';}
      }
    })().finally(()=>{job.checking=null;});
    return job.checking;
  }
  async function get(path) {
    active();const file=await source(path),job=jobs.get(path);
    if(job&&current(job))await check(job);
    const record=await read(path),previous=record.result?.source;
    return {...record,stale:!!previous&&(previous.mtime!==file.mtime||previous.size!==file.size),job:job&&current(job)?describe(job):null};
  }
  async function save(path,instruction) {
    active();if(!validInstruction(instruction))throw Error('解析指示は4000文字以内で指定してください。');
    await source(path);return update(path,record=>({...record,instruction}));
  }
  async function start(path,instruction) {
    active();if(!validInstruction(instruction)||!instruction.trim())throw Error('解析指示は1〜4000文字で指定してください。');
    const session=state().startedAt,file=await source(path);
    // 同一ファイルの二重送信を避け、他のファイルの解析は独立して継続する。
    const previous=jobs.get(path);if(previous&&current(previous)&&previous.status==='waiting')throw Error('このファイルは解析中です。');
    if([...jobs.values()].filter(job=>current(job)&&job.status==='waiting').length>=5)throw Error('同時に解析できるファイルは5件までです。');
    const id=randomUUID(),job={id,path,instruction:instruction.trim(),session,status:'waiting',deadline:now()+waitMs,source:{mtime:file.mtime,size:file.size},controller:new AbortController()};
    const date=new Date(now()),pad=n=>String(n).padStart(2,'0');
    job.resultPath=`temp/${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${id}_analysis.json`;
    jobs.set(path,job);
    try {
      const temp=join(file.root,'temp');await mkdir(temp,{recursive:true});if(!within(file.root,await realpath(temp)))throw Error('tempがプロジェクト外を参照しています。');
      job.prompt=`プロジェクト内の指定ファイルを読み取り解析してください。ソース・設定の変更、サーバー起動、インストール、他エージェントへの委譲は行わないでください。
プロジェクトルート: ${file.root}
対象ファイル（ルート相対）: ${JSON.stringify(path)}
ユーザーの解析指示: ${JSON.stringify(job.instruction)}
ユーザーの解析指示を優先し、対象の内容と必要な参照先を確認して日本語で説明してください。ソースの説明には根拠となる関数名や行番号を、画像の説明には実際に確認できた視覚情報を示してください。確認できないことは推測と明記し、秘密情報を出力しないでください。読めない形式なら読み取れない範囲を説明し、内容を創作しないでください。
内容の解析とあわせて、このファイルの画面をブラウザで表示できるURLも調べてください。HTML / Vueなどはソース、import関係、routerのルート定義、サーバーのポート設定、base / public設定を読み、対象の画面に対応する実際のURLと根拠を確認してください。AiDiy以外のプロジェクトでも、そのプロジェクトの設定に従ってください。サーバーは起動せず、到達性を未確認の場合はその旨をdisplayUrlReasonに記載してください。
displayUrlsはurlとlabelという文字列フィールドを持つオブジェクトの配列です。表示URLは根拠のあるHTTP(S)の絶対URLだけをdisplayUrlsに最大20件、各4096文字以内で保存し、labelには画面名（200文字以内）を入れてください。認証情報、トークン、秘密のクエリや署名を含むURLは保存・出力しないでください。動的ルートのIDやホスト・ポートを推測したり、:id / {id}などのプレースホルダーを含むURLを作らないでください。URLを特定できない場合、画面を持たないファイルの場合はdisplayUrlsを空配列とし、displayUrlReasonに理由を日本語で2000文字以内で記載してください。根拠となる設定やルートと未確認事項もdisplayUrlReasonに簡潔に記載してください。
結果は ${job.resultPath}.tmp にUTF-8 JSONで書き、完成後に ${job.resultPath} へリネームしてください。この2ファイル以外は作成・変更しないでください。
形式: ${JSON.stringify({requestId:id,path,instruction:job.instruction,content:'解析内容（日本語Markdown）',displayUrls:[],displayUrlReason:'表示URLの根拠・未確認事項、または特定できない理由'})}
contentは空でない20万文字以内のMarkdownです。5分以内を目安に、必ず結果ファイルへ保存してください。`;
      await update(path,record=>({...record,instruction:job.instruction}));
      if(!current(job))throw Error('利用が終了しました。');
      void Promise.resolve().then(()=>runAgent({project:file.root,prompt:job.prompt,signal:job.controller.signal})).then(()=>{job.agentFinished=true;}).catch(()=>{job.agentError=true;}).finally(async()=>{
        // 終了直前のpollがENOENTを読んでいても、その結果だけで終了判定しない。
        // 進行中の確認が終わってから、エージェントが確定したファイルを再読込する。
        try{await job.checking;if(current(job))await check(job);}catch{}
      });
      watch(job);return describe(job);
    }catch(error){job.status='failed';job.message=error.message;throw error;}
  }
  return {get,save,start,close(){closed=true;for(const job of jobs.values()){clearTimeout(job.timer);job.controller.abort();}},
    async handle(req,res,url) {
      if(url.pathname!=='/api/file-analysis')return false;
      const send=(status,data)=>res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(data));
      if(!state().active){send(503,{error:'利用を開始してください。'});return true;}
      try {
        if(req.method==='GET')send(200,await get(url.searchParams.get('path')));
        else if(['POST','PUT'].includes(req.method)){
          const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>20*1024*1024)throw Error('解析指示が長すぎます。');chunks.push(chunk);}
          const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          send(200,req.method==='POST'?await start(data.path,data.instruction):await save(data.path,data.instruction));
        }else send(405,{error:'GET / POST / PUT required'});
      }catch(error){send(400,{error:error.message});}
      return true;
    }
  };
}
