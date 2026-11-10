// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {DIAG_TRANSPORT_BYTE_LIMIT} from '../runtime/transport_limit.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createAppLauncher,アプリタスク,タスク一覧} from '../起動/アプリ起動.mjs';
import {createServer} from '../diag_main.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'diag-app-test-')),project=join(root,'日本語 空白 project');await mkdir(project);
 t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const calls=[],manager=createAppLauncher({chromeInstalled:async()=>true,root,portStatusFn:async()=>({対象:[]}),taskTeamStatus:async()=>({利用可能:false}),pythonCommand:'fixture-python',tasks:async()=>[],spawnFn(command,args,options){
  const child=new EventEmitter();child.unref=()=>{child.unreferenced=true;};calls.push({command,args,options,child});queueMicrotask(()=>child.emit('spawn'));return child;
 }});
 return {root,project:await realpath(project),manager,calls};
}
test('unconfigured channel apps hidden; missing/relative/file/unknown inputs never launch or check tasks',async t=>{
 const f=await fixture(t);let reads=0;
 const manager=createAppLauncher({chromeInstalled:async()=>true,root:f.root,portStatusFn:async()=>({対象:[]}),taskTeamStatus:async()=>({利用可能:false}),tasks:async()=>{reads++;return [];}});
 assert.deepEqual((await manager.catalog()).対象.map(x=>x.id),['avatar','task','team','ide','cpu','navi','console','code','live','chrome','browser']);
 for(const id of ['cpu','avatar','ide','console','code','live','discord'])for(const path of ['',undefined,'relative',join(f.root,'missing')])await assert.rejects(manager.launch(id,path),{status:400});
 await writeFile(join(f.root,'file'),'x');await assert.rejects(manager.launch('avatar',join(f.root,'file')),{status:400});
 await assert.rejects(manager.launch('arbitrary-command',f.project),{status:400});assert.equal(reads,0);
});
test('project argument/cwd remain exact; Avatar retains app base; detached logs and no IPC ownership',async t=>{
 const f=await fixture(t);
 for(const id of ['cpu','avatar','ide','console','code','live','discord']){
  assert.equal((await f.manager.launch(id,f.project)).受付,true);
  const call=f.calls.at(-1);assert.equal(call.options.cwd,id==='avatar'?f.root:f.project);
  assert.equal(call.options.detached,true);assert.equal(call.options.shell,false);assert.equal(call.options.windowsHide,true);assert.equal(call.options.stdio[0],'ignore');assert.equal(call.options.stdio.includes('ipc'),false);assert.equal(call.child.unreferenced,true);
  if(id==='discord')assert.equal(call.args[0],join(f.root,'frontend_channels','discord','panel','launch.mjs'));
  if(id==='avatar'){assert.equal(call.command,process.execPath);assert.equal(call.args.at(-1),join(f.root,'frontend_avatar','launch.mjs'));}
  else {assert.equal(call.args[call.args.indexOf('--project')+1],f.project);assert.equal(call.args.includes('--new-window'),['cpu','ide','console','code'].includes(id));}
 }
 assert.equal(f.calls.length,7);
});
test('singleton checks run only on click, block existing tasks, permit IDE/Console/Code repeats and serialize races',async t=>{
 const f=await fixture(t);let reads=0,calls=0,release;
 const tasks=[{command:'python "C:/AiDiy/frontend_avatar/_start.py"'},{command:'electron "C:/AiDiy/frontend_ide/desktop.cjs" --app live'},{command:'node "/a/frontend_channels/discord/src/web-server.ts"'}];
 const manager=createAppLauncher({chromeInstalled:async()=>true,root:f.root,portStatusFn:async()=>({対象:[]}),taskTeamStatus:async()=>({利用可能:false}),tasks:async()=>{reads++;return tasks;},spawnFn(){calls++;throw Error();}});
 manager.catalog();assert.equal(reads,0);
 for(const id of ['avatar','live','discord'])assert.equal((await manager.launch(id,f.project)).起動済み,true);
 assert.equal(calls,0);assert.equal(reads,3);
 const racing=createAppLauncher({chromeInstalled:async()=>true,tasks:()=>new Promise(resolve=>{release=resolve;})});
 const one=racing.launch('live',f.project);while(!release)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(racing.launch('live',f.project),{status:409});release(tasks);await one;
 for(const id of ['ide','console','code']){await f.manager.launch(id,f.project);await f.manager.launch(id,f.project);}
 assert.equal(f.calls.length,6);assert.equal(reads,3);
});
test('Windows/macOS/Linux task entries and legacy Live match without matching other apps or tests',()=>{
 for(const command of ['python "C:\\work space\\frontend_avatar\\_start.py"','/usr/bin/python3 /home/x/frontend_avatar/_start.py','/Applications/Electron.app/Contents/MacOS/Electron /work/frontend_avatar/dist-electron/main.js'])assert.equal(アプリタスク('avatar',{command}),true,command);
 for(const command of ['electron "C:\\x\\frontend_ide\\desktop.cjs" --app live','node /work/frontend_ide/launch.mjs --app live --project /tmp/a','node /work/frontend_ide/host/aidiy_live/launch.mjs'])assert.equal(アプリタスク('live',{command}),true,command);
 for(const command of ['electron /work/frontend_channels/discord/panel/desktop.cjs','node --import /loader.mjs /work/frontend_channels/discord/src/web-server.ts'])assert.equal(アプリタスク('discord',{command}),true,command);
 for(const command of ['electron /work/frontend_ide/desktop.cjs --app code','node --test /work/frontend_ide/host/aidiy_live/launch.mjs','node -e "frontend_avatar/_start.py"','editor /work/project.txt'])for(const id of ['avatar','live','discord'])assert.equal(アプリタスク(id,{command}),false,command);
});
test('task lookup failure fails closed and releases pending state',async t=>{
 const f=await fixture(t);let reads=0;
 const m=createAppLauncher({chromeInstalled:async()=>true,tasks:async()=>{reads++;throw Error('private process data');}});
 for(let i=0;i<2;i++)await assert.rejects(m.launch('live',f.project),error=>error.status===503&&!error.message.includes('private'));
 assert.equal(reads,2);
});
test('folder browser returns real directories and parent without file contents',async t=>{
 const f=await fixture(t);await mkdir(join(f.project,'子フォルダ'));await writeFile(join(f.project,'file.txt'),'not returned');
 const data=await f.manager.folders(f.project);assert.equal(data.フォルダ,f.project);assert.equal(data.親,f.root);assert.deepEqual(data.子フォルダ,[{名前:'子フォルダ',パス:join(f.project,'子フォルダ')}]);
});
test('empty folder browser starts at the AiDiy root, without home fallback',async t=>{
 const f=await fixture(t);
 for(const value of ['',undefined])assert.equal((await f.manager.folders(value)).フォルダ,await realpath(f.root));
 await assert.rejects(f.manager.folders('relative'),{status:400});
});
test('real task lookup can run without starting any app',async()=>{const tasks=await タスク一覧();assert.ok(Array.isArray(tasks));assert.ok(tasks.every(item=>Number.isInteger(item.pid)&&typeof item.command==='string'));});
test('authenticated API rejects arbitrary commands/methods/oversized payloads',async t=>{
 const f=await fixture(t),server=createServer({token:'fixture',appLauncher:f.manager,modelTrials:{close(){}},startManager:{close(){}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}/`,headers={Authorization:'Bearer fixture','Content-Type':'application/json'};
 assert.equal((await fetch(base+'api/アプリ起動')).status,401);
 assert.equal((await fetch(base+'api/アプリ起動',{headers})).status,200);
 for(const id of ['cpu','avatar','ide','console','code','live','discord']){
  const response=await fetch(base+`AiDiy_${id}.png`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(new URL(`../ui/src/components/アプリ起動/アイコン/AiDiy_${id}.png`,import.meta.url)));
 }
 assert.equal((await fetch(base+'AiDiy_unknown.png')).status,404);
 for(const [body,status] of [[{対象:'console',フォルダ:f.project,command:'bad'},400],[{対象:'bad',フォルダ:f.project},400],[{対象:'avatar',フォルダ:''},400],[{対象:'console',フォルダ:'x'.repeat(DIAG_TRANSPORT_BYTE_LIMIT+1)},413]])assert.equal((await fetch(base+'api/アプリ起動/開始',{method:'POST',headers,body:JSON.stringify(body)})).status,status);
 assert.equal((await fetch(base+'api/アプリ起動/開始',{headers})).status,404);
 const response=await fetch(base+'api/アプリ起動/開始',{method:'POST',headers,body:JSON.stringify({対象:'console',フォルダ:f.project})});assert.equal(response.status,202);assert.equal(f.calls.length,1);
});
test('real detached app survives Diag server shutdown and inherits chosen cwd',async t=>{
 const f=await fixture(t);await mkdir(join(f.root,'frontend_ide'));const marker=join(f.root,'alive.json');
 await writeFile(join(f.root,'frontend_ide','launch.mjs'),`import{writeFileSync}from'node:fs';setInterval(()=>writeFileSync(${JSON.stringify(marker)},JSON.stringify({cwd:process.cwd(),pid:process.pid,time:Date.now()})),50);`);
 let child;const manager=createAppLauncher({chromeInstalled:async()=>true,root:f.root,spawnFn:(...args)=>(child=spawn(...args))});
 const server=createServer({token:'fixture',appLauncher:manager,modelTrials:{close(){}},startManager:{close(){}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await manager.launch('console',f.project);for(let i=0;i<100;i++){try{await readFile(marker);break;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
  const before=JSON.parse(await readFile(marker,'utf8'));await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>setTimeout(resolve,150));
  const after=JSON.parse(await readFile(marker,'utf8'));assert.equal(after.cwd,f.project);assert.equal(after.pid,child.pid);assert.ok(after.time>before.time);
 }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));if(child?.exitCode===null){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}}
});

test('catalog copies CODE_BASE_PATH including ../ without modifying config or launching apps',async t=>{
 const f=await fixture(t);await mkdir(join(f.root,'_config'));
 const filename=join(f.root,'_config','AiDiy_key.json');
 const manager=createAppLauncher({chromeInstalled:async()=>true,root:f.root,taskTeamStatus:async()=>({利用可能:false}),spawnFn(){throw Error('must not launch');}});
 assert.equal((await manager.catalog()).フォルダ,'');
 for(const value of [undefined,null,42,{},[],false,'','   ','../',' ../ ',f.project,'C:\\日本語 空白\\project','../other-project']){
  const raw='\uFEFF'+JSON.stringify({CODE_BASE_PATH:value,openai_key_id:'synthetic-private-key',OTHER:'private'});
  await writeFile(filename,raw);const data=await manager.catalog();
  assert.deepEqual(Object.keys(data).sort(),['対象','フォルダ','起動フォルダ'].sort());
  assert.equal(data.フォルダ,typeof value==='string'?value:'');
  assert.ok(!JSON.stringify(data).includes('private'));
  assert.equal(await readFile(filename,'utf8'),raw);
 }
 for(const raw of ['{invalid','null','[]']){await writeFile(filename,raw);assert.equal((await manager.catalog()).フォルダ,'');assert.equal(await readFile(filename,'utf8'),raw);}
 assert.equal(f.calls.length,0);
});

test('configured ../ and relative folders resolve against backend_server for validated app launch',async t=>{
 const f=await fixture(t);await mkdir(join(f.root,'_config'));
 const config=join(f.root,'_config','AiDiy_key.json');
 for(const [configured,expected] of [['../',await realpath(f.root)],['..\\',await realpath(f.root)],['../日本語 空白 project',f.project],[f.project,f.project]]){
  await writeFile(config,JSON.stringify({CODE_BASE_PATH:configured}));
  const data=await f.manager.catalog();assert.equal(data.フォルダ,configured);assert.equal(data.起動フォルダ,expected);
  await f.manager.launch('code',data.起動フォルダ);assert.equal(f.calls.at(-1).options.cwd,expected);
 }
 for(const configured of ['', '   ', 'C:relative', 'bad\0path', 'bad\npath', '../\n', 'x'.repeat(4097)]){
  await writeFile(config,JSON.stringify({CODE_BASE_PATH:configured}));const data=await f.manager.catalog();
  assert.equal(data.フォルダ,configured);assert.equal(data.起動フォルダ,'');await assert.rejects(f.manager.launch('code',data.起動フォルダ),{status:400});
 }
 await writeFile(config,JSON.stringify({CODE_BASE_PATH:'../deleted-project'}));
 await assert.rejects(f.manager.launch('code',(await f.manager.catalog()).起動フォルダ),{status:400});
 // 任意のAPI相対入力を許可する変更ではない。
 await assert.rejects(f.manager.launch('code','../'),{status:400});
});

test('Navi is before Console and launches only selected project in a separate window',async t=>{
 const {起動項目を整列,アプリアイコン}=await import('../ui/src/components/アプリ起動/アプリアイコン.mjs');const f=await fixture(t);
 const items=起動項目を整列((await f.manager.catalog()).対象);assert.equal(items.findIndex(x=>x.id==='navi')+1,items.findIndex(x=>x.id==='console'));assert.equal(items.find(x=>x.id==='navi').名前,'Navi');assert.equal(アプリアイコン.navi,'AiDiy_navi.png');
 await f.manager.launch('navi',f.project);assert.deepEqual(f.calls[0].args,[join(f.root,'frontend_ide','launch.mjs'),'--app','navi','--project',f.project,'--new-window']);assert.equal(f.calls[0].options.cwd,f.project);
});

test('Discord detection uses its sibling directory on Windows and POSIX',()=>{
 for(const command of ['node /repo/frontend_channels/discord/panel/launch.mjs','node C:\\repo\\frontend_channels\\discord\\src\\web-server.ts'])assert.equal(アプリタスク('discord',{command}),true,command);
 for(const command of ['node /repo/frontend_channels/slack/panel/launch.mjs','node /repo/frontend_channels/panel/launch.mjs','node /repo/frontend_channels/discord-other/panel/launch.mjs'])assert.equal(アプリタスク('discord',{command}),false,command);
});

test('CPU launches without Core/Tools and has a fixed first-party icon',async t=>{
 const f=await fixture(t),catalog=await f.manager.catalog();const cpu=catalog.対象.find(item=>item.id==='cpu');assert.equal(cpu.名前,'CPU');assert.notEqual(cpu.利用可能,false);
 await f.manager.launch('cpu',f.project);assert.deepEqual(f.calls[0].args.slice(1),['--app','cpu','--project',f.project,'--new-window']);assert.equal(f.calls[0].options.shell,false);
 const {アプリアイコン,起動項目を整列}=await import('../ui/src/components/アプリ起動/アプリアイコン.mjs');assert.equal(アプリアイコン.cpu,'AiDiy_cpu.png');const ids=起動項目を整列(catalog.対象).map(x=>x.id);assert.equal(ids.indexOf('ide')+1,ids.indexOf('cpu'));
});
