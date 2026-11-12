// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {createAppLauncher,アプリタスク} from '../起動/アプリ起動.mjs';
import {アプリ状態を作成} from '../ui/src/components/アプリ起動/アプリ状態.mjs';
const {render,dependency}=createRequire(import.meta.url)('./ui-components.cjs');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'diag-slack-launch-')),project=join(root,'日本語 project'),entry=join(root,'frontend_channels/slack/panel/launch.mjs');await mkdir(project);
 await mkdir(join(root,'_config'));await writeFile(join(root,'_config','AiDiy_key.json'),JSON.stringify({discord_bot_token:'fixture-discord',slack_bot_token:'fixture-slack'}));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const calls=[],tasks=[];let release,taskReads=0,hold=false;
 const manager=createAppLauncher({chromeInstalled:async()=>true,root,node:'fixture-node',portStatusFn:async()=>({対象:[]}),taskTeamStatus:async()=>({利用可能:false}),tasks:async()=>{taskReads++;return tasks;},spawnFn(command,args,options){const child=new EventEmitter();child.unref=()=>{};calls.push({command,args,options});release=()=>child.emit('spawn');if(!hold)queueMicrotask(release);return child;}});
 return {root,project,entry,manager,calls,tasks,taskReads:()=>taskReads,install:async()=>{await mkdir(join(root,'frontend_channels/slack/panel'),{recursive:true});await writeFile(entry,'// fixture only; never executed\n');},hold:()=>hold=true,release:()=>release()};
}
test('configured Slack catalog follows Discord; absent or non-file entry stays visible, unavailable and never launches',async t=>{
 const f=await fixture(t);let list=(await f.manager.catalog()).対象;
 assert.equal(list[list.findIndex(x=>x.id==='discord')+1].id,'slack');
 const row=list.find(x=>x.id==='slack');assert.equal(row.名前,'Slack');assert.equal(row.利用可能,false);assert.equal(row.無効表示,'未導入');assert.doesNotMatch(row.無効理由,/準備中/);
 for(let i=0;i<2;i++)await assert.rejects(f.manager.launch('slack',f.project),{status:503});
 assert.equal(f.calls.length,0);assert.equal(f.taskReads(),0);await assert.rejects(stat(join(f.root,'temp')),e=>e.code==='ENOENT');
 await mkdir(f.entry,{recursive:true});assert.equal((await f.manager.catalog()).対象.find(x=>x.id==='slack').利用可能,false);await assert.rejects(f.manager.launch('slack',f.project),{status:503});
});
test('Slack fixed installed entry passes exact project argv, keeps Discord separate and rechecks missing entry',async t=>{
 const f=await fixture(t);await f.install();assert.equal((await f.manager.catalog()).対象.find(x=>x.id==='slack').利用可能,true);
 f.tasks.push({command:'node /repo/frontend_channels/discord/panel/launch.mjs'});
 assert.equal((await f.manager.launch('slack',f.project)).受付,true);assert.equal(f.calls.length,1);
 const call=f.calls[0];assert.equal(call.command,'fixture-node');assert.deepEqual(call.args,[f.entry,'--project',f.project]);assert.equal(call.options.cwd,f.project);assert.equal(call.options.shell,false);assert.equal(call.options.detached,true);
 f.tasks.push({command:'node '+f.entry});assert.equal((await f.manager.launch('slack',f.project)).起動済み,true);assert.equal(f.calls.length,1);
 await rm(f.entry);await assert.rejects(f.manager.launch('slack',f.project),{status:503});assert.equal(f.calls.length,1);
});
test('Slack launch serializes repeated clicks and releases pending state',async t=>{
 const f=await fixture(t);await f.install();f.hold();const first=f.manager.launch('slack',f.project);
 while(!f.calls.length)await new Promise(r=>setImmediate(r));
 await assert.rejects(f.manager.launch('slack',f.project),{status:409});f.release();await first;
 const second=f.manager.launch('slack',f.project);while(f.calls.length<2)await new Promise(r=>setImmediate(r));f.release();await second;
});
test('Slack process matching is module-local and does not match Discord, command text or tests',()=>{
 for(const command of ['node C:\\repo\\frontend_channels\\slack\\panel\\launch.mjs --project C:\\work','electron /repo/frontend_channels/slack/panel/desktop.cjs','node --import loader /repo/frontend_channels/slack/src/web-server.ts'])assert.equal(アプリタスク('slack',{command}),true,command);
 for(const command of ['node /repo/frontend_channels/discord/panel/launch.mjs','node /repo/frontend_channels/discord/src/main.ts','node -e "frontend_channels/slack/panel/launch.mjs"','node --test /repo/frontend_channels/slack/panel/launch.mjs'])assert.equal(アプリタスク('slack',{command}),false,command);
 assert.equal(アプリタスク('discord',{command:'node /repo/frontend_channels/slack/panel/launch.mjs'}),false);
});
test('normal keeps unavailable Slack disabled; mini hides it and orders available Slack after Discord',async()=>{
 const rows=[{id:'cpu',名前:'CPU'},{id:'chrome',名前:'Chrome'},{id:'slack',名前:'Slack',単一起動:true,利用可能:false,無効表示:'未導入'},{id:'discord',名前:'Discord'}];
 const {起動項目を整列}=dependency('components/アプリ起動/アプリアイコン.mjs');assert.deepEqual(Array.from(起動項目を整列(rows),x=>x.id),['cpu','discord','slack','chrome']);
 const ref=value=>({value}),state={項目:ref(rows),フォルダ:ref('/work'),処理中:ref(''),選択中:ref(false),通知:ref(''),結果:ref({}),一覧:ref(null),利用可能:id=>id!=='slack',不可理由:id=>id==='slack'?'Slack の起動ファイルが見つかりません。':'',読込(){},起動(){assert.fail('render must not launch');}};
 for(const name of ['アプリ起動パネル.vue','ミニアプリ起動.vue']){
  if(name.startsWith('ミニ')){
   const hidden=await render('components/アプリ起動/'+name,{state,online:true});assert.doesNotMatch(hidden,/data-app="slack"/);
   const available={...state,利用可能:()=>true,不可理由:()=>''};
   const visible=await render('components/アプリ起動/'+name,{state:available,online:true});
   assert.ok(visible.indexOf('data-app="discord"')<visible.indexOf('data-app="slack"'));assert.match(visible,/src="AiDiy_slack.png"/);assert.ok(visible.indexOf('data-app="cpu"')<visible.indexOf('data-app="discord"'));
   continue;
  }
  const html=await render('components/アプリ起動/'+name,{state,online:true});assert.ok(html.indexOf('data-app="discord"')<html.indexOf('data-app="slack"'));assert.match(html,/src="AiDiy_slack.png"/);assert.ok(html.indexOf('data-app="cpu"')<html.indexOf('data-app="discord"'));assert.doesNotMatch(html,/準備中|frontend_channels|接続済み/);
  const slack=html.slice(html.indexOf('data-app="slack"'));assert.match(slack.split('</button>')[0],/disabled/);if(name.startsWith('アプリ'))assert.match(slack,/未導入/);
 }
});
test('Slack UI never launches unavailable or stale entries; error and authentication reset remain fail-closed',async()=>{
 const calls=[];let fail=false;const state=アプリ状態を作成({api:async(url)=>{calls.push(url);if(fail)throw Error('fixture expired');return {対象:[{id:'slack',利用可能:true}],フォルダ:'/work'};},schedule:()=>1,unschedule(){}});
 assert.equal(state.利用可能('slack'),false);state.フォルダ.value='/work';await state.起動('slack');assert.equal(calls.length,0);
 await state.読込();assert.equal(state.利用可能('slack'),true);state.接続(true);await new Promise(r=>setImmediate(r));state.接続(false);assert.equal(state.利用可能('slack'),false);await state.起動('slack');assert.ok(!calls.some(x=>x.endsWith('/開始')));
 fail=true;await state.読込();assert.equal(state.利用可能('slack'),false);assert.equal(state.項目.value[0].無効表示,'確認不可');state.終了();
});

test('Slack launch API keeps authentication and fixed payload gates; missing entry returns 503, not acceptance',async t=>{
 const f=await fixture(t),{createHandler}=await import('../diag_main.mjs'),{Readable}=await import('node:stream');
 const handler=createHandler({token:'fixture',appLauncher:f.manager});
 const request=async({auth='Bearer fixture',method='POST',body={対象:'slack',フォルダ:f.project},url='/api/アプリ起動/開始'}={})=>{
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url,method,headers:{authorization:auth,'content-type':'application/json'}});
  const res={status:0,writeHead(status){this.status=status;},end(value){this.body=JSON.parse(value);}};await handler(req,res);return res;
 };
 try{
  assert.equal((await request({auth:''})).status,401);assert.equal((await request({method:'GET'})).status,404);assert.equal((await request({body:{対象:'slack',フォルダ:f.project,command:'other'}})).status,400);
  const result=await request();assert.equal(result.status,503);assert.match(result.body.エラー,/起動ファイル/);assert.equal(result.body.受付,undefined);assert.equal(f.calls.length,0);assert.equal(f.taskReads(),0);
 }finally{await handler.close();}
});
