// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCliLauncher} from '../diag/起動/CLI起動.mjs';
import {createServer} from '../diag/diag_main.mjs';
import {DIAG_TRANSPORT_BYTE_LIMIT} from '../runtime/transport_limit.mjs';
const ids=['claude','codex','copilot','agy','grok','opencode','aidiy_hermes','aidiy_pi'];
async function fixture(t,options={}){
 const root=await mkdtemp(join(tmpdir(),'diag-cli-fixture-')),project=join(root,`日本語 project ' & $ % ;`);await mkdir(project);
 t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5}));
 const calls=[],resolved=[];
 const manager=createCliLauncher({root,resolveCli:async(id,value)=>{resolved.push({id,value});if(options.missing===id)throw Error('private path');return {executable:'/fixture/'+id};},spawnFn(command,args,opts){
  const child=new EventEmitter();child.connected=true;child.disconnect=()=>{child.connected=false;};child.kill=()=>{child.killed=true;};child.unref=()=>{};
  calls.push({command,args,opts,child});if(!options.pending)queueMicrotask(()=>child.emit('message',options.error?{launchError:'sensitive internal error'}:{launchReady:true}));return child;
 },timeout:options.timeout??500});
 return {root,project,calls,resolved,manager};
}
test('CLI catalog is fixed; availability uses resolver only, no process execution',async t=>{
 const f=await fixture(t,{missing:'grok'}),result=await f.manager.catalog();assert.deepEqual(result.対象.map(x=>x.id),ids);assert.equal(result.対象.find(x=>x.id==='grok').利用可能,false);assert.equal(f.calls.length,0);assert.equal(f.resolved.length,ids.length);assert.ok(f.resolved.every(x=>x.value.autoApprove===true));assert.doesNotMatch(JSON.stringify(result),/executable|private path/);
});
test('all CLI launches pass only fixed id, approval, and exact cwd; omit models and shell strings',async t=>{
 const f=await fixture(t);
 for(const id of ids){const result=await f.manager.launch(id,f.project,true);assert.equal(result.受付,true);assert.equal(result.通知,'');const c=f.calls.at(-1);assert.equal(c.opts.cwd,f.project);assert.equal(c.opts.shell,false);assert.equal(c.opts.detached,true);assert.equal(c.opts.env.AIDIY_LAUNCHER_CHILD,'1');assert.deepEqual(c.args,[join(f.root,'frontend_ide','launch.mjs'),'--app','console','--project',f.project,'--new-window','--cli',id,'--cli-auto-approve','--foreground']);assert.equal(c.opts.stdio.at(-1),'ipc');assert.equal(c.child.connected,false);assert.doesNotMatch(c.args.join(' '),/--model|--provider|--prompt/);}
});
test('invalid ids, unconfirmed mode, missing project and missing executable never spawn',async t=>{
 const f=await fixture(t,{missing:'grok'});
 for(const [id,path,approved,status] of [['injected;sh',f.project,true,400],['copilot',f.project,false,400],['copilot',f.project,'true',400],['copilot','',true,400],['copilot','relative',true,400],['copilot',join(f.root,'missing'),true,400],['copilot',f.project+'\n',true,400],['grok',f.project,true,503]])await assert.rejects(f.manager.launch(id,path,approved),{status});
 assert.equal(f.calls.length,0);
});
test('every CLI including Hermes opens independent windows for repeated and concurrent same-project requests',async t=>{
 for(const id of ids){
  const f=await fixture(t,{pending:true});
  const first=f.manager.launch(id,f.project,true),second=f.manager.launch(id,f.project,true);
  while(f.calls.length<2)await new Promise(resolve=>setImmediate(resolve));
  assert.notEqual(f.calls[0].child,f.calls[1].child);
  f.calls[1].child.emit('message',{launchReady:true});f.calls[0].child.emit('message',{launchReady:true});
  const results=await Promise.all([first,second]);
  const third=f.manager.launch(id,f.project,true);
  while(f.calls.length<3)await new Promise(resolve=>setImmediate(resolve));
  f.calls[2].child.emit('message',{launchReady:true});results.push(await third);
  assert.ok(results.every(result=>result.受付===true&&!result.起動済み));
  assert.equal(new Set(results.map(result=>result.ログ)).size,3);
  assert.ok(f.calls.every(call=>call.args.includes('--new-window')&&!call.child.killed));
  f.calls[0].child.emit('exit',0);
  assert.ok(f.calls.slice(1).every(call=>!call.child.killed));
  assert.ok(f.calls.every(call=>call.child.listenerCount('exit')===0&&call.child.listenerCount('message')===0),'successful windows are owned by Console, not tracked by CLI/project');
 }
});
test('one concurrent startup failure kills only its own unfinished child and leaves the other launch usable',async t=>{
 const f=await fixture(t,{pending:true});
 const first=f.manager.launch('aidiy_hermes',f.project,true);
 const failed=assert.rejects(first,{status:503});
 while(!f.calls.length)await new Promise(resolve=>setImmediate(resolve));
 const second=f.manager.launch('aidiy_hermes',f.project,true);
 while(f.calls.length<2)await new Promise(resolve=>setImmediate(resolve));
 f.calls[0].child.emit('message',{launchError:'fixture error'});
 f.calls[1].child.emit('message',{launchReady:true});
 await failed;assert.equal((await second).受付,true);
 assert.equal(f.calls[0].child.killed,true);assert.equal(f.calls[1].child.killed,undefined);
});
test('real IPC launchers keep separate processes and ports; closing one owner or Diag does not stop the other', {timeout:10000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'diag-cli-process-')),project=join(root,'日本語 project &'),children=[];
 await mkdir(project);await mkdir(join(root,'frontend_ide'));
 await writeFile(join(root,'frontend_ide','launch.mjs'),`
  import {createServer} from 'node:http';
  const server=createServer((req,res)=>{
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify({pid:process.pid,cwd:process.cwd(),args:process.argv.slice(2)}));
   if(req.url==='/close')server.close(()=>process.exit(0));
  });
  process.on('disconnect',()=>{}); // 表示完了後はConsole自身がサーバーを所有する。
  process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
  server.listen(0,'127.0.0.1',()=>process.send({launchReady:true,url:'http://127.0.0.1:'+server.address().port}));
 `,'utf8');
 t.after(async()=>{
  await Promise.all(children.map(async record=>{
   if(record.child.exitCode!==null||record.child.signalCode)return;
   const exit=new Promise(resolve=>record.child.once('exit',resolve));record.child.kill();await exit;
  }));
  await rm(root,{recursive:true,force:true,maxRetries:5});
 });
 const manager=createCliLauncher({root,resolveCli:async()=>({}),timeout:5000,spawnFn(...args){
  const child=spawn(...args),record={child};children.push(record);
  child.on('message',message=>{if(message.launchReady)record.url=message.url;});
  return child;
 }});
 const server=createServer({token:'fixture',cliLauncher:manager,modelTrials:{close(){}},startManager:{close(){}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 const launch=()=>fetch(base+'/api/CLI起動/開始',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({対象:'aidiy_hermes',フォルダ:project,自動承認確認:true})});
 const responses=await Promise.all([launch(),launch()]);assert.ok(responses.every(response=>response.status===202));
 assert.equal(children.length,2);assert.notEqual(children[0].child.pid,children[1].child.pid);assert.notEqual(children[0].url,children[1].url);
 const inspect=record=>fetch(record.url,{signal:AbortSignal.timeout(1000)}).then(response=>response.json());
 for(const record of children){const info=await inspect(record);assert.equal(info.cwd,project);assert.ok(info.args.includes('--new-window'));assert.equal(record.child.connected,false);}
 // DiagのHTTP待受と終了処理は、完了済みのCLI起動の所有者ではない。
 await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 for(const record of children)assert.equal((await inspect(record)).pid,record.child.pid);
 const firstExit=new Promise(resolve=>children[0].child.once('exit',resolve));
 await fetch(children[0].url+'/close');await firstExit;
 await assert.rejects(inspect(children[0]));assert.equal((await inspect(children[1])).pid,children[1].child.pid);
 const secondExit=new Promise(resolve=>children[1].child.once('exit',resolve));
 await fetch(children[1].url+'/close');await secondExit;
 await assert.rejects(inspect(children[1]));
});
test('startup errors and timeout fail closed, kill unfinished child and permit retry',async t=>{
 for(const options of [{error:true},{pending:true,timeout:5}]){
  const f=await fixture(t,options);for(let i=0;i<2;i++)await assert.rejects(f.manager.launch('codex',f.project,true),error=>[503,504].includes(error.status)&&!error.message.includes('sensitive'));
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(x=>x.child.killed));
 }
});
test('authenticated CLI API limits body fields, confirmation, asset names and methods',async t=>{
 const f=await fixture(t);const server=createServer({token:'fixture',cliLauncher:f.manager,modelTrials:{close(){}},startManager:{close(){}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}/`,headers={Authorization:'Bearer fixture','Content-Type':'application/json'};
 assert.equal((await fetch(base+'api/CLI起動')).status,401);assert.equal((await fetch(base+'api/CLI起動',{headers})).status,200);
 for(const id of ids){const response=await fetch(base+`CLI_${id}.png`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(new URL(`../diag/ui/components/アプリ起動/CLIアイコン/${id}.png`,import.meta.url)));}
 for(const id of ids.filter(id=>!['aidiy_hermes','aidiy_pi'].includes(id))){const response=await fetch(base+`CLI_${id}.svg`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/svg+xml');assert.equal(await response.text(),await readFile(new URL(`../diag/ui/components/アプリ起動/CLIアイコン/${id}.svg`,import.meta.url),'utf8'));}
 for(const name of ['LICENSE-Octicons.txt','LICENSE-LobeHub.txt','LICENSE-OpenCode.txt']){const license=await fetch(base+name);assert.equal(license.status,200);assert.equal(license.headers.get('content-type'),'text/plain; charset=utf-8');assert.equal(await license.text(),await readFile(new URL('../diag/ui/components/アプリ起動/CLIアイコン/'+name,import.meta.url),'utf8'));}
 const citations=await fetch(base+'LICENSE_ICONS.md');assert.equal(citations.status,200);assert.equal((await citations.text()).replace(/\r\n/g,'\n'),(await readFile(new URL('../diag/ui/components/アプリ起動/CLIアイコン/LICENSE_ICONS.md',import.meta.url),'utf8')).replace(/\r\n/g,'\n'));
 assert.equal((await fetch(base+'CLI_bad.png')).status,404);
 assert.equal((await fetch(base+'CLI_bad.svg')).status,404);
 for(const id of ['aidiy_hermes','aidiy_pi'])assert.equal((await fetch(base+`CLI_${id}.svg`)).status,404);
 for(const [body,status] of [[{対象:'copilot',フォルダ:f.project},400],[{対象:'copilot',フォルダ:f.project,自動承認確認:true,model:'bad'},400],[{対象:'copilot',フォルダ:'x'.repeat(9000),自動承認確認:true},400],[{対象:'copilot',フォルダ:'x'.repeat(DIAG_TRANSPORT_BYTE_LIMIT),自動承認確認:true},413]])assert.equal((await fetch(base+'api/CLI起動/開始',{method:'POST',headers,body:JSON.stringify(body)})).status,status);
 assert.equal((await fetch(base+'api/CLI起動/開始',{headers})).status,404);assert.equal(f.calls.length,0);
 assert.equal((await fetch(base+'api/CLI起動/開始',{method:'POST',headers,body:JSON.stringify({対象:'copilot',フォルダ:f.project,自動承認確認:true})})).status,202);assert.equal(f.calls.length,1);
 const repeated=await Promise.all(Array.from({length:3},()=>fetch(base+'api/CLI起動/開始',{method:'POST',headers,body:JSON.stringify({対象:'copilot',フォルダ:f.project,自動承認確認:true})})));
 assert.ok(repeated.every(response=>response.status===202));assert.equal(f.calls.length,4);
});

test('missing optional Console files do not prevent Diag construction and fail only on CLI use',async()=>{
 let loads=0;const manager=createCliLauncher({loadDefinitions:async()=>{loads++;throw Error('private missing module path');}});assert.equal(loads,0);
 await assert.rejects(manager.catalog(),error=>error.status===503&&!error.message.includes('private'));assert.equal(loads,1);
});
test('missing shared CLI module returns safe actionable 503 through authenticated API',async t=>{
 const server=createServer({token:'fixture',cliLauncher:createCliLauncher({loadDefinitions:async()=>{throw Error('private filepath');}}),modelTrials:{close(){}},startManager:{close(){}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/CLI起動`,{headers:{Authorization:'Bearer fixture'}});assert.equal(response.status,503);const body=await response.json();assert.match(body.エラー,/frontend_ide/);assert.doesNotMatch(body.エラー,/private/);
});


test('Copilot SVG includes its white caption band while preserving Octicons path geometry and MIT notice',async()=>{
 const iconRoot=new URL('../diag/ui/components/アプリ起動/CLIアイコン/',import.meta.url);
 const source=await readFile(new URL('upstream/copilot-24.svg',iconRoot),'utf8'),display=await readFile(new URL('copilot.svg',iconRoot),'utf8');
 const paths=value=>[...value.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(item=>item[1]);assert.equal(paths(source).length,2);assert.deepEqual(paths(display),paths(source));assert.match(display,/<svg[^>]*viewBox="0 0 24 24"[^>]*id="brandmark"/);assert.match(display,/<text[^>]*fill="#000000"[^>]*>Copilot<\/text>/);assert.doesNotMatch(display,/<script|<image|href=/i);
 const license=await readFile(new URL('LICENSE-Octicons.txt',iconRoot),'utf8');assert.match(license,/Copyright \(c\) 2026 GitHub Inc\./);assert.match(license,/Permission is hereby granted/);assert.match(license,/THE SOFTWARE IS PROVIDED "AS IS"/);
});


test('外部CLI SVGの形状・色を維持し、Hermesはlocal PNGのみ配布する',async()=>{
 const root=new URL('../diag/ui/components/アプリ起動/CLIアイコン/',import.meta.url),text=async path=>(await readFile(new URL(path,root),'utf8')).replace(/\r\n/g,'\n');
 const paths=value=>[...value.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(item=>item[1]);
 for(const [id,filename] of [['claude','claude-code-color-lobe.svg'],['codex','codex-devicons.svg'],['grok','Grok_Logomark_Light.svg'],['opencode','opencode-logo-dark-square.svg']]){
  const original=await text('upstream/'+filename),display=await text(id+'.svg');assert.deepEqual(paths(display),paths(original),id);
  for(const [,fill] of original.matchAll(/\bfill="([^"]+)"/g))assert.ok(display.includes(`fill="${fill}"`),id+' preserves '+fill);
  assert.ok(display.includes('viewBox="'+original.match(/viewBox="([^"]+)"/)[1]+'"'),id+' preserves its original viewport');
 }
 for(const [id,label] of Object.entries({claude:'Claude',codex:'Codex',copilot:'Copilot',agy:'Antigravity',grok:'Grok',opencode:'OpenCode'})){
  const svg=await text(id+'.svg');assert.match(svg,/width="120" height="120" viewBox="0 0 120 120"/);
  assert.match(svg,/<rect id="caption-band" x="0" y="90" width="120" height="30" fill="#ffffff"/);
  assert.match(svg,new RegExp('<text[^>]*id="caption-label"[^>]*fill="#000000"[^>]*>'+label+'<\\/text>'));
  assert.doesNotMatch(svg,/<script|<foreignObject|\b(?:href|xlink:href)="(?!data:image\/png;base64,)/i);
  const png=await readFile(new URL(id+'.png',root));assert.equal(png.readUInt32BE(16),120);assert.equal(png.readUInt32BE(20),120);
 }
 for(const id of ['aidiy_hermes','aidiy_pi']){const png=await readFile(new URL(id+'.png',root));assert.equal(png.readUInt32BE(16),120);assert.equal(png.readUInt32BE(20),120);await assert.rejects(readFile(new URL(id+'.svg',root)),{code:'ENOENT'});}
 const notes=await text('LICENSE_ICONS.md');for(const label of ['Copilot','Claude','Codex','Grok','OpenCode','aidiy_hermes','aidiy_pi','LobeHub'])assert.ok(notes.includes(label),label);assert.doesNotMatch(notes,/取得・確認待ち|独自仮ピクトグラム/);
});
