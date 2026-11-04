// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 診断の実際の合成ファイルを模擬ホストへ渡し、外部AIに接続せず選択画面を撮影する。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startDevelopment} from '../server.mjs';

const read=group=>JSON.parse(readFileSync(`_AIDIY/aidiy_diag/${group}_models_info.json`,'utf8'));
const code=read('code'),live=Object.fromEntries(Object.entries(read('live')).map(([key,entry])=>[key,entry.models]));
const voices=Object.fromEntries(Object.entries(JSON.parse(readFileSync('_AIDIY/aidiy_diag/live_voices_info.json','utf8'))).map(([key,entry])=>[key,entry.voices]));
const app=await startDevelopment(resolve('frontend_ide'));
const profile=mkdtempSync(join(tmpdir(),'aidiy-model-catalog-'));
const executable=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]
  .filter(Boolean).flatMap(base=>['Google/Chrome/Application/chrome.exe','Microsoft/Edge/Application/msedge.exe'].map(file=>join(base,file))).find(existsSync);
if(!executable)throw Error('Chrome / Edge が見つかりません。');
const port=9400+Math.floor(Math.random()*500);
const chrome=spawn(executable,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1280,800','--hide-scrollbars','--no-first-run','about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws;
try{
 let pages;
 for(let i=0;i<60;i++){try{pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();if(pages.some(p=>p.type==='page'))break;}catch{}await sleep(100);}
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
 let sequence=0;const pending=new Map();
 ws.addEventListener('message',event=>{const value=JSON.parse(event.data);if(pending.has(value.id)){pending.get(value.id)(value);pending.delete(value.id);}});
 const send=(method,params={})=>new Promise(resolve=>{const id=++sequence;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.result.exceptionDetails)throw Error(JSON.stringify(value.result.exceptionDetails));return value.result.result.value;};
 await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 const fixture=readFileSync(new URL('../checks/host-fixture.js',import.meta.url),'utf8');
 const output=resolve('temp/model-catalog-check');mkdirSync(output,{recursive:true});
 const stamp=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Tokyo'}).replace(/\D/g,'');
 let previous;
 for(const kind of ['code','live']){
  if(previous)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:previous});
  const provider=Object.keys(live)[0],vendor=provider.replace(/_live$/,'').toUpperCase();
  const source=`window.fixtureKind=${JSON.stringify(kind)};\n${fixture}\n`+
   `const codeCatalog=${JSON.stringify(code)},liveCatalog=${JSON.stringify(live)},voiceCatalog=${JSON.stringify(voices)};`+
   `Object.assign(fixtureSettings,{LIVE_AI_NAME:${JSON.stringify(provider)},${`LIVE_${vendor}_MODEL`}:${JSON.stringify(Object.keys(live[provider])[0])},${`LIVE_${vendor}_VOICE`}:'Zephyr'});`+
   `fixtureHold=packet=>{if(packet.type==='modelCatalog'){const items=packet.provider?Object.entries(codeCatalog[packet.provider]?.models||{}).map(([id,label])=>({id,label})):Object.keys(codeCatalog).map(id=>({id,label:id}));setTimeout(()=>window.postMessage({...packet,items},'*'),0);return true;}`+
   `if(packet.value?.data?.available_models){packet.value.data.available_models.live_models=liveCatalog;packet.value.data.available_models.live_voices=voiceCatalog;}return false;};`;
  previous=(await send('Page.addScriptToEvaluateOnNewDocument',{source})).result.identifier;
  await send('Page.navigate',{url:app.url});await sleep(1500);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='モデル ▾').click()`);await sleep(200);
  if(kind==='code'){
   await evaluate(`const select=document.querySelector('.model-dialog select');select.value='copilot_cli';select.dispatchEvent(new Event('change',{bubbles:true}));`);await sleep(200);
   const labels=await evaluate(`Array.from(document.querySelectorAll('.model-dialog select')[1].options).map(option=>option.textContent)`);
   assert.ok(labels.includes(code.copilot_cli.models['claude-haiku-5.5']));
  }else{
   const ids=await evaluate(`Array.from(document.querySelectorAll('.model-dialog select')[1].options).map(option=>option.value)`);
   assert.deepEqual(ids,Object.keys(live[provider]));
  }
  const screenshot=await send('Page.captureScreenshot',{format:'png'});
  const file=join(output,`${stamp}-${kind}.png`);writeFileSync(file,Buffer.from(screenshot.result.data,'base64'));console.log(file);
 }
 console.log('合成ファイルのCode表示名・Live候補順を実画面で確認しました。');
}finally{
 ws?.close();chrome.kill();await app.close();await sleep(300);
 if(!resolve(profile).startsWith(resolve(tmpdir())+(process.platform==='win32'?'\\':'/')))throw Error('一時パスが不正です');
 try{rmSync(profile,{recursive:true,force:true});}catch{}
}
