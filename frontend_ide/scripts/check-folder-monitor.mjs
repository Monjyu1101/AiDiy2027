// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// オフラインfixtureだけで2Dカードの実寸・操作を検証し、画面を保存する。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync} from 'node:fs';
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
const project=mkdtempSync(join(tmpdir(),'aidiy-folder-monitor-'));
const profile=mkdtempSync(join(tmpdir(),'aidiy-folder-monitor-browser-'));
const longName='長い日本語の設計資料と開発手順をまとめたフォルダ'.repeat(2);
for(const name of ['空フォルダ',longName,...Array.from({length:22},(_,i)=>`開発資料${i+1}`)])mkdirSync(join(project,name));
writeFileSync(join(project,'README.txt'),'カード表示の確認用ファイルです。');
utimesSync(join(project,'README.txt'),new Date(Date.now()-86400000),new Date(Date.now()-86400000));
const longFile='ファイル名の幅を検証する資料'.repeat(3)+'.txt';
writeFileSync(join(project,longFile),'long name');
for(let i=0;i<60;i++)writeFileSync(join(project,`file${String(i).padStart(3,'0')}.txt`),'original');
writeFileSync(join(project,'開発資料1','nested.txt'),'nested');
mkdirSync(join(project,'開発資料1','内部'));
writeFileSync(join(project,'開発資料1','内部','one.txt'),'one');writeFileSync(join(project,'開発資料1','内部','two.txt'),'two');
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
 async function until(expression){for(let i=0;i<700;i++){if(await evaluate(expression))return;await sleep(50);}console.error(JSON.stringify({errors,screen:await evaluate('document.body.innerText')},null,2));assert.fail(`画面待機: ${expression}`);}
 const output=resolve('temp/folder-monitor-check');mkdirSync(output,{recursive:true});
 const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(/\D/g,'');
 let shotNumber=0;const shots=[];
 async function capture(name){const result=await send('Page.captureScreenshot',{format:'png'});const file=join(output,`${stamp}-${++shotNumber}-${name}.png`);writeFileSync(file,Buffer.from(result.result.data,'base64'));shots.push(file);}
 await send('Runtime.enable');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:app.url});
 await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='オフライン利用')`);
 await evaluate(`window.folderCalls=[];window.galaxyCalls=[];window.originalFetch=window.fetch;window.fetch=function(url,options){if(String(url).includes('/api/folder-state'))window.folderCalls.push(String(url));if(String(url).includes('/api/galaxy'))window.galaxyCalls.push(String(url));return originalFetch.apply(this,arguments);};`);
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
 await until(`!!document.querySelector('.ide-view-modes')`);
 await until(`!!window.aidiyIDE`);await evaluate(`aidiyIDE.setAutoSpin(false);aidiyIDE.interact();`);
 await evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
 await until(`!!document.querySelector('.space-filter-toggle')`);
 await evaluate(`(()=>{const button=document.querySelector('.space-filter-toggle');if(button.getAttribute('aria-checked')==='true')button.click();})()`);
 await evaluate(`aidiyIDE.goTo({type:'dir',path:''})`);
 await until(`document.querySelectorAll('[data-page-layer="live"] .folder-page-entry.folder').length>=24`);
 const layouts=[];
 for(const [width,height] of [[1280,800],[768,1000],[390,844],[1280,420]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('[data-page-layer="live"]').scrollTop=0`);await sleep(100);
  const layout=await evaluate(`(()=>{
   const body=document.querySelector('[data-page-layer="live"]'),folders=[...body.querySelectorAll('.folder-page-entry.folder')],file=body.querySelector('.folder-page-entry:not(.folder)'),rects=folders.map(e=>e.getBoundingClientRect());
   return {count:folders.length,columns:new Set(folders.map(e=>e.offsetLeft)).size,overflow:body.scrollWidth>body.clientWidth,filesAfter:Math.min(file.getBoundingClientRect().top)>=Math.max(...rects.map(r=>r.bottom)),minHeight:Math.min(...rects.map(r=>r.height)),namesFit:folders.every(e=>{const n=e.querySelector('.folder-page-name');return n.scrollWidth<=n.clientWidth&&n.scrollHeight<=n.clientHeight;}),fileHeight:file.getBoundingClientRect().height};
  })()`);
  assert.equal(layout.overflow,false);assert.equal(layout.filesAfter,true);assert.equal(layout.namesFit,true);assert.ok(layout.minHeight>=111);assert.ok(layout.count>=24);
  assert.equal(layout.columns,layout.count,'現行のフォルダカードは画面幅によらず横一列');
  layouts.push({width,height,...layout});await capture(`${width}x${height}`);
 }
 const decoration=await evaluate(`(()=>{const folder=document.querySelector('[data-page-layer="live"] .folder-page-entry.folder'),today=document.querySelector('[data-page-layer="live"] [title="file000.txt"] time'),old=document.querySelector('[data-page-layer="live"] [title="README.txt"] time'),style=getComputedStyle(folder);return {radius:style.borderRadius,shadow:style.boxShadow,image:style.backgroundImage,today:today.textContent,todayColor:getComputedStyle(today).color,todayTitle:today.title,old:old.textContent};})()`);
 assert.equal(decoration.radius,'0px');assert.equal(decoration.shadow,'none');assert.equal(decoration.image,'none');assert.match(decoration.today,/^今日 /);assert.equal(decoration.todayColor,'rgb(180, 35, 24)');assert.doesNotMatch(decoration.old,/今日/);
 // 横幅に余裕がある名前は一行。狭幅では欠落せず折り返す。
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 const nameMetrics=await evaluate(`(()=>{const e=[...document.querySelectorAll('[data-page-layer="live"] .folder-page-entry')].find(e=>e.title===${JSON.stringify(longFile)}),n=e.querySelector('.folder-page-name'),m=e.querySelector('.folder-page-meta');return {height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width,metaWidth:m.getBoundingClientRect().width,text:n.textContent};})()`);
 assert.ok(nameMetrics.height<30,JSON.stringify(nameMetrics));await evaluate(`[...document.querySelectorAll('[data-page-layer="live"] .folder-page-entry')].find(e=>e.title===${JSON.stringify(longFile)}).scrollIntoView({block:'center'})`);await capture('filename-wide');
 // 手動操作中は既存の自動追跡を待機させ、一覧更新時の位置保持を確認する。
 await evaluate(`aidiyIDE.interact();aidiyIDE.clear();const body=document.querySelector('[data-page-layer="live"]');body.focus();body.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));`);
 await sleep(150);
 await evaluate(`document.querySelector('[data-page-layer="live"]').scrollTop=320`);
 const before=await evaluate(`({cursor:document.querySelector('[data-page-layer="live"] [data-cursor="true"]').title,scroll:document.querySelector('[data-page-layer="live"]').scrollTop})`);
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await evaluate(`aidiyIDE.setAutoSpin(true);aidiyIDE.interact()`);
 writeFileSync(join(project,'file000.txt'),'updated content in fixture');
 await until(`!!document.querySelector('.page-turn-refresh')`);
 const [line1,line2]=await evaluate(`new Promise(resolve=>{const edge=document.querySelector('.folder-page-turn-edge'),first=edge.getBoundingClientRect().top;requestAnimationFrame(()=>requestAnimationFrame(()=>resolve([first,edge.getBoundingClientRect().top])));})`);
 assert.ok(line2>line1,`${line1} -> ${line2}`);await capture('refresh-sweep');
 await until(`!document.querySelector('.page-turn-refresh')`);
 const after=await evaluate(`({cursor:document.querySelector('[data-page-layer="live"] [data-cursor="true"]').title,scroll:document.querySelector('[data-page-layer="live"]').scrollTop})`);
 assert.deepEqual(after,before);
 // 差分なしの右上更新にも同じシートを出し、連打は一度だけ取得する。
 const manualCalls=await evaluate('galaxyCalls.length');
 await evaluate(`const refresh=document.querySelector('.folder-page-refresh');refresh.click();refresh.click();`);
 await until(`!!document.querySelector('.page-turn-refresh')`);await capture('manual-no-change');
 await until(`!document.querySelector('.page-turn-refresh')`);
 assert.equal(await evaluate('galaxyCalls.length'),manualCalls+1);
 assert.deepEqual(await evaluate(`({cursor:document.querySelector('[data-page-layer="live"] [data-cursor="true"]').title,scroll:document.querySelector('[data-page-layer="live"]').scrollTop})`),before);
 // OFF中は確認しない。ON復帰で追加削除・連続書き込みの最終状態を反映。
 await evaluate(`document.querySelector('[aria-label="自動探索"]').click()`);await sleep(100);
 const offCount=await evaluate('folderCalls.length');writeFileSync(join(project,'added.txt'),'added');rmSync(join(project,'file001.txt'));
 await sleep(31000);assert.equal(await evaluate('folderCalls.length'),offCount);
 assert.equal(await evaluate(`!!document.querySelector('[data-page-layer="live"] [title="added.txt"]')`),false);
 await evaluate(`document.querySelector('[aria-label="自動探索"]').click();aidiyIDE.interact()`);
 await until(`!!document.querySelector('[data-page-layer="live"] [title="added.txt"]')`);
 assert.equal(await evaluate(`!!document.querySelector('[data-page-layer="live"] [title="file001.txt"]')`),false);
 writeFileSync(join(project,'added.txt'),'one');writeFileSync(join(project,'added.txt'),'final content');
 await until(`document.querySelector('[data-page-layer="live"] [title="added.txt"] .folder-page-size')?.textContent==='13 B'`);
 // フォルダ切替はその配下だけを確認。古いルートの一覧へ戻さない。
 await evaluate(`aidiyIDE.interact();aidiyIDE.goTo({type:'dir',path:'開発資料1'})`);
 await until(`document.querySelector('[data-page-layer="live"]')?.dataset.pagePath==='開発資料1'`);
 await until(`folderCalls.at(-1)?.includes(encodeURIComponent('開発資料1'))`);
 writeFileSync(join(project,'開発資料1','new.txt'),'nested new');
 await until(`!!document.querySelector('[data-page-layer="live"] [title="開発資料1/new.txt"]')`);
 // OS設定でも更新シートと線を省略しない。
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await evaluate(`window.sweepSeen=false;window.sweepObserver=new MutationObserver(()=>{if(document.querySelector('.page-turn-refresh'))window.sweepSeen=true;});sweepObserver.observe(document.body,{childList:true,subtree:true});`);
 writeFileSync(join(project,'開発資料1','quiet.txt'),'quiet');
 await until(`!!document.querySelector('[data-page-layer="live"] [title="開発資料1/quiet.txt"]')`);
 assert.equal(await evaluate('sweepSeen'),true);await evaluate('sweepObserver.disconnect()');await capture('OS設定でも更新シート');
 // 閲覧軌跡のクリアはこの一時プロジェクトの閲覧一覧だけを対象にする。
 await evaluate(`aidiyIDE.interact();aidiyIDE.goTo({type:'file',path:'開発資料1/new.txt'})`);
 await until(`!!document.querySelector('.viewer-popup')`);
 await evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='閲覧軌跡').click()`);
 await until(`!!document.querySelector('[aria-label="閲覧軌跡をクリア"]')`);
 const historyBefore=await evaluate(`({path:aidiyIDE.selected.path,trail:[...aidiyIDE.trail],saved:JSON.parse(localStorage.getItem('aidiy_ide:'+${JSON.stringify(project)})),button:document.querySelector('[aria-label="閲覧軌跡をクリア"]').getBoundingClientRect().right,heading:document.querySelector('.route-list-heading').getBoundingClientRect().right})`);
 assert.ok(Math.abs(historyBefore.button-historyBefore.heading)<2);await capture('history-clear-button');
 await evaluate(`document.querySelector('[aria-label="閲覧軌跡をクリア"]').click()`);
 await until(`document.querySelector('[aria-label="閲覧軌跡をクリア"]').disabled`);
 const historyAfter=await evaluate(`({path:aidiyIDE.selected.path,trail:[...aidiyIDE.trail],saved:JSON.parse(localStorage.getItem('aidiy_ide:'+${JSON.stringify(project)}))})`);
 assert.equal(historyAfter.path,historyBefore.path);assert.deepEqual(historyAfter.trail,historyBefore.trail);assert.deepEqual(historyAfter.saved.voyages,historyBefore.saved.voyages);assert.deepEqual(historyAfter.saved.voyageCurrent,historyBefore.saved.voyageCurrent);assert.equal(historyAfter.saved.journal.filter(e=>e.type==='file').length,0);
 await evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='閲覧軌跡').click()`);
 assert.equal(await evaluate(`!!document.querySelector('[aria-label="閲覧軌跡をクリア"]')`),false);
 // 起点・grepのフォルダは通常色のまま、右側の件数は色付きで残す。
 await evaluate(`aidiyIDE.interact();document.querySelector('.explorer-toggle').click()`);
 await until(`!!document.querySelector('.explorer-panel')`);
 await evaluate(`Array.from(document.querySelectorAll('.since-presets button')).find(b=>b.textContent==='解除').click()`);
 await until(`!!document.querySelector('.explorer-panel li[data-path="開発資料1"]')`);
 const folderStyle=()=>evaluate(`(()=>{const row=document.querySelector('.explorer-panel li[data-path="開発資料1"]'),name=row.querySelector('.file-name'),icon=row.querySelector('.file-type-icon'),meta=row.querySelector('.file-meta');return {name:getComputedStyle(name).color,iconColor:getComputedStyle(icon).color,filter:getComputedStyle(icon).filter,meta:meta.textContent,metaColor:getComputedStyle(meta).color,fresh:row.classList.contains('fresh')};})()`);
 const normalFolder=await folderStyle();
 await evaluate(`Array.from(document.querySelectorAll('.since-presets button')).find(b=>b.textContent==='今日').click()`);
 await until(`document.querySelector('.explorer-panel li[data-path="開発資料1"]')?.classList.contains('fresh')`);
 const sinceFolder=await folderStyle();assert.equal(sinceFolder.name,normalFolder.name);assert.equal(sinceFolder.iconColor,normalFolder.iconColor);assert.equal(sinceFolder.filter,normalFolder.filter);assert.match(sinceFolder.meta,/更新/);await capture('explorer-since-colors');
 await evaluate(`document.querySelector('.explorer-search input[value="grep"]').click();`);
 await evaluate(`const query=document.querySelector('.explorer-search input[type="search"]');query.value='nested';query.dispatchEvent(new Event('input',{bubbles:true}));Array.from(document.querySelectorAll('.explorer-search form button')).find(b=>b.textContent==='検索').click();`);
 await until(`document.querySelector('.explorer-panel li[data-path="開発資料1"]')?.classList.contains('fresh')`);
 const grepFolder=await folderStyle();assert.equal(grepFolder.name,normalFolder.name);assert.equal(grepFolder.iconColor,normalFolder.iconColor);assert.equal(grepFolder.filter,normalFolder.filter);assert.match(grepFolder.meta,/更新/);await capture('explorer-grep-colors');
 // 3分類は別々の実ツリーを表示。AI応答はブラウザー内のfixtureで完結させる。
 await evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='検索軌跡').click()`);
 await until(`!!document.querySelector('.route-tree')`);assert.equal(await evaluate(`aidiyIDE.routeState.mode`),'search');await capture('search-route-tree');
 const grepPaths=await evaluate(`[...document.querySelectorAll('.route-tree [data-route-path]')].map(e=>e.dataset.routePath)`);
 assert.ok(grepPaths.includes('開発資料1/nested.txt'));
 await evaluate(`window.folderFetch=window.fetch;window.fetch=function(url,options){if(String(url).startsWith('/api/ai-search'))return Promise.resolve(new Response(JSON.stringify(String(url).includes('/history')?{entries:[]}:{status:'complete',result:{id:'fixture',title:'テスト検索',query:'fixture',files:[{path:'README.txt',reason:'入口'},{path:'file002.txt',reason:'候補'}],route:['README.txt','file002.txt'],routeRecords:[{from:null,to:'f:README.txt'},{from:'f:README.txt',to:'f:file002.txt'}]}}),{status:200,headers:{'content-type':'application/json'}}));return folderFetch.apply(this,arguments);};document.querySelector('.explorer-search input[value="ai"]').click();`);
 await evaluate(`const q=document.querySelector('.ai-search-panel textarea');q.value='fixture';q.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.ai-search-panel form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
 await until(`aidiyIDE.routeState.mode==='ai'&&document.querySelector('.route-tree [data-route-path="file002.txt"]')`);await capture('ai-route-tree');
 assert.equal(await evaluate(`!!document.querySelector('[aria-label="閲覧軌跡をクリア"]')`),false);
 await evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='検索軌跡').click()`);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.route-tree [data-route-path]')].map(e=>e.dataset.routePath)`),grepPaths);
 for(const entry of [{type:'dir',path:'開発資料1'},{type:'dir',path:'開発資料1/内部'},{type:'file',path:'開発資料1/内部/one.txt'},{type:'file',path:'開発資料1/内部/two.txt'},{type:'file',path:'開発資料1/内部/one.txt'},{type:'file',path:'開発資料1/new.txt'}])await evaluate(`aidiyIDE.goTo(${JSON.stringify(entry)})`);
 await evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='閲覧軌跡').click()`);
 await until(`!!document.querySelector('[data-route-point="o:開発資料1/内部"]')`);await capture('view-route-folder-pairs');
 const treeRows=await evaluate(`[...document.querySelectorAll('.route-tree li')].map(e=>({point:e.dataset.routePoint,parent:e.dataset.routeParent,depth:e.dataset.routeDepth}))`);
 assert.equal(treeRows.find(r=>r.point==='o:開発資料1/内部').parent,'g:開発資料1/内部');
 await evaluate(`document.querySelector('[data-route-point="g:開発資料1/内部"] button').click()`);
 await evaluate(`document.querySelector('[aria-label="次の閲覧ファイル"]').click()`);
 await until(`aidiyIDE.selected?.path==='開発資料1/内部/one.txt'`);
 await evaluate(`document.querySelector('[aria-label="次の閲覧ファイル"]').click()`);await until(`aidiyIDE.selected?.path==='開発資料1/内部/two.txt'`);
 await evaluate(`document.querySelector('[aria-label="前の閲覧ファイル"]').click()`);await until(`aidiyIDE.selected?.path==='開発資料1/内部/one.txt'`);
 await evaluate(`document.querySelector('[aria-label="前の閲覧ファイル"]').click()`);await until(`!aidiyIDE.selected&&aidiyIDE.trail.join('/')==='開発資料1/内部'`);
 await evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='閲覧軌跡').click()`);
 await evaluate(`document.querySelector('[aria-label="エクスプローラーを閉じる"]').click()`);
 // 非表示と3Dでは停止し、復帰後は一つの監視だけ。
 await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));`);await sleep(50);
 const hiddenCount=await evaluate('folderCalls.length');await sleep(31000);assert.equal(await evaluate('folderCalls.length'),hiddenCount);
 await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));`);await until(`folderCalls.length>${hiddenCount}`);
 await evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='3D').click()`);await sleep(50);
 const modeCount=await evaluate('folderCalls.length');await sleep(31000);assert.equal(await evaluate('folderCalls.length'),modeCount);
 await evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
 await until(`folderCalls.length>${modeCount}`);
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='利用終了').click()`);
 await until(`!document.querySelector('.folder-pages')`);const endCount=await evaluate('folderCalls.length');await sleep(31000);assert.equal(await evaluate('folderCalls.length'),endCount);
 assert.deepEqual(errors,[]);
 const evidence={treeRows,grepPaths,normalFolder,sinceFolder,grepFolder,decoration,nameMetrics,before,after,line1,line2,layouts,operations:['フォルダカードの横一列配置','矩形カードの枠線と影なし表示','今日だけ赤字・元日時tooltip','差分なしの手動更新と連打','変更時の下方向モーション','カーソルとスクロール維持','OFF/ON','追加削除と連続更新','フォルダ切替','reduced-motion','非表示/3D/利用終了の監視停止','閲覧軌跡のみクリアと位置保持','起点/grepのフォルダ色保持と件数表示','3分類の独立ツリーとフォルダ入場対の順次移動'],shots,errors};
 writeFileSync(join(output,'result.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}finally{
 ws?.close();chrome.kill();await app.close();await sleep(300);
 for(const folder of [project,profile]){
  if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');
  try{rmSync(folder,{recursive:true,force:true});}catch{/* ブラウザが保持中の一時ファイルは残す。 */}
 }
}
