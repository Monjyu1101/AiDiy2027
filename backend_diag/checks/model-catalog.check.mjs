// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 旧 tests/test_model_probe.py の CatalogParityTests を移植。日付はローカル暦（元実装の naive datetime と同じ）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as catalog from '../runtime/model_catalog.mjs';
const NOW=new Date(2026,9,15,12);
const ago=days=>{const date=new Date(NOW);date.setDate(date.getDate()-days);return date.getTime()/1000;};
const label=seconds=>{const d=new Date(seconds*1000);return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;};
const row=(id,days,count=42)=>({id,created:ago(days),context_length:count,architecture:{modality:'text->text'}});
const keys=value=>new Set(Object.keys(value));
test('openrouter each cutoff inclusive and missing date',()=>{
 const entries=[];
 for(const [provider,limit] of [['perplexity',365],['google',240],['openai',240],['anthropic',240],['x-ai',240],['other',90]])entries.push(row(provider+'/keep',limit),row(provider+'/drop',limit+1));
 entries.push({id:'google/no-date'});
 const out=catalog.openrouterCatalog({data:entries},NOW);
 assert.equal(Object.keys(out).length,6);assert.ok(Object.keys(out).every(name=>name.endsWith('/keep')));
 assert.equal(out['google/keep'].トークン数,'42');assert.equal(out['google/keep'].モダリティ,'text->text');assert.equal(out['google/keep'].作成日,label(ago(240)));
});
test('google supported action, router date join and live exception',()=>{
 const items=[['match',['generateContent']],['missing',['generateContent']],['live-missing',['generateContent']],['embed',['embedContent']]].map(([name,actions])=>({name:'models/'+name,supported_actions:actions,input_token_limit:123}));
 const out=catalog.googleCatalog(items,{'google/match':{作成日:'2026/10/01'}});
 assert.deepEqual(keys(out),new Set(['match','live-missing']));assert.equal(out.match.作成日,'2026/10/01');assert.equal(out['live-missing'].作成日,null);
 assert.deepEqual(keys(catalog.googleCatalog(items,{})),new Set(['match','missing','live-missing']));
});
test('openai date always applies and zero token filter',()=>{
 const items=[['match',240],['old',241],['missing',1],['realtime-missing',1]].map(([id,age])=>({id,created:ago(age)}));
 assert.deepEqual(keys(catalog.openaiCatalog(items,{},NOW)),new Set(['match','missing','realtime-missing']));
 const out=catalog.openaiCatalog(items,{'openai/match':{トークン数:'123',モダリティ:'text'}},NOW);
 assert.deepEqual(keys(out),new Set(['match','realtime-missing']));assert.equal(out.match.トークン数,'123');
});
test('claude unknown dates retained, normalization and unmatched kept',()=>{
 const old=new Date(NOW);old.setDate(old.getDate()-241);
 const out=catalog.claudeCatalog({data:[{id:'claude-3-5-20241022',created_at:NOW},{id:'unknown',created_at:null},{id:'bad',created_at:'not-a-date'},{id:'old',created_at:old}]},{'anthropic/claude-3.5':{トークン数:'88',モダリティ:'text'}},NOW);
 assert.deepEqual(keys(out),new Set(['claude-3-5-20241022','unknown','bad']));assert.equal(out['claude-3-5-20241022'].トークン数,'88');assert.equal(out.bad.作成日,null);
});
test('claude ISO strings with Z, offset, unknown and old',()=>{
 const out=catalog.claudeCatalog({data:[{id:'new-z',created_at:'2026-10-14T12:00:00Z'},{id:'new-offset',created_at:'2026-10-14T14:00:00+02:00'},{id:'old-iso',created_at:'2025-01-01T00:00:00Z'},{id:'invalid',created_at:'not-a-date'}]},{},NOW);
 assert.deepEqual(keys(out),new Set(['new-z','new-offset','invalid']));assert.equal(out['new-z'].作成日,'2026/10/14');assert.equal(out.invalid.作成日,null);
});
test('ollama sort and known date required',()=>{
 assert.deepEqual(Object.keys(catalog.ollamaCatalog({data:[row('older',240),row('newer',1),row('expired',241),{id:'missing'}]},NOW)),['newer','older']);
});
test('new Gemini chat models require Google API membership, not OpenRouter publication',()=>{
 const order=['gemini-4-carbon','gemini-4-argon','gemini-3.8-flash'];
 assert.deepEqual(catalog.GEMINI_CHAT_MODEL_ORDER,order);
 const items=[...order,'gemini-4-carbon-image','unlisted-chat'].map(name=>({name:'models/'+name,supported_actions:['generateContent']}));
 const router={'google/gemini-3.8-flash':{作成日:'2026/09/02'}};
 const out=catalog.googleCatalog(items,router);
 assert.deepEqual(Object.keys(out),order);
 assert.equal(out['gemini-4-carbon'].作成日,null);
 assert.equal(out['gemini-4-argon'].作成日,null);
 assert.equal(out['gemini-3.8-flash'].作成日,'2026/09/02');
 assert.deepEqual(Object.keys(catalog.googleCatalog(items.slice(2),router)),['gemini-3.8-flash']);
 assert.deepEqual(Object.keys(catalog.googleCatalog([{name:'models/gemini-4-carbon',supported_actions:['embedContent']}],router)),[]);
 assert.deepEqual(Object.keys(catalog.googleCatalog([],router)),[]);
});
