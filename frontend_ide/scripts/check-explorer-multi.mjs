// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vueの別窓でチェック・取得停止・一括操作を検証。ゴミ箱は専用fixture内の移動だけ。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {startDevelopment} from '../server.mjs';
const chromePath=process.env.CHROME_PATH||[process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),'/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean).find(existsSync);
assert.ok(chromePath,'CHROME_PATH に Chrome / Edge を指定してください。');
const fixture=mkdtempSync(join(tmpdir(),'aidiy-multi-')),project=join(fixture,'project'),profile=join(fixture,'browser'),trash=join(fixture,'trash');
for(const path of [project,profile,trash,join(project,'target')])mkdirSync(path);
for(const name of ['a.txt','b.txt','c.txt'])writeFileSync(join(project,name),name);
writeFileSync(join(project,'target/nested.txt'),'nested');
const trashCalls=[],connections=[],errors=[];
const app=await startDevelopment(project,{explorerOptions:{native:{trash:async path=>{trashCalls.push(path);renameSync(path,join(trash,String(trashCalls.length)+'.txt'));}}}});
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const output=resolve('temp/explorer-multi-check');mkdirSync(output,{recursive:true});
let closeBrowser;
async function connect(target){
 const ws=new WebSocket(target.webSocketDebuggerUrl);connections.push(ws);await new Promise(done=>ws.addEventListener('open',done,{once:true}));
 let sequence=0;const pending=new Map();
 ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);});
 const send=(method,params={})=>new Promise(done=>{pending.set(++sequence,done);ws.send(JSON.stringify({id:sequence,method,params}));});
 async function evaluate(expression){const data=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(data.error,undefined);assert.equal(data.result?.exceptionDetails,undefined,JSON.stringify(data.result?.exceptionDetails));return data.result.result.value;}
 async function until(expression){for(let n=0;n<150;n++){if(await evaluate(expression))return;await sleep(60);}assert.fail('画面待機: '+expression);}
 async function shot(name){await sleep(150);const data=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(data.result.data,'base64'));}
 async function click(selector,modifiers=0){
  const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point,modifiers});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1,modifiers});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1,modifiers});
  await sleep(60);
 }
 async function key(key,code,windowsVirtualKeyCode,modifiers=0){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode,modifiers});await sleep(60);}
 await send('Runtime.enable');return {send,evaluate,until,shot,click,key};
}
try{
 let port;for(let n=0;n<100&&!port;n++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
 assert.ok(port,'ブラウザー起動');const tabs=async()=>await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const target=(await tabs()).find(tab=>tab.type==='page'),main=await connect(target);
 closeBrowser=()=>main.send('Browser.close');
 await main.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await main.send('Page.navigate',{url:app.url});
 await main.until(`[...document.querySelectorAll('button')].some(b=>b.textContent==='オフライン利用')`);
 await main.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='オフライン利用').click()`);
 await main.until(`!!window.aidiyIDE?.world`);
 await main.evaluate(`aidiyIDE.setAutoSpin(false);document.querySelectorAll('.ide-view-modes button')[1].click();document.querySelector('.explorer-toggle').click()`);
 await main.until(`!!document.querySelector('[data-path="a.txt"] .explorer-row-check')`);
 await main.evaluate(`document.querySelector('[data-path="a.txt"]').click()`);
 await main.until(`aidiyIDE.selected?.path==='a.txt'`);
 await main.evaluate(`document.querySelector('[aria-label="エクスプローラーを別ウィンドウで開く"]').click()`);
 let popup;for(let n=0;n<100&&!popup;n++){popup=(await tabs()).find(tab=>tab.type==='page'&&tab.id!==target.id);if(!popup)await sleep(60);}
 assert.ok(popup,'Explorer別窓');const panel=await connect(popup);
 await panel.send('Emulation.setDeviceMetricsOverride',{width:600,height:1000,deviceScaleFactor:1,mobile:false});
 await panel.until(`!!document.querySelector('[data-path="b.txt"]')`);
 await panel.click('[data-path="target"] .chevron');await panel.click('[data-path="target"]');
 await panel.until(`!!document.querySelector('[data-path="target/nested.txt"]')`);
 await panel.click('[data-path="target/nested.txt"]',8);
 assert.equal(await panel.evaluate(`document.querySelector('[data-path="target"] .explorer-row-check').checked`),false);
 assert.equal(await panel.evaluate(`document.querySelectorAll('.explorer-row-check:checked').length`),1);
 await panel.click('[data-path="a.txt"]');
 await main.until(`aidiyIDE.selected?.path==='a.txt'`);
 await panel.click('[data-path="b.txt"]',2);
 await main.until(`aidiyIDE.selected?.path==='b.txt'`);
 await panel.click('[data-path="c.txt"] .explorer-row-check');
 assert.equal(await main.evaluate(`aidiyIDE.selected.path`),'b.txt');
 await panel.click('[data-path="c.txt"] .explorer-row-check');
 assert.equal(await panel.evaluate(`document.querySelectorAll('.explorer-row-check:checked').length`),2);
 // 範囲の拡大と縮小を同じ基点から行い、階層外のフォルダを巻き込まない。
 await panel.click('[data-path="a.txt"]');await panel.click('[data-path="c.txt"]',8);
 await main.until(`aidiyIDE.selected?.path==='c.txt'`);
 assert.equal(await panel.evaluate(`document.querySelectorAll('.explorer-row-check:checked').length`),3);
 await panel.click('[data-path="b.txt"]',8);
 await main.until(`aidiyIDE.selected?.path==='b.txt'`);
 assert.equal(await panel.evaluate(`document.querySelectorAll('.explorer-row-check:checked').length`),2);
 assert.equal(await panel.evaluate(`document.querySelector('[data-path="target"] .explorer-row-check').checked`),false);
 await panel.key(' ','Space',32);
 assert.equal(await panel.evaluate(`document.querySelectorAll('.explorer-row-check:checked').length`),1);
 assert.equal(await main.evaluate(`aidiyIDE.selected.path`),'b.txt');
 await panel.key(' ','Space',32);
 assert.equal(await panel.evaluate(`document.querySelectorAll('.explorer-row-check:checked').length`),2);
 await panel.until(`document.querySelector('.explorer-checked-status').textContent.includes('取得を停止中')`);
 const previous=await main.evaluate(`window.beforeWorld=aidiyIDE.world;true`);assert.equal(previous,true);
 writeFileSync(join(project,'added.txt'),'arrived while frozen');
 assert.equal(await main.evaluate(`aidiyIDE.refresh()`),false);
 assert.equal(await main.evaluate(`aidiyIDE.world===window.beforeWorld`),true);
 assert.equal(await panel.evaluate(`!!document.querySelector('[data-path="added.txt"]')`),false);
 await panel.shot('01-multiple-checked');
 async function menu(path){await panel.evaluate(`(()=>{const node=document.querySelector('[data-path="${path}"]');const r=node.getBoundingClientRect();node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+90,clientY:r.top+10}));})()`);await panel.until(`!!document.querySelector('.explorer-context-menu')`);}
 async function action(name){await panel.evaluate(`document.querySelector('[data-action="${name}"]').click()`);}
 await menu('b.txt');assert.equal(await panel.evaluate(`getComputedStyle(document.querySelector('[data-action="trash"] .bulk-prefix')).fontWeight`),'700');
 assert.equal(await panel.evaluate(`(()=>{const el=document.querySelector('[data-action="trash"] .bulk-prefix');return getComputedStyle(el).color===getComputedStyle(el.parentElement).color;})()`),true);
 await panel.shot('02-batch-menu');await action('copy');await menu('target');await action('paste');
 await panel.until(`document.querySelector('.explorer-operation-status')?.textContent.includes('2件をコピーしました')`);
 for(const name of ['a.txt','b.txt'])assert.equal(readFileSync(join(project,'target',name),'utf8'),name);
 await panel.evaluate(`document.querySelector('[data-path="b.txt"] .explorer-row-check').focus()`);await panel.key('c','KeyC',67,2);
 await panel.until(`document.querySelector('.explorer-operation-status')?.textContent.includes('2件をコピーしました')`);
 await menu('target');await panel.evaluate(`document.querySelector('.explorer-context-menu [data-action="paste"]').click()`);
 await panel.until(`document.querySelector('.explorer-operation-status')?.textContent.includes('2件をコピーしました')`);
 for(const name of ['a','b'])assert.equal(readFileSync(join(project,'target',name+' - コピー.txt'),'utf8'),name+'.txt');
 assert.equal(await panel.evaluate(`!!document.querySelector('[data-path="added.txt"]')`),false,'一括コピー完了後も複数チェック中は一覧を維持');
 await menu('b.txt');await action('trash');await panel.until(`!!document.querySelector('.explorer-action-dialog')`);
 assert.match(await panel.evaluate(`document.querySelector('.dialog-path').textContent`),/a\.txt[\s\S]*b\.txt/);await panel.shot('03-batch-trash-confirmation');
 await panel.evaluate(`document.querySelector('.explorer-action-dialog [data-initial-focus]').click()`);assert.equal(trashCalls.length,0);
 await menu('b.txt');await action('trash');await panel.evaluate(`document.querySelector('.explorer-action-dialog .danger').click()`);
 await panel.until(`!document.querySelector('[data-path="a.txt"]')&&!!document.querySelector('[data-path="added.txt"]')`);
 assert.equal(trashCalls.length,2);assert.equal(existsSync(join(project,'target/nested.txt')),true);assert.equal(existsSync(join(project,'c.txt')),true);for(const name of ['a.txt','b.txt'])assert.equal(existsSync(join(project,name)),false);
 assert.equal(await panel.evaluate(`document.querySelectorAll('.explorer-row-check:checked').length`),0);
 // Ctrlは離れた階層のファイルを個別に追加する。親フォルダはチェックしない。
 await panel.click('[data-path="c.txt"]');await panel.click('[data-path="target/nested.txt"]',2);
 await main.until(`aidiyIDE.selected?.path==='target/nested.txt'`);
 assert.equal(await panel.evaluate(`document.querySelectorAll('.explorer-row-check:checked').length`),2);
 assert.equal(await panel.evaluate(`document.querySelector('[data-path="target"] .explorer-row-check').checked`),false);
 await menu('target/nested.txt');await action('copy');await menu('target');await action('paste');
 await panel.until(`document.querySelector('.explorer-operation-status')?.textContent.includes('2件をコピーしました')`);
 assert.equal(readFileSync(join(project,'target/c.txt'),'utf8'),'c.txt');assert.equal(readFileSync(join(project,'target/nested - コピー.txt'),'utf8'),'nested');
 assert.equal(existsSync(join(project,'c.txt')),true);assert.equal(readFileSync(join(project,'target/nested.txt'),'utf8'),'nested');
 await panel.evaluate(`document.querySelector('.explorer-checked-status button').click()`);
 await main.until(`aidiyIDE.canFollow()===false`); // 自動探索OFFは維持する。
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,trash:'専用一時フォルダへの模擬移動',output}));
}finally{
 await Promise.race([closeBrowser?.().catch(()=>{}),sleep(1500)]);
 for(const ws of connections)ws.close();if(chrome.exitCode===null)chrome.kill();await app.close();
 if(!resolve(fixture).startsWith(resolve(tmpdir())+sep))throw Error('fixture path');
 for(let n=0;;n++){try{rmSync(fixture,{recursive:true,force:true});break;}catch(error){if(n===10)throw error;await sleep(300);}}
}
