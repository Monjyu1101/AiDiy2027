// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue / xterm / Chromiumのキー・clipboardを検証。PTYだけはfixtureとし、コマンドは実行しない。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startDevelopment} from '../server.mjs';
const project=mkdtempSync(join(tmpdir(),'aidiy-keyboard-project-')),profile=mkdtempSync(join(tmpdir(),'aidiy-keyboard-browser-'));
const app=await startDevelopment(project,{kind:'console'});
const executable=process.env.CHROME_PATH||['/usr/bin/chromium',...[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(base=>join(base,'Google/Chrome/Application/chrome.exe'))].find(existsSync);
const browser=spawn(executable,['--headless=new',...(process.platform==='linux'?['--no-sandbox']:[]),'--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','inherit'],windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let ws;
try{
 let port;for(let i=0;i<100&&!port;i++){if(browser.exitCode!==null)throw Error(`Chrome exited: ${browser.exitCode}`);try{port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];}catch{}if(!port)await sleep(100);}assert.ok(port,'Chrome did not start');
 const target=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(t=>t.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++id,resolve);ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.error||result.result.exceptionDetails)throw Error(JSON.stringify(result));return result.result.result.value;};
 const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(50);}throw Error(expression);};
 await send('Page.enable');
 await send('Runtime.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.inputs=[];window.WebSocket=class {static OPEN=1;readyState=1;constructor(){window.termSocket=this;setTimeout(()=>this.onopen?.(),0);}send(raw){const packet=JSON.parse(raw);if(packet.type==='input')inputs.push(packet.data);if(packet.type==='start')setTimeout(()=>this.receive({type:'ready',project:'/fixture',shell:'fixture',completion:false}),0);}receive(packet){this.onmessage?.({data:JSON.stringify(packet)});}close(){this.readyState=3;this.onclose?.();}};`});
 await send('Browser.grantPermissions',{origin:new URL(app.url).origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
 await send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await send('Page.navigate',{url:app.url});await until(`document.querySelector('.console-component')?.textContent.includes('実行中')`);
 const press=async(key,code,keyCode,modifiers=0)=>{await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`);for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:keyCode,modifiers,...(type==='keyDown'&&key.length===1&&!(modifiers&7)?{text:key}: {})});await sleep(40);};
 assert.equal(await evaluate(`document.querySelector('.auto-connect').textContent.trim()`),'Tools接続確認');
 assert.equal(await evaluate(`document.querySelector('.console-meta span:last-child').textContent.trim().startsWith('Tools ')`),true);
 await evaluate(`navigator.clipboard.writeText(${JSON.stringify('貼り付け日本語 •・·\nsecond line')})`);
 await press('v','KeyV',86,2);assert.deepEqual(await evaluate('inputs.splice(0)'),['貼り付け日本語 •・·\rsecond line']);
 await evaluate(`termSocket.receive({type:'data',data:'\\x1b[?2004h'})`);await sleep(60);
 await press('v','KeyV',86,2);assert.deepEqual(await evaluate('inputs.splice(0)'),['\x1b[200~貼り付け日本語 •・·\rsecond line\x1b[201~']);
 for(const [modifiers,expected] of [[0,'\r'],[1,'\x1b\r'],[8,'\x1b[13;2u'],[9,'\x1b[13;4u']]){await press('Enter','Enter',13,modifiers);assert.deepEqual(await evaluate('inputs.splice(0)'),[expected]);}
 await press('c','KeyC',67,2);assert.deepEqual(await evaluate('inputs.splice(0)'),[]);
 await press('d','KeyD',68,2);assert.deepEqual(await evaluate('inputs.splice(0)'),['\x04']);
 for(const shift of [0,8])for(let code=65;code<=90;code++){
  if(code===67||code===86)continue;
  await press(String.fromCharCode(code+(shift?0:32)),`Key${String.fromCharCode(code)}`,code,2|shift);
  assert.deepEqual(await evaluate('inputs.splice(0)'),[String.fromCharCode(code-64)],`Ctrl+${shift?'Shift+':''}${String.fromCharCode(code)}`);
 }
 for(const [key,code,keyCode,modifiers,expected] of [
  ['?','Slash',191,10,'\x7f'],['/','Slash',191,2,'\x1f'],['@','BracketLeft',192,2,'\x00'],
  ['^','Equal',187,2,'\x1e'],['_','IntlRo',226,10,'\x1f'],['!','Digit1',49,10,'\x1b[33;6u'],
  ['a','KeyA',65,1,'\x1ba'],['A','KeyA',65,9,'\x1bA'],['@','BracketLeft',192,1,'\x1b@'],
  ['d','KeyD',68,3,'\x1b\x04'],['D','KeyD',68,11,'\x1b\x04'],['A','KeyA',65,8,'A'],
  ['Enter','Enter',13,2,'\x1b[13;5u'],['Enter','Enter',13,10,'\x1b[13;6u'],['Enter','Enter',13,11,'\x1b[13;8u'],
  ['Tab','Tab',9,2,'\x1b[9;5u'],['Tab','Tab',9,9,'\x1b[9;4u'],['Tab','Tab',9,8,'\x1b[Z'],
  ['Insert','Insert',45,8,'\x1b[2;2~'],['PageUp','PageUp',33,8,'\x1b[5;2~'],['PageDown','PageDown',34,9,'\x1b[6;4~'],
  ['ArrowLeft','ArrowLeft',37,10,'\x1b[1;6D'],['F2','F2',113,9,'\x1b[1;4Q']
 ]){await press(key,code,keyCode,modifiers);assert.deepEqual(await evaluate('inputs.splice(0)'),[expected],`${key}, modifiers=${modifiers}`);}
 await press('ArrowUp','ArrowUp',38);assert.deepEqual(await evaluate('inputs.splice(0)'),['\x1b[A']);
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Ctrl+C送信').click()`);assert.deepEqual(await evaluate('inputs.splice(0)'),['\x03']);
 // ネイティブcopy経路も実xtermの選択モデルで確認する。
 await evaluate(`termSocket.receive({type:'data',data:'copy selection test'})`);await sleep(100);
 const point=await evaluate(`(()=>{const r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.left+20,y:r.top+8};})()`);
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:3});
 await press('c','KeyC',67,2);
 assert.ok((await evaluate('navigator.clipboard.readText()')).includes('copy selection test'));
 assert.deepEqual(await evaluate('inputs.splice(0)'),[]);
 await evaluate(`document.querySelector('.xterm-helper-textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,shiftKey:true,isComposing:true,bubbles:true,cancelable:true}))`);
 assert.deepEqual(await evaluate('inputs.splice(0)'),[]);
 const screenshot=await send('Page.captureScreenshot',{format:'png'});const output=resolve('temp/console-check');mkdirSync(output,{recursive:true});
 const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(/\D/g,'');
 const screenshotPath=join(output,`${stamp}_term-keyboard.png`);writeFileSync(screenshotPath,Buffer.from(screenshot.result.data,'base64'));
 console.log('PASS: Tools labels, native Ctrl+V, bracketed paste, copy, Ctrl letters/symbols, Alt/Shift combinations, Enter/Tab/Page/Insert, arrows, function keys, IME guard. Screenshot:',screenshotPath);
}finally{ws?.close();browser.kill();await app.close();await sleep(200);for(const folder of [profile,project]){if(!folder.startsWith(join(tmpdir(),'aidiy-keyboard-')))throw Error('一時パスが不正です。');rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});}}
