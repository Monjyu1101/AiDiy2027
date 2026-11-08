// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実ブラウザで初期高さ・小画面・再表示を撮影する。AIは呼び出さない。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startMockDevelopment as startDevelopment,mockOutput,mockStage,removeMockDirectory,readMockDebugPort} from '../checks/navigation-mock-support.mjs';
const chromePath=process.env.CHROME_PATH||['/usr/bin/chromium','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if(!chromePath)throw Error('CHROME_PATHにChrome / Edgeの実行パスを指定してください。');
const temporary=mkdtempSync(join(tmpdir(),'aidiy-navi-height-')),project=join(temporary,'project'),output=mockOutput('temp/navigation-height-check');
mkdirSync(project);mkdirSync(output,{recursive:true});writeFileSync(join(project,'README.md'),'# Navigator initial height fixture\n');
const navigationOptions={stateRoot:join(temporary,'navigation-state'),runAgent:()=>{throw Error('No AI request is permitted in this layout test');}};
const app=await startDevelopment(project,{kind:'navi',offline:true,navigationOptions});let ide,socket;
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${join(temporary,'browser')}`,'--window-size=1920,1080',...(process.platform==='linux'?['--no-sandbox']:[]),'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
let chromeError='';chrome.stderr.on('data',chunk=>{chromeError+=chunk;});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function until(check,label){mockStage(label);for(let i=0;i<300;i++){if(await check())return;await sleep(100);}throw Error('待機タイムアウト: '+label);}
try{
 const activePort=join(temporary,'browser','DevToolsActivePort');await until(()=>{if(chrome.exitCode!==null||chrome.signalCode!==null)throw Error('Browser stopped: '+chromeError);return existsSync(activePort);},'browser');
 let port;await until(()=>(port=readMockDebugPort(activePort)),'debug port readable');const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');
 socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');let id=0;const pending=new Map(),errors=[];
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('CDP timeout: '+method)),30000);pending.set(++id,value=>{clearTimeout(timer);done(value);});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});assert.equal(r.error,undefined);assert.equal(r.result?.exceptionDetails,undefined,JSON.stringify(r.result?.exceptionDetails));return r.result.result.value;};
 const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:1920,screenHeight:1080,deviceScaleFactor:1,mobile:false});await sleep(100);};
 const capture=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(r.result.data,'base64'));};
 await send('Runtime.enable');await send('Page.enable');await viewport(480,900);await send('Page.navigate',{url:app.url});
 await until(()=>evaluate(`!!document.querySelector('.navigation-panel.standalone textarea')`),'standalone');
 const layout=()=>evaluate(`(()=>{const p=document.querySelector('.navigation-panel'),r=p.getBoundingClientRect(),t=document.querySelector('textarea').getBoundingClientRect();return {top:r.top,height:r.height,bottom:r.bottom,width:r.width,viewport:innerHeight,goalBottom:t.bottom,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
 const normal=await layout();assert.ok(Math.abs(normal.height-900)<=2);assert.equal(normal.overflow,false);await capture('standalone-480x900');
 await viewport(384,464);const small=await layout();assert.ok(small.bottom<=464&&small.goalBottom<=464);assert.equal(small.overflow,false);await capture('standalone-small-384x464');
 await viewport(540,650);assert.ok((await layout()).bottom<=650);await viewport(480,900);assert.ok(Math.abs((await layout()).height-900)<=2);
 ide=await startDevelopment(project,{kind:'ide',navigationOptions});await viewport(1280,1000);await send('Page.navigate',{url:ide.url});
 await until(()=>evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='オフライン利用')`),'IDE start');
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='オフライン利用').click()`);await until(()=>evaluate(`!!window.aidiyIDE`),'IDE');
 // Popup blocking exercises the inline fallback; its measured bounds also supply real popup features.
 await evaluate(`aidiyIDE.setAutoSpin(false);window.heightFeatures=[];window.open=(url,name,features)=>{heightFeatures.push(features);return null;};document.querySelector('.navigation-launch').click()`);
 await until(()=>evaluate(`heightFeatures.length===1&&!!document.querySelector('.navigation-panel')`),'inline Navigator');
 const inline=await layout();assert.equal(inline.height,900);assert.ok(inline.bottom<=1000);assert.ok(await evaluate(`heightFeatures[0].includes('height=900')`));await capture('ide-inline-900');
 await viewport(640,600);const inlineSmall=await layout();assert.ok(inlineSmall.height<900&&inlineSmall.bottom<=600);await capture('ide-inline-small');
 await evaluate(`document.querySelector('.navigation-panel').style.setProperty('--workspace-top','140px')`);
 const lowerTop=await layout();assert.equal(lowerTop.top,140);assert.equal(lowerTop.height,444);assert.equal(lowerTop.bottom,584);await capture('ide-inline-lower-top');
 await evaluate(`document.querySelector('.navigation-panel').style.removeProperty('--workspace-top')`);
 await viewport(1280,1000);assert.equal((await layout()).height,900);

 assert.deepEqual(errors,[]);
 const result={pass:true,ai:'not invoked',checks:['standalone 480x900','small screen 384x464','manual viewport resize and return','IDE inline 900','browser popup initial height features','small IDE viewport','IDE top offset and 16px bottom margin','IDE viewport resize and return'],normal,small,inline,inlineSmall,lowerTop};
 writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}await ide?.close();await app.close();removeMockDirectory(temporary);
}
