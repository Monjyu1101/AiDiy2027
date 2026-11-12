// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実サービスを起動せず、合成プロセスと既存ブラウザで起動画面を確認する。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createServer} from '../diag_main.mjs';
import {createStartManager} from '../起動/サービス管理.mjs';
import {createAppLauncher} from '../起動/アプリ起動.mjs';

const root=mkdtempSync(join(tmpdir(),'diag-start-fixture-'));mkdirSync(join(root,'scripts'));
writeFileSync(join(root,'scripts','起動対象.json'),readFileSync(new URL('../../scripts/起動対象.json',import.meta.url)));
mkdirSync(join(root,'_config'));writeFileSync(join(root,'_config','AiDiy_key.json'),JSON.stringify({discord_bot_token:'fixture-discord-token'}));
const calls=[],children=[];
const manager=createStartManager({root,python:'fixture-python',spawnFn(_command,args){
 const child=new EventEmitter();child.pid=500000+children.length;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.closed=false;
 calls.push(args.at(-1));children.push(child);
 child.stdin.on('data',()=>{if(!child.closed){child.closed=true;setImmediate(()=>child.emit('close',0));}});
 child.ready=()=>{child.stdout.write(JSON.stringify({type:'log',data:'合成コンソールの日本語出力\n<文字列はHTMLとして実行しません>\n'})+'\n');child.stdout.write(JSON.stringify({type:'ready'})+'\n');};
 return child;
}});
const project=join(root,'日本語 空白 project');mkdirSync(project);mkdirSync(join(project,'subfolder'));
let taskChecks=0;const appCalls=[],appLauncher=createAppLauncher({root,pythonCommand:'fixture-python',chromeInstalled:async()=>true,linkedLiveRunning:async()=>false,taskTeamStatus:async()=>({利用可能:false,無効理由:'試験用バックエンド停止'}),portStatusFn:async()=>portStatusFn(),tasks:async()=>{taskChecks++;return [{command:'node /fixture/frontend_ide/launch.mjs --app live'}];},spawnFn(command,args,options){appCalls.push({command,args,cwd:options.cwd});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}});
const portCatalog=JSON.parse(readFileSync(new URL('../../scripts/起動対象.json',import.meta.url),'utf8')).filter(item=>item.起動管理!==false);
const openPorts=new Set(['core','tools','web']);const portSamples=[];
const portStatusFn=async()=>{portSamples.push(Date.now());return {対象:portCatalog.map(({id,名前,ポート})=>({id,名前,ポート,開放:openPorts.has(id)}))};};
const server=createServer({vscodeLauncher:{catalog:async()=>({id:'vscode',名前:'VS Code',種類:'editor',利用可能:false}),launch(){throw Error('Editor execution is forbidden in this fixture');}},cliLauncher:{catalog:async()=>({対象:[]}),launch(){throw Error('CLI execution is forbidden in this fixture');}},token:'app-browser-fixture',prefix:'/proxy/8097/',startManager:manager,portStatusFn,appLauncher,
 entries:[{id:'node',name:'Node.js',menuGroup:'ベース',commands:['node']}],
 toolsStatusFn:async()=>({online:false}),previousResults:{snapshot:async()=>({})},
 publicCache:{snapshot:()=>({状態:'未取得'}),input:()=>({})},modelTrials:{close(){}},
 keyStatusFn:async()=>({項目:[]})});
const requests=[];server.on('request',request=>requests.push(decodeURIComponent(request.url)));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const executable=process.env.CHROME_PATH||[[process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'],[process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe']].filter(([base])=>base).map(([base,name])=>join(base,name)).find(existsSync)||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
assert.ok(executable,'既存Chrome/Edgeが必要です');
const profile=mkdtempSync(join(tmpdir(),'diag-start-browser-')),output=resolve(process.env.DIAG_SCREENSHOT_DIR||'temp/diag-app-browser');mkdirSync(output,{recursive:true});
const browser=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let ws;
try{
 let port;for(let i=0;i<100&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
 assert.ok(port,'ブラウザを起動できませんでした。');
 const page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
 let seq=0;const pending=new Map(),errors=[];
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++seq,resolve);ws.send(JSON.stringify({id:seq,method,params}));});
 async function evaluate(expression){const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response));return response.result.result.value;}
 async function until(expression){for(let i=0;i<140;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail(expression);}
 const click=text=>evaluate(`[...document.querySelectorAll('button')].find(button=>button.getClientRects().length&&(button.textContent.trim()===${JSON.stringify(text)}||button.getAttribute('aria-label')===${JSON.stringify(text)})).click()`);
 async function capture(name){const response=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(response.result.data,'base64'));}
 async function fitMiniViewport(){
  const height=await evaluate(`2+Math.ceil(['.mini-content','.panel-brand','.connection-bar'].reduce((sum,selector)=>sum+document.querySelector(selector).getBoundingClientRect().height,0))`);
  assert.equal(height,190);await send('Emulation.setDeviceMetricsOverride',{width:360,height,deviceScaleFactor:1,mobile:false});
 }
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*']});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
 const url=`http://127.0.0.1:${server.address().port}/proxy/8097/#token=app-browser-fixture`;
 await send('Page.navigate',{url});await until(`document.querySelector('.diag-meta')?.textContent.includes('接続済')`);
 assert.equal(await evaluate(`document.querySelector('nav.tabs button.active').textContent`),'システム起動');
 await click('ランチャー表示');await until(`document.querySelectorAll('.mini-app-button').length===9&&document.querySelectorAll('.mini-cli-button[data-app=chrome]').length===1`);
 await fitMiniViewport();
 await until(`[...document.querySelectorAll('.mini-app-button img')].every(img=>img.complete&&img.naturalWidth>0)`);
 assert.equal(await evaluate(`[...document.querySelectorAll('.mini-app-button')].every(button=>button.disabled)`),true);
 assert.equal(await evaluate(`document.querySelector('.mini-app-message .mini-app-marquee').textContent`),'SELECT YOUR PROJECT  ▸▸  READY FOR LAUNCH');
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.mini-app-marquee')).animationName`),'mini-marquee');
 assert.equal(await evaluate(`document.querySelector('.mini-app-message').title`),'プロジェクト選択してね');
 assert.equal(await evaluate(`document.querySelectorAll('.mini-heading').length`),0);
 assert.equal(await evaluate(`!!document.querySelector('header.panel-brand .mini-restore')`),true);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.mini-app-message')).color`),'rgb(255, 107, 130)');
 assert.equal(await evaluate(`(()=>{const view=document.querySelector('.start-mini');return view.scrollHeight<=view.clientHeight&&document.documentElement.scrollWidth<=innerWidth;})()`),true);
 assert.equal(await evaluate(`document.querySelectorAll('.mini-icon-caption').length`),0);
 assert.equal(await evaluate(`[...document.querySelectorAll('.mini-app-button')].every(button=>button.getAttribute('aria-label')?.includes(' を起動')&&button.querySelector('img')?.getAttribute('width')==='36')`),true);
 await until(`[...document.querySelectorAll('.mini-service')].some(button=>button.textContent==='Core'&&button.dataset.tone==='running'&&button.title.includes('8091'))`);
 assert.equal(await evaluate(`(()=>{const items=[...document.querySelectorAll('.mini-service[data-tone=running]')].map(element=>getComputedStyle(element));return items.length>0&&items.every(style=>style.animationName==='mini-blink')&&document.querySelectorAll('.mini-indicator').length===0;})()`),true);
 assert.equal(await evaluate(`new Set([...document.querySelectorAll('.mini-service')].map(element=>element.style.getPropertyValue('--mini-blink'))).size`),6);
 assert.equal(appCalls.length,0);assert.equal(taskChecks,0);await capture('app-mini-no-project');
 await click('アプリ起動パネルでプロジェクトを選択');await until(`!document.querySelector('.start-mini')&&document.querySelector('nav.tabs button.active').textContent==='アプリ起動'`);
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
 for(const [key,code,keyCode] of [['Enter','Enter',13],[' ','Space',32]]){
  await click('導入状況');await click('ランチャー表示');await until(`document.querySelector('.mini-project-link')`);await fitMiniViewport();
  await evaluate(`document.querySelector('.mini-project-link').focus()`);
  await until(`document.activeElement===document.querySelector('.mini-project-link')`);
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,text:type==='keyDown'?(key==='Enter'?'\r':' '):undefined,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});
  await until(`!document.querySelector('.start-mini')&&document.querySelector('nav.tabs button.active').textContent==='アプリ起動'`);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
 }
 await until(`document.querySelectorAll('.app-launch-card[data-app]').length===12`);
 assert.equal(await evaluate(`document.querySelector('#run').getClientRects().length`),0);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.app-launch-button:not(:disabled)')].map(button=>button.closest('[data-app]').dataset.app)`),['chrome']);
 assert.equal(appCalls.length,0);assert.equal(taskChecks,0);
 await capture('app-no-project');
 await click('フォルダ選択');await until(`document.querySelector('.app-folder-dialog')`);
 await evaluate(`document.querySelector('.app-folder-dialog input').value=${JSON.stringify(project)};document.querySelector('.app-folder-dialog input').dispatchEvent(new Event('input',{bubbles:true}))`);
 await click('移動');await until(`document.querySelector('.app-folder-list').textContent.includes('subfolder')`);
 assert.equal(await evaluate(`document.querySelector('.app-project').classList.contains('required')&&getComputedStyle(document.querySelector('#app-project-folder')).animationName`),'app-project-alert','未選択の欄は赤で促す');
 await click('このフォルダを選択');await until(`document.querySelector('#app-project-folder').value===${JSON.stringify(project)}`);
 assert.equal(await evaluate(`document.querySelector('.app-project').classList.contains('required')`),false);
 assert.equal(await evaluate(`document.querySelectorAll('.app-launch-button:not(:disabled)').length`),10);
 await sleep(900);assert.equal(taskChecks,0,'フォルダ選択・表示・待機ではアプリの稼働中確認をしない');
 for(const name of ['Avatar','IDE','Console','Code','Live','Discord']){
  await click(`${name} を起動`);await until(`![...document.querySelectorAll('.app-launch-state')].some(state=>state.textContent==='起動確認中…')`);
 }
 assert.deepEqual(appCalls.map(item=>item.args.includes('--project')?item.args[item.args.indexOf('--project')+1]:item.cwd),[root,project,project,project,project]);
 assert.equal(taskChecks,3);assert.equal(appCalls.length,5);
 assert.equal(await evaluate(`document.querySelector('[data-app="live"] .app-launch-result')===null`),true,'起動済みの成功通知も表示しない');
 await click('Code を起動');await until(`document.querySelector('[data-app="code"] .app-launch-state').textContent===''&&!document.querySelector('[data-app="code"] .app-launch-button').disabled`);
 assert.equal(appCalls.length,6);assert.equal(taskChecks,3);
 await until(`[...document.querySelectorAll('.app-launch-icon')].every(img=>img.complete&&img.naturalWidth>0)`);
 await capture('app-desktop');
 const before=requests.filter(route=>route.includes('アプリ起動/開始')).length;await sleep(1200);assert.equal(requests.filter(route=>route.includes('アプリ起動/開始')).length,before,'表示待機でアプリ起動を再発行しない');assert.equal(taskChecks,3);
 await click('導入状況');await click('アプリ起動');assert.equal(await evaluate(`document.querySelector('#app-project-folder').value`),project);
 await click('ランチャー表示');await until(`document.querySelectorAll('.mini-app-button').length===9&&document.querySelectorAll('.mini-cli-button[data-app=chrome]').length===1`);
 assert.equal(await evaluate(`document.querySelector('.app-launch-panel').getClientRects().length`),0);
 await click('元のサイズに戻す');await until(`document.querySelector('nav.tabs button.active').textContent==='アプリ起動'`);
 assert.equal(await evaluate(`document.querySelector('#app-project-folder').value`),project);
 await click('ランチャー表示');await until(`document.querySelectorAll('.mini-service').length>0`);
 await evaluate(`[...document.querySelectorAll('.mini-service')].find(button=>button.textContent==='Core').click()`);
 await until(`document.querySelector('nav.tabs button.active').textContent==='システム起動'&&!document.querySelector('.start-mini')`);
 await click('システム起動');await click('ランチャー表示');await until(`document.querySelectorAll('.mini-app-button').length===9&&document.querySelectorAll('.mini-cli-button[data-app=chrome]').length===1`);
 await fitMiniViewport();
 assert.equal(await evaluate(`document.querySelectorAll('.mini-app-button:not(:disabled)').length`),9);
 await evaluate(`document.querySelector('.mini-app-button[data-app="live"]').click()`);
 await until(`!document.querySelector('.mini-app-button[data-app="live"]').disabled&&document.querySelector('.mini-app-message').textContent===${JSON.stringify(project)}`);
 assert.equal(await evaluate(`document.querySelector('.mini-app-message').textContent.includes('起動済み')`),false);
 assert.equal(taskChecks,4);assert.equal(appCalls.length,6);
 assert.equal(await evaluate(`document.querySelector('.mini-app-button[data-app="live"]').disabled`),false,'起動済みの結果を理由にボタンを無効化せず、次回押下時も再確認する');
 await evaluate(`document.querySelector('.mini-app-button[data-app="code"]').click()`);
 await until(`!document.querySelector('.mini-app-button[data-app="code"]').disabled&&document.querySelector('.mini-app-message').textContent===${JSON.stringify(project)}`);
 assert.equal(await evaluate(`document.querySelector('.mini-app-message').textContent.includes('起動を要求')`),false);
 assert.equal(appCalls.length,7);assert.equal(appCalls.at(-1).cwd,project);assert.equal(taskChecks,4);
 assert.equal(await evaluate(`(()=>{const view=document.querySelector('.start-mini');return view.scrollHeight<=view.clientHeight&&document.documentElement.scrollWidth<=innerWidth;})()`),true);
 await capture('app-mini-project');
 const miniRequests=requests.filter(route=>route.includes('アプリ起動/開始')).length;await sleep(1200);assert.equal(requests.filter(route=>route.includes('アプリ起動/開始')).length,miniRequests);
 await click('元のサイズに戻す');await click('アプリ起動');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:true});await sleep(150);await capture('app-mobile');
 assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight`),false);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.app-launch-list')).overflowY`),'auto');
 await click('解除');assert.deepEqual(await evaluate(`[...document.querySelectorAll('.app-launch-button:not(:disabled)')].map(button=>button.closest('[data-app]').dataset.app)`),['chrome']);
 await send('Page.navigate',{url});await until(`document.querySelector('.diag-meta')?.textContent.includes('接続済')`);await click('アプリ起動');
 assert.equal(await evaluate(`document.querySelector('#app-project-folder').value`),'','再起動・再読込では毎回フォルダ未選択');
 assert.equal(await evaluate(`document.querySelector('.app-project').classList.contains('required')`),true);
 assert.deepEqual(errors,[]);console.log('アプリ起動: ミニ360×190・電光掲示板のクリック/Enter/Space・フォルダ選択後の起動/排他・390/1280px OK');
}finally{
 ws?.close();browser.kill();await manager.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 const safeBase=resolve(tmpdir())+sep;for(const path of [root,profile]){assert.ok(resolve(path).startsWith(safeBase));for(let i=0;i<20;i++){try{rmSync(path,{recursive:true,force:true});break;}catch{await sleep(100);}}}
}
