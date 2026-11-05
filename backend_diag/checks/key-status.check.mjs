// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {DIAG_TRANSPORT_BYTE_LIMIT} from '../runtime/transport_limit.mjs';
import {getKeyStatus,testKey,KEY_PROVIDERS,runModels} from '../モデル情報/key_status.mjs';
const now=new Date('2026-10-15T12:00:00Z');
const reader=value=>async filename=>{assert.match(String(filename),/[\\/]_config[\\/]AiDiy_key\.json$/);return JSON.stringify(value);};
const forbidden=()=>assert.fail('Unexpected configuration read or network call');

test('Node status uses only bounded config reader and never contacts a provider',async()=>{
 const response=await runModels('status',undefined,{reader:reader({openai_key_id:'fixture-secret',gemini_key_id:' < placeholder > ',ollama_key_id:'ollama'}),fetch:forbidden});
 assert.equal(response.data.設定状態,'読込済み');
 const rows=Object.fromEntries(response.data.項目.map(row=>[row.id,row]));
 assert.equal(rows.openai.設定済み,true);assert.equal(rows.gemini.設定済み,false);assert.equal(rows.ollama.設定済み,null);assert.equal(rows.ollama.ローカル,true);assert.equal(rows.ollama.キー不要,true);assert.equal(rows.ollama.テスト可能,true);assert.equal(rows.openrt_chat.キー不要,false);
 assert.ok(!JSON.stringify(response).includes('fixture-secret'));
});
test('unknown and unsupported IDs never read config or fetch',async()=>{
 for(const id of ['../arbitrary','azure','copilot'])assert.equal((await testKey(id,{run:forbidden})).状態,'未実施');
 assert.equal((await runModels('test','bad',{reader:forbidden,fetch:forbidden})).error,'unsupported');
});
test('external integrations: read-only auth GET with fixed headers, role checks, safe names, unset keys never fetch',async()=>{
 const keys={huggingface_key_read:'hf-read-secret',huggingface_key_write:'hf-write-secret',discord_bot_token:'discord-secret'};
 const run=async(id,body,values=keys)=>{const calls=[];const response=await runModels('test',id,{reader:reader(values),fetch:async(provider,headers)=>{calls.push([provider,headers]);if(body instanceof Error)throw body;return body;}});return {...response.data,calls};};
 let r=await run('huggingface_read',{name:'alice',email:'a@example.invalid',auth:{accessToken:{role:'read',displayName:'token-name'}}});
 assert.equal(r.状態,'OK');assert.match(r.説明,/alice/);assert.match(r.説明,/read/);assert.deepEqual(r.calls.map(([provider,headers])=>[provider,headers.Authorization]),[['huggingface','Bearer hf-read-secret']]);
 assert.ok(!JSON.stringify({...r,calls:undefined}).match(/secret|example\.invalid|token-name/));assert.deepEqual(r.モデル,[]);
 assert.equal((await run('huggingface_write',{name:'alice',auth:{accessToken:{role:'read'}}})).状態,'NG');
 assert.equal((await run('huggingface_write',{name:'alice',auth:{accessToken:{role:'write'}}})).状態,'OK');
 assert.equal((await run('huggingface_write',{auth:{accessToken:{role:'fineGrained',fineGrained:{scoped:[{permissions:['repo.content.read','repo.write']}]}}}})).状態,'PASS');
 assert.equal((await run('huggingface_write',{auth:{accessToken:{role:'fineGrained',fineGrained:{global:['discussion.read']}}}})).状態,'NG');
 r=await run('discord',{bot:true,username:'my_bot.1'});assert.equal(r.状態,'OK');assert.match(r.説明,/my_bot\.1/);
 assert.equal(r.calls[0][0],'discord');assert.equal(r.calls[0][1].Authorization,'Bot discord-secret');assert.match(r.calls[0][1]['User-Agent'],/^DiscordBot \(/);
 assert.equal((await run('discord',{bot:false,username:'person'})).状態,'NG');
 r=await run('discord',{bot:true,username:'<b>discord-secret</b>'});assert.equal(r.状態,'OK');assert.doesNotMatch(r.説明,/secret|<b>/);
 r=await run('discord',new Error('auth'));assert.equal(r.状態,'NG');assert.match(r.説明,/認証/);
 for(const id of ['huggingface_read','huggingface_write','discord']){r=await run(id,{},{});assert.equal(r.状態,'未実施');assert.equal(r.説明,'キーが未設定です。');assert.deepEqual(r.calls,[]);}
 const status=await runModels('status',undefined,{reader:reader({discord_bot_token:'discord-secret'}),fetch:forbidden});
 const rows=Object.fromEntries(status.data.項目.map(row=>[row.id,row]));
 assert.equal(rows.discord.テスト可能,true);assert.equal(rows.huggingface_read.テスト可能,false);assert.equal(rows.huggingface_read.理由,'キーが未設定です。');
});
test('safe runner schema discards unknown fields and formats model details',async()=>{
 const status=await getKeyStatus({run:async()=>({data:{設定状態:'読込済み',項目:[null,{id:'openrt_chat',設定済み:false,キー不要:true,テスト可能:true,secret:'hidden'}]}})});
 assert.equal(status.項目.length,KEY_PROVIDERS.length);assert.equal(status.項目.find(row=>row.id==='openrt_chat').キー不要,true);assert.ok(!JSON.stringify(status).includes('hidden'));
 const tested=await testKey('openai',{run:async()=>({data:{id:'openai',状態:'OK',説明:'fixture',モデル:['model','<script>','model'],モデル詳細:[{model_id:'model',作成日:'2026/10/01',トークン数:'100',モダリティ:'text',secret:'hidden'}],警告:['補完未確認'],確認日時:'2026-10-15T00:00:00Z',secret:'hidden'}})});
 assert.deepEqual(tested.モデル,['model']);assert.equal(tested.モデル詳細[0].作成日,'2026/10/01');assert.deepEqual(tested.警告,['補完未確認']);assert.ok(!JSON.stringify(tested).includes('hidden'));
});
test('runner errors leave status unknown and probes untested without leaked text',async()=>{
 for(const error of ['timeout','output','busy','stopped','invalid']){
  const status=await getKeyStatus({run:async()=>({error})});assert.equal(status.設定状態,'確認不可');assert.ok(status.項目.every(row=>row.設定済み===null&&!row.テスト可能));
  const result=await testKey('openai',{run:async()=>({error})});assert.equal(result.状態,'未実施');assert.doesNotMatch(result.説明,/Python/);
 }
});
test('public acquisition uses anonymous fetch, never configuration',async()=>{
 const result=await runModels('public',undefined,{reader:forbidden,now,fetch:async(provider,headers)=>{
  assert.equal(provider,'openrouter');assert.deepEqual(headers,{});return {data:[{id:'other/new',created:now.getTime()/1000}]};
 }});
 assert.equal(result.data.状態,'OK');assert.deepEqual(Object.keys(result.data.公開モデル),['other/new']);
});
test('OpenRouter individual test verifies key and preserves authentication marker',async()=>{
 const input={公開状態:'取得済',公開モデル:{example:{model_id:'example',作成日:'2026/10/15',トークン数:'100',モダリティ:'text'}},確認日時:now.toISOString()};
 const result=await runModels('test','openrt_chat',{input,reader:reader({openrt_key_id:'fixture-key'}),fetch:async provider=>{assert.equal(provider,'openrouter-key');return {data:{is_free_tier:false}};}});
 assert.equal(result.data.認証確認,true);
 const safe=await testKey('openrt_chat',{run:async()=>result});assert.equal(safe.認証確認,true);
 const {currentOpenRouterProof}=await import('../runtime/model_probe.mjs');
 assert.equal(await currentOpenRouterProof(safe,reader({openrt_key_id:'fixture-key'})),true);
 assert.equal(await currentOpenRouterProof(safe,reader({openrt_key_id:'changed-key'})),false);
 assert.ok(!JSON.stringify(safe).includes('fixture-key'));
 assert.equal(result.data.状態,'OK');assert.deepEqual(result.data.モデル,['example']);
});
test('oversized cache is rejected before configuration or network',async()=>{
 const result=await runModels('test','openai',{input:{large:'x'.repeat(DIAG_TRANSPORT_BYTE_LIMIT+1)},reader:forbidden,fetch:forbidden});assert.equal(result.error,'input');
});
test('deadline aborts provider operation and returns a safe error',async()=>{
 let signal;
 const result=await runModels('test','openai',{timeout:15,reader:reader({openai_key_id:'fixture-secret'}),fetch:async(_provider,_headers,_pageToken,abortSignal)=>{signal=abortSignal;return new Promise(()=>{});}});
 assert.equal(result.error,'timeout');assert.equal(signal.aborted,true);assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});
test('isolated runners bound concurrency and shutdown cancels every operation',async()=>{
 const {createModelRunner}=await import('../モデル情報/key_status.mjs');const runner=createModelRunner();let started=0;const signals=[];
 const options={reader:reader({openai_key_id:'fixture-secret'}),fetch:async(_p,_h,_t,signal)=>{started++;signals.push(signal);return new Promise(()=>{});}};
 const first=runner.run('test','openai',options),second=runner.run('test','gemini',{...options,reader:reader({gemini_key_id:'fixture-secret'})});
 while(started<2)await new Promise(resolve=>setImmediate(resolve));
 const queued=runner.run('status',undefined,{reader:forbidden});
 runner.cancel();assert.equal((await queued).error,'stopped');assert.equal((await first).error,'stopped');assert.equal((await second).error,'stopped');assert.ok(signals.every(signal=>signal.aborted));
 assert.equal((await runner.run('status',undefined,{reader:forbidden})).error,'stopped');
});
test('external abort prevents startup and aborts an active request',async()=>{
 const {createModelRunner}=await import('../モデル情報/key_status.mjs');const runner=createModelRunner();const early=new AbortController();early.abort();
 assert.equal((await runner.run('status',undefined,{signal:early.signal,reader:forbidden})).error,'stopped');
 const controller=new AbortController();let started;
 const ready=new Promise(resolve=>{started=resolve;});let requestSignal;
 const pending=runner.run('test','openai',{signal:controller.signal,reader:reader({openai_key_id:'fixture-secret'}),fetch:async(_p,_h,_t,signal)=>{requestSignal=signal;started();return new Promise(()=>{});}});
 await ready;controller.abort();assert.equal((await pending).error,'stopped');assert.equal(requestSignal.aborted,true);
});


test('Ollama confirmed missing skips all model work, other installation states preserve acquisition',async()=>{
 const skipped=await testKey('ollama',{installResults:[{id:'ollama',状態:'未検出'}],run:forbidden});
 assert.equal(skipped.状態,'未実施');assert.equal(skipped.スキップ,true);assert.deepEqual(skipped.モデル,[]);assert.match(skipped.説明,/未検出.*スキップ/);
 for(const state of [undefined,'未確認','OK','注意','NG','ERR']){
  let calls=0;
  const result=await testKey('ollama',{installResults:state?[{id:'ollama',状態:state}]:[],run:(action,id,options)=>runModels(action,id,{...options,reader:reader({}),fetch:async provider=>{assert.equal(provider,'ollama-local');calls++;return {models:[{name:'fixture:latest'}]};}})});
  assert.equal(calls,1,state);assert.equal(result.状態,'OK');assert.deepEqual(result.モデル,['fixture:latest']);
 }
});

test('Slack credentials never appear in status or hostile integration display fields without exposing token values',async()=>{
 const secrets=['xoxb-fixture-bot-token','xapp-fixture-app-token'];
 const values={discord_bot_token:'fixture-discord',huggingface_key_read:'fixture-hf',slack_bot_token:secrets[0],slack_app_token:secrets[1]};
 const status=await runModels('status',undefined,{reader:reader(values),fetch:forbidden});
 assert.equal(status.data.項目.find(row=>row.id==='slack').設定済み,true);
 for(const secret of secrets)assert.ok(!JSON.stringify(status).includes(secret));
 for(const secret of secrets){
  for(const [id,body] of [['discord',{bot:true,username:'prefix-'+secret}],['huggingface_read',{name:secret,auth:{accessToken:{role:'read'}}}]]){
   const response=await runModels('test',id,{reader:reader(values),fetch:async()=>body});
   assert.equal(response.data.状態,'OK');
   for(const token of secrets)assert.ok(!JSON.stringify(response).includes(token));
  }
 }
 for(const id of ['slack_bot','slack_app']){
  assert.equal((await testKey(id,{run:forbidden})).状態,'未実施');
  assert.equal((await runModels('test',id,{reader:forbidden,fetch:forbidden})).error,'unsupported');
 }
});
