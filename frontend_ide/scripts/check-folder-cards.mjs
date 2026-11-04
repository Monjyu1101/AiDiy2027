// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// オフラインfixtureだけで2Dカードの実寸・操作を検証し、画面を保存する。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {startDevelopment} from '../server.mjs';

const chromePath=process.env.CHROME_PATH||[
 [process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'],
 [process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'],
 [process.env.PROGRAMFILES,'Microsoft/Edge/Application/msedge.exe'],
].filter(([base])=>base).map(([base,name])=>join(base,name)).find(existsSync)
 || ['/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
assert.ok(chromePath,'Chrome / Edge が必要です。CHROME_PATH で指定できます。');
const project=mkdtempSync(join(tmpdir(),'aidiy-folder-cards-'));
const profile=mkdtempSync(join(tmpdir(),'aidiy-folder-browser-'));
const longName='長い日本語の設計資料と開発手順をまとめたフォルダ'.repeat(2);
for(const name of ['空フォルダ',longName,...Array.from({length:22},(_,i)=>`開発資料${i+1}`)])mkdirSync(join(project,name));
writeFileSync(join(project,'README.txt'),'カード表示の確認用ファイルです。');
const app=await startDevelopment(project);
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws;
try{
 const {readFileSync}=await import('node:fs');let port;
 for(let i=0;i<50&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
 assert.ok(port,'テスト用ブラウザに接続できません。');
 const target=(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
 let sequence=0;const pending=new Map(),errors=[];
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++sequence,resolve);ws.send(JSON.stringify({id:sequence,method,params}));});
 async function evaluate(expression){const message=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(message.error,undefined);assert.equal(message.result?.exceptionDetails,undefined,JSON.stringify(message.result?.exceptionDetails));return message.result.result.value;}
 async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail(`画面待機: ${expression}`);}
 const output=resolve('temp/folder-card-check');mkdirSync(output,{recursive:true});
 const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(/\D/g,'');
 let shotNumber=0;const shots=[];
 async function capture(name){const result=await send('Page.captureScreenshot',{format:'png'});const file=join(output,`${stamp}-${++shotNumber}-${name}.png`);writeFileSync(file,Buffer.from(result.result.data,'base64'));shots.push(file);}
 await send('Runtime.enable');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:app.url});
 await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='オフライン利用')`);
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
 await until(`!!document.querySelector('.ide-view-modes')`);
 await evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
 await until(`!!document.querySelector('.space-filter-toggle')`);
 await evaluate(`(()=>{const button=document.querySelector('.space-filter-toggle');if(button.getAttribute('aria-checked')==='true')button.click();})()`);
 await until(`document.querySelectorAll('[data-page-layer="live"] .folder-page-entry.folder').length>=24`);
 const layouts=[];
 for(const [width,height] of [[1280,800],[768,1000],[390,844],[1280,420]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('[data-page-layer="live"]').scrollTop=0`);await sleep(100);
  const layout=await evaluate(`(()=>{
   const body=document.querySelector('[data-page-layer="live"]'),folders=[...body.querySelectorAll('.folder-page-entry.folder')],file=body.querySelector('.folder-page-entry:not(.folder)'),rects=folders.map(e=>e.getBoundingClientRect());
   return {count:folders.length,columns:new Set(rects.map(r=>Math.round(r.left))).size,overflow:body.scrollWidth>body.clientWidth,filesAfter:Math.min(file.getBoundingClientRect().top)>=Math.max(...rects.map(r=>r.bottom)),minHeight:Math.min(...rects.map(r=>r.height)),namesFit:folders.every(e=>{const n=e.querySelector('.folder-page-name');return n.scrollWidth<=n.clientWidth&&n.scrollHeight<=n.clientHeight;}),fileHeight:file.getBoundingClientRect().height};
  })()`);
  assert.equal(layout.overflow,false);assert.equal(layout.filesAfter,true);assert.equal(layout.namesFit,true);assert.ok(layout.minHeight>=111);assert.ok(layout.count>=24);
  if(width===1280)assert.ok(layout.columns>1);if(width===390)assert.equal(layout.columns,1);
  layouts.push({width,height,...layout});await capture(`${width}x${height}`);
 }
 await evaluate(`document.querySelector('[data-page-layer="live"] [title="空フォルダ"]').click()`);
 await until(`!!document.querySelector('[data-page-layer="live"] .folder-page-empty')`);await capture('empty');
 await evaluate(`document.querySelector('button[title^="親フォルダ"]').click()`);
 await until(`document.querySelectorAll('[data-page-layer="live"] .folder-page-entry.folder').length>=24`);
 assert.equal(await evaluate(`document.querySelector('[data-page-layer="live"] [data-cursor="true"]').title`),'空フォルダ');
 await evaluate(`(()=>{const body=document.querySelector('[data-page-layer="live"]');body.focus();body.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));})()`);
 await until(`document.querySelector('[data-page-layer="live"] [data-cursor="true"]')?.title==='README.txt'`);
 await evaluate(`document.querySelector('[data-page-layer="live"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
 await until(`!!document.querySelector('.viewer-popup')`);await capture('file-preview');
 assert.equal(await evaluate(`document.querySelector('.ide-view-modes [aria-pressed="true"]').textContent`),'2D');
 assert.deepEqual(errors,[]);
 const evidence={layouts,operations:['空フォルダを開く','親へ戻る','選択復元','End/Enterでファイル表示'],shots,errors};
 writeFileSync(join(output,'result.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}finally{
 ws?.close();chrome.kill();await app.close();await sleep(300);
 for(const folder of [project,profile]){
  if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');
  try{rmSync(folder,{recursive:true,force:true});}catch{/* ブラウザが保持中の一時ファイルは残す。 */}
 }
}
