// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createAppLauncher,アプリ一覧,isChromeInstalled} from '../起動/アプリ起動.mjs';
const {render}=createRequire(import.meta.url)('./ui-components.cjs');
const channels=rows=>rows.filter(row=>['discord','slack'].includes(row.id)).map(row=>row.id);
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'diag-channel-visibility-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'_config'));
 const file=join(root,'_config','AiDiy_key.json');
 const manager=createAppLauncher({chromeInstalled:async()=>true,root,taskTeamStatus:async()=>({利用可能:false}),portStatusFn:async()=>({対象:[]}),tasks:async()=>assert.fail('catalog must not inspect processes'),spawnFn:()=>assert.fail('catalog must not start apps')});
 return {root,file,manager,write:data=>writeFile(file,JSON.stringify(data))};
}
test('missing, unreadable and invalid configuration hides both channels but keeps every unrelated app',async t=>{
 const f=await fixture(t),expected=アプリ一覧.filter(row=>!['discord','slack'].includes(row.id)).map(row=>row.id);
 const check=async()=>assert.deepEqual((await f.manager.catalog()).対象.map(row=>row.id),expected);
 await check();await mkdir(f.file);await check();await rm(f.file,{recursive:true});
 for(const content of ['{invalid','null','[]','"not an object"']){await writeFile(f.file,content);await check();}
});
test('each first Bot key independently controls visibility; empty, whitespace, placeholders and nonstrings are unconfigured',async t=>{
 const f=await fixture(t);
 for(const id of ['discord','slack']){
  const other=id==='discord'?'slack':'discord';
  for(const value of [undefined,null,'',' \t\n ','< your token >','  <placeholder>  ',false,42,[],{}]){
   await f.write({[`${id}_bot_token`]:value,[`${other}_bot_token`]:'fixture-configured'});
   assert.deepEqual(channels((await f.manager.catalog()).対象),[other]);
  }
 }
});
test('Bot keys alone suffice without IDs, app token or live connection; catalog refresh preserves order and never returns secrets',async t=>{
 const f=await fixture(t);
 const discord='fixture-discord-private',slack='fixture-slack-private';
 await f.write({discord_bot_token:` ${discord} `,slack_bot_token:`\t${slack}\n`,slack_app_token:'<unset>',discord_guild_id:'<unset>',slack_team_id:'<unset>',CODE_BASE_PATH:'../project'});
 const data=await f.manager.catalog();
 assert.deepEqual(data.対象.map(row=>row.id),アプリ一覧.map(row=>row.id));
 assert.deepEqual(channels(data.対象),['discord','slack']);
 assert.equal(data.フォルダ,'../project');
 assert.equal(data.対象.find(row=>row.id==='slack').利用可能,false); // 未導入でもキー登録済みなら表示。
 assert.doesNotMatch(JSON.stringify(data),/fixture-(discord|slack)-private|bot_token|app_token|guild_id|team_id/);
 await f.write({slack_bot_token:slack});assert.deepEqual(channels((await f.manager.catalog()).対象),['slack']);
 await f.write({discord_bot_token:discord});assert.deepEqual(channels((await f.manager.catalog()).対象),['discord']);
 await f.write({});assert.deepEqual(channels((await f.manager.catalog()).対象),[]);
});
test('normal keeps configured channels; mini shows only available channels in Discord then Slack order',async t=>{
 const f=await fixture(t),ref=value=>({value});
 for(const enabled of [[],['discord'],['slack'],['discord','slack']]){
  await f.write(Object.fromEntries(enabled.map(id=>[`${id}_bot_token`,'fixture-token'])));
  const data=await f.manager.catalog(),state={項目:ref(data.対象),フォルダ:ref('/work'),処理中:ref(''),選択中:ref(false),通知:ref(''),結果:ref({}),一覧:ref(null),利用可能:()=>false,不可理由:()=>'',読込(){},起動(){assert.fail('render must not launch');}};
  for(const available of [false,true]) for(const name of ['アプリ起動パネル.vue','ミニアプリ起動.vue']){
   state.利用可能=()=>available;
   const visible=name==='ミニアプリ起動.vue'&&!available?[]:enabled;
   const html=await render('components/アプリ起動/'+name,{state,online:true});
   for(const id of ['discord','slack'])assert.equal(html.includes(`data-app="${id}"`),visible.includes(id));
   if(visible.length===2)assert.ok(html.indexOf('data-app="discord"')<html.indexOf('data-app="slack"'));
  }
 }
 // 円形も同じサーバーカタログを整列して使い、独自の固定Discord/Slack項目は持たない。
 const micro=await readFile(new URL('../ui/src/components/アプリ起動/マイクロランチャー.vue',import.meta.url),'utf8');
 assert.match(micro,/起動項目を整列\(\[\.\.\.props\.appState\.項目\.value\.filter/);
});

test('Chrome reuses installation catalog resolver without starting a process and returns only a boolean',async()=>{
 for(const found of [null,'/synthetic/Google Chrome']){
  assert.equal(await isChromeInstalled({resolveFn:async entry=>{assert.equal(entry.id,'chrome');assert.ok(entry.commands.length);return found;}}),Boolean(found));
 }
 assert.equal(await isChromeInstalled({resolveFn:async()=>{throw Error('private path');}}),false);
});
test('missing Chrome is hidden independently of Tools/Web, without hiding AiDiy Browser; installed Chrome retains service gates',async t=>{
 const f=await fixture(t);let installed=false,online=false,broken=false;
 const manager=createAppLauncher({root:f.root,chromeInstalled:async()=>{if(broken)throw Error('private path');return installed;},taskTeamStatus:async()=>({利用可能:false}),portStatusFn:async()=>({対象:['tools','web'].map(id=>({id,開放:online}))}),spawnFn:()=>assert.fail('catalog must not launch')});
 for(online of [false,true]){
  const rows=(await manager.catalog()).対象;
  assert.equal(rows.some(row=>row.id==='chrome'),false);
  assert.equal(rows.some(row=>row.id==='browser'),true);
 }
 installed=true;
 for(online of [false,true]){
  const rows=(await manager.catalog()).対象;
  assert.equal(rows.find(row=>row.id==='chrome').利用可能,online);
  assert.equal(rows.some(row=>row.id==='browser'),true);
 }
 broken=true;assert.equal((await manager.catalog()).対象.some(row=>row.id==='chrome'),false);
});
