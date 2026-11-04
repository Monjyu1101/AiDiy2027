// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from '../diag_main.mjs';
import {createVSCodeLauncher,resolveVSCode} from '../起動/VSCode起動.mjs';
function fixture(options={}){
 const calls=[],env={PATH:'/bin',HTTPS_PROXY:'http://proxy.test:8080',NO_PROXY:'localhost',ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--inspect'};
 const manager=createVSCodeLauncher({startupGrace:1,env,resolveFn:async()=>'/bin/code',realpathFn:async x=>x,statFn:async()=>({isDirectory:()=>true}),spawnFn(command,args,opts){calls.push({command,args,opts});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;},...options});return {manager,calls,env};
}
test('VS Code opens exact selected folder without shell, model, Console, or approval flags; inherits proxy',async()=>{
 const f=fixture(),project="/tmp/日本語 project ' & $ % ;";assert.equal((await f.manager.launch(project)).受付,true);
 assert.deepEqual(f.calls[0].args,['--new-window',project]);assert.equal(f.calls[0].opts.cwd,project);assert.equal(f.calls[0].opts.shell,false);assert.equal(f.calls[0].opts.windowsHide,false);
 assert.equal(f.calls[0].opts.env.HTTPS_PROXY,f.env.HTTPS_PROXY);assert.equal(f.calls[0].opts.env.NO_PROXY,'localhost');assert.equal(f.calls[0].opts.env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(f.env.ELECTRON_RUN_AS_NODE,'1');
});
test('missing executable, invalid folder and spawn error do not fall back to another folder',async()=>{
 const f=fixture({resolveFn:async()=>null});assert.equal((await f.manager.catalog()).利用可能,false);await assert.rejects(f.manager.launch('/project'),/VS Code/);
 for(const value of ['',null,'relative','/bad\npath'])await assert.rejects(f.manager.launch(value),/プロジェクト/);assert.equal(f.calls.length,0);
 await assert.rejects(fixture({statFn:async()=>({isDirectory:()=>false})}).manager.launch('/file'),/フォルダ/);
 await assert.rejects(fixture({spawnFn(){const c=new EventEmitter();queueMicrotask(()=>c.emit('error',Error('private')));return c;}}).manager.launch('/project'),/起動できません/);
});
test('Windows code.cmd maps to actual Code.exe without cmd interpolation; handles Insiders and missing binary',async()=>{
 for(const [cmd,exe] of [['code.cmd','Code.exe'],['code-insiders.cmd','Code - Insiders.exe']]){
  const root='C:\\Users\\日本語 user\\Microsoft VS Code',checks=[];
  const result=await resolveVSCode({platform:'win32',resolveFn:async(entry)=>{assert.equal(entry.id,'code');return root+'\\bin\\'+cmd;},statFn:async p=>{checks.push(p);return {isFile:()=>true};}});
  assert.equal(result,root+'\\'+exe);assert.deepEqual(checks,[result]);
  const f=fixture({platform:'win32',resolveFn:async()=>result});const folder='C:\\work 日本語\\a & %PATH%';await f.manager.launch(folder);assert.deepEqual(f.calls[0].args,['--new-window',folder]);assert.equal(f.calls[0].opts.shell,false);assert.equal(f.calls[0].opts.windowsHide,false);
 }
 assert.equal(await resolveVSCode({platform:'win32',resolveFn:async()=>'C:\\Code\\bin\\code.cmd',statFn:async()=>{throw Error();}}),null);
});
test('authenticated editor endpoint accepts only folder and never calls CLI auto-approval launcher',async t=>{
 const f=fixture(),cli={catalog:async()=>({対象:[]}),launch:()=>{throw Error('must not call CLI');}};
 const server=createServer({token:'fixture',entries:[],cliLauncher:cli,vscodeLauncher:f.manager});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/`,headers={Authorization:'Bearer fixture','Content-Type':'application/json'};
 assert.equal((await fetch(base+'api/VSCode起動/開始',{method:'POST'})).status,401);
 const catalog=await (await fetch(base+'api/CLI起動',{headers})).json();assert.equal(catalog.対象[0].種類,'editor');
 for(const body of [{フォルダ:'/project',自動承認確認:true},{フォルダ:'/project',対象:'code'},{フォルダ:'relative'}])assert.equal((await fetch(base+'api/VSCode起動/開始',{method:'POST',headers,body:JSON.stringify(body)})).status,400);
 assert.equal((await fetch(base+'api/VSCode起動/開始',{method:'POST',headers,body:JSON.stringify({フォルダ:'/project'})})).status,202);assert.equal(f.calls.length,1);
});
test('VS Code SVG and PNG are served as exact generated assets; generated manifest matches',async t=>{
 const {readFile}=await import('node:fs/promises');const {verify}=await import('../ui/verify.mjs');
 assert.equal(await verify(),true);
 const server=createServer({token:'fixture',entries:[]});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 for(const ext of ['svg','png']){
  const response=await fetch(`http://127.0.0.1:${server.address().port}/CLI_vscode.${ext}`);assert.equal(response.status,200);
  const original=await readFile(new URL(`../ui/src/components/アプリ起動/CLIアイコン/vscode.${ext}`,import.meta.url));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);
 }
});

test('VS Code label uses editor blue and white, with matching launcher geometry',async()=>{
 const {readFile}=await import('node:fs/promises');
 const svg=await readFile(new URL('../ui/src/components/アプリ起動/CLIアイコン/vscode.svg',import.meta.url),'utf8');
 assert.match(svg,/viewBox="0 0 120 120"/);assert.match(svg,/x="18" y="3" width="84" height="84"/);
 assert.match(svg,/id="caption-band" x="0" y="90" width="120" height="30" fill="#1e3a5f"/);
 assert.match(svg,/font-size="22" font-weight="700" fill="#ffffff">VS Code<\/text>/);
 const png=await readFile(new URL('../ui/src/components/アプリ起動/CLIアイコン/vscode.png',import.meta.url));assert.equal(png.readUInt32BE(16),120);assert.equal(png.readUInt32BE(20),120);
});

test('GUI process failures after spawn are reported; an existing-window handoff exit=0 succeeds',async()=>{
 for(const code of [1,42,null,0]){
  let unref=false;
  const f=fixture({startupGrace:20,spawnFn(){const c=new EventEmitter();c.unref=()=>{unref=true;};queueMicrotask(()=>{c.emit('spawn');c.emit('exit',code,code===null?'SIGTERM':null);});return c;}});
  if(code===0){assert.equal((await f.manager.launch('/project')).受付,true);assert.equal(unref,true);}
  else {await assert.rejects(f.manager.launch('/project'),/起動直後に終了/);assert.equal(unref,false);}
 }
});
test('real child exiting nonzero after successful OS spawn is not accepted as successful launch',async()=>{
 const {spawn}=await import('node:child_process');
 const f=fixture({startupGrace:2000,spawnFn(_exe,_args,opts){return spawn(process.execPath,['-e','process.exit(23)'],{...opts,cwd:process.cwd()});}});
 await assert.rejects(f.manager.launch('/project'),/終了コード: 23/);
});
