// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {probe,publicCatalog,status,safeDetails,validatedCache} from '../runtime/model_probe.mjs';
const now=new Date('2026-10-15T12:00:00Z'),created=now.getTime()/1000;
const reader=value=>async()=>JSON.stringify(value);
const forbidden=()=>assert.fail('Unexpected config/network operation');
const routerAuth={reader:reader({openrt_key_id:'fixture-key'}),fetch:async(provider,headers)=>{assert.equal(provider,'openrouter-key');assert.deepEqual(headers,{Authorization:'Bearer fixture-key'});return {data:{is_free_tier:false}};}};
test('invalid configuration is unknown; unset and unsupported keys never fetch',async()=>{
 assert.equal((await status({reader:async()=> '[]'})).設定状態,'読込不可');
 assert.equal((await probe('gemini',{reader:reader({freeai_key_id:'fixture-key'}),fetch:forbidden})).状態,'未実施');
 assert.equal((await probe('azure',{reader:forbidden,fetch:forbidden})).状態,'未実施');
});
test('selected Google credential only, pagination completes before cache filtering',async()=>{
 const calls=[];
 const result=await probe('freeai',{now,reader:reader({gemini_key_id:'other-secret',freeai_key_id:'selected-secret'}),cache:{公開状態:'取得済',公開モデル:{'google/second':{作成日:'2026/10/01'}}},fetch:async(provider,headers,token)=>{
  calls.push({provider,headers,token});return {models:[{name:`models/${token?'second':'first'}`,supportedGenerationMethods:['generateContent'],inputTokenLimit:222}],...(token?{}:{nextPageToken:'page2'})};
 }});
 assert.equal(result.状態,'OK');assert.deepEqual(result.モデル,['second']);assert.equal(result.モデル詳細[0].作成日,'2026/10/01');assert.equal(calls.length,2);
 for(const call of calls){assert.equal(call.provider,'google');assert.deepEqual(call.headers,{'x-goog-api-key':'selected-secret'});}
 assert.equal(calls[1].token,'page2');assert.ok(!JSON.stringify(result).includes('secret'));
});
test('pagination is bounded and malformed responses fail closed',async()=>{
 let count=0;
 const result=await probe('gemini',{reader:reader({gemini_key_id:'fixture-key'}),fetch:async()=>{count++;return {models:[],nextPageToken:'again'};}});
 assert.equal(result.状態,'NG');assert.equal(count,20);
 for(const body of [{data:{}},{data:null},{models:[]}]){
  const response=await probe('openai',{reader:reader({openai_key_id:'fixture-key'}),fetch:async()=>body});assert.equal(response.状態,'NG');
 }
});
test('all configured secrets and organization are redacted from metadata',async()=>{
 const result=await probe('openai',{now,reader:reader({openai_key_id:'fixture-key',gemini_key_id:'other-secret',openai_organization:'fixture-org'}),fetch:async(provider,headers)=>{
  assert.equal(provider,'openai');assert.equal(headers['OpenAI-Organization'],'fixture-org');assert.equal(headers.Authorization,'Bearer fixture-key');
  return {data:[{id:'safe-model',created},{id:'fixture-org',created},{id:'other-secret',created}]};
 }});
 assert.equal(result.状態,'OK');assert.deepEqual(result.モデル,['safe-model']);assert.ok(result.警告.length);
 assert.ok(!JSON.stringify(result).includes('fixture-org'));assert.ok(!JSON.stringify(result).includes('other-secret'));
 assert.deepEqual(safeDetails({'safe-model':{作成日:'other-secret',トークン数:'fixture-key',モダリティ:'prefix-other-secret'}},['fixture-key','other-secret']),[{model_id:'safe-model',作成日:null,トークン数:null,モダリティ:null}]);
});
test('public failure does not leak provider errors and cache validation fails closed',async()=>{
 const result=await publicCatalog({now,fetch:async()=>{throw Error('secret-error');}});
 assert.equal(result.状態,'NG');assert.ok(!JSON.stringify(result).includes('secret-error'));
 for(const cache of [null,[],{公開状態:'取得中',公開モデル:{}},{公開状態:'取得済',公開モデル:{bad:null}}]){
  const result=await probe('openrt',{...routerAuth,cache});assert.equal(result.状態,'NG');
 }
});
test('configuration bounds, UTF-8 BOM, unreadable and missing states',async()=>{
 const {readConfig,CONFIG_LIMIT}=await import('../runtime/model_probe.mjs');
 assert.equal((await readConfig(async()=> '\uFEFF{"openai_key_id":"fixture-key"}'))[0],'読込済み');
 assert.equal((await readConfig(async()=> 'x'.repeat(CONFIG_LIMIT+1)))[0],'読込不可');
 assert.equal((await readConfig(async()=> Buffer.from([0xff,0xfe])))[0],'読込不可');
 assert.equal((await readConfig(async()=> {throw Object.assign(Error('fixture-secret'),{code:'ENOENT'});}))[0],'未作成');
 assert.equal((await readConfig(async()=> {throw Error('fixture-secret');}))[0],'読込不可');
});
test('public details are unlimited but individual display is capped at 500',async()=>{
 const data=Array.from({length:501},(_,i)=>({id:`other/model-${i}`,created}));
 const result=await publicCatalog({now,fetch:async()=>({data})});assert.equal(Object.keys(result.公開モデル).length,501);
 const selected=await probe('openrt',{...routerAuth,cache:{公開状態:'取得済',公開モデル:result.公開モデル}});assert.equal(selected.モデル.length,500);
});
// 以下は旧 tests/test_model_probe.py の BridgeTests から、TypeScript 実装に該当する項目を移植。
const day=86400;
test('fixed config path, provider order and safe status without key values',async()=>{
 const result=await status({reader:async file=>{
  assert.match(file.replaceAll('\\','/'),/\/_config\/AiDiy_key\.json$/);
  return JSON.stringify({openai_key_id:'fixture-secret',gemini_key_id:' < placeholder > ',ollama_key_id:'ollama'});
 }});
 assert.deepEqual(result.項目.map(row=>row.id),['gemini','freeai','claude','openai','openai_oauth','grok','azure','copilot','openrt','ollama','local','huggingface_read','huggingface_write','discord','slack']);
 assert.ok(!JSON.stringify(result).includes('fixture-secret'));
 const rows=Object.fromEntries(result.項目.map(row=>[row.id,row]));
 assert.equal(rows.openai.設定済み,true);assert.equal(rows.gemini.設定済み,false);
 // Ollama は本体と同じくローカル（ollama list）。キーでは判定しない。
 assert.equal(rows.ollama.設定済み,null);assert.equal(rows.ollama.ローカル,true);assert.equal(rows.ollama.キー不要,true);assert.equal(rows.ollama.テスト可能,true);
 assert.equal(rows.openrt.キー不要,false);assert.equal(rows.openrt.テスト可能,false);
});
test('public catalog is anonymous and applies the OpenRouter date filter',async()=>{
 const result=await publicCatalog({now,fetch:async(provider,headers)=>{
  assert.equal(provider,'openrouter');assert.deepEqual(headers,{});
  return {data:[{id:'other/new',created:created-day},{id:'other/old',created:created-91*day}]};
 }});
 assert.equal(result.状態,'OK');assert.deepEqual(Object.keys(result.公開モデル),['other/new']);assert.match(result.説明,/キーの有効性/);
});
test('OpenRouter verifies credentials separately before reusing the startup cache',async()=>{
 const 公開モデル=(await publicCatalog({now,fetch:async()=>({data:[{id:'other/new',created:created-day}]})})).公開モデル;
 const result=await probe('openrt',{...routerAuth,cache:{公開状態:'取得済',公開モデル}});
 assert.equal(result.状態,'OK');assert.deepEqual(result.モデル,['other/new']);
 for(const state of ['未取得','取得中','失敗'])assert.equal((await probe('openrt',{...routerAuth,cache:{公開状態:state,公開モデル}})).状態,'NG');
});
test('missing router cache warns but continues; selected provider failure is NG without error text',async()=>{
 const result=await probe('openai',{now,reader:reader({openai_key_id:'fixture-secret'}),fetch:async provider=>{assert.equal(provider,'openai');return {data:[{id:'fresh',created:created-2*day}]};}});
 assert.equal(result.状態,'OK');assert.deepEqual(result.モデル,['fresh']);assert.ok(result.警告.length);
 const failed=await probe('openai',{now,reader:reader({openai_key_id:'fixture-secret'}),fetch:async()=>{throw Error('secret-error');}});
 assert.equal(failed.状態,'NG');assert.deepEqual(failed.モデル,[]);assert.ok(!JSON.stringify(failed).includes('secret-error'));
});
test('Claude wire ISO dates are filtered by the 240 day window',async()=>{
 const result=await probe('claude',{now,reader:reader({claude_key_id:'fixture-key'}),fetch:async(provider,headers)=>{
  assert.equal(provider,'anthropic');assert.equal(headers['x-api-key'],'fixture-key');
  return {data:[{id:'old',created_at:'2025-01-01T00:00:00Z'},{id:'new',created_at:'2026-10-14T12:00:00Z'}]};
 }});
 assert.equal(result.状態,'OK');assert.deepEqual(result.モデル,['new']);
});
test('placeholder OpenAI organization is not sent',async()=>{
 const calls=[];
 await probe('openai',{now,reader:reader({openai_key_id:'fixture-key',openai_organization:' < your organization > '}),fetch:async(provider,headers)=>{calls.push(headers);return {data:[]};}});
 assert.equal(calls.length,1);assert.ok(!Object.hasOwn(calls[0],'OpenAI-Organization'));
});
// 以下は本体（conf_model.py の get_chat_models / _get_ollama_local_models）との一致。
test('display lists drop retired OpenAI models like get_chat_models, but the join source keeps them',async()=>{
 const openai=await probe('openai',{now,reader:reader({openai_key_id:'fixture-key'}),fetch:async()=>({data:[{id:'gpt-6-sol',created:created-day},{id:'gpt-6.1-sol',created:created-day},{id:'gpt-6-sol-mini',created:created-day}]})});
 assert.deepEqual(openai.モデル,['gpt-6.1-sol']);
 const 公開モデル=(await publicCatalog({now,fetch:async()=>({data:[{id:'openai/gpt-6-sol',created},{id:'openai/gpt-6.1-sol',created},{id:'~openai/gpt-sol-latest',created}]})})).公開モデル;
 assert.ok(Object.hasOwn(公開モデル,'openai/gpt-6-sol'),'join source keeps retired models');assert.ok(Object.hasOwn(公開モデル,'~openai/gpt-sol-latest'),'aliases kept like the main app');
 const openrt=await probe('openrt',{...routerAuth,cache:{公開状態:'取得済',公開モデル}});
 assert.deepEqual(openrt.モデル,['openai/gpt-6.1-sol','~openai/gpt-sol-latest']);
});
test('Ollama lists local models like ollama list (newest first), without keys, and reports a stopped server as NG',async()=>{
 const calls=[];
 const ok=await probe('ollama',{reader:reader({ollama_key_id:'cloud-secret'}),fetch:async(provider,headers)=>{calls.push({provider,headers});return {models:[{name:'old:latest',modified_at:'2026-01-01T00:00:00Z'},{name:'new:cloud',modified_at:'2026-10-01T00:00:00Z'},{name:''}]};}});
 assert.equal(ok.状態,'OK');assert.deepEqual(ok.モデル,['new:cloud','old:latest']);assert.deepEqual(calls,[{provider:'ollama-local',headers:{}}]);
 assert.equal(ok.モデル詳細[0].作成日,null);
 const stopped=await probe('ollama',{reader:reader({}),fetch:async()=>{throw Error('network');}});
 assert.equal(stopped.状態,'NG');assert.match(stopped.説明,/ローカルの Ollama に接続できません/);
});
test('backend_local reports the fixed candidates (same as CHAT_LOCAL_MODELS) as PASS without reading _config',async()=>{
 const result=await probe('local',{reader:forbidden,fetch:forbidden});
 assert.equal(result.状態,'PASS');assert.deepEqual(result.モデル,['google/gemma-4-E2B-it','google/gemma-4-E4B-it','google/gemma-4-E2B-it-qat-mobile-transformers','google/gemma-4-E4B-it-qat-mobile-transformers']);assert.match(result.説明,/固定候補/);
 const row=(await status({reader:reader({})})).項目.find(item=>item.id==='local');assert.equal(row.テスト可能,true);assert.equal(row.ローカル,true);assert.equal(row.キー名,'固定候補');
});
test('live candidates carry creation dates: OpenAI from the API, Gemini from the OpenRouter join',async()=>{
 const openai=await probe('openai',{now,reader:reader({openai_key_id:'fixture-key'}),fetch:async()=>({data:[{id:'gpt-realtime-2',created},{id:'gpt-6.1-sol',created}]})});
 assert.deepEqual(openai.ライブ候補,['gpt-realtime-2']);assert.match(openai.ライブ候補作成日['gpt-realtime-2'],/^\d{4}\/\d{2}\/\d{2}$/);
 const gemini=await probe('gemini',{now,reader:reader({gemini_key_id:'fixture-key'}),cache:{公開状態:'取得済',公開モデル:{'google/live-dated':{作成日:'2026/09/01'},'google/chat':{作成日:'2026/09/02'}}},fetch:async()=>({models:[{name:'models/live-dated',supportedGenerationMethods:['bidiGenerateContent']},{name:'models/live-undated',supportedGenerationMethods:['bidiGenerateContent']},{name:'models/chat',supportedGenerationMethods:['generateContent']}]})});
 assert.deepEqual(gemini.ライブ候補,['live-dated','live-undated']);assert.deepEqual(gemini.ライブ候補作成日,{'live-dated':'2026/09/01','live-undated':null});
});

test('OpenRouter never promotes public metadata without a verified key',async()=>{
 const cache={公開状態:'取得済',公開モデル:{'other/new':{作成日:'2026/10/01'}}};
 for(const key of [undefined,'','<placeholder>']){
  const result=await probe('openrt',{reader:reader({openrt_key_id:key}),fetch:forbidden,cache});
  assert.equal(result.状態,'未実施');assert.deepEqual(result.モデル,[]);assert.notEqual(result.認証確認,true);
 }
 for(const response of [()=>{throw Error('invalid-secret');},()=>({data:[]}),()=>({data:{}})]){
  const result=await probe('openrt',{reader:reader({openrt_key_id:'fixture-key'}),cache,fetch:async(provider)=>{assert.equal(provider,'openrouter-key');return response();}});
  assert.equal(result.状態,'NG');assert.deepEqual(result.モデル,[]);assert.ok(!JSON.stringify(result).includes('invalid-secret'));
 }
 const result=await probe('openrt',{...routerAuth,cache});
 assert.equal(result.認証確認,true);assert.deepEqual(result.モデル,['other/new']);
});

test('configured Slack tokens are secrets in hostile model identifiers and metadata',async()=>{
 const secrets=['xoxb-fixture-slack-bot','xapp-fixture-slack-app'];
 const values={openai_key_id:'fixture-openai',openrt_key_id:'fixture-openrouter',slack_bot_token:secrets[0],slack_app_token:secrets[1]};
 const result=await probe('openai',{now,reader:reader(values),fetch:async()=>({data:[{id:'safe-model',created},...secrets.map(id=>({id,created}))]})});
 assert.deepEqual(result.モデル,['safe-model']);
 for(const secret of secrets)assert.ok(!JSON.stringify(result).includes(secret));
 const cache={公開状態:'取得済',公開モデル:{safe:{model_id:'safe',作成日:secrets[0],トークン数:'prefix-'+secrets[1],モダリティ:secrets.join('/')}}};
 const metadata=await probe('openrt',{now,reader:reader(values),cache,fetch:async()=>({data:{is_free_tier:false}})});
 for(const secret of secrets)assert.ok(!JSON.stringify(metadata).includes(secret));
 assert.deepEqual(metadata.モデル,['safe']);
 for(const id of ['slack_bot','slack_app'])assert.equal((await probe(id,{reader:forbidden,fetch:forbidden})).状態,'未実施');
});

test('Slack status is bot-token presence only; invalid tokens never authenticate',async()=>{
 for(const value of [undefined,null,1,'',' ','x','<placeholder>','token whitespace','token\nline']){
  const options={reader:reader({slack_bot_token:value}),fetch:forbidden};
  const row=(await status(options)).項目.find(row=>row.id==='slack');
  assert.equal(row.設定済み,false);assert.equal(row.テスト可能,false);
  assert.equal((await probe('slack',options)).状態,'未実施');
 }
 const row=(await status({reader:reader({slack_bot_token:' xoxb-fixture '})})).項目.find(row=>row.id==='slack');
 assert.equal(row.設定済み,true);assert.equal(row.テスト可能,true);assert.equal(row.状態,'未実施');
});
test('Slack manual auth requires bot success and never publishes response or app credentials',async()=>{
 const values={slack_bot_token:' xoxb-fixture ',slack_app_token:'xapp-secret'};
 for(const body of [{ok:true,bot_id:'B123',user:'xapp-secret',team:'private'}, {ok:true}, {ok:false,error:'xapp-secret'}, {ok:'true',bot_id:'B123'},new Error('xapp-secret')]){
  let calls=0;const result=await probe('slack',{reader:reader(values),fetch:async(provider,headers)=>{
   calls++;assert.equal(provider,'slack');assert.deepEqual(headers,{Authorization:'Bearer xoxb-fixture','Content-Type':'application/x-www-form-urlencoded'});
   if(body instanceof Error)throw body;return body;
  }});
  assert.equal(calls,1);assert.equal(result.状態,body.ok===true&&body.bot_id==='B123'?'OK':'NG');
  assert.deepEqual(result.モデル,[]);assert.doesNotMatch(JSON.stringify(result),/xapp-secret|xoxb-fixture|private/);
 }
});

test('Slack transport fixes HTTPS endpoint and POST without URL credentials or socket',async t=>{
 const {default:https}=await import('node:https');const {EventEmitter}=await import('node:events');
 const {fetchMetadata}=await import('../runtime/model_probe.mjs');
 const saved={NO_PROXY:process.env.NO_PROXY,no_proxy:process.env.no_proxy};
 t.after(()=>{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 process.env.NO_PROXY='*';process.env.no_proxy='*';
 let calls=0;
 t.mock.method(https,'request',(options,respond)=>{
  calls++;assert.equal(options.hostname,'slack.com');assert.equal(options.path,'/api/auth.test');
  assert.equal(options.port,443);assert.equal(options.method,'POST');assert.equal(options.rejectUnauthorized,true);
  assert.equal(options.headers.Authorization,'Bearer fixture');
  const request=new EventEmitter();request.destroy=()=>{};request.end=()=>queueMicrotask(()=>{
   const response=new EventEmitter();response.statusCode=200;response.destroy=()=>{};respond(response);
   response.emit('data',Buffer.from('{"ok":true,"bot_id":"B123"}'));response.emit('end');
  });return request;
 });
 assert.equal((await fetchMetadata('slack',{Authorization:'Bearer fixture'})).ok,true);assert.equal(calls,1);
});
