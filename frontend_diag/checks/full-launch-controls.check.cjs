// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');
const assert=require('node:assert/strict');
const {render,source}=require('./ui-components.cjs');
const value=value=>({value});

test('アイコン化の有効条件は通常・ランチャー表示で同じ',async()=>{
 for(const compact of [false,true])for(const connected of [false,true])for(const microAvailable of [false,true])for(const switching of [false,true]){
  const html=await render('components/ウィンドウ/ステータスバー.vue',{compact,connected,microAvailable,switching});
  const button=html.match(/<button class="title-micro-switch"[^>]*>/)[0];
  assert.equal(/ disabled(?:[ >])/.test(button),!connected||!microAvailable||switching);
 }
});

function startState({empty=false,loading=false,busy=false}={}){
 const item={id:'web',名前:'Web',フォルダ:'frontend_web',状態:'稼働中',設定:{起動対象:true,自動再起動:true,ブラウザ表示:true}};
 return {
  項目:value(empty?[]:[item]),選択:value(empty?'':'web'),選択対象:value(empty?null:item),
  停止警告対象:value(new Set()),ポート項目:value([{id:'web',開放:true}]),
  保存表示:value('設定を保存しました'),コンソール:value('fixture log'),読込中:value(loading),
  保存中:value(busy),処理中:value(busy),起動中:value(busy),通知:value(''),
  ブラウザ起動可能:value(true),ブラウザ起動中:value(false),ブラウザ通知:value(''),
 };
}
function appState({empty=false,folder='',busy=false}={}){
 return {
  一覧:value(null),フォルダ:value(folder),処理中:value(busy?'code':''),選択中:value(false),通知:value(''),
  項目:value(empty?[]:[{id:'code',名前:'Code',単一起動:false}]),結果:value({}),読込:async()=>{},利用可能:id=>!['task','team'].includes(id),不可理由:id=>['task','team'].includes(id)?'TaskTeam 未起動':'',
 };
}

test('通常のシステム起動は未接続・空・読込中・処理中でもページ内ミニボタンを持たない',async()=>{
 for(const online of [true,false])for(const options of [{},{empty:true},{loading:true},{busy:true}]){
  const html=await render('components/起動/起動パネル.vue',{state:startState(options),online,visible:true});
  assert.doesNotMatch(html,/ミニ表示|start-mini-switch/);
  assert.match(html,/システム起動/);assert.match(html,/class="start-save"[^>]*>設定を保存しました/);
  if(!options.empty&&!options.loading){
   for(const label of ['再起動','停止（Ctrl+C）','手動で開く'])assert.ok(html.includes(label),label);
   assert.match(html,/role="log"/);assert.equal((html.match(/type="checkbox"/g)||[]).length,3);
  }
 }
 assert.doesNotMatch(source('components/起動/起動パネル.vue'),/defineEmits|\$emit\(['"]mini['"]\)/);
});

test('通常のアプリ起動は未接続・未選択・処理中でもページ内ミニボタンを持たない',async()=>{
 for(const online of [true,false])for(const options of [{},{empty:true},{folder:'/fixture/project'},{folder:'/fixture/project',busy:true}]){
  const html=await render('components/アプリ起動/アプリ起動パネル.vue',{state:appState(options),online,visible:true});
  assert.doesNotMatch(html,/ミニ表示/);assert.match(html,/フォルダ選択/);
  if(options.folder)assert.match(html,/>解除<\/button>/);
  if(!options.empty){
   assert.match(html,/class="app-launch-button"/);
   assert.ok(html.includes(options.busy?'起動確認中…':'Code を起動'));
   const launch=html.match(/<button class="app-launch-button"[^>]*>/)[0];
   assert.equal(/ disabled(?:[ >])/.test(launch),!online||!options.folder||!!options.busy);
  }
 }
 assert.doesNotMatch(source('components/アプリ起動/アプリ起動パネル.vue'),/defineEmits|\$emit\(['"]mini['"]\)/);
});

test('通常画面は8アプリ・導入済みCLI・VS Codeを並べ、未導入CLIを隠す',async()=>{
 const ids=['claude','codex','copilot','agy','grok','opencode','aidiy_hermes'];
 const entries=ids.map(id=>({id,名前:id,モード:'fixture',利用可能:!['grok','opencode'].includes(id)}));
 entries.push({id:'vscode',名前:'VS Code',種類:'editor',モード:'プロジェクトフォルダを開く',利用可能:true});
 const cliState={項目:value(entries.filter(item=>item.利用可能===true)),全項目:value(entries),処理中:value(''),通知:value(''),失敗:value(false),読込:async()=>{}};
 for(const online of [true,false])for(const folder of ['/fixture/project','']){
  const state=appState({folder});state.項目=value(['avatar','task','team','ide','console','code','live','discord'].map(id=>({id,名前:id})));
  const html=await render('components/アプリ起動/アプリ起動パネル.vue',{state,cliState,online,visible:true});
  assert.equal((html.match(/class="app-launch-button"/g)||[]).length,14);
  assert.equal((html.match(/width="72" height="72"/g)||[]).length,14);
  assert.match(html,/VS Code でフォルダを開く/);
  for(const id of ['task','team']){const card=html.match(new RegExp(`<article[^>]*data-app="${id}"[^>]*>([\\s\\S]*?)</article>`))[1];assert.match(card,/<button[^>]* disabled/);assert.match(card,/TaskTeam 未起動/);}
  assert.ok(html.indexOf('data-app="avatar"')<html.indexOf('data-app="task"'));assert.ok(html.indexOf('data-app="task"')<html.indexOf('data-app="team"'));assert.ok(html.indexOf('data-app="ide"')<html.indexOf('data-app="avatar"'));
  assert.doesNotMatch(html,/app-launch-name/);
  assert.ok(html.indexOf('data-cli="aidiy_hermes"')<html.indexOf('data-cli="claude"'));
  for(const item of entries){
   if(!item.利用可能){assert.ok(!html.includes(`data-cli="${item.id}"`));continue;}
   const card=html.match(new RegExp(`<article[^>]*data-cli="${item.id}"[^>]*>([\\s\\S]*?)</article>`))[1];
   const button=card.match(/<button[^>]*>/)[0];
   assert.equal(/ disabled(?:[ >])/.test(button),!online||!folder||!item.利用可能,item.id);
   assert.equal(card.includes('未導入'),!item.利用可能,item.id);
  }
 }
});

test('通常のアプリ起動は受付・起動済み通知を隠し、エラーだけ表示する',async()=>{
 const state=appState({folder:'/fixture/project'});
 for(const 種別 of ['accepted','existing','error']){
  state.結果=value({code:{種別,通知:'fixture launch notice',ログ:'/fixture/log'}});
  const html=await render('components/アプリ起動/アプリ起動パネル.vue',{state,online:true,visible:true});
  assert.equal(html.includes('fixture launch notice'),種別==='error');assert.doesNotMatch(html,/起動ログの保存先/);
 }
});

test('ミニ切替の配線はタイトルバーだけに残し、通常ページの表示条件を維持する',async()=>{
 const app=source('App.vue');
 assert.equal((app.match(/@mini=/g)||[]).length,2);
 assert.match(app,/<component[^>]*:is="ステータスバー"[^>]*@mini="表示切替\('mini'\)"[^>]*@micro="表示切替\('micro'\)"[^>]*@restore="表示切替\('normal'\)"/);
 for(const [name,tab] of [['起動パネル','start'],['アプリ起動パネル','apps']]){
  const panel=app.match(new RegExp(`<component :is="${name}"[^>]*>`))[0];
  assert.ok(panel.includes(`:visible="tab==='${tab}'&&!ミニ表示"`));assert.doesNotMatch(panel,/@mini=/);
 }
 for(const connected of [true,false]){
  const html=await render('components/ウィンドウ/ステータスバー.vue',{connected,compact:false});
  assert.equal((html.match(/aria-label="ランチャー表示"/g)||[]).length,1);
  const button=html.match(/<button class="title-mini-switch"[^>]*>/)[0];
  assert.equal(/ disabled(?:[ >])/.test(button),!connected);
 }
});


test('通常・ミニは指定の先頭6アプリとAvatar・Task・Team・CPU・Discord・Slackを同じ順序で表示する',async()=>{
 const expected=['ide','console','browser','navi','code','live','aidiy_hermes','avatar','task','team','cpu','discord','slack','claude','codex','copilot','agy','grok','opencode','vscode','chrome'];
 const cliIds=new Set(['aidiy_hermes','claude','codex','copilot','agy','grok','opencode','vscode']);
 const cliState={項目:value([...expected].reverse().filter(id=>cliIds.has(id)).map(id=>({id,名前:id,利用可能:true}))),処理中:value(''),通知:value(''),失敗:value(false),読込:async()=>{}};
 for(const missing of [[],['task','team'],['browser','slack'],[]])for(const busy of [false,true]){
  const state=appState({folder:'/fixture/project',busy});
  state.項目=value([...expected].reverse().filter(id=>!cliIds.has(id)).map(id=>({id,名前:id})));
  state.利用可能=id=>!missing.includes(id);state.不可理由=id=>missing.includes(id)?'未起動':'';
  for(const name of ['アプリ起動パネル.vue','ミニアプリ起動.vue']){
   const html=await render('components/アプリ起動/'+name,{state,cliState,online:true,visible:true});
   const shown=Array.from(html.matchAll(/data-(?:app|cli)="([^"]+)"/g),match=>match[1]);
   const wanted=name.startsWith('ミニ')?expected.filter(id=>id==='aidiy_hermes'||!cliIds.has(id)&&id!=='chrome'&&!missing.includes(id)):expected;
   assert.deepEqual(shown,wanted,name);
  }
 }
});
