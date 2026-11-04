// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// オフラインfixtureでIDE内のすりガラスとピン留め別窓の分離を実画面検証する。
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
const project=mkdtempSync(join(tmpdir(),'aidiy-glass-'));
const profile=mkdtempSync(join(tmpdir(),'aidiy-glass-browser-'));

mkdirSync(join(project,'src'));
writeFileSync(join(project,'src','sample.txt'),'Glass panel fixture\nReadable text stays opaque.\n');
writeFileSync(join(project,'README.txt'),'Second fixture file.');
const app=await startDevelopment(project);
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sockets=[],errors=[],shots=[];
const output=resolve('temp/glass-panel-check');mkdirSync(output,{recursive:true});
const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14);
async function connect(target){
 const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let sequence=0;const pending=new Map();
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++sequence,resolve);ws.send(JSON.stringify({id:sequence,method,params}));});
 async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(r.error,undefined);assert.equal(r.result?.exceptionDetails,undefined,JSON.stringify(r.result?.exceptionDetails));return r.result.result.value;}
 async function until(expression){for(let i=0;i<200;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail('画面待機: '+expression);}
 async function capture(name){const r=await send('Page.captureScreenshot',{format:'png'});const file=join(output,`${stamp}-${shots.length+1}-${name}.png`);writeFileSync(file,Buffer.from(r.result.data,'base64'));shots.push(file);}
 await send('Runtime.enable');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 return {send,evaluate,until,capture};
}
const styles=`(()=>{
 const value=selector=>{const e=document.querySelector(selector);if(!e)return null;const pseudo=selector==='.explorer-routes'?getComputedStyle(e,'::before'):null;const s=pseudo?.content==='""'?pseudo:getComputedStyle(e);return {background:s.backgroundColor,blur:s.backdropFilter,opacity:s.opacity,color:s.color};};
 return {explorer:value('.explorer-panel'),bar:value('.explorer-routes'),list:value('.route-file-list'),viewer:value('.viewer-popup'),folder:value('.explorer-panel li[data-path="src"] .file-name'),icon:value('.explorer-panel li[data-path="src"] .file-type-icon'),count:value('.explorer-panel li[data-path="src"] .file-meta'),text:value('.viewer-popup header span')};})()`;
const removeGlass=`(()=>{for(const sheet of document.styleSheets){for(let index=0;index<sheet.cssRules.length;index++){const rule=sheet.cssRules[index];if(rule instanceof CSSSupportsRule&&rule.cssText.includes('.development-app.ide .space-view')&&rule.cssText.includes('backdrop-filter')){window.glassRule={sheet,index,text:rule.cssText};sheet.deleteRule(index);return true;}}}return false;})()`;
const restoreGlass=`glassRule.sheet.insertRule(glassRule.text,glassRule.index)`;
try{
 const {readFileSync}=await import('node:fs');let port;
 for(let i=0;i<50&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
 assert.ok(port);const targets=async()=>await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const main=await connect((await targets()).find(t=>t.type==='page'));
 await main.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await main.send('Page.navigate',{url:app.url});
 await main.until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='オフライン利用')`);
 await main.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
 await main.until('!!window.aidiyIDE');await main.evaluate('aidiyIDE.setAutoSpin(false);aidiyIDE.interact()');
 await main.evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
 await main.until(`!!document.querySelector('.folder-pages')`);
 await main.evaluate(`aidiyIDE.goTo({type:'file',path:'src/sample.txt'})`);
 await main.until(`!!document.querySelector('.viewer-popup .viewer-meta')`);await sleep(350);
 await main.evaluate(`document.querySelector('.explorer-toggle').click()`);
 await main.evaluate(`Array.from(document.querySelectorAll('.since-presets button')).find(b=>b.textContent==='今日').click()`);
 await main.until(`document.querySelector('.explorer-panel li[data-path="src"]')?.classList.contains('fresh')`);
 await main.evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='閲覧軌跡').click()`);
 await main.until(`!!document.querySelector('.route-file-list')`);
 const glass2d=await main.evaluate(styles);
 for(const name of ['explorer','bar','list','viewer']){assert.equal(glass2d[name].background,'rgba(7, 11, 23, 0.82)');assert.equal(glass2d[name].blur,'blur(4px)');assert.equal(glass2d[name].opacity,'1');}
 assert.equal(glass2d.text.opacity,'1');assert.equal(glass2d.folder.opacity,'1');assert.equal(glass2d.icon.opacity,'1');
 await main.capture('embedded-2d');
 // 非対応時を、@supportsの強化ルールを除去して模擬する。基礎CSSは書き換えない。
 assert.equal(await main.evaluate(removeGlass),true);const fallback=await main.evaluate(styles);
 for(const name of ['explorer','bar','list','viewer']){assert.equal(fallback[name].blur,'none');assert.ok(Number(fallback[name].background.match(/, ([\d.]+)\)$/)?.[1]||1)>.9);}
 for(const name of ['folder','icon','count','text']){assert.equal(glass2d[name].color,fallback[name].color);assert.equal(glass2d[name].opacity,fallback[name].opacity);}
 await main.capture('fallback-no-backdrop');await main.evaluate(restoreGlass);
 await main.evaluate(`document.querySelector('[aria-label="最新の内容に更新"]').click()`);await main.until(`!document.querySelector('[aria-label="最新の内容に更新"]').disabled`);
 await main.evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='閲覧軌跡').click()`);
 await main.evaluate(`document.querySelector('[aria-label="エクスプローラーを閉じる"]').click()`);
 await main.evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='3D').click()`);await sleep(350);
 await main.evaluate(`document.querySelector('.explorer-toggle').click();Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='閲覧軌跡').click()`);
 const glass3d=await main.evaluate(styles);for(const name of ['explorer','bar','list','viewer'])assert.equal(glass3d[name].blur,'blur(4px)');await main.capture('embedded-3d');
 // 実際のピン留めボタンで別ターゲットを起動し、元画面のプレビューが閉じることも確認。
 await main.evaluate(`document.querySelector('[aria-label="ファイルを別ウィンドウで開く"]').click()`);
 let popup;for(let i=0;i<100&&!popup;i++){popup=(await targets()).find(t=>t.type==='page'&&t.url.includes('#viewer='));if(!popup)await sleep(50);}
 assert.ok(popup,'ピン留めの別ウィンドウ');const pinned=await connect(popup);
 await pinned.send('Emulation.setDeviceMetricsOverride',{width:680,height:780,deviceScaleFactor:1,mobile:false});
 await pinned.until(`!!document.querySelector('.viewer-pinned .viewer-meta')`);await sleep(350);
 await main.until(`!document.querySelector('.viewer-popup')`);
 const pinnedStyle=`(()=>{const a=getComputedStyle(document.querySelector('.viewer-window')),b=getComputedStyle(document.querySelector('.viewer-pinned'));return {background:a.backgroundColor,panel:b.backgroundColor,blur:b.backdropFilter,opacity:b.opacity,text:document.querySelector('.viewer-pinned header span').textContent,space:!!document.querySelector('.space-view')};})()`;
 const pinnedAfter=await pinned.evaluate(pinnedStyle);assert.equal(pinnedAfter.background,'rgb(8, 12, 26)');assert.equal(pinnedAfter.blur,'none');assert.equal(pinnedAfter.opacity,'1');assert.equal(pinnedAfter.space,false);
 assert.equal(await pinned.evaluate(removeGlass),true);assert.deepEqual(await pinned.evaluate(pinnedStyle),pinnedAfter,'新CSSの有無で別窓の背景が変わらない');await pinned.evaluate(restoreGlass);
 await pinned.evaluate(`document.querySelector('[aria-label="最新の内容に更新"]').click()`);await pinned.until(`!document.querySelector('[aria-label="最新の内容に更新"]').disabled`);await pinned.capture('pinned-unchanged');
 assert.deepEqual(errors,[]);
 const evidence={glass2d,glass3d,fallback,pinned:pinnedAfter,operations:['2D/3Dの面・文字・アイコン・件数色','非対応時のfallback模擬','画面内で更新・開閉','実ピン留めと別窓更新','別窓にスタイルが漏れない'],shots,errors};
 writeFileSync(join(output,'result.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}finally{
 for(const ws of sockets)ws.close();chrome.kill();await app.close();await sleep(300);
 for(const folder of [project,profile]){if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');try{rmSync(folder,{recursive:true,force:true});}catch{}}
}
