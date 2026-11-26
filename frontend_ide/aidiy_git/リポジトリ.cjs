// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {execFile}=require('node:child_process');
const {realpath,lstat,opendir}=require('node:fs/promises');
const path=require('node:path');
const {promisify}=require('node:util');
const {createHash}=require('node:crypto');
const execute=promisify(execFile);
const fail=(message,status=409)=>Object.assign(Error(message),{status});
const gitEnv=()=>({...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_(?:DIR|COMMON_DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+|EXEC_PATH|LITERAL_PATHSPECS|GLOB_PATHSPECS|NOGLOB_PATHSPECS|ICASE_PATHSPECS)$/i.test(key))),GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never',GIT_NO_REPLACE_OBJECTS:'1',LC_ALL:'C',GIT_OPTIONAL_LOCKS:'0'});
const MAX_OUTPUT=768*1024;
const labelError=error=>{
 if(error?.code==='ENOENT')return 'Git が見つかりません。Git を導入してください。';
 if(error?.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')return 'Git の出力が上限を超えました。';
 if(error?.killed || error?.code==='ABORT_ERR')return 'Git 処理を中止しました。実際の状態は再読込で確認してください。';
 const data=String(error?.stderr||'');
 if(/stale info|non-fast-forward|not possible to fast-forward|fetch first|divergent/i.test(data))return '履歴が分岐しています。自動では取り込まず、送信もしません。取得後に履歴を確認してください。';
 if(/unmerged|resolve your current index|conflict|would be overwritten/i.test(data))return '競合または作業中の変更があるため完了できません。変更一覧を確認してください。';
 if(/authentication|permission denied|could not read Username|host key verification/i.test(data))return '認証に失敗しました。Git／SSH の資格情報を確認してください。';
 if(/author identity unknown|unable to auto-detect email/i.test(data))return 'Git の user.name と user.email を設定してください。';
 if(/not allowed/i.test(data)&&/transport/i.test(data))return '許可されていない Git 通信方式です。';
 if(/nothing to commit/i.test(data+error?.stdout))return 'コミットするステージ済みの変更がありません。';
 // 生のエラー本文・URLは資格情報を含む場合があるので返さない。
 return 'Git の処理に失敗しました。リポジトリ、通信、設定を確認してください。';
};
async function git(cwd,args,{signal,network=false,allowed=[0]}={}){
 try{
  const {stdout}=await execute('git',['--literal-pathspecs','-c','color.ui=false','-c','core.quotepath=false','-c','core.fsmonitor=false',
   '-c','protocol.allow=never',...['ssh','https','http','git','file'].flatMap(proto=>['-c',`protocol.${proto}.allow=always`]),...args],
   {cwd,env:gitEnv(),encoding:'utf8',timeout:network?45000:12000,maxBuffer:MAX_OUTPUT,windowsHide:true,signal});
  return {stdout,code:0};
 }catch(error){
  if(typeof error.code==='number'&&allowed.includes(error.code))return {stdout:error.stdout||'',code:error.code};
  throw fail(labelError(error),error.code==='ENOENT'?503:409);
 }
}
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const stat=async value=>lstat(value).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
async function gitEntry(candidate, name, signal){
 const cwd=await realpath(candidate), marker=await stat(path.join(cwd,'.git'));
 if(!marker||!marker.isDirectory()&&!marker.isFile())return null;
 const {stdout}=await git(cwd,['rev-parse','--show-toplevel'],{signal});
 const root=await realpath(stdout.replace(/\r?\n$/,''));
 if(!samePath(cwd,root))return null;
 const id=createHash('sha256').update(JSON.stringify([cwd,marker.dev,marker.ino])).digest('hex');
 return {id,name:name??path.basename(cwd),cwd};
}
async function gitRoot(project,{signal}={}){
 if(typeof project!=='string'||!path.isAbsolute(project))return null;
 try{return (await gitEntry(project,null,signal))?.cwd??null;}catch{return null;}
}
// ルートに .git があれば単独。なければ実ディレクトリの1階層目だけ。シンボリックリンクと親・孫は対象外。
async function gitWorkspace(project,{signal,first=false}={}){
 if(typeof project!=='string'||!path.isAbsolute(project))return {name:'',mode:'workspace',entries:[]};
 const workspace=await realpath(project);
 const name=path.basename(workspace);
 if(await stat(path.join(workspace,'.git'))){
  const entry=await gitEntry(workspace,null,signal).catch(()=>null);
  return {name,mode:'root',entries:entry?[entry]:[]};
 }
 const entries=[];
 const directory=await opendir(workspace);
 for await(const child of directory){
  signal?.throwIfAborted();
  if(!child.isDirectory()||child.name==='.git')continue;
  const candidate=path.join(workspace,child.name);
  const entry=await verifyChild(workspace,candidate,child.name,signal);
  if(!entry)continue;
  entries.push(entry);
  if(first)break;
 }
 entries.sort((a,b)=>a.name.localeCompare(b.name,'ja',{numeric:true}));
 return {name,mode:'workspace',entries};
}
async function verifyChild(workspace,candidate,name,signal){
 try{
  if(!(await lstat(candidate)).isDirectory()||!samePath(await realpath(candidate),candidate)||!samePath(path.dirname(candidate),workspace))return null;
  const entry=await gitEntry(candidate,name,signal);
  return entry&&samePath(entry.cwd,candidate)?entry:null;
 }catch{return null;}
}
async function validateWorkspaceEntry(project,entry,signal){
 try{
  const workspace=await realpath(project);
  const rootMarker=await stat(path.join(workspace,'.git'));
  const current=rootMarker?(samePath(workspace,entry.cwd)?await gitEntry(workspace,null,signal):null):await verifyChild(workspace,entry.cwd,entry.name,signal);
  return current?.id===entry.id?current:null;
 }catch{return null;}
}
const gitAvailable=async project=>{try{return (await gitWorkspace(project,{first:true})).entries.length>0;}catch{return false;}};
// 引数なしの単独起動では、現在地以外を暗黙に操作対象へ含めない。
async function requireGitProject(project,{workspace=false}={}){
 await git(project,['--version']);
 const marker=await stat(path.join(project,'.git'));
 if(marker){
  if(!await gitRoot(project))throw fail('このフォルダの .git を有効な作業リポジトリとして開けません。');
  return;
 }
 if(workspace){
  if(await gitAvailable(project))return;
  throw fail('指定したフォルダまたは直下に Git リポジトリが見つかりません。');
 }
 throw fail('現在のフォルダに .git がありません。Git リポジトリのルートで aidiy_git を実行してください。');
}
const states=(raw)=>{
 const parts=raw.split('\0'),rows=[];
 for(let i=0;i<parts.length&&parts[i];i++){
  const token=parts[i],xy=token.slice(0,2),name=token.slice(3);
  if(token[2]!==' '||!name)continue;
  const old=/[RC]/.test(xy)?parts[++i]:null;
  rows.push({path:name,old:old||null,index:xy[0],work:xy[1],untracked:xy==='??',conflict:/^(DD|AU|UD|UA|DU|AA|UU)$/.test(xy)});
 }
 return rows;
};
const validRemote=name=>typeof name==='string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(name);
const validBranch=ref=>typeof ref==='string' && ref.startsWith('refs/heads/') && !/[\x00-\x20:\x7f]/.test(ref);
const safeUrl=value=>{
 const raw=value.trim();
 try { const url=new URL(raw);url.username='';url.password='';url.search='';url.hash='';return url.toString(); } catch {}
 return raw.replace(/^[^@/\s]+@(?=[^\s:]+:)/,'').slice(0,500);
};
function githubUrl(value){
 const raw=String(value||'').trim();
 let pathname;
 try{
  const url=new URL(raw);
  if(url.hostname!=='github.com'||!['https:','ssh:'].includes(url.protocol)||url.port||url.search||url.hash)return null;
  pathname=url.pathname;
 }catch{
  const match=/^git@github\.com:(.+)$/i.exec(raw);
  if(!match)return null;
  pathname='/'+match[1];
 }
 const match=/^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/?$/.exec(pathname);
 if(!match)return null;
 const [,owner,rawRepo]=match,repo=rawRepo.replace(/\.git$/i,'');
 if(!repo||repo==='.'||repo==='..')return null;
 return {owner,repo,url:`https://github.com/${owner}/${repo}`};
}
function githubRemote(remote){
 if(remote.fetchUrls.length!==1||remote.pushUrls.length!==1)return null;
 const fetch=githubUrl(remote.fetchUrls[0]),push=githubUrl(remote.pushUrls[0]);
 return fetch&&push&&fetch.url.toLowerCase()===push.url.toLowerCase()?fetch:null;
}
function pushArguments(remote,s,body,lease=false){
 if(remote.pushUrls.length!==1)throw fail('送信先 URL が1件のリモートだけを送信できます。');
 if(!s.head||!s.branch||s.upstream&&s.upstream.remote!==remote.name)
  throw fail('現在のブランチと送信先を確認してください。');
 const ref=s.upstream?.ref||'refs/heads/'+s.branch;
 if(!validBranch(ref))throw fail('送信先のブランチが不正です。',400);
 if(lease&&(!githubRemote(remote)||!s.upstream?.oid||body.confirm!==s.branch))
  throw fail('GitHub の追跡先を取得し、現在のブランチ名を入力して確認してください。',400);
 return ['-c',`remote.${remote.name}.mirror=false`,'push','--porcelain','--no-follow-tags','--no-recurse-submodules',
  ...(lease?[`--force-with-lease=${ref}:${s.upstream.oid}`]:['--no-force',...(s.upstream?[]:['--set-upstream'])]),'--',remote.name,`HEAD:${ref}`];
}
async function githubList(remote,action,cwd,signal){
 const info=remote&&githubRemote(remote);
 if(!info)throw fail('GitHub のリモートを選択してください。',400);
 const fields='number,title,state,updatedAt,author';
 let data;
 try{
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!['GH_HOST','GH_REPO'].includes(key.toUpperCase()))),GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GH_NO_EXTENSION_UPDATE_NOTIFIER:'1'};
  const {stdout}=await execute('gh',[action==='github-pr'?'pr':'issue','list','--repo',`github.com/${info.owner}/${info.repo}`,'--state','all','--limit','50','--json',fields],{cwd,env,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:MAX_OUTPUT,signal});
  data=JSON.parse(stdout);
  if(!Array.isArray(data))throw Error('invalid');
 }catch(error){
  throw fail(error.code==='ENOENT'?'一覧表示には GitHub CLI (gh) が必要です。ブラウザーで管理できます。':'一覧を取得できません。gh auth login とリポジトリのアクセス権を確認するか、ブラウザーで開いてください。',503);
 }
 return {entries:data.slice(0,50).filter(item=>Number.isSafeInteger(item?.number)&&item.number>0).map(item=>({
  number:item.number,title:String(item.title||'').slice(0,300),state:String(item.state||'').slice(0,20),updatedAt:String(item.updatedAt||'').slice(0,30),
  author:{login:String(item.author?.login||'').slice(0,100)},
  url:`${info.url}/${action==='github-pr'?'pull':'issues'}/${item.number}`,
 }))};
}
async function summarize(cwd,signal){
 const commands=[
  ['status','--porcelain=v1','-z','--untracked-files=all'],
  ['symbolic-ref','-q','HEAD'],
  ['rev-parse','--verify','--quiet','HEAD'],
  ['remote'],
 ];
 const [status,symbolic,head,known]=await Promise.all(commands.map((args,i)=>git(cwd,args,{signal,allowed:i===1||i===2?[0,1]:[0]})));
 const branchRef=symbolic.stdout.trim(),branch=validBranch(branchRef)?branchRef.slice('refs/heads/'.length):'';
 const remotes=await Promise.all(known.stdout.split(/\r?\n/).filter(validRemote).slice(0,24).map(async name=>{
  const [fetch,push]=await Promise.all([git(cwd,['remote','get-url','--all',name],{signal}),git(cwd,['remote','get-url','--push','--all',name],{signal})]);
  const fetchUrls=fetch.stdout.trimEnd().split(/\r?\n/).filter(Boolean), pushUrls=push.stdout.trimEnd().split(/\r?\n/).filter(Boolean);
  return {name,fetchUrls,pushUrls};
 }));
 let upstream=null,ahead=null,behind=null;
 if(branch){
  const {stdout}=await git(cwd,['for-each-ref','--count=1','--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)',branchRef],{signal});
  const [remote,ref,tracking]=stdout.trimEnd().split('\0');
  if(validRemote(remote)&&validBranch(ref)&&tracking){
   const oid=(await git(cwd,['rev-parse','--verify','--quiet',tracking],{signal,allowed:[0,1]})).stdout.trim();
   upstream={remote,ref,tracking,oid:/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(oid)?oid:null};
   const counts=await git(cwd,['rev-list','--left-right','--count','HEAD...@{upstream}'],{signal,allowed:[0,128]});
   const values=counts.stdout.trim().split(/\s+/).map(Number);
   if(values.length===2&&values.every(Number.isInteger)){[ahead,behind]=values;}
  }
 }
 const rows=states(status.stdout);
 // 送信の確定前に、ブランチと実URLを含む参照先が変わっていないことを照合する。
 const revision=createHash('sha256').update(JSON.stringify([cwd,branchRef,head.stdout,upstream,remotes,rows])).digest('hex');
 return {project:path.basename(cwd),branch,detached:!branch,head:head.stdout.trim(),remotes,upstream,ahead,behind,rows,revision};
}
const forView=s=>({...s,remotes:s.remotes.map(({name,fetchUrls,pushUrls})=>({name,fetch:fetchUrls.map(safeUrl),push:pushUrls.map(safeUrl),github:githubRemote({fetchUrls,pushUrls})}))});
function createRepository(project){
 let busy=false;
 return {
  async request(action,body={},signal){
   const cwd=await gitRoot(project,{signal});
   if(!cwd)throw fail('選択したプロジェクトは Git 管理されていないか、Git を利用できません。',404);
   if(action==='status')return forView(await summarize(cwd,signal));
   if(action==='history'){
    const {stdout}=await git(cwd,['log','-30','--no-show-signature','--format=%h%x09%as%x09%s'],{signal,allowed:[0,128]});
    return {entries:stdout.trimEnd().split('\n').filter(Boolean).map(line=>{const [id,date,...parts]=line.split('\t');return {id,date,subject:parts.join(' ')};})};
   }
   if(['github-pr','github-issue'].includes(action)){
    const s=await summarize(cwd,signal);
    return githubList(s.remotes.find(r=>r.name===body.remote),action,cwd,signal);
   }
   const diff=action==='diff';
   if(!diff&&!['stage','unstage','commit','fetch','pull','push','force-push'].includes(action))throw fail('未対応の操作です。',404);
   if(!diff&&busy)throw fail('別の Git 操作が実行中です。');
   if(!diff)busy=true;
   try {
    const s=await summarize(cwd,signal);
    if(!diff && body.revision!==s.revision)throw fail('Git の状態が変わりました。再読込してから操作してください。');
    const row=s.rows.find(candidate=>candidate.path===body.path);
    const filenames=row?.old?[row.path,row.old]:row?[row.path]:[];
    let args,network=false;
    if(diff){
     if(!row||!['index','work'].includes(body.side))throw fail('対象の変更を選び直してください。',400);
     args=row.untracked?['diff','--no-index','--no-ext-diff','--no-textconv','--','/dev/null',row.path]:
      ['diff','--no-ext-diff','--no-textconv',...(body.side==='index'?['--cached']:[]),'--',...filenames];
     return {diff:(await git(cwd,args,{signal,allowed:row.untracked?[0,1]:[0]})).stdout};
    }
    if(action==='stage'||action==='unstage'){
     if(!row || (action==='unstage'&&(row.untracked||row.index===' ')))throw fail('対象の変更を選び直してください。',400);
     args=action==='stage'?['add','-A','--',...filenames]:s.head?['reset','--quiet','HEAD','--',...filenames]:['rm','--cached','--quiet','--',...filenames];
    }else if(action==='commit'){
     if(typeof body.message!=='string'||!body.message.trim()||body.message.length>4000||body.message.includes('\0'))throw fail('コミットメッセージは 1〜4000 文字で入力してください。',400);
     if(!s.rows.some(row=>!row.untracked&&row.index!==' ')||s.rows.some(row=>row.conflict))throw fail('ステージ済みの変更が必要です。競合があれば先に解消してください。');
     args=['commit','-m',body.message.trim()];
    }else{
     const remote=s.remotes.find(r=>r.name===body.remote);
     if(!remote)throw fail('登録済みのリモートを選択してください。',400);
     network=true;
     if(action==='fetch')args=['fetch','--no-prune','--no-prune-tags','--no-recurse-submodules','--',remote.name];
     else {
      if(action==='pull'){
       if(!s.branch||!s.upstream||s.upstream.remote!==remote.name)throw fail('現在のブランチに、このリモートの追跡先が設定されていません。');
       if(s.rows.some(row=>!row.untracked))throw fail('取り込み前に追跡中の変更をコミットするか整理してください。');
       args=['pull','--ff-only','--no-rebase','--no-recurse-submodules','--',remote.name,s.upstream.ref];
      }else args=pushArguments(remote,s,body,action==='force-push');
     }
    }
    await git(cwd,args,{signal,network});
    return forView(await summarize(cwd,signal));
   }finally{if(!diff)busy=false;}
  },
 };
}
module.exports={requireGitProject,gitAvailable,gitRoot,gitWorkspace,validateWorkspaceEntry,createRepository,githubUrl,pushArguments};
