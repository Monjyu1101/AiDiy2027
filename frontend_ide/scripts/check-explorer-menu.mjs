// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 隔離ブラウザーと専用fixtureのみ。ゴミ箱は専用一時フォルダへの移動に置換する。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {startDevelopment} from '../server.mjs';
const chromePath=process.env.CHROME_PATH||['/usr/bin/chromium','/usr/bin/google-chrome',process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe')].filter(Boolean).find(existsSync);
assert.ok(chromePath,'CHROME_PATH に Chrome / Edge を指定してください。');
const fixture=mkdtempSync(join(tmpdir(),'aidiy-explorer-check-')),project=join(fixture,'project'),profile=join(fixture,'browser'),trash=join(fixture,'trash');
for(const folder of [project,profile,trash,join(project,'docs'),join(project,'target')])mkdirSync(folder);
writeFileSync(join(project,'docs','sample.txt'),'sample original');writeFileSync(join(project,'keep.txt'),'untouched');
const trashCalls=[];
const app=await startDevelopment(project,{explorerOptions:{native:{trash:async path=>{trashCalls.push(path);renameSync(path,join(trash,'recoverable.txt'));},rename:async(source,destination)=>{assert.equal(existsSync(destination),false);renameSync(source,destination);}}}});
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
let startupError='',chromeExited=false;chrome.stderr.on('data',chunk=>{startupError=(startupError+String(chunk)).slice(-2000);});chrome.on('error',error=>{startupError=error.message;chromeExited=true;});chrome.on('exit',()=>{chromeExited=true;});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));let ws;
try{
 let port;for(let n=0;n<100&&!port&&!chromeExited;n++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
 assert.ok(port,'隔離ブラウザーの起動失敗: '+startupError);const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(done=>ws.addEventListener('open',done,{once:true}));let sequence=0;const pending=new Map(),errors=[];
 ws.addEventListener('message',event=>{const result=JSON.parse(event.data);if(result.id){pending.get(result.id)?.(result);pending.delete(result.id);}if(result.method==='Runtime.exceptionThrown')errors.push(result.params.exceptionDetails);});
 const send=(method,params={})=>new Promise(done=>{pending.set(++sequence,done);ws.send(JSON.stringify({id:sequence,method,params}));});
 async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(result.error,undefined);assert.equal(result.result?.exceptionDetails,undefined,JSON.stringify(result.result?.exceptionDetails));return result.result.result.value;}
 async function until(expression){for(let n=0;n<100;n++){if(await evaluate(expression))return;await sleep(60);}assert.fail(`画面待機: ${expression}`);}
 const output=resolve('temp/explorer-menu-check');mkdirSync(output,{recursive:true});const shots=[];
 async function shot(name){await sleep(120);const result=await send('Page.captureScreenshot',{format:'png'});const file=join(output,name+'.png');writeFileSync(file,Buffer.from(result.result.data,'base64'));shots.push(file);}
 async function menu(path=''){const selector=path?`[role=treeitem][data-path=${JSON.stringify(path)}]`:'.explorer-root-name';await until(`!!document.querySelector(${JSON.stringify(selector)})`);await until(`!document.querySelector('.explorer-rename,.explorer-action-dialog')`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);await sleep(150);await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});const rect=node.getBoundingClientRect();node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+30,clientY:rect.top+10}));})()`);await until(`!!document.querySelector('.explorer-context-menu')`);}
 async function action(name){await evaluate(`document.querySelector('.explorer-context-menu [data-action="${name}"]').click()`);}
 async function name(value){await evaluate(`(()=>{const input=document.querySelector('.explorer-rename,.explorer-action-dialog input');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));if(input.closest('form'))input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);}
 await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:app.url});
 await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='オフライン利用')`);await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
 await until(`!!window.aidiyIDE`);await evaluate(`aidiyIDE.setAutoSpin(false);document.querySelector('.ide-view-modes button').closest('div').querySelectorAll('button')[1].click()`);
 await until(`!!document.querySelector('.space-filter-toggle')`);await evaluate(`if(document.querySelector('.space-filter-toggle').getAttribute('aria-checked')==='true')document.querySelector('.space-filter-toggle').click();if(document.querySelector('.explorer-toggle'))document.querySelector('.explorer-toggle').click()`);
 await until(`!!document.querySelector('[data-path="docs"]')`);await evaluate(`document.querySelector('[data-path="docs"] .chevron').click()`);await menu('docs/sample.txt');
 assert.equal(await evaluate(`document.querySelector('[data-action="paste"]').disabled`),true);assert.deepEqual(await evaluate(`[...document.querySelectorAll('.explorer-context-menu [role=menuitem]')].map(e=>e.dataset.action)`),['open-app','open-folder','handoff','copy-path','copy-relative','copy','paste','duplicate','rename','trash','create-file','create-folder']);await shot('01-context-menu');
 await action('copy');await menu('target');await action('paste');await until(`document.querySelector('.explorer-operation-status')?.textContent.includes('をコピーしました')`);assert.equal(readFileSync(join(project,'target','sample.txt'),'utf8'),'sample original');
 await menu('docs/sample.txt');await action('duplicate');await until(`!!document.querySelector('[data-path="docs/sample - コピー.txt"]')`);assert.equal(readFileSync(join(project,'docs','sample - コピー.txt'),'utf8'),'sample original');
 await menu('docs/sample.txt');await action('rename');await until(`!!document.querySelector('.explorer-rename')`);await shot('02-inline-rename');
 await evaluate(`document.querySelector('.explorer-rename').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true}))`);assert.equal(await evaluate(`!!document.querySelector('.explorer-rename')`),true);
 await evaluate(`document.querySelector('.explorer-rename').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);assert.equal(existsSync(join(project,'docs','sample.txt')),true);
 await menu('docs/sample.txt');await action('rename');await name('renamed.txt');await until(`!!document.querySelector('[data-path="docs/renamed.txt"]')`);assert.equal(existsSync(join(project,'docs','sample.txt')),false);
 await menu('docs/renamed.txt');await action('rename');await name('sample - コピー.txt');await until(`document.querySelector('.explorer-operation-status')?.textContent.includes('同じ名前')`);assert.equal(existsSync(join(project,'docs','renamed.txt')),true);await evaluate(`document.querySelector('.explorer-rename').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
 await menu();assert.equal(await evaluate(`document.querySelector('[data-action="trash"]').disabled`),true);await action('create-folder');await name('new folder');await until(`!!document.querySelector('[data-path="new folder"]')`);
 await menu('new folder');await action('create-file');await name('new.txt');await until(`!!document.querySelector('[data-path="new folder/new.txt"]')`);assert.equal(readFileSync(join(project,'new folder','new.txt'),'utf8'),'');
 await menu('docs/renamed.txt');await action('trash');await until(`!!document.querySelector('.explorer-action-dialog')`);await shot('03-trash-confirmation');assert.equal(trashCalls.length,0);await evaluate(`document.querySelector('.explorer-action-dialog [data-initial-focus]').click()`);assert.equal(trashCalls.length,0);
 await menu('docs/renamed.txt');await action('trash');await evaluate(`document.querySelector('.explorer-action-dialog .danger').click()`);await until(`!document.querySelector('[data-path="docs/renamed.txt"]')`);assert.equal(trashCalls.length,1);assert.equal(readFileSync(join(trash,'recoverable.txt'),'utf8'),'sample original');
 // ルートにフォーカスしたキーボードpasteは古いtree cursorではなくルートが対象。
 await menu('keep.txt');await action('copy');await evaluate(`(()=>{const root=document.querySelector('.explorer-root-name');root.focus();root.dispatchEvent(new KeyboardEvent('keydown',{key:'v',ctrlKey:true,bubbles:true,cancelable:true}));})()`);await until(`!!document.querySelector('[data-path="keep - コピー.txt"]')`);
 await shot('04-completed');assert.equal(readFileSync(join(project,'keep.txt'),'utf8'),'untouched');assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,trash:'dedicated temporary mock, not OS Trash',shots,errors},null,2));
}finally{ws?.close();chrome.kill();await app.close();await sleep(400);if(!resolve(fixture).startsWith(resolve(tmpdir())+sep))throw Error('fixture path');try{rmSync(fixture,{recursive:true,force:true});}catch{}}
