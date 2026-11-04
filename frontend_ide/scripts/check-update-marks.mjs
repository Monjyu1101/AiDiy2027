// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// オフラインfixtureで更新強調・光輪・日付境界・描画停止を実画面検証する。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync,unlinkSync} from 'node:fs';
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
const project=mkdtempSync(join(tmpdir(),'aidiy-marks-'));
const profile=mkdtempSync(join(tmpdir(),'aidiy-marks-browser-'));


const now=Date.now(),today=new Date();today.setHours(0,0,0,0);const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
const dates={'earlier.txt':+today+1,'latest-a.js':now,'latest-b.py':now,'yesterday.md':+yesterday+1,'old.json':+yesterday-1};
for(const [name,date]of Object.entries(dates)){writeFileSync(join(project,name),'fixture '+name);utimesSync(join(project,name),date/1000,date/1000);}
mkdirSync(join(project,'child'));writeFileSync(join(project,'child','newer.txt'),'nested');
const app=await startDevelopment(project);
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sockets=[],errors=[],shots=[];
const output=resolve('temp/update-marks-check');mkdirSync(output,{recursive:true});
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

try{
 const {readFileSync}=await import('node:fs');let port;
 for(let i=0;i<50&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
 assert.ok(port);const targets=async()=>await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const main=await connect((await targets()).find(t=>t.type==='page'));
 await main.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1.5,mobile:false});
 await main.send('Page.navigate',{url:app.url});
 await main.until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='オフライン利用')`);
 await main.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
 await main.until('!!window.aidiyIDE?.world');await main.evaluate('aidiyIDE.setAutoSpin(false);aidiyIDE.interact()');
 await main.evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
 await main.until(`document.querySelectorAll('.updated-latest').length===2`);
 const first=await main.evaluate('aidiyIDE.updateMarks');assert.deepEqual(first.levels,{'earlier.txt':1,'latest-a.js':2,'latest-b.py':2});assert.deepEqual(first.flashes,{});
 assert.equal(await main.evaluate(`document.querySelectorAll('.updated-today').length`),3);
 await main.capture('2d-today-and-tied-latest');
 await main.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await main.evaluate('aidiyIDE.refresh()');assert.deepEqual(await main.evaluate('aidiyIDE.updateMarks.flashes'),{});
 writeFileSync(join(project,'earlier.txt'),'actually changed fixture');utimesSync(join(project,'earlier.txt'),(now+1000)/1000,(now+1000)/1000);
 await main.evaluate('aidiyIDE.refresh()');
 assert.deepEqual(await main.evaluate('Object.keys(aidiyIDE.updateMarks.flashes)'),['earlier.txt']);
 assert.equal(await main.evaluate(`document.querySelectorAll('.file-update-pulse').length`),1);
 await sleep(350);await main.capture('2d-one-changed-row');
 await main.until(`Object.keys(aidiyIDE.updateMarks.flashes).length===0`);
 await main.evaluate(`aidiyIDE.goTo({type:'file',path:'latest-b.py'})`);
 unlinkSync(join(project,'old.json'));writeFileSync(join(project,'added.txt'),'new file');utimesSync(join(project,'added.txt'),(now-1000)/1000,(now-1000)/1000);
 await main.evaluate('aidiyIDE.refresh()');assert.equal(await main.evaluate('aidiyIDE.selected.path'),'latest-b.py');assert.deepEqual(await main.evaluate('Object.keys(aidiyIDE.updateMarks.flashes)'),['added.txt']);
 assert.equal(await main.evaluate(`aidiyIDE.world.planets.some(file=>file.path==='old.json')`),false);
 await main.evaluate('aidiyIDE.clear()');

 await main.evaluate(`aidiyIDE.goTo({type:'dir',path:'child'})`);assert.deepEqual(await main.evaluate('aidiyIDE.updateMarks.flashes'),{});
 await main.evaluate(`aidiyIDE.goTo({type:'dir',path:''})`);assert.deepEqual(await main.evaluate('aidiyIDE.updateMarks.flashes'),{});
 await main.evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='3D').click()`);
 await main.evaluate(`Object.assign(aidiyIDE.cam,{tx:0,ty:0,tz:0,dist:aidiyIDE.world.radius*2.5,yaw:0,pitch:0,roll:0});Object.assign(aidiyIDE.goal,aidiyIDE.cam)`);await sleep(2500);await main.capture('galaxy-update-halos');
 await main.evaluate(`const body=aidiyIDE.world.planets.find(file=>file.path==='earlier.txt');Object.assign(aidiyIDE.cam,{tx:body.x,ty:body.y,tz:body.z,dist:350});Object.assign(aidiyIDE.goal,aidiyIDE.cam)`);await sleep(100);await main.capture('galaxy-latest-halo-close');
 await main.evaluate(`const todayBody=aidiyIDE.world.planets.find(file=>file.path==='latest-a.js');Object.assign(aidiyIDE.cam,{tx:todayBody.x,ty:todayBody.y,tz:todayBody.z,dist:350});Object.assign(aidiyIDE.goal,aidiyIDE.cam)`);await sleep(300);await main.capture('galaxy-today-halo-close');
 await main.evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
 // 日跨ぎは実時間を待たず、復帰時の再判定経路で確認する。
 const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);
 await main.evaluate(`window.originalNow=Date.now;Date.now=()=>${+tomorrow+1000};document.dispatchEvent(new Event('visibilitychange'))`);
 await main.until(`document.querySelectorAll('.updated-today').length===0`);
 assert.deepEqual(await main.evaluate('aidiyIDE.updateMarks.levels'),{});
 await main.evaluate(`Date.now=originalNow;document.dispatchEvent(new Event('visibilitychange'))`);
 assert.deepEqual(errors,[]);
 const result={first,shots,errors,operations:['初回は静的','同率最新2件','子フォルダ除外','無差分発光なし','変更行だけ1200ms','追加・削除と選択保持','移動時発光なし','黄金色・薄い黄色の外側へ薄くなるオーラ','衛星なし','ローカル日跨ぎ']};
 writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
 for(const ws of sockets)ws.close();chrome.kill();await app.close();await sleep(300);
 for(const folder of [project,profile]){if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');try{rmSync(folder,{recursive:true,force:true});}catch{}}
}
