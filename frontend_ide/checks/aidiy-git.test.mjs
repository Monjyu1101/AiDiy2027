// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import repository from '../aidiy_git/リポジトリ.cjs';
import {startGit} from '../aidiy_git/serve.mjs';
import {createGitPanel,gitToolsOnline} from '../aidiy_git/パネル.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
const execute=promisify(execFile);
const git=(cwd,...args)=>execute('git',['-c','protocol.file.allow=always',...args],{cwd,encoding:'utf8'});
const user=async root=>{await git(root,'config','user.name','AiDiy fixture');await git(root,'config','user.email','test@example.invalid');};
const make=async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'aidiy-git-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
};
const init=(dir)=>git(dir,'init','-b','main');
const set=async(root,name,value)=>writeFile(join(root,name),value,'utf8');
const keyOf=html=>/name="aidiy-git" content="([0-9a-f]+)"/.exec(html)[1];
function client(origin,key,session='standalone'){
 return async(action,body,extras={})=>{
  const response=await fetch(new URL('/api/git/'+action,origin),{method:body===undefined?'GET':'POST',headers:{'x-aidiy-git':key,'x-aidiy-git-session':session,...(body===undefined?{}:{'content-type':'application/json'}),...extras},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,result:await response.json().catch(()=>null)};
 };
}
test('real Git panel: diff, staging, unstaging, commits, history, fetch, fast-forward and push on a generic remote',async t=>{
 const dir=await make(t),root=join(dir,'project'),bare=join(dir,'remote.git'),peer=join(dir,'peer');
 await mkdir(root);await init(root);await user(root);
 await git(dir,'init','--bare','-b','main',bare);
 await git(root,'remote','add','local',bare);
 await set(root,'start.txt','original\n');await git(root,'add','--','start.txt');await git(root,'commit','-m','initial');
 await git(root,'push','-u','local','main');
 const app=await startGit(root);t.after(()=>app.close());
 const response=await fetch(app.url);const html=await response.text();
 assert.equal(response.status,200);assert.match(html,/id="tab-guide"[^>]*aria-pressed="false"[^]*id="tab-git"[^>]*aria-pressed="true"/);assert.match(html,/id="guide-content"[^>]*hidden/);
 const request=client(app.url,keyOf(html));
 const status=async()=>{const {status,result}=await request('status');assert.equal(status,200);return result;};
 const op=async(action,body={},current=null,expected=200)=>{const {revision}=current??await status();const {status:code,result}=await request(action,{revision,...body});assert.equal(code,expected,`${action}: ${result.error}`);return result;};
 const entry='[literal] 連携.txt';
 await set(root,entry,'hello world\n');
 let s=await status();assert.equal(s.rows[0].path,entry);
 assert.equal(s.remotes[0].github,null);assert.equal(s.upstream.remote,'local');
 const diff=await request('diff',{path:entry,side:'work'});
 assert.equal(diff.status,200,JSON.stringify(diff));assert.match(diff.result.diff,/\+hello world/);
 s=await op('stage',{path:entry},s);assert.equal(s.rows[0].index,'A');
 s=await op('unstage',{path:entry},s);assert.equal(s.rows[0].untracked,true);
 s=await op('stage',{path:entry},s);
 s=await op('commit',{message:'Add literal filename'},s);assert.equal(s.ahead,1);
 assert.equal((await request('history')).result.entries[0].subject,'Add literal filename');
 await op('force-push',{remote:'local',confirm:'main'},s,400);
 s=await op('push',{remote:'local'},s);assert.equal(s.ahead,0);
 await git(dir,'clone',bare,peer);await user(peer);
 await set(peer,'peer.txt','peer\n');await git(peer,'add','peer.txt');await git(peer,'commit','-m','peer');await git(peer,'push');
 s=await op('fetch',{remote:'local'});assert.equal(s.behind,1);
 s=await op('pull',{remote:'local'},s);assert.equal(s.behind,0);
 assert.equal(await readFile(join(root,'peer.txt'),'utf8'),'peer\n');
 await set(root,'start.txt','local divergence\n');await git(root,'add','start.txt');await git(root,'commit','-m','local branch');
 await set(peer,'peer.txt','different divergence\n');await git(peer,'add','peer.txt');await git(peer,'commit','-m','peer branch');await git(peer,'push');
 s=await op('fetch',{remote:'local'});const head=s.head;assert.deepEqual([s.ahead,s.behind],[1,1]);
 await op('pull',{remote:'local'},s,409);await op('push',{remote:'local'},s,409);assert.equal((await status()).head,head);
 assert.equal((await request('stage',{revision:'different',path:entry})).status,409);
 assert.equal((await request('stage',{revision:(await status()).revision,path:'../outside'})).status,400);
 assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/);
 assert.equal((await client(app.url,'bad')('status')).status,403);
 assert.equal((await request('status',undefined,{origin:'https://example.invalid'})).status,403);
 assert.equal((await fetch(new URL('/api/connection',app.url))).status,404);
});
test('exact repository root only, linked worktrees work, checkout cannot be selected through HTTP',async t=>{
 const dir=await make(t),root=join(dir,'repo'),sub=join(root,'nested'),worktree=join(dir,'linked');
 await mkdir(root);await init(root);await user(root);await git(root,'commit','--allow-empty','-m','init');
 await mkdir(sub);await git(root,'worktree','add','-b','side',worktree);
 assert.equal(await repository.gitAvailable(root),true);assert.equal(await repository.gitAvailable(sub),false);assert.equal(await repository.gitAvailable(worktree),true);
 await assert.rejects(startGit(sub),/Git/);
 let current={active:false};const panel=createGitPanel(root,{state:()=>current,linked:true});
 const server=createServer((req,res)=>panel.handle(req,res,new URL(req.url,'http://localhost')).then(handled=>{if(!handled)res.writeHead(404).end();}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{panel.close();server.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const availability=()=>fetch(origin+'/api/git/available').then(r=>r.json());
 assert.deepEqual(await availability(),{available:false});
 current={active:true,startedAt:4};assert.deepEqual(await availability(),{available:true});
 assert.equal((await fetch(origin+'/development/git/?session=3')).status,409);
 const html=await fetch(origin+'/development/git/?session=4').then(r=>r.text());
 const request=client(origin,keyOf(html),'4');assert.equal((await request('status')).status,200);
 current={active:false};assert.equal((await request('status')).status,409);
 current={active:true,startedAt:5};assert.equal((await request('status')).status,409);
});
test('only the real github.com fetch/push pair exposes GitHub features and safe links',async t=>{
 const dir=await make(t);await init(dir);await user(dir);
 await git(dir,'remote','add','origin','https://fake:secret@github.com/Org/Repo.git');
 const repo=repository.createRepository(dir);
 let status=await repo.request('status');
 assert.equal(status.remotes[0].github.url,'https://github.com/Org/Repo');
 assert.doesNotMatch(JSON.stringify(status),/secret/);
 await git(dir,'remote','set-url','--push','origin','https://github.com.example.invalid/Org/Repo.git');
 status=await repo.request('status');assert.equal(status.remotes[0].github,null);
 await assert.rejects(repo.request('github-pr',{remote:'origin'}),/GitHub/);
 await git(dir,'remote','set-url','--push','origin','https://github.com/Org/Repo.git');
 await git(dir,'remote','set-url','--add','--push','origin','https://github.com/Org/Other.git');
 status=await repo.request('status');assert.equal(status.remotes[0].push.length,2);assert.equal(status.remotes[0].github,null);

 for(const url of ['https://github.com.evil.invalid/o/r','https://github.com@evil.invalid/o/r','https://github.com:444/o/r','https://github.com/o/r/compare','ext::https://github.com/o/r','file:///tmp/git'])
  assert.equal(repository.githubUrl(url),null,url);
 assert.deepEqual(repository.githubUrl('git@github.com:Org/Repo.git'),{owner:'Org',repo:'Repo',url:'https://github.com/Org/Repo'});
});
test('normal first push sets upstream; GitHub force requires explicit exact lease and rejects changed remote history',async t=>{
 const dir=await make(t),repo=join(dir,'repo'),bare=join(dir,'remote.git'),peer=join(dir,'peer');
 await mkdir(repo);await init(repo);await user(repo);await git(dir,'init','--bare','-b','main',bare);
 await git(repo,'commit','--allow-empty','-m','initial');await git(repo,'remote','add','origin',bare);
 const service=repository.createRepository(repo);
 let status=await service.request('status');assert.equal(status.upstream,null);
 status=await service.request('push',{revision:status.revision,remote:'origin'});assert.equal(status.upstream.remote,'origin');
 const remote={name:'origin',fetchUrls:['https://github.com/test/repo.git'],pushUrls:['git@github.com:test/repo.git']};
 assert.throws(()=>repository.pushArguments(remote,status,{confirm:'incorrect'},true),/ブランチ名/);
 assert.throws(()=>repository.pushArguments({...remote,pushUrls:['https://other.invalid/test/repo.git']},status,{confirm:'main'},true),/GitHub/);
 const args=repository.pushArguments(remote,status,{confirm:'main'},true);
 assert.ok(args.includes('--force-with-lease=refs/heads/main:'+status.upstream.oid));
 assert.ok(!args.includes('--force'));
 await git(dir,'clone',bare,peer);await user(peer);await git(peer,'commit','--allow-empty','-m','remote advance');await git(peer,'push');
 const expected=(await git(peer,'rev-parse','HEAD')).stdout;
 // 別操作の取得で追跡refが新しくなっても、当初確認したleaseを上書きしない。
 await git(repo,'fetch','origin');
 assert.notEqual((await service.request('status')).upstream.oid,status.upstream.oid);

 await assert.rejects(git(repo,...args),error=>/stale info/i.test(error.stdout+error.stderr));
 assert.equal((await git(bare,'rev-parse','HEAD')).stdout,expected);
});
test('public CLI entry starts the isolated Git panel without Core or IDE UI dependencies',async t=>{
 const dir=await make(t);await init(dir);
 const {launch}=await import('../launch.mjs');
 const app=await launch('git',['--project',dir,'--no-open']);
 t.after(()=>app.close());
 const html=await fetch(app.url).then(r=>r.text());
 assert.match(html,/<title>AiDiy Git<\/title>/);
 const request=client(app.url,keyOf(html));
 assert.equal((await request('status')).status,200);
 assert.equal((await fetch(new URL('/development/git/github-tabs.js',app.url))).status,200);
});

const gitLauncher=fileURLToPath(new URL('../aidiy_git/launch.mjs',import.meta.url));
async function launchGitFixture(t,cwd,args=[]){
 const child=spawn(process.execPath,[gitLauncher,...args,'--no-open'],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const stopped=once(child,'close');
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();await stopped;});
 const output=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Git fixture did not start')),8000);
  let text='',errors='';
  child.stderr.on('data',chunk=>{errors+=chunk;});
  child.stdout.on('data',chunk=>{text+=chunk;if(/プロジェクト: .*\r?\n/.test(text)){clearTimeout(timer);resolve(text);}});
  child.on('exit',code=>{clearTimeout(timer);reject(Error(errors||'Git fixture exited: '+code));});
  child.on('error',error=>{clearTimeout(timer);reject(error);});
 });
 return /http:\/\/127\.0\.0\.1:\d+\//.exec(output)[0];
}
test('the standalone command opens the current repository root and keeps explicitly selected workspaces',async t=>{
 const dir=await make(t),root=join(dir,'日本語 Git root');
 await mkdir(root);await init(root);await set(root,'current.txt','from cwd');
 const url=await launchGitFixture(t,root);
 const query=client(url,keyOf(await fetch(url).then(r=>r.text())));
 assert.equal((await query('status')).result.rows[0].path,'current.txt');
 const explicit=await launchGitFixture(t,dir,['--project',dir]);
 const workspace=client(explicit,keyOf(await fetch(explicit).then(r=>r.text())));
 const result=(await workspace('repositories')).result;
 assert.equal(result.mode,'workspace');
 assert.deepEqual(result.repositories.map(item=>item.name),['日本語 Git root']);
});

test('the standalone command reports missing Git, missing .git, and invalid .git before opening a window',async t=>{
 const dir=await make(t),root=join(dir,'repo'),nested=join(root,'nested'),emptyPath=join(dir,'empty'),invalid=join(dir,'broken');
 await mkdir(nested,{recursive:true});await init(root);await mkdir(emptyPath);await mkdir(invalid);
 await set(invalid,'.git','not a gitdir');
 const env={...process.env,DISPLAY:':99',CODESPACES:'false'};
 for(const [cwd,message] of [[dir,/現在のフォルダに \.git がありません/],[nested,/現在のフォルダに \.git がありません/],[invalid,/有効な作業リポジトリ/]]){
  await assert.rejects(execute(process.execPath,[gitLauncher],{cwd,env,timeout:8000,windowsHide:true}),err=>{
   assert.equal(err.code,1);assert.match(err.stderr,message);assert.equal(err.stdout,'');return true;
  });
 }
 const noGit=Object.fromEntries(Object.entries(env).filter(([key])=>key.toUpperCase()!=='PATH'));
 noGit.PATH=emptyPath;
 await assert.rejects(execute(process.execPath,[gitLauncher],{cwd:root,env:noGit,timeout:8000,windowsHide:true}),err=>{
  assert.equal(err.code,1);assert.match(err.stderr,/Git が見つかりません。Git を導入してください/);assert.equal(err.stdout,'');return true;
 });
});

test('Tools probe checks the same ping as Term and does not gate Git when unavailable',async t=>{
 const dir=await make(t);await init(dir);
 const target=async()=> 'http://127.0.0.1:8095/aidiy_code_agents/';
 assert.equal(await gitToolsOnline(dir,undefined,async(url,{signal,redirect})=>{
  assert.equal(url.href,'http://127.0.0.1:8095/aidiy_code_agents/ping');assert.ok(signal);assert.equal(redirect,'error');
  return {ok:true,json:async()=>({status:'ok',name:'aidiy_code_agents'})};
 },target),true);
 assert.equal(await gitToolsOnline(dir,undefined,async()=>{throw Error('offline');},target),false);
 assert.equal(await gitToolsOnline(dir,undefined,async()=>({ok:true,json:async()=>({status:'ok',name:'unrelated'})}),target),false);
 let online=false;
 const app=await startGit(dir,{checkTools:async(project,signal)=>{assert.equal(project,dir);assert.ok(signal);return online;}});
 t.after(()=>app.close());
 const key=keyOf(await fetch(app.url).then(r=>r.text())),request=client(app.url,key);
 assert.equal((await client(app.url,'bad')('tools-status')).status,403);
 assert.deepEqual((await request('tools-status')).result,{online:false});assert.equal((await request('status')).status,200);
 online=true;assert.deepEqual((await request('tools-status')).result,{online:true});
 for(const file of ['titlebar-colors.css','toggle-drag.js','window-actions.js','panel-chrome.js'])
  assert.equal((await fetch(new URL('/development/git/'+file,app.url))).status,200);
});
test('workspace selects direct repositories only; status, revisions and stage never cross repositories',async t=>{
 const dir=await make(t),root=join(dir,'workspace'),alpha=join(root,'日本語 A'),beta=join(root,'B'),middle=join(root,'nested'),deep=join(middle,'repo');
 await mkdir(alpha,{recursive:true});await mkdir(beta);await mkdir(deep,{recursive:true});
 for(const path of [alpha,beta,deep]){await init(path);await set(path,'same.txt','data\n');}
 if(process.platform!=='win32'){const {symlink}=await import('node:fs/promises');await symlink(deep,join(root,'alias'));}
 assert.equal(await repository.gitAvailable(root),true);assert.equal(await repository.gitAvailable(middle),true);
 const app=await startGit(root);t.after(()=>app.close());
 const key=keyOf(await fetch(app.url).then(r=>r.text())),request=client(app.url,key);
 const requestFor=(id,action,body)=>request(action,body,{'x-aidiy-git-repo':id});
 assert.equal((await request('status')).status,409);
 const first=(await request('repositories')).result;
 assert.equal(first.mode,'workspace');assert.equal(first.name,'workspace');
 assert.deepEqual(new Set(first.repositories.map(repo=>repo.name)),new Set(['日本語 A','B']));
 assert.ok(first.repositories.every(repo=>Object.keys(repo).length===2 && /^[a-f0-9]{64}$/.test(repo.id)));
 const a=first.repositories.find(repo=>repo.name==='日本語 A').id,b=first.repositories.find(repo=>repo.name==='B').id;
 const aStatus=(await requestFor(a,'status')).result,bStatus=(await requestFor(b,'status')).result;
 assert.notEqual(aStatus.revision,bStatus.revision);
 assert.equal((await requestFor(b,'stage',{revision:aStatus.revision,path:'same.txt'})).status,409);
 assert.equal((await requestFor(a,'stage',{revision:aStatus.revision,path:'same.txt'})).status,200);
 assert.match((await git(alpha,'diff','--cached','--name-only')).stdout,/same.txt/);
 assert.equal((await git(beta,'diff','--cached','--name-only')).stdout,'');
 assert.equal((await requestFor('..','status')).status,400);
 await init(root);
 assert.equal((await requestFor(a,'status')).status,409,'旧一覧の子はルートリポジトリの作成後に操作しない');
 const after=(await request('repositories')).result;
 assert.equal(after.mode,'root');assert.deepEqual(after.repositories.map(repo=>repo.name),['workspace']);
 assert.equal((await requestFor(a,'status')).status,409);
 assert.equal((await requestFor(after.repositories[0].id,'status')).status,200);
});
