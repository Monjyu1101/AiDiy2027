// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runHeadless,OUTPUT_DIRECTORY,STEPS,modelsStep} from '../診断/headless.mjs';
const installOnly=STEPS.filter(step=>step.id==='install');
import {parseArgs} from '../diag_main.mjs';

const entries=[{id:'node',name:'Node.js',menuGroup:'ベース'},{id:'ffmpeg',name:'ffmpeg'}];
const ok=entry=>({id:entry.id,状態:'OK',パス:'/fixture/'+entry.id,バージョン:'1.0.0',説明:'fixture',確認日時:'2026-10-15T00:00:00.000Z'});
const quiet={log:()=>{},error:()=>{}};
async function folder(fn){const directory=await mkdtemp(path.join(os.tmpdir(),'diag-headless-'));try{return await fn(directory);}finally{await rm(directory,{recursive:true,force:true});}}

test('output is _AIDIY/aidiy_diag at the repository root',()=>{
 assert.equal(path.relative(path.resolve(import.meta.dirname,'../..'),OUTPUT_DIRECTORY).replaceAll('\\','/'),'_AIDIY/aidiy_diag');
});
test('headless checks all entries at once (fastest) and writes install_info.json in catalog order',async()=>folder(async directory=>{
 let active=0,maximum=0;const order=[],lines=[];
 const probeFn=async entry=>{active++;maximum=Math.max(maximum,active);order.push(entry.id);await new Promise(r=>setTimeout(r,10));active--;return entry.id==='ffmpeg'?{...ok(entry),状態:'未検出',パス:null,バージョン:null}:ok(entry);};
 assert.equal(await runHeadless({steps:installOnly,directory,loadEntries:async()=>entries,probeFn,log:line=>lines.push(line),error:()=>{}}),0);
 assert.equal(maximum,2);assert.deepEqual(order,['node','ffmpeg']);
 const saved=JSON.parse(await readFile(path.join(directory,'install_info.json'),'utf8'));
 assert.equal(saved.種類,'インストール状況');assert.equal(saved.件数,2);assert.deepEqual(saved.集計,{OK:1,未検出:1});
 assert.deepEqual(saved.項目.map(item=>[item.id,item.名前,item.分類,item.状態]),[['node','Node.js','ベース','OK'],['ffmpeg','ffmpeg','その他拡張','未検出']]);
 assert.ok(lines.some(line=>line.includes('[1/2] OK  Node.js 1.0.0')));
 assert.deepEqual(await readdir(directory),['install_info.json']);
}));
test('execution failure keeps the previous result file untouched',async()=>folder(async directory=>{
 const file=path.join(directory,'install_info.json');await writeFile(file,'previous');
 const errors=[];
 const code=await runHeadless({steps:installOnly,directory,loadEntries:async()=>entries,probeFn:async entry=>{if(entry.id==='ffmpeg')throw Error('boom');return ok(entry);},log:()=>{},error:line=>errors.push(line)});
 assert.equal(code,1);assert.equal(await readFile(file,'utf8'),'previous');assert.deepEqual(await readdir(directory),['install_info.json']);
 assert.ok(errors.some(line=>line.includes('更新していません')));
 assert.equal(await runHeadless({steps:installOnly,directory,loadEntries:async()=>entries,probeFn:async entry=>({...ok(entry),状態:'unknown'}),...quiet}),1);
 assert.equal(await readFile(file,'utf8'),'previous');
}));
test('catalog failure and cancellation do not write',async()=>folder(async directory=>{
 assert.equal(await runHeadless({steps:installOnly,directory:path.join(directory,'none'),loadEntries:async()=>{throw Error('missing');},...quiet}),1);
 assert.deepEqual(await readdir(directory),[]);
 const file=path.join(directory,'install_info.json');await writeFile(file,'previous');
 const controller=new AbortController();
 const code=await runHeadless({steps:installOnly,directory,loadEntries:async()=>entries,probeFn:async entry=>{controller.abort();return ok(entry);},signal:controller.signal,...quiet});
 assert.equal(code,130);assert.equal(await readFile(file,'utf8'),'previous');
}));
test('write failure reports failure and leaves no temporary file',async()=>folder(async directory=>{
 await mkdir(path.join(directory,'install_info.json'));
 assert.equal(await runHeadless({steps:installOnly,directory,loadEntries:async()=>entries,probeFn:async entry=>ok(entry),...quiet}),1);
 assert.deepEqual(await readdir(directory),['install_info.json']);
}));
test('--headless is accepted alone and rejects display or listen options',()=>{
 assert.equal(parseArgs(['--headless']).headless,true);
 for(const extra of [['--browser'],['--no-open'],['--foreground'],['--port','0'],['--base-path','/x/']])assert.throws(()=>parseArgs(['--headless',...extra]));
});
test('full diagnosis includes provider model info after installation',()=>{
 assert.deepEqual(STEPS.map(step=>step.id),['install','models']);assert.equal(STEPS[1].file,null);
});
test('models step tests only model providers that can be tested (2 at a time) and saves one file per provider',async()=>folder(async directory=>{
 let active=0,maximum=0;const tested=[],lines=[];
 const statusFn=async()=>({項目:[{id:'gemini',名前:'Gemini',テスト可能:true},{id:'claude',名前:'Claude',テスト可能:false},{id:'openrt_chat',名前:'OpenRouter',テスト可能:true},{id:'ollama',名前:'Ollama',テスト可能:true},{id:'discord',名前:'Discord',テスト可能:true},{id:'slack',名前:'Slack Bot',テスト可能:true}]});
 const testFn=async(id,{publicCache})=>{active++;maximum=Math.max(maximum,active);tested.push(id);assert.equal(publicCache.公開状態,'取得済');await new Promise(r=>setTimeout(r,10));active--;return id==='ollama'?{id,状態:'NG',モデル:[],モデル詳細:[]}:{id,状態:'OK',モデル:['m'],モデル詳細:[{model_id:'m'}]};};
 const publicCache={refresh:async()=>({}),input:()=>({公開モデル:{},公開状態:'取得済'})};
 const result=await modelsStep({configReader:()=>'{}',directory,statusFn,testFn,publicCache,log:line=>lines.push(line)});
 assert.deepEqual(tested.sort(),['gemini','ollama','openrt_chat']);assert.equal(maximum,2);
 assert.deepEqual(result.集計,{OK:2,NG:1});assert.deepEqual(result.保存先,['gemini_models_info.json','openrt_chat_models_info.json','openrt_free_models_info.json','ollama_models_info.json','chat_models_info.json','live_models_info.json','code_models_info.json','navi_models_info.json','hermes_models_info.json','prediction_models_info.json','decisions_models_info.json','live_voices_info.json']);
 assert.deepEqual((await readdir(directory)).sort(),['chat_models_info.json','code_models_info.json','decisions_models_info.json','gemini_models_info.json','hermes_models_info.json','live_models_info.json','live_voices_info.json','navi_models_info.json','ollama_models_info.json','openrt_chat_models_info.json','openrt_free_models_info.json','prediction_models_info.json']);
 assert.ok(lines.some(line=>line.includes('NG  Ollama')));
}));


test('headless passes current installation results and saves missing Ollama without fetching models',async()=>folder(async directory=>{
 const {testKey,runModels}=await import('../モデル情報/key_status.mjs');
 const providers=[{id:'ollama',名前:'Ollama',テスト可能:true}];
 for(const state of ['OK','未検出','OK']){
  let calls=0;
  const models={...STEPS[1],run:options=>modelsStep({...options,statusFn:async()=>({項目:providers}),configReader:()=> '{}',publicCache:{refresh:async()=>({}),input:()=>({})},testFn:(id,options)=>testKey(id,{...options,run:(action,id,options)=>runModels(action,id,{...options,reader:async()=> '{}',fetch:async provider=>{assert.equal(provider,'ollama-local');calls++;return {models:[{name:'fixture:latest'}]};}})})})};
  const code=await runHeadless({directory,steps:[STEPS[0],models],loadEntries:async()=>[{id:'ollama',name:'Ollama'}],probeFn:async()=>({id:'ollama',状態:state}),...quiet});
  assert.equal(code,0);assert.equal(calls,state==='未検出'?0:1);
  const saved=JSON.parse(await readFile(path.join(directory,'ollama_models_info.json'),'utf8'));
  assert.equal(saved.状態,state==='未検出'?'未実施':'OK');assert.equal(saved.chat.件数,calls);
 }
}));
