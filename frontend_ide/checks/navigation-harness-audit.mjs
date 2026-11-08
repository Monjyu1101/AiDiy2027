// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// step-9: 旧ハーネスの見出し完全一致だけを現行画面で照合。元の8本の再現試験ではない。
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {startDevelopment} from '../server.mjs';
const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});
const base=mkdtempSync(join(tmpdir(),'aidiy-nav-harness-audit-')),project=join(base,'公開試験');mkdirSync(project);
writeFileSync(join(project,'README.md'),'# 公開画面試験\n実AIは呼び出しません。\n');
const scope={active:true,connected:true,mode:'online',startedAt:Date.now(),project:{name:'公開試験',path:project}};
const connection={state:()=>scope,connect:async()=>scope,close(){}};
let calls=0;
const app=await startDevelopment(project,{kind:'navi',connection,navigationOptions:{stateRoot:join(base,'state'),modelFile:join(base,'model.json'),defaultModel:async()=>({provider:'aidiy_hermes',model:'auto'}),runAgent:async({prompt})=>{
 calls++;const shape=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
 const items=[{id:'read',name:'READMEの確認',progress:100,weight:50,weightReason:'試験用の固定配分',reason:'模擬確認済み'},{id:'approval',name:'別途の手動承認',progress:0,weight:50,weightReason:'試験用の固定配分',reason:'未実施'}];
 return {content:JSON.stringify({...shape,items,overall:{progress:50,reason:'模擬表示の試験'},nextItemId:'approval',nextPrompt:'利用者の別途の手動承認を確認してください。'})};
}}});
const runtime=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');
const {chromium}=await import(pathToFileURL(runtime).href);
const chrome=process.env.CHROME_PATH||join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe');
let browser;
try{
 assert.ok(existsSync(chrome),'Chromeが利用できない');
 const config=await(await fetch(new URL('development/config',app.url))).json();
 const endpoint=new URL('api/navigation?instance='+config.navigationInstance,app.url);
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal:'公開資料の確認',action:'navigate',clientRequestId:'step9-mock-heading'})});assert.equal(response.status,202);
 for(let i=0;i<100;i++){const value=await(await fetch(endpoint)).json();if(value.job.status==='complete')break;assert.equal(value.job.status,'running');await new Promise(done=>setTimeout(done,20));}
 browser=await chromium.launch({executablePath:chrome,headless:true});
 const page=await browser.newPage({viewport:{width:600,height:900}});let loadedBundleHash;
 page.on('response',async response=>{if(new URL(response.url()).pathname==='/development/app.js')loadedBundleHash=createHash('sha256').update(await response.body()).digest('hex');});
 await page.goto(app.url);await page.locator('.navigation-task-heading').waitFor();
 const actual=await page.locator('.navigation-task-heading').textContent();
 const fixture=readFileSync(new URL('../scripts/check-navigation.mjs',import.meta.url),'utf8');
 const legacyPresent=fixture.includes("document.querySelector('.navigation-task-heading').textContent`),'タスク'");
 const currentPresent=fixture.includes("assert.match(await child(0,`document.querySelector('.navigation-task-heading').textContent`),/^タスク");
 assert.ok(legacyPresent||currentPresent);
 const assertionLine=fixture.split(/\r?\n/).find(line=>line.includes("assert.match(await child(0,`document.querySelector('.navigation-task-heading').textContent`),"));
 const sourcePattern=assertionLine?.match(/,(\/\^.*\/)\);/)?.[1];
 assert.notEqual(actual,'タスク');
 const currentAssertionPass=!!sourcePattern&&vm.runInNewContext(sourcePattern).test(actual);
 if(currentPresent)assert.ok(currentAssertionPass,'ハーネス自身の正規表現で実画面の見出しを検証');
 assert.equal(calls,1);await page.screenshot({path:join(output,'見出し照合.png')});
 const record={at:new Date().toISOString(),scope:'現行ハーネスの見出し完全一致1箇所だけ。過去8本の復元ではない。',source:'frontend_ide/scripts/check-navigation.mjs',legacyExpected:'タスク',actual,legacyAssertionPass:false,currentAssertionPass,currentHeadingIncludesDate:true,classification:'旧期待値と現行仕様の不整合。見出しの日時形式を検証するよう限定修正。',mockAgentCalls:calls,externalAIRequests:0,isolatedState:true,loadedBundleHash};
 writeFileSync(join(output,'heading.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
}finally{await browser?.close();await app.close();}
