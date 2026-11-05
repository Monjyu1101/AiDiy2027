// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// プロバイダ別モデル情報（_AIDIY/aidiy_diag/<id>_models_info.json）の構成と保存。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {modelsInfo,writeModelsInfo as saveModelsInfo,installedCodeClis,openCodeModels,MODEL_PROVIDER_IDS,modelsInfoFile} from '../モデル情報/models_info.mjs';
import {probe} from '../runtime/model_probe.mjs';
import {createHandler} from '../diag_main.mjs';

const reads=[];
const read=async name=>{reads.push(name);throw Error('must not read model configuration: '+name);};
const now=()=>new Date('2026-10-15T00:00:00Z');
const emptyDefaults={chat:{},live:{},code:{aidiy_hermes:{models:{auto:'仮設定（未検証） - auto'}}}};
const allClis={copilot_cli:true,claude_cli:true,codex_cli:true,antigravity_cli:true,grok_cli:true,opencode_cli:true};
const writeModelsInfo=(providers,results,options={})=>saveModelsInfo(providers,results,{installedClis:allClis,configReader:()=> '{}',antigravityModelsReader:async()=>({'gemini-cli':'yyyy/mm/dd - gemini-cli'}),...options});
const ok=(extra={})=>({状態:'OK',説明:'ok',確認日時:'2026-10-15T00:00:00Z',モデル:['m1'],モデル詳細:[{model_id:'m1',作成日:'2026/10/01',トークン数:'100',モダリティ:'text'}],...extra});

test('no provider inserts xx/auto and partial merges discard old inserted records',async()=>{
 for(const id of MODEL_PROVIDER_IDS){
  const info=await modelsInfo({id,名前:id},ok(),{now});
  for(const entry of Object.values(info.code??{}))assert.ok(Object.keys(entry.models).every(model=>!/\/(?:auto|same)$/.test(model)),id);
 }
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-no-same-'));
 try{
  await writeFile(path.join(directory,'claude_models_info.json'),JSON.stringify({code:{aidiy_hermes:{models:{'claude_cli/same':'old','copilot_cli/same':'old','antigravity_cli/auto':'old','grok_cli/auto':'old'}}}}));
  await writeModelsInfo([{id:'openai_oauth',名前:'OAuth'}],{openai_oauth:ok()},{directory,now,installedClis:{}});
  const code=JSON.parse(await readFile(path.join(directory,'code_models_info.json'),'utf8'));
  assert.deepEqual(code.aidiy_hermes.models,{'openai_oauth/m1':'2026/10/01 - openai_oauth/m1'});
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('merged code includes only installed CLIs and Hermes starts with installed same routes',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-enabled-clis-'));
 const providers=MODEL_PROVIDER_IDS.map(id=>({id,名前:id}));
 const results=Object.fromEntries(providers.map(({id})=>[id,ok()]));
 const load=async()=>JSON.parse(await readFile(path.join(directory,'code_models_info.json'),'utf8'));
 try{
  await writeModelsInfo(providers,results,{directory,now});
  let code=await load();
  assert.deepEqual(Object.keys(code.aidiy_hermes.models),[...Object.keys(allClis).map(key=>key+'/same'),'openai_oauth/m1']);
  for(const cli of Object.keys(allClis)){
   // 保存済みデータも、今回の導入状況に合わせて絞る。
   await writeModelsInfo([{id:'openai_oauth',名前:'OAuth'}],{openai_oauth:ok()},{directory,now,installedClis:{...allClis,[cli]:false}});
   code=await load();
   assert.equal(Object.hasOwn(code,cli),false,cli);
   if(['codex_cli','copilot_cli'].includes(cli))assert.equal(Object.hasOwn(JSON.parse(await readFile(path.join(directory,'navi_models_info.json'),'utf8')),cli),false,cli+' Navi');
   if(cli==='claude_cli')assert.equal(Object.hasOwn(code,'claude_sdk'),false);
   assert.deepEqual(Object.keys(code.aidiy_hermes.models),[...Object.keys(allClis).filter(key=>key!==cli).map(key=>key+'/same'),'openai_oauth/m1']);
  }
  await writeModelsInfo([{id:'openai_oauth',名前:'OAuth'}],{openai_oauth:ok()},{directory,now,installedClis:{}});
  code=await load();
  assert.deepEqual(code,{aidiy_hermes:{models:{'openai_oauth/m1':'2026/10/01 - openai_oauth/m1'}}});
  const navi=JSON.parse(await readFile(path.join(directory,'navi_models_info.json'),'utf8'));assert.equal(Object.hasOwn(navi,'codex_cli'),false);assert.equal(Object.hasOwn(navi,'copilot_cli'),false);
  await writeModelsInfo([{id:'openai_oauth',名前:'OAuth'}],{openai_oauth:ok()},{directory,now,installedClis:{codex_cli:true},naviHermesAvailable:false});
  const withoutHermes=JSON.parse(await readFile(path.join(directory,'navi_models_info.json'),'utf8'));assert.equal(Object.hasOwn(withoutHermes,'aidiy_hermes'),false);assert.equal(Object.hasOwn(withoutHermes,'codex_cli'),true);
  const installed=await installedCodeClis({loadEntries:async()=>[{id:'claude'},{id:'agy'}],resolve:async entry=>'/fixture/'+entry.id});
  assert.deepEqual(installed,{...Object.fromEntries(Object.keys(allClis).map(key=>[key,false])),claude_cli:true,antigravity_cli:true});
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('Copilot installed fallback also retains versioned Claude candidates when only OpenAI was fetched',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-copilot-fallback-'));
 const load=async()=>JSON.parse(await readFile(path.join(directory,'code_models_info.json'),'utf8'));
 const expected={
  'claude-fable-5.1':'2026/08/28 - claude-fable-5.1',
  'claude-opus-5.5':'2026/09/21 - claude-opus-5.5',
  'claude-sonnet-5.5':'2026/09/28 - claude-sonnet-5.5',
  'claude-haiku-5.5':'2026/10/07 - claude-haiku-5.5',
  'gpt-6-astra':'2026/08/28 - gpt-6-astra',
  'gpt-6.1-sol':'2026/09/28 - gpt-6.1-sol',
  'gpt-6.1-terra':'yyyy/mm/dd - gpt-6.1-terra',
  'gpt-6-luna':'2026/09/15 - gpt-6-luna',
 };
 try{
  const options={directory,now,installedClis:{copilot_cli:true}};
  await writeModelsInfo([{id:'grok',名前:'Grok'}],{grok:ok() },options);
  assert.deepEqual((await load()).copilot_cli.models,expected);
  assert.deepEqual(Object.keys((await load()).copilot_cli.models),Object.keys(expected));
  await writeModelsInfo([{id:'openai',名前:'OpenAI'}],{openai:ok({状態:'NG'})},options);
  assert.deepEqual((await load()).copilot_cli.models,expected);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory,'openai_models_info.json'),'utf8')).code.copilot_cli.models,{});
  await writeModelsInfo([{id:'openai',名前:'OpenAI'}],{openai:ok({モデル詳細:[{model_id:'gpt-only'}]})},options);
  assert.deepEqual((await load()).copilot_cli.models,{'gpt-only':'yyyy/mm/dd - gpt-only',...Object.fromEntries(Object.entries(expected).filter(([id])=>id.startsWith('claude-')))});
  await writeModelsInfo([{id:'openai',名前:'OpenAI'}],{openai:ok({状態:'NG'})},{...options,installedClis:{}});
  assert.equal(Object.hasOwn(await load(),'copilot_cli'),false);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('Gemini generates chat and live candidates, independently of Antigravity',async()=>{
 const info=await modelsInfo({id:'gemini',名前:'Gemini'},ok({ライブ候補:['gemini-3.8-live']}),{read,now});
 assert.equal(info.プロバイダ,'gemini');assert.equal(info.chat.件数,1);assert.deepEqual(info.chat.モデル[0],{model_id:'m1',作成日:'2026/10/01',トークン数:'100',モダリティ:'text'});
 assert.equal(info.形式,2);assert.deepEqual(info.chat.gemini_chat.models,{m1:'2026/10/01 - m1'});
 assert.deepEqual(info.live,{gemini_live:{models:{'gemini-3.8-live':'yyyy/mm/dd - gemini-3.8-live'}}});
 assert.equal(info.code,undefined);
 const candidates=['gemini-2.5-native-audio','gemini-robotics-er-2-streaming-preview','gemini-3.8-live','gemini-3.5-transcribe-live','gemini-3.5-live-translate-preview','gemini-4-live-translate','gemini-native-audio-translate','gemini-3.1-live','gemini-chat','lyria-live'];
 for(const id of ['gemini','freeai']){
  const filtered=await modelsInfo({id,名前:id},ok({モデル詳細:[{model_id:'gemini-chat'},{model_id:'lyria-3-pro-preview'}],ライブ候補:candidates,ライブ候補作成日:{'gemini-2.5-native-audio':'2026/10/15','gemini-3.8-live':'2025/01/01'}}),{now});
  assert.deepEqual(Object.keys(filtered.live[id+'_live'].models),['gemini-3.8-live','gemini-3.1-live','gemini-2.5-native-audio']);
  assert.equal(filtered.live[id+'_live'].models['gemini-2.5-native-audio'],'2026/10/15 - gemini-2.5-native-audio');
  assert.equal(filtered.chat.件数,1);assert.deepEqual(Object.keys(filtered.chat[id+'_chat'].models),['gemini-chat']);
  assert.doesNotMatch(JSON.stringify(filtered),/lyria/);
 }
});
test('each provider follows the main app grouping without reading model configuration',async()=>{
 const shapes={};
 for(const id of MODEL_PROVIDER_IDS){const info=await modelsInfo({id,名前:id},ok(),{read,now});shapes[id]=[!!info.chat,!!info.live,Object.keys(info.code??{})];}
 assert.deepEqual(shapes,{gemini:[true,true,[]],freeai:[true,true,[]],claude:[true,false,['claude_sdk','claude_cli','copilot_cli']],openai:[true,true,['codex_cli','copilot_cli']],openai_oauth:[true,false,['codex_cli','copilot_cli','aidiy_hermes']],grok:[true,false,['grok_cli']],openrt_chat:[true,false,[]],ollama:[true,false,['opencode_cli']],local:[true,false,[]]});
 const local=await modelsInfo({id:'local',名前:'local'},{状態:'PASS',モデル詳細:[{model_id:'google/gemma-4-E2B-it'}]},{read:async name=>{throw Error('must not read '+name);},now});
 assert.match(local.chat.取得元,/固定候補/);assert.equal(local.chat.local_chat.models['google/gemma-4-E2B-it'],'google/gemma-4-E2B-it / 約10GB bf16 / 速い (default)');
 const claude=await modelsInfo({id:'claude',名前:'Claude'},ok({モデル詳細:[{model_id:'claude-haiku-5-5',作成日:'2026/10/07'},{model_id:'claude-opus-5',作成日:'2026/07/24'},{model_id:'claude-haiku-5',作成日:'2026/06/01'}]}),{read,now});
 assert.deepEqual(claude.code.claude_sdk,{models:{haiku:'2026/10/07 - claude-haiku-5-5',opus:'2026/07/24 - claude-opus-5'}});
 assert.deepEqual(claude.code.copilot_cli,{models:{'claude-haiku-5.5':'2026/10/07 - claude-haiku-5.5','claude-opus-5':'2026/07/24 - claude-opus-5'}});
 assert.equal(claude.code.aidiy_hermes,undefined);
 const ollama=await modelsInfo({id:'ollama',名前:'Ollama'},ok(),{read,now});assert.deepEqual(ollama.code.opencode_cli.models,{m1:'2026/10/01 - m1'});
 assert.deepEqual(reads,[]);
});
test('NG keeps the reason and Grok fixed candidates; only tested providers are written, one file each',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-models-info-'));
 try{
  const providers=[{id:'grok',名前:'Grok'},{id:'gemini',名前:'Gemini'},{id:'discord',名前:'Discord'},{id:'openrt_chat',名前:'OpenRouter'}];
  const saved=await writeModelsInfo(providers,{grok:{...ok(),状態:'NG',説明:'expired',警告:['fallback']},gemini:ok(),discord:ok(),openrt_chat:{状態:'未実施'}},{directory,read,now});
  assert.deepEqual(saved,['grok_models_info.json','gemini_models_info.json','chat_models_info.json','live_models_info.json','code_models_info.json','navi_models_info.json','hermes_models_info.json','prediction_models_info.json','decisions_models_info.json','live_voices_info.json']);assert.deepEqual((await readdir(directory)).sort(),['chat_models_info.json','code_models_info.json','decisions_models_info.json','gemini_models_info.json','grok_models_info.json','hermes_models_info.json','live_models_info.json','live_voices_info.json','navi_models_info.json','prediction_models_info.json']);
  const grok=JSON.parse(await readFile(path.join(directory,modelsInfoFile('grok')),'utf8'));
  assert.equal(grok.状態,'NG');assert.equal(grok.説明,'expired');assert.match(grok.chat.取得元,/固定候補/);assert.deepEqual(grok.警告,['fallback']);
  assert.deepEqual(Object.keys(grok.code.grok_cli.models),['grok-4.7','grok-4.6']);
 }finally{await rm(directory,{recursive:true,force:true});}
});
const response=()=>({status:0,headers:{},body:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});
async function request(handler,url,method='GET'){const res=response();await handler({url,method,headers:{authorization:'Bearer k'}},res);return {status:res.status,body:JSON.parse(res.body.toString())};}
test('model write saves only results this server obtained; reloading settings discards them',async()=>{
 const writes=[];
 const h=createHandler({token:'k',entries:[],keyStatusFn:async()=>({項目:[]}),publicCache:{snapshot:()=>({}),input:()=>({})},keyTestFn:async id=>id==='azure'?{id,状態:'未実施'}:{id,状態:'OK',モデル:[]},modelsWriteFn:async(_providers,results)=>{writes.push(Object.keys(results));return Object.keys(results).map(modelsInfoFile);}});
 assert.equal((await request(h,'/api/モデル書込','POST')).status,409);
 await request(h,'/api/キーテスト/azure','POST');assert.equal((await request(h,'/api/モデル書込','POST')).status,409);
 await request(h,'/api/キーテスト/gemini','POST');await request(h,'/api/キーテスト/openrt_chat','POST');
 const saved=await request(h,'/api/モデル書込','POST');assert.equal(saved.status,200);
 assert.deepEqual(saved.body,{保存先:['_AIDIY/aidiy_diag/gemini_models_info.json','_AIDIY/aidiy_diag/openrt_chat_models_info.json'],件数:2});
 await request(h,'/api/キー設定');assert.equal((await request(h,'/api/モデル書込','POST')).status,409);
 assert.deepEqual(writes,[['gemini','openrt_chat']]);
});
test('chat models are written newest first; same dates and undated models keep their original order (undated last)',async()=>{
 const rows=[{model_id:'old',作成日:'2025/01/01'},{model_id:'none-a',作成日:null},{model_id:'new',作成日:'2026/10/14'},{model_id:'same-1',作成日:'2026/09/01'},{model_id:'placeholder',作成日:'yyyy/mm/dd'},{model_id:'same-2',作成日:'2026/09/01'},{model_id:'none-b'}];
 const info=await modelsInfo({id:'gemini',名前:'Gemini'},ok({モデル詳細:rows}),{read,now});
 assert.deepEqual(info.chat.モデル.map(row=>row.model_id),['new','same-1','same-2','old','none-a','placeholder','none-b']);
});
test('Grok PASS (fixed candidates) is saved with its source',async()=>{
 const info=await modelsInfo({id:'grok',名前:'Grok'},{状態:'PASS',説明:'fixed',モデル:['grok-4.7','grok-4.6'],モデル詳細:[{model_id:'grok-4.7'},{model_id:'grok-4.6'}]},{read,now});
 assert.equal(info.状態,'PASS');assert.match(info.chat.取得元,/固定候補/);assert.deepEqual(info.chat.モデル.map(row=>row.model_id),['grok-4.7','grok-4.6']);
});
test('live candidates use API dates then model ID dates; no configuration, proposals or voices',async()=>{
 const {liveDate,liveLabels}=await import('../モデル情報/models_info.mjs');
 assert.equal(liveDate('x','2026/06/24'),'2026/06/24');
 assert.equal(liveDate('gemini-2.5-flash-native-audio-preview-12-2025',null,undefined),'2025/12/--');
 assert.equal(liveDate('model-2026-03-05',null,undefined),'2026/03/05');
 assert.equal(liveDate('gemini-3.1-flash-live-preview',null),'yyyy/mm/dd');
 assert.equal(liveDate('gemini-3.8-live',null,undefined),'yyyy/mm/dd');
 assert.deepEqual(liveLabels(['undated','model-2026-03-05','new'],{new:'2026/09/01'}),{new:'2026/09/01 - new','model-2026-03-05':'2026/03/05 - model-2026-03-05',undated:'yyyy/mm/dd - undated'});
 const fetched=await modelsInfo({id:'openai',名前:'OpenAI'},ok({ライブ候補:['gpt-realtime-2','gpt-realtime-whisper','gpt-realtime-translate'],ライブ候補作成日:{'gpt-realtime-2':'2026/05/06'}}),{read,now});
 assert.deepEqual(fetched.live.openai_live.models,{'gpt-realtime-2':'2026/05/06 - gpt-realtime-2'});
 assert.deepEqual(fetched.code.codex_cli.models,fetched.chat.openai_chat.models);
 const mixed=await modelsInfo({id:'openai',名前:'OpenAI'},ok({モデル詳細:[{model_id:'gpt-code',作成日:'2026/10/01'},{model_id:'gpt-realtime-2'}]}),{now});
 assert.deepEqual(mixed.code.codex_cli.models,{'gpt-code':'2026/10/01 - gpt-code'});
 assert.equal(mixed.code.aidiy_hermes,undefined);
 assert.ok(Object.hasOwn(mixed.chat.openai_chat.models,'gpt-realtime-2'));
 assert.equal(fetched.live.本体設定案,undefined);assert.equal(fetched.live.差分,undefined);assert.equal(fetched.live.openai_live.voices,undefined);
 const failed=await modelsInfo({id:'openai',名前:'OpenAI'},{状態:'NG',モデル詳細:[{model_id:'fallback'}],ライブ候補:['old-live']},{read,now});
 assert.deepEqual(failed.live.openai_live.models,{});assert.deepEqual(failed.chat.openai_chat.models,{});assert.deepEqual(failed.chat.モデル,[]);
});
test('only Grok and local candidates are fixed in aidiy_diag',async()=>{
 const {FIXED_MODELS}=await import('../モデル情報/models_info.mjs');
 const reads=[];await modelsInfo({id:'claude',名前:'Claude'},ok(),{read:async name=>{reads.push(name);throw Error(name);},now});
 assert.deepEqual(reads,[]);
 assert.deepEqual(Object.keys(FIXED_MODELS),['grok_cli','local_chat']);
 assert.deepEqual(Object.keys(FIXED_MODELS.grok_cli.models),['grok-4.7','grok-4.6']);
 assert.equal(Object.keys(FIXED_MODELS.local_chat.models).length,4);
});
test('chat keeps the detailed モデル array and exposes selectable chat names with models (same order)',async()=>{
 const rows=[{model_id:'old',作成日:'2025/01/01'},{model_id:'undated',作成日:null},{model_id:'new',作成日:'2026/10/07'}];
 const info=await modelsInfo({id:'gemini',名前:'Gemini'},ok({モデル詳細:rows}),{read,now});
 assert.deepEqual(info.chat.モデル.map(row=>row.model_id),['new','old','undated']);
 assert.deepEqual(info.chat.gemini_chat.models,{new:'2026/10/07 - new',old:'2025/01/01 - old',undated:'yyyy/mm/dd - undated'});
 assert.deepEqual(Object.keys(info.chat.gemini_chat.models),info.chat.モデル.map(row=>row.model_id));
 const local=await modelsInfo({id:'local',名前:'local'},{状態:'PASS',モデル詳細:[{model_id:'google/gemma-4-E2B-it'}]},{read,now});
 assert.equal(local.chat.local_chat.models['google/gemma-4-E2B-it'],'google/gemma-4-E2B-it / 約10GB bf16 / 速い (default)');
});

test('all selectable chat, live and code entries expose models; Claude API metadata stays separate',async()=>{
 const chatKeys={gemini:'gemini_chat',freeai:'freeai_chat',openai:'openai_chat',openai_oauth:'openai_oauth',openrt_chat:'openrt_chat',ollama:'ollama_chat',local:'local_chat'};
 const liveKeys={gemini:'gemini_live',freeai:'freeai_live',openai:'openai_live'};
 for(const id of MODEL_PROVIDER_IDS){
  const info=await modelsInfo({id,名前:id},ok(),{read,now});
  assert.equal(info.chat.本体の区分,undefined,id);
  if(info.live)assert.deepEqual(Object.keys(info.live),[liveKeys[id]],id);
  if(chatKeys[id])assert.deepEqual(Object.keys(info.chat[chatKeys[id]]),['models'],id);
  if(liveKeys[id])assert.deepEqual(Object.keys(info.live[liveKeys[id]]),['models'],id);
  for(const entry of Object.values(info.code??{}))assert.deepEqual(Object.keys(entry),['models'],id);
  assert.equal(info.chat.models,undefined);
 }
 const detail={model_id:'claude-haiku-5-5',作成日:'2026/10/07',トークン数:'1000000',モダリティ:'text+image+file->text'};
 const claude=await modelsInfo({id:'claude',名前:'Claude'},ok({モデル詳細:[detail]}),{read,now});
 assert.deepEqual(claude.chat.モデル,[detail]);
 assert.equal(claude.chat.claude_chat,undefined);
 assert.deepEqual(claude.code.claude_sdk.models,{haiku:'2026/10/07 - claude-haiku-5-5'});
 assert.deepEqual(claude.code.claude_cli.models,claude.code.claude_sdk.models);
 const missing=await modelsInfo({id:'gemini',名前:'Gemini'},ok(),{read:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});},now});
 assert.deepEqual(missing.live.gemini_live.models,{});assert.doesNotMatch(JSON.stringify(missing),/_config/);
});

test('Codex excludes realtime; Hermes keeps acquired OAuth models with a provider prefix',async()=>{
 const info=await modelsInfo({id:'openai_oauth',名前:'OpenAI OAuth'},ok({モデル詳細:[{model_id:'gpt-new',作成日:'2026/10/15'},{model_id:'gpt-other'}]}),{read,now});
 assert.deepEqual(info.code.codex_cli.models,{'gpt-new':'2026/10/15 - gpt-new','gpt-other':'yyyy/mm/dd - gpt-other'});
 assert.deepEqual(info.code.aidiy_hermes.models,{'openai_oauth/gpt-new':'2026/10/15 - openai_oauth/gpt-new','openai_oauth/gpt-other':'yyyy/mm/dd - openai_oauth/gpt-other'});
 const realtime=await modelsInfo({id:'openai_oauth',名前:'OpenAI OAuth'},ok({モデル詳細:[{model_id:'gpt-code'},{model_id:'gpt-realtime-2'}]}),{now});
 assert.deepEqual(realtime.code.codex_cli.models,{'gpt-code':'yyyy/mm/dd - gpt-code'});
 assert.ok(Object.hasOwn(realtime.code.aidiy_hermes.models,'openai_oauth/gpt-realtime-2'));
 const failed=await modelsInfo({id:'openai_oauth',名前:'OpenAI OAuth'},ok({状態:'NG'}),{read,now});
 assert.deepEqual(failed.code.codex_cli.models,{});assert.deepEqual(failed.code.copilot_cli.models,{});
 assert.equal(Object.keys(failed.code.aidiy_hermes.models).length,4);
 assert.ok(Object.values(failed.code.aidiy_hermes.models).every(label=>label.startsWith('仮設定（未検証）')));
});

test('Codex keeps the numerically newest version per family and context variant',async()=>{
 const ids=['gpt-5.6-sol','gpt-6.1-sol','gpt-5.6-luna','gpt-6-luna','gpt-6.1-terra','gpt-6.9-pro','gpt-6.10-pro','gpt-5.6-sol-900k','gpt-6.1-sol-900k','gpt-5.4','gpt-5.5','gpt-5.4-mini','gpt-realtime-2'];
 for(const id of ['openai','openai_oauth']){
  const info=await modelsInfo({id,名前:id},ok({モデル詳細:ids.map(model_id=>({model_id}))}),{now});
  assert.deepEqual(Object.keys(info.code.codex_cli.models),['gpt-6.1-sol','gpt-6-luna','gpt-6.1-terra','gpt-6.10-pro','gpt-6.1-sol-900k','gpt-5.5','gpt-5.4-mini']);
  assert.deepEqual(info.code.copilot_cli,info.code.codex_cli);
  assert.deepEqual(info.chat.モデル.map(row=>row.model_id),ids);
 }
});

test('combined files merge providers and model keys, retain dated labels and preserve untested saved providers',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-merged-models-'));
 const provider=id=>({id,名前:id});
 const load=async group=>JSON.parse(await readFile(path.join(directory,modelsInfoFile(group)),'utf8'));
 try{
  await writeModelsInfo([provider('claude'),provider('openai')],{
   claude:ok({モデル詳細:[{model_id:'claude-haiku-5-5',作成日:'2026/10/07'}]}),
   openai:ok({モデル詳細:[{model_id:'gpt-6.1-sol',作成日:'2026/09/28'},{model_id:'gpt-6-luna',作成日:'2026/09/15'}],ライブ候補:['gpt-realtime-2']}),
  },{directory,now});
  await writeModelsInfo([provider('openai_oauth')],{openai_oauth:ok({モデル詳細:[{model_id:'gpt-6.1-sol'},{model_id:'gpt-6.1-sol-900k'},{model_id:'gpt-6.1-terra',作成日:'2026/10/01'}]})},{directory,now});
  const code=await load('code');
  assert.deepEqual(Object.keys(code.codex_cli.models).sort(),['gpt-6.1-terra','gpt-6-luna','gpt-6.1-sol','gpt-6.1-sol-900k'].sort());
  assert.equal(code.codex_cli.models['gpt-6.1-sol'],'2026/09/28 - gpt-6.1-sol');
  assert.equal(code.copilot_cli.models['claude-haiku-5.5'],'2026/10/07 - claude-haiku-5.5');
  assert.equal(Object.keys(code.copilot_cli.models).length,5);
  assert.deepEqual(Object.keys(code.codex_cli),['models']);
  const chat=await load('chat');
  assert.deepEqual(Object.keys(chat).sort(),['openai_chat','openai_oauth']);assert.equal(chat.モデル,undefined);
  assert.deepEqual(await load('live'),{openai_live:{models:{'gpt-realtime-2':'yyyy/mm/dd - gpt-realtime-2'}}});
  await writeModelsInfo([provider('gemini'),provider('freeai')],{
   gemini:ok({ライブ候補:['gemini-3.8-live']}),freeai:ok({ライブ候補:['gemini-3.8-live']}),
  },{directory,now});
  assert.equal(Object.keys(await load('chat'))[0],'freeai_chat');
  assert.equal(Object.keys(await load('live'))[0],'freeai_live');
  const codeKeys=Object.keys(await load('code'));
  assert.deepEqual(codeKeys.slice(0,2),['claude_sdk','claude_cli']);
  assert.equal(codeKeys.at(-1),'antigravity_cli');
  assert.ok(codeKeys.indexOf('codex_cli')<codeKeys.indexOf('antigravity_cli'));
  await writeModelsInfo([provider('openai_oauth')],{openai_oauth:ok({モデル詳細:[{model_id:'gpt-6.1-sol',作成日:'2026/10/15'}]})},{directory,now});
  assert.equal((await load('code')).codex_cli.models['gpt-6.1-sol'],'2026/10/15 - gpt-6.1-sol');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('consolidated outputs omit every empty provider after CLI fallback and label filtering',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-empty-'));
 try {
  const providers=['gemini','freeai','openai','openai_oauth','claude','ollama'].map(id=>({id,名前:id}));
  await writeModelsInfo(providers,Object.fromEntries(providers.map(({id})=>[id,ok({モデル詳細:[],ライブ候補:[]})])),{directory,installedClis:{}});
  for(const group of ['chat','live','code'])assert.deepEqual(JSON.parse(await readFile(path.join(directory,modelsInfoFile(group)),'utf8')),emptyDefaults[group]);
  await writeFile(path.join(directory,'openai_oauth_models_info.json'),JSON.stringify({chat:{openai_oauth:{models:{bad:42}}},code:{aidiy_hermes:{models:{'copilot_cli/auto':'old'}}}}));
  await writeModelsInfo([],{}, {directory,installedClis:{}});
  for(const group of ['chat','live','code'])assert.deepEqual(JSON.parse(await readFile(path.join(directory,modelsInfoFile(group)),'utf8')),emptyDefaults[group]);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('OpenRouter requires verified results and current key presence even for saved legacy files',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-router-auth-'));
 const provider={id:'openrt_chat',名前:'OpenRouter',設定済み:true};
 const load=async()=>JSON.parse(await readFile(path.join(directory,'chat_models_info.json'),'utf8'));
 try {
  await writeModelsInfo([provider],{openrt_chat:ok()},{directory,installedClis:{}});assert.deepEqual(await load(),{});
  const configReader=()=>JSON.stringify({openrt_key_id:'fixture-key'});
  const verified=await probe('openrt_chat',{reader:configReader,cache:{公開状態:'取得済',公開モデル:{m1:{作成日:'2026/10/01'}}},fetch:async()=>({data:{is_free_tier:false}})});
  await writeModelsInfo([provider],{openrt_chat:verified},{directory,installedClis:{},configReader});assert.deepEqual((await load()).openrt_chat.models,{m1:'2026/10/01 - m1'});
  await writeModelsInfo([provider],{openrt_chat:verified},{directory,installedClis:{},configReader:()=>JSON.stringify({openrt_key_id:'changed-key'})});assert.deepEqual(await load(),{},'external key edit invalidates the in-memory result');
  await writeModelsInfo([provider],{openrt_chat:JSON.parse(JSON.stringify(verified))},{directory,installedClis:{},configReader});assert.deepEqual(await load(),{},'serialized proof cannot authorize a provider');
  await writeModelsInfo([provider],{},{directory,installedClis:{}});assert.deepEqual(await load(),{},'saved authentication is not evidence for the currently configured key');
  await writeModelsInfo([{...provider,設定済み:false}],{},{directory,installedClis:{}});assert.deepEqual(await load(),{});
  await writeModelsInfo([provider],{openrt_chat:{状態:'未実施'}},{directory,installedClis:{}});assert.deepEqual(await load(),{});
  await writeModelsInfo([provider],{openrt_chat:{状態:'NG'}},{directory,installedClis:{}});assert.deepEqual(await load(),{});
  await writeFile(path.join(directory,'openrt_chat_models_info.json'),JSON.stringify({状態:'OK',chat:{openrt_chat:{models:{old:'old'}}}}));
  await writeModelsInfo([provider],{},{directory,installedClis:{}});assert.deepEqual(await load(),{});
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('empty Live without configuration stays empty and Code keeps its fixed provisional default',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-fixed-fallback-'));
 const options={directory,installedClis:{},configReader:()=>JSON.stringify({CHAT_AI_NAME:'freeai_chat',CHAT_FREEAI_MODEL:'configured-chat'})};
 const load=async group=>JSON.parse(await readFile(path.join(directory,modelsInfoFile(group)),'utf8'));
 try {
  await writeModelsInfo([],{},options);
  assert.deepEqual(await load('live'),emptyDefaults.live);assert.deepEqual(await load('code'),emptyDefaults.code);
  await writeModelsInfo([{id:'gemini',名前:'Gemini'},{id:'openai_oauth',名前:'OAuth'}],{gemini:ok({ライブ候補:['real-live']}),openai_oauth:ok()},options);
  assert.deepEqual(await load('live'),{gemini_live:{models:{'real-live':'yyyy/mm/dd - real-live'}}});
  assert.deepEqual(await load('code'),{aidiy_hermes:{models:{'openai_oauth/m1':'2026/10/01 - openai_oauth/m1'}}});
  await writeModelsInfo([{id:'gemini',名前:'Gemini'},{id:'openai_oauth',名前:'OAuth'}],{gemini:{状態:'NG'},openai_oauth:{状態:'NG'}},{...options,installedClis:{copilot_cli:true}});
  assert.deepEqual(await load('live'),emptyDefaults.live);
  assert.deepEqual(Object.keys(await load('code')),['copilot_cli','aidiy_hermes']);
  assert.equal(Object.keys((await load('code')).copilot_cli.models).length,8);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('OpenCode mirrors Codex IDs, labels and order with independent installation gates',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-opencode-mirror-'));
 const load=async kind=>JSON.parse(await readFile(path.join(directory,modelsInfoFile(kind)),'utf8'));
 const providers=['claude','openai','ollama'].map(id=>({id,名前:id}));
 const results={claude:ok({モデル詳細:[{model_id:'claude-haiku-5-5',作成日:'2026/10/07'}]}),openai:ok({モデル詳細:[{model_id:'gpt-6-luna',作成日:'2026/10/08'}]}),ollama:ok({モデル詳細:[{model_id:'ollama-only'}]})};
 try {
  await writeModelsInfo(providers,results,{directory,installedClis:{copilot_cli:true,opencode_cli:true,codex_cli:true}});
  const both=await load('code'),chat=await load('chat'),decisions=await load('decisions');
  assert.deepEqual(Object.entries(both.opencode_cli.models),Object.entries(openCodeModels(both.codex_cli.models)));
  assert.equal(both.opencode_cli.models['ollama-only'],undefined);
  assert.ok(Object.keys(both.copilot_cli.models).some(id=>id.startsWith('claude-')));assert.ok(!Object.keys(both.opencode_cli.models).some(id=>id.startsWith('claude-')));assert.ok(both.opencode_cli.models['openai/gpt-6-luna']);
  await writeModelsInfo([],{}, {directory,installedClis:{opencode_cli:true,codex_cli:true}});
  const only=await load('code');
  assert.equal(only.copilot_cli,undefined);
  assert.deepEqual(Object.entries(only.opencode_cli.models),Object.entries(openCodeModels(both.codex_cli.models)));
  assert.deepEqual(only.codex_cli,both.codex_cli);
  await writeModelsInfo([],{}, {directory,installedClis:{opencode_cli:true}});
  const independent=await load('code');assert.equal(independent.codex_cli,undefined);assert.deepEqual(independent.opencode_cli.models,openCodeModels(both.codex_cli.models));
  assert.deepEqual(await load('chat'),chat);assert.deepEqual(await load('decisions'),decisions);
  await writeModelsInfo([],{}, {directory,installedClis:{copilot_cli:true}});
  assert.equal((await load('code')).opencode_cli,undefined);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('OpenCode alone uses the same eight-model fallback as Copilot',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-opencode-fallback-'));
 const load=async()=>JSON.parse(await readFile(path.join(directory,modelsInfoFile('code')),'utf8'));
 try {
  await writeModelsInfo([],{}, {directory,installedClis:{copilot_cli:true}});
  const models=(await load()).copilot_cli.models;assert.equal(Object.keys(models).length,8);assert.ok(Object.keys(models).some(id=>id.startsWith('claude-')));
  await writeModelsInfo([],{}, {directory,installedClis:{opencode_cli:true}});
  const code=await load();assert.equal(code.copilot_cli,undefined);
  assert.deepEqual(Object.entries(code.opencode_cli.models),Object.entries(openCodeModels(models)));
  assert.ok(code.aidiy_hermes.models['opencode_cli/same']);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('failed model acquisition supplements both CLIs without claiming authentication success',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-opencode-failed-'));
 const load=async group=>JSON.parse(await readFile(path.join(directory,modelsInfoFile(group)),'utf8'));
 try {
  const providers=[{id:'openai',名前:'OpenAI',設定済み:false}];
  const results={openai:{状態:'NG',認証確認:false,説明:'fixture unavailable',モデル詳細:[]}};
  await writeModelsInfo(providers,results,{directory,installedClis:{copilot_cli:true,opencode_cli:true}});
  const code=await load('code');
  assert.deepEqual(Object.entries(code.opencode_cli.models),Object.entries(openCodeModels(code.copilot_cli.models)));
  assert.equal(Object.keys(code.opencode_cli.models).length,8);assert.equal(Object.keys(code.copilot_cli.models).length,8);
  assert.deepEqual(Object.keys(code.opencode_cli),['models']);
  const source=await load('openai');assert.equal(source.状態,'NG');assert.notEqual(source.認証確認,true);
  assert.deepEqual(await load('decisions'),{});
 }finally{await rm(directory,{recursive:true,force:true});}
});


test('OpenCode prefixes model IDs and labels once, preserving date and control options',()=>{
 const expected={'openai/gpt-8-sol':'2026/10/18 - openai/gpt-8-sol',auto:'auto',same:'same'};
 assert.deepEqual(openCodeModels({'gpt-8-sol':'2026/10/18 - gpt-8-sol',auto:'auto',same:'same'}),expected);
 assert.deepEqual(openCodeModels(expected),expected);
});


test('Copilot keeps fetched latest versioned Claude families, then restores fixed families if Anthropic fails',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-copilot-claude-'));
 const load=async()=>JSON.parse(await readFile(path.join(directory,'code_models_info.json'),'utf8'));
 const providers=[{id:'claude',名前:'Claude'},{id:'openai',名前:'OpenAI'}];
 const openai=ok({モデル詳細:[{model_id:'gpt-6-luna',作成日:'2026/09/15'}]});
 const rows=[
  {model_id:'claude-haiku-5',作成日:'2026/06/01'},
  {model_id:'claude-fable-5-1',作成日:'2026/08/28'},
  {model_id:'claude-opus-5',作成日:'2026/07/24'},
  {model_id:'claude-sonnet-5-5',作成日:'2026/09/28'},
  {model_id:'claude-haiku-5-5',作成日:'2026/10/07'},
  {model_id:'claude-opus-5-5',作成日:'2026/09/21'},
 ];
 try{
  const options={directory,installedClis:{copilot_cli:true,opencode_cli:true}};
  await writeModelsInfo(providers,{claude:ok({モデル詳細:rows}),openai},options);
  const fetched=await load();
  assert.deepEqual(Object.keys(fetched.copilot_cli.models),['claude-haiku-5.5','claude-sonnet-5.5','claude-opus-5.5','claude-fable-5.1','gpt-6-luna']);
  assert.equal(fetched.copilot_cli.models['claude-haiku-5.5'],'2026/10/07 - claude-haiku-5.5');
  assert.deepEqual(fetched.opencode_cli.models,{'openai/gpt-6-luna':'2026/09/15 - openai/gpt-6-luna'});
  await writeModelsInfo(providers,{claude:ok({状態:'NG',モデル:[],モデル詳細:[]}),openai},options);
  const failed=await load();
  assert.deepEqual(Object.keys(failed.copilot_cli.models),['gpt-6-luna','claude-fable-5.1','claude-opus-5.5','claude-sonnet-5.5','claude-haiku-5.5']);
  assert.equal(failed.copilot_cli.models['gpt-6-luna'],'2026/09/15 - gpt-6-luna');
  assert.deepEqual(failed.opencode_cli,fetched.opencode_cli);
  const source=JSON.parse(await readFile(path.join(directory,'claude_models_info.json'),'utf8'));
  assert.deepEqual(source.code.copilot_cli.models,{}); // 未取得source自体を取得成功に書換えない
 }finally{await rm(directory,{recursive:true,force:true});}
});
