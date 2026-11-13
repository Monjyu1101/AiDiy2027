// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// OpenAI OAuth（~/.codex/auth.json）と Grok（~/.grok/auth.json）の設定判定とモデル一覧取得。
// ログイン情報は合成値だけを使い、実ファイル・実サービスには触れない。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readOAuth,oauthPath,status,probe,readCodexLocal} from '../runtime/model_probe.mjs';
import {codexCatalog,grokCatalog,finalizeCodexModels,codexFallbackCatalog} from '../runtime/model_catalog.mjs';

const now=new Date('2026-10-15T12:00:00Z');
const jwt=claims=>['e30',Buffer.from(JSON.stringify(claims)).toString('base64url'),'sig'].join('.');
const codexToken=jwt({exp:now.getTime()/1000+3600,'https://api.openai.com/auth':{chatgpt_account_id:'acct-fixture'}});
const files={codex:JSON.stringify({tokens:{access_token:codexToken}}),grok:JSON.stringify({'https://auth.x.ai::id':{key:'grok-secret',expires_at:'2026-10-16T00:00:00Z'}})};
const oauthReader=kind=>{if(!files[kind])throw Object.assign(Error('missing'),{code:'ENOENT'});return files[kind];};
const reader=async()=>'{}';
const forbidden=()=>assert.fail('Unexpected network operation');

test('login files are read from each CLI folder (CODEX_HOME honored)',()=>{
 assert.equal(oauthPath('codex',{CODEX_HOME:'/fixture/codex'},'/home/user'),path.join('/fixture/codex','auth.json'));
 assert.equal(oauthPath('codex',{},'/home/user'),path.join('/home/user','.codex','auth.json'));
 assert.equal(oauthPath('grok',{},'/home/user'),path.join('/home/user','.grok','auth.json'));
});
test('credentials: Codex account from the JWT claim, Grok key from the x.ai entry; missing or other issuers are unset',async()=>{
 const codex=await readOAuth('codex',oauthReader);assert.equal(codex.token,codexToken);assert.equal(codex.account,'acct-fixture');assert.ok(codex.expiresAt>now.getTime());
 const grok=await readOAuth('grok',oauthReader);assert.equal(grok.token,'grok-secret');assert.equal(grok.expiresAt,Date.parse('2026-10-16T00:00:00Z'));
 for(const body of ['{}','{"tokens":{}}','not json'])assert.equal(await readOAuth('codex',()=>body),null);
 assert.equal(await readOAuth('grok',()=>JSON.stringify({'https://other.example::id':{key:'x'}})),null);
 assert.equal(await readOAuth('grok',()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}),null);
});
test('status marks OAuth rows configured by login files even without API keys, and never returns token values',async()=>{
 const result=await status({reader,oauthReader:kind=>kind==='codex'?files.codex:(()=>{throw Error('missing');})()});
 const rows=Object.fromEntries(result.項目.map(row=>[row.id,row]));
 assert.equal(rows.openai.設定済み,false);assert.equal(rows.openai_oauth.設定済み,true);assert.equal(rows.openai_oauth.テスト可能,true);assert.equal(rows.openai_oauth.キー名,'~/.codex/auth.json');
 assert.equal(rows.grok.設定済み,false);assert.equal(rows.grok.テスト可能,false);assert.match(rows.grok.理由,/grok CLI でログイン/);
 assert.ok(!JSON.stringify(result).includes(codexToken));
});
test('OpenAI OAuth lists Codex models like the main app: hidden and retired removed, priority order, forward-compat with standard names, account header',async()=>{
 const calls=[];
 const result=await probe('openai_oauth',{now,reader:forbidden,oauthReader,fetch:async(provider,headers)=>{calls.push({provider,headers});return {models:[
  {slug:'gpt-6-luna',priority:30},{slug:'gpt-6.1-sol',priority:10,context_window:400000},{slug:'hidden-model',priority:1,visibility:'hide'},
  {slug:'gpt-6-sol',priority:5},{slug:'gpt-6-astra',priority:10},{slug:codexToken,priority:40}]};}});
 assert.equal(result.状態,'OK');assert.deepEqual(result.モデル,['gpt-6-astra','gpt-6.1-sol','gpt-6-luna']);
 assert.equal(calls.length,1);assert.equal(calls[0].provider,'codex');assert.equal(calls[0].headers.Authorization,'Bearer '+codexToken);assert.equal(calls[0].headers['ChatGPT-Account-Id'],'acct-fixture');
 assert.equal(result.モデル詳細.find(row=>row.model_id==='gpt-6.1-sol').作成日,null);
 assert.ok(!JSON.stringify(result).includes(codexToken));assert.ok(!JSON.stringify(result).includes('acct-fixture'));
});
test('Grok lists models with its login key; expired login explains re-login and missing login never fetches',async()=>{
 const ok=await probe('grok',{now,reader:forbidden,oauthReader,fetch:async(provider,headers)=>{assert.equal(provider,'grok');assert.equal(headers.Authorization,'Bearer grok-secret');return {data:[{id:'grok-4.7'},{id:'grok-hidden',hidden:true},{id:'grok-old',created:now.getTime()/1000-241*86400},{id:'grok-4.6',created:now.getTime()/1000-86400}]};}});
 assert.equal(ok.状態,'OK');assert.deepEqual(ok.モデル,['grok-4.7','grok-old','grok-4.6']);assert.deepEqual(ok.警告,[]);
 const expired=await probe('grok',{now:new Date('2026-10-17T00:00:00Z'),reader:forbidden,oauthReader,fetch:async()=>{throw Error('http');}});
 // Grok は本体が固定候補を流し込む系統なので、API が取れなくても PASS（黄）。理由は説明に残す。
 assert.equal(expired.状態,'PASS');assert.match(expired.説明,/固定候補（grok-4.7 \/ grok-4.6）を使用/);assert.match(expired.説明,/有効期限が切れています。grok CLI を起動して再ログイン/);
 // 本体（CODE_GROK_CLI_MODELS）と同じ固定候補を代替表示する。
 assert.deepEqual(expired.モデル,['grok-4.7','grok-4.6']);assert.match(expired.警告[0],/固定候補/);
 const missing=await probe('grok',{reader:forbidden,oauthReader:()=>'{}',fetch:forbidden});assert.equal(missing.状態,'未実施');assert.match(missing.説明,/ログイン情報がありません/);
});
test('catalog shapes fail closed',()=>{
 assert.throws(()=>codexCatalog({data:[]}));assert.throws(()=>grokCatalog({}));
 assert.deepEqual(Object.keys(grokCatalog({models:[{info:{id:'grok-4.6',hidden:false}},{info:{id:'grok-x',hidden:true}}]})),['grok-4.6']);
});
test('Codex synthesis matches codex_models.py: retired and legacy aliases removed, forward-compat appended',()=>{
 assert.deepEqual(finalizeCodexModels(['gpt-5.4','gpt-6-sol','gpt-5.4-mini','gpt-6.1-sol-2026-09-01']),['gpt-5.4','gpt-5.4-mini','gpt-6.1-sol-2026-09-01','gpt-6.1-sol','gpt-6.1-terra','gpt-6-luna']);
 assert.deepEqual(finalizeCodexModels(['gpt-6.1-sol','gpt-6.1-sol-900k']),['gpt-6.1-sol','gpt-6-astra']);
});
test('Codex API failure shows the main app fallback: config.toml model, models_cache.json, defaults',async()=>{
 const local=name=>name==='config.toml'?'model = "gpt-custom"\n[profiles.x]\nmodel = "ignored"\n':JSON.stringify({models:[{slug:'gpt-cache',priority:1},{slug:'gpt-hidden',visibility:'hidden'}]});
 assert.deepEqual(await readCodexLocal(local),{defaultModel:'gpt-custom',cacheIds:['gpt-cache']});
 assert.deepEqual(Object.keys(codexFallbackCatalog(null,[])),['gpt-6-astra','gpt-6.1-sol','gpt-6.1-terra','gpt-6-luna']);
 const failed=await probe('openai_oauth',{now,reader:forbidden,oauthReader,codexLocalReader:local,fetch:async()=>{throw Error('http');}});
 assert.equal(failed.状態,'NG');assert.deepEqual(failed.モデル.slice(0,3),['gpt-custom','gpt-cache','gpt-6-astra']);assert.match(failed.警告[0],/代替候補/);
 assert.ok(!JSON.stringify(failed).includes(codexToken));
});
