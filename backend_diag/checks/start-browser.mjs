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
import {createWebBrowserOpener} from '../起動/Webブラウザ.mjs';

const root=mkdtempSync(join(tmpdir(),'diag-start-fixture-'));mkdirSync(join(root,'scripts'));
writeFileSync(join(root,'scripts','起動対象.json'),readFileSync(new URL('../../scripts/起動対象.json',import.meta.url)));
const calls=[],children=[];
const stopCalls=[];
const manager=createStartManager({root,python:'fixture-python',portStatusFn:()=>portStatusFn(),forceStopFn:async target=>{stopCalls.push(target.id);openPorts.delete(target.id);},spawnFn(_command,args){
 const child=new EventEmitter();child.pid=500000+children.length;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.closed=false;
 calls.push(args.at(-1));children.push(child);
 child.stdin.on('data',()=>{if(!child.closed){child.closed=true;setImmediate(()=>child.emit('close',0));}});
 child.ready=()=>{child.stdout.write(JSON.stringify({type:'log',data:'合成コンソールの日本語出力\n<文字列はHTMLとして実行しません>\n'})+'\n');child.stdout.write(JSON.stringify({type:'ready'})+'\n');};
 return child;
}});
const portCatalog=JSON.parse(readFileSync(new URL('../../scripts/起動対象.json',import.meta.url),'utf8')).filter(item=>item.起動管理!==false);
const openPorts=new Set(portCatalog.map(item=>item.id));const portSamples=[];
const portStatusFn=async()=>{portSamples.push(Date.now());return {対象:portCatalog.map(({id,名前,ポート})=>({id,名前,ポート,開放:openPorts.has(id)}))};};
const browserCalls=[];
const webBrowserOpenFn=createWebBrowserOpener({portStatusFn,fetchFn:async(url,options)=>{browserCalls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({id:'fixture-page'})};}});
const server=createServer({cliLauncher:{catalog:async()=>({対象:[]}),launch(){throw Error('CLI execution is forbidden in this fixture');}},token:'start-browser-fixture',prefix:'/proxy/8097/',startManager:manager,portStatusFn,
 webBrowserOpenFn,
 entries:[{id:'node',name:'Node.js',menuGroup:'ベース',commands:['node']}],
 toolsStatusFn:async()=>({online:false}),previousResults:{snapshot:async()=>({})},
 publicCache:{snapshot:()=>({状態:'未取得'}),input:()=>({})},modelTrials:{close(){}},
 keyStatusFn:async()=>({項目:[]})});
const requests=[],portRequests=[];server.on('request',request=>{const route=decodeURIComponent(request.url);requests.push(route);if(route.endsWith('/起動/ポート'))portRequests.push(Date.now());});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const executable=process.env.CHROME_PATH||[[process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'],[process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe']].filter(([base])=>base).map(([base,name])=>join(base,name)).find(existsSync)||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
assert.ok(executable,'既存Chrome/Edgeが必要です');
const profile=mkdtempSync(join(tmpdir(),'diag-start-browser-')),output=resolve(process.env.DIAG_SCREENSHOT_DIR||'temp/diag-start-browser');mkdirSync(output,{recursive:true});
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
 async function evaluate(expression){const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(response.result?.exceptionDetails,undefined,expression+JSON.stringify(response));return response.result.result.value;}
 async function until(expression){for(let i=0;i<140;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail(expression);}
 const click=text=>evaluate(`[...document.querySelectorAll('button')].find(button=>(button.textContent.trim()===${JSON.stringify(text)}||button.getAttribute('aria-label')===${JSON.stringify(text)})).click()`);
 async function capture(name){const response=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(response.result.data,'base64'));}
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*']});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
 const url=`http://127.0.0.1:${server.address().port}/proxy/8097/#token=start-browser-fixture`;
 await send('Page.navigate',{url});await until(`document.querySelector('.diag-meta')?.textContent.includes('接続済み')`);
 await until(`document.querySelector('nav.tabs button.active')?.textContent==='システム起動'&&document.querySelectorAll('.start-targets button').length===6`);
 assert.deepEqual(calls,[],'初期表示ではサービスを起動しない');
 await click('導入状況');
 assert.equal(await evaluate(`document.querySelectorAll('.start-mini-switch').length`),0,'ページ内のミニ切替は置かない');
 assert.equal(await evaluate(`document.querySelectorAll('header.panel-brand .title-mini-switch:not(:disabled)').length`),1,'ミニ切替は全タブ共通のタイトルバーに置く');
 assert.deepEqual(calls,[]);await click('システム起動');await until(`document.querySelectorAll('.start-targets button').length===6`);
 await until(`document.querySelector('#run').textContent==='強制停止'&&!document.querySelector('#run').disabled`);
 await evaluate(`[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent.includes('Web')).click()`);
 const browserOption=`[...document.querySelectorAll('.start-settings label')].find(label=>label.textContent==='ブラウザで開く').querySelector('input')`;
 await until(`document.querySelector('.start-console-heading strong')?.textContent==='Web コンソール'`);
 assert.equal(await evaluate(`document.querySelectorAll('.start-settings input').length`),3,'Web は起動対象・自動再起動・ブラウザで開くの3項目');
 assert.equal(await evaluate(`${browserOption}.checked`),true);
 await until(`!document.querySelector('.start-open-browser').disabled`);
 const inline=await evaluate(`(()=>{const button=document.querySelector('.start-open-browser'),label=button.previousElementSibling;const b=button.getBoundingClientRect(),l=label.getBoundingClientRect();return {after:b.left>=l.right,sameRow:Math.abs(b.top-l.top)<12};})()`);
 assert.deepEqual(inline,{after:true,sameRow:true},'手動ボタンはチェック欄のすぐ右側');
 for(const id of ['tools','web']){
  const name=id==='tools'?'Tools / MCP':'Web';
  openPorts.delete(id);await until(`document.querySelector('.start-open-browser').disabled&&[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent.includes(${JSON.stringify(name)})).dataset.tone==='stopped'`);
  assert.equal(await evaluate(`getComputedStyle([...document.querySelectorAll('.start-targets button')].find(button=>button.dataset.tone==='stopped')).animationName`),'start-stopped-blink');
  await capture('start-'+id+'-stopped');
  openPorts.add(id);await until(`!document.querySelector('.start-open-browser').disabled&&[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent.includes(${JSON.stringify(name)})).dataset.tone==='running'`);
 }
 await evaluate(`document.querySelector('.start-open-browser').click()`);await until(`document.querySelector('.start-message')?.textContent.includes('localhost:8090')`);
 assert.deepEqual(browserCalls,[{url:'http://127.0.0.1:8095/aidiy_chrome_devtools/new_page',body:{url:'http://localhost:8090/',show_automation_banner:false}}]);
 assert.deepEqual(calls,[],'手動で開く操作はサービスを起動しない');
 await evaluate(`${browserOption}.click()`);await until(`document.querySelector('.start-save').textContent==='設定を保存しました'`);
 assert.equal(JSON.parse(readFileSync(join(root,'_config/AiDiy_diag_start.json'),'utf8')).設定.web.ブラウザ表示,false);
 await capture('start-web-options');
 await evaluate(`[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent==='Local').click()`);
 await until(`document.querySelector('.start-console-heading strong')?.textContent==='Local コンソール'`);
 await evaluate(`document.querySelector('.start-settings input').click()`);await until(`document.querySelector('.start-save').textContent==='設定を保存しました'`);
 assert.equal(JSON.parse(readFileSync(join(root,'_config/AiDiy_diag_start.json'),'utf8')).設定.local.起動対象,true);
 await send('Page.navigate',{url});await until(`document.querySelector('.diag-meta')?.textContent.includes('接続済み')`);await click('システム起動');await until(`document.querySelectorAll('.start-targets button').length===6`);
 await evaluate(`[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent.includes('Web')).click()`);await until(`document.querySelector('.start-console-heading strong')?.textContent==='Web コンソール'`);
 assert.equal(await evaluate(`${browserOption}.checked`),false,'Web のブラウザ設定を再読込後も保持する');
 await evaluate(`[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent.includes('Local')).click()`);await until(`document.querySelector('.start-settings input')?.checked`);
 await evaluate(`[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent.includes('Web')).click()`);await until(`document.querySelector('.start-console-heading strong')?.textContent==='Web コンソール'`);
 openPorts.clear();await until(`document.querySelector('#run').textContent==='一括起動'&&!document.querySelector('#run').disabled`);
 await evaluate(`document.querySelector('#run').click()`);
 await until(`document.querySelectorAll('.start-targets button[data-tone=stopped]').length===6`);
 assert.equal(await evaluate(`Boolean(document.querySelector('.start-mini'))`),false,'一括起動ではミニへ自動切替しない');
 await capture('start-waiting-tabs');
 for(const [index,name] of ['Local','Tools / MCP','Core','Apps','Task / Team','Web'].entries()){
  for(let attempt=0;children.length<=index&&attempt<140;attempt++)await sleep(50);
  assert.ok(children[index]);
  await until(`document.querySelector('.start-console-heading strong')?.textContent===${JSON.stringify(name+' コンソール')}`);
  assert.equal(await evaluate(`document.querySelector('.start-targets button.active').textContent.includes(${JSON.stringify(name)})`),true);
  if(index===0){
   await evaluate(`[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent.includes('Web')).click()`);
   await sleep(1000);assert.equal(await evaluate(`document.querySelector('.start-console-heading strong').textContent`),'Web コンソール','起動対象が変わるまでは手動選択を保持する');
  }
  openPorts.add(portCatalog[index].id);children[index].ready();
 }
 await until(`!document.querySelector('#run').disabled&&document.querySelector('.start-console').textContent.includes('合成コンソール')`);
 assert.deepEqual(calls,['local','tools','core','apps','taskteam','web']);
 assert.equal(await evaluate(`document.querySelector('#run').textContent`),'強制停止');
 for(const target of portCatalog)openPorts.add(target.id);
 await capture('start-desktop');
 const desktop=await evaluate(`(()=>{const consoleView=document.querySelector('.start-console');return {page:document.documentElement.scrollHeight>innerHeight,height:consoleView.clientHeight,overflow:getComputedStyle(consoleView).overflowY}})()`);
 assert.equal(desktop.page,false);assert.ok(desktop.height>200,JSON.stringify(desktop));assert.equal(desktop.overflow,'auto');
 await click('ランチャー表示');await until(`document.querySelector('.start-mini')`);
 await send('Emulation.setDeviceMetricsOverride',{width:330,height:248,deviceScaleFactor:1,mobile:false});await sleep(100);await capture('start-mini');
 assert.equal(await evaluate(`document.querySelectorAll('.mini-service').length`),6);
 assert.equal(await evaluate(`document.querySelector('nav.tabs').getClientRects().length`),0);
 assert.equal(await evaluate(`document.querySelector('footer').getClientRects().length`),0);
 assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight`),false);
 const fits=await evaluate(`(()=>{const view=document.querySelector('.start-mini');return {height:view.clientHeight,scroll:view.scrollHeight};})()`);
 assert.ok(fits.scroll<=fits.height,JSON.stringify(fits));
 await sleep(150);const previousLogs=requests.filter(route=>route.endsWith('/起動/ログ')).length;
 children[1].stdout.write(JSON.stringify({type:'status',state:'再起動待ち'})+'\n');openPorts.delete('tools');
 await until(`[...document.querySelectorAll('.mini-service')].some(element=>element.textContent.includes('Tools')&&element.dataset.tone==='stopped'&&element.title.includes('未開放'))`);
 assert.equal(await evaluate(`getComputedStyle([...document.querySelectorAll('.mini-service')].find(button=>button.dataset.tone==='stopped')).animationName`),'mini-stopped-blink');
 // 起動受付やアプリ稼働判定からの内部呼出しを、画面の定期取得へ混ぜない。
 const samples=portRequests.length;
 for(let i=0;i<240&&portRequests.length<samples+2;i++)await sleep(50);
 assert.ok(portRequests.length>=samples+2,'ミニの定期取得が継続する');
 assert.ok(portRequests.at(-1)-portRequests.at(-2)>=4900,'ミニの定期取得は約5秒間隔');
 assert.equal(requests.filter(route=>route.endsWith('/起動/ログ')).length,previousLogs,'ミニ表示は状態だけを取得');
 children[1].stdout.write(JSON.stringify({type:'ready'})+'\n');openPorts.add('tools');
 await until(`[...document.querySelectorAll('.mini-service')].some(element=>element.textContent.includes('Tools')&&element.dataset.tone==='running')`);
 await evaluate(`[...document.querySelectorAll('.mini-service')].find(button=>button.textContent.includes('Core')).click()`);
 await until(`!document.querySelector('.start-mini')&&document.querySelector('.start-console-heading strong').textContent==='Core コンソール'`);
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
 assert.deepEqual(calls,['local','tools','core','apps','taskteam','web'],'表示切替は起動・停止しない');assert.ok(children.every(child=>!child.closed));
 await click('ランチャー表示');await until(`document.querySelector('.start-mini')`);await click('元のサイズに戻す');await until(`!document.querySelector('.start-mini')`);
 await click('導入状況');assert.equal(await evaluate(`document.querySelectorAll('.start-mini-switch').length`),0);await click('システム起動');
 await evaluate(`[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent.includes('Local')).click()`);
 await until(`document.querySelector('.start-console-heading strong').textContent==='Local コンソール'`);
 await until(`document.querySelector('.start-console').textContent.includes('合成コンソール')`);
 const logText=await evaluate(`document.querySelector('.start-console').textContent`);
 await evaluate(`(()=>{const view=document.querySelector('.start-console');view.focus();const range=document.createRange();range.selectNodeContents(view);getSelection().removeAllRanges();getSelection().addRange(range);document.addEventListener('copy',event=>{window.copiedStartLog=getSelection().toString();event.preventDefault();},{once:true});})()`);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.start-console')).userSelect`),'text');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'c',code:'KeyC',modifiers:2,windowsVirtualKeyCode:67});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'c',code:'KeyC',modifiers:2,windowsVirtualKeyCode:67});
 await until(`window.copiedStartLog!==undefined`);assert.equal(await evaluate('window.copiedStartLog'),logText.replace(/\n$/,''),'Ctrl+C は選択したログのコピー');
 await sleep(200);assert.ok(children.every(child=>!child.closed),'コピー操作でサービスを停止しない');
 assert.equal(requests.filter(route=>route.endsWith('/起動/停止')).length,0);
 await evaluate(`document.querySelector('.start-console').dispatchEvent(new KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true}));document.querySelector('.start-console').dispatchEvent(new KeyboardEvent('keydown',{key:'c',metaKey:true,bubbles:true,cancelable:true}));getSelection().removeAllRanges()`);
 await sleep(100);assert.equal(requests.filter(route=>route.endsWith('/起動/停止')).length,0,'未選択の Ctrl+C / ⌘C でも停止しない');
 children[0].stdout.write(JSON.stringify({type:'log',data:Array.from({length:150},(_,index)=>`追従確認 ${index}\n`).join('')+'長いログの横スクロール '.repeat(100)+'\n最下部の確認 1\n'})+'\n');
 await until(`document.querySelector('.start-console').textContent.includes('最下部の確認 1')&&(()=>{const view=document.querySelector('.start-console');return view.scrollHeight-view.scrollTop-view.clientHeight<3;})()`);
 await evaluate(`document.querySelector('.start-console').scrollTop=0`);await sleep(100);
 assert.equal(await evaluate(`document.querySelector('.start-console').scrollTop`),0);
 children[0].stdout.write(JSON.stringify({type:'log',data:'手動スクロール後も最新ログへ追従\n'})+'\n');
 await until(`document.querySelector('.start-console').textContent.includes('手動スクロール後も最新ログへ追従')&&(()=>{const view=document.querySelector('.start-console');return view.scrollHeight-view.scrollTop-view.clientHeight<3;})()`);
 const wrapping=await evaluate(`(()=>{const view=document.querySelector('.start-console'),style=getComputedStyle(view);return {whiteSpace:style.whiteSpace,wide:view.scrollWidth>view.clientWidth,page:document.documentElement.scrollWidth>innerWidth};})()`);
 assert.equal(wrapping.whiteSpace,'pre');assert.equal(wrapping.wide,true,'長いログは折り返さず横スクロールできる');assert.equal(wrapping.page,false);
 await evaluate(`document.querySelector('.start-console').scrollLeft=250`);assert.ok(await evaluate(`document.querySelector('.start-console').scrollLeft>0`));
 await capture('start-log-tail');
 await click('再起動');
 for(let attempt=0;children.length<7&&attempt<140;attempt++)await sleep(50);
 assert.ok(children[6]);assert.equal(children[0].closed,true);
 await until(`!document.querySelector('.start-console').textContent.includes('手動スクロール後も最新ログへ追従')&&document.querySelector('.start-console').textContent.includes('python backend_local/_start.py')`);
 children[6].ready();await until(`!document.querySelector('#run').disabled&&document.querySelector('.start-console').textContent.includes('合成コンソール')`);
 await evaluate(`[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent.includes('Core')).click()`);
 await until(`document.querySelector('.start-console-heading strong').textContent==='Core コンソール'`);
 await evaluate(`[...document.querySelectorAll('.start-targets button')].find(button=>button.textContent.includes('Local')).click()`);
 await until(`document.querySelector('.start-console-heading strong').textContent==='Local コンソール'&&document.querySelector('.start-console').textContent.includes('合成コンソール')`);
 assert.equal(await evaluate(`document.querySelector('.start-console').textContent.includes('手動スクロール後も最新ログへ追従')`),false,'タブを戻しても前回のログは復活しない');
 await click('停止（Ctrl+C）');
 await until(`document.querySelector('.start-status').textContent==='停止済み'`);assert.equal(children[6].closed,true);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:true});await sleep(100);await capture('start-mobile');
 assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false);
 assert.equal(await evaluate(`document.querySelector('.start-console').clientHeight>100`),true);
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
 await until(`document.querySelector('#run').textContent==='強制停止'&&!document.querySelector('#run').disabled`);
 await click('強制停止');await until(`document.querySelector('#run').textContent==='一括起動'&&!document.querySelector('#run').disabled`);
 assert.deepEqual(stopCalls,['web','taskteam','apps','core','tools','local']);assert.ok(children.every(child=>child.closed));
 assert.equal(openPorts.size,0);await capture('start-all-stopped');
 assert.deepEqual(errors,[]);console.log('起動画面: 起動タブの追従・新着ログの最下部表示・手動選択保持・コピーと停止・ミニ表示・330/390/1280px表示 OK');
}finally{
 ws?.close();browser.kill();await manager.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 const safeBase=resolve(tmpdir())+sep;for(const path of [root,profile]){assert.ok(resolve(path).startsWith(safeBase));for(let i=0;i<20;i++){try{rmSync(path,{recursive:true,force:true});break;}catch{await sleep(100);}}}
}
