// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {callMcp,localRequest} from '../モデル試行/trials.mjs';
import {decisionQuestions} from '../モデル試行/defaults.mjs';

test('isolated Decisions API contract through real MCP SDK to Diag', {skip:!process.env.DIAG_TEST_PYTHON,timeout:90000},async()=>{
 const child=spawn(process.env.DIAG_TEST_PYTHON,[fileURLToPath(new URL('./fixtures/decision_tools.py',import.meta.url))],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let errors='';child.stderr.on('data',chunk=>errors+=chunk);
 const lines=createInterface({input:child.stdout});
 try{
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('fixture startup: '+errors)),60000);
   lines.once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line).port);});
   child.once('error',reject);
   child.once('exit',()=>{clearTimeout(timer);reject(new Error('fixture exit: '+errors));});
  });
  const row={区分:'DECISION',プロバイダ:'openai_decisions',モデル:'gpt-6-luna',入力:'おはよう',質問:decisionQuestions()};
  const run=入力=>callMcp({...row,入力},{PORT_TOOLS:port},{request:localRequest,manual:{prompt:入力,questions:decisionQuestions()}});
  const result=await run('おはよう');
  assert.equal(result.status,'OK');assert.equal(result.data.model,'openai_decisions/gpt-6-luna');
  assert.equal(result.data.answers[0].choice,'medium');assert.equal(result.data.usage.total_tokens,25);
  const refusal=await run('refusal');assert.equal(refusal.data.answers[0].type,'refusal');
  await assert.rejects(run('http-error'),error=>/HTTP 400/.test(error.message)&&!error.message.includes('synthetic-secret'));
  await assert.rejects(run('malformed'),/応答形式/);
 }finally{lines.close();child.kill();}
});
