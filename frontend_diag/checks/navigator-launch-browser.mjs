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
import {createServer} from '../diag/diag_main.mjs';
import {createStartManager} from '../diag/起動/サービス管理.mjs';
import {createAppLauncher} from '../diag/起動/アプリ起動.mjs';

const root=mkdtempSync(join(tmpdir(),'diag-start-fixture-'));mkdirSync(join(root,'scripts'));
writeFileSync(join(root,'scripts','起動対象.json'),readFileSync(new URL('../../scripts/起動対象.json',import.meta.url)));
const calls=[],children=[];
const manager=createStartManager({root,python:'fixture-python',spawnFn(_command,args){
 const child=new EventEmitter();child.pid=500000+children.length;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.closed=false;
 calls.push(args.at(-1));children.push(child);
 child.stdin.on('data',()=>{if(!child.closed){child.closed=true;setImmediate(()=>child.emit('close',0));}});
 child.ready=()=>{child.stdout.write(JSON.stringify({type:'log',data:'合成コンソールの日本語出力\n<文字列はHTMLとして実行しません>\n'})+'\n');child.stdout.write(JSON.stringify({type:'ready'})+'\n');};
 return child;
}});
const project=join(root,'日本語 空白 project');mkdirSync(project);mkdirSync(join(project,'subfolder'));
let taskChecks=0;const appCalls=[],appLauncher=createAppLauncher({root,pythonCommand:'fixture-python',taskTeamStatus:async()=>({利用可能:false,無効理由:'試験用バックエンド停止'}),portStatusFn:async()=>portStatusFn(),tasks:async()=>{taskChecks++;return [{command:'node /fixture/frontend_ide/launch.mjs --app live'}];},spawnFn(command,args,options){appCalls.push({command,args,cwd:options.cwd});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}});
const portCatalog=JSON.parse(readFileSync(new URL('../../scripts/起動対象.json',import.meta.url),'utf8')).filter(item=>item.起動管理!==false);
const openPorts=new Set(['core']);const portSamples=[];
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
 async function until(expression){for(let i=0;i<140;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail(expression+" actual="+JSON.stringify(await evaluate(`({mini:[...document.querySelectorAll('.mini-app-button')].map(x=>x.dataset.app),cli:[...document.querySelectorAll('.mini-cli-button')].map(x=>x.dataset.app)})`)));}
 const click=text=>evaluate(`[...document.querySelectorAll('button')].find(button=>button.getClientRects().length&&(button.textContent.trim()===${JSON.stringify(text)}||button.getAttribute('aria-label')===${JSON.stringify(text)})).click()`);
 async function capture(name){const response=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(response.result.data,'base64'));}
 async function fitMiniViewport(){
  const height=await evaluate(`2+Math.ceil(['.mini-content','.panel-brand','.connection-bar'].reduce((sum,selector)=>sum+document.querySelector(selector).getBoundingClientRect().height,0))`);
  assert.ok(height>=80&&height<=360);await send('Emulation.setDeviceMetricsOverride',{width:360,height,deviceScaleFactor:1,mobile:false});
 }
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*']});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
 const url=`http://127.0.0.1:${server.address().port}/proxy/8097/#token=app-browser-fixture`;
 await send('Page.navigate',{url});await until(`document.querySelector('.diag-meta')?.textContent.includes('接続済')`);
 assert.equal(await evaluate(`document.querySelector('nav.tabs button.active').textContent`),'システム起動');
 await click('ランチャー表示');
 await until(`document.querySelector('.mini-app-button[data-app="navi"] img')?.naturalWidth===512`);
 assert.equal(await evaluate(`(()=>{const ids=[...document.querySelectorAll('.mini-app-button')].map(x=>x.dataset.app);return ids.indexOf('navi')+1===ids.indexOf('console');})()`),true);
 await capture('navigator-mini');
 await click('アプリ起動パネルでプロジェクトを選択');
 await until(`document.querySelector('[data-app="navi"] .app-launch-icon')?.naturalWidth===512`);
 assert.equal(await evaluate(`(()=>{const ids=[...document.querySelectorAll('.app-launch-card[data-app]')].map(x=>x.dataset.app);return ids.indexOf('navi')+1===ids.indexOf('console');})()`),true);
 await capture('navigator-launcher');
 assert.equal(appCalls.length,0);assert.deepEqual(errors,[]);
 console.log('Navi: mini/full icon 512px, before Console, no app/service launch PASS');
}finally{
 ws?.close();browser.kill();await manager.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 const safeBase=resolve(tmpdir())+sep;for(const path of [root,profile]){assert.ok(resolve(path).startsWith(safeBase));for(let i=0;i<20;i++){try{rmSync(path,{recursive:true,force:true});break;}catch{await sleep(100);}}}
}
