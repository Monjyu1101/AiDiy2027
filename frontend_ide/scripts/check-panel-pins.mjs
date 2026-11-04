// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// オフラインfixtureでExplorer/Viewerの別窓化・状態保持・X折畳み/閲覧終了・Webフェードを実画面検証する。
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
const project=mkdtempSync(join(tmpdir(),'aidiy-pin-'));
const profile=mkdtempSync(join(tmpdir(),'aidiy-pin-browser-'));

mkdirSync(join(project,'src'));
writeFileSync(join(project,'src','sample.txt'),'Glass panel fixture\nReadable text stays opaque.\n');
writeFileSync(join(project,'README.txt'),'Second fixture file.');
for(let i=0;i<80;i++)writeFileSync(join(project,'src',`file-${String(i).padStart(2,'0')}.txt`),'Searchable fixture '+i);
const app=await startDevelopment(project);
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sockets=[],errors=[],shots=[];
const output=resolve('temp/panel-pin-check');mkdirSync(output,{recursive:true});
async function connect(target){
 const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let sequence=0;const pending=new Map();
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++sequence,resolve);ws.send(JSON.stringify({id:sequence,method,params}));});
 async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(r.error,undefined);assert.equal(r.result?.exceptionDetails,undefined,JSON.stringify(r.result?.exceptionDetails));return r.result.result.value;}
 async function until(expression){for(let i=0;i<200;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail('画面待機: '+expression);}
 async function capture(name){const r=await send('Page.captureScreenshot',{format:'png'});const file=join(output,`${name}.png`);writeFileSync(file,Buffer.from(r.result.data,'base64'));shots.push(file);}
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
 await main.until('!!window.aidiyIDE');await main.evaluate('aidiyIDE.setAutoSpin(false);aidiyIDE.interact()');
 await main.evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
 await main.until(`!!document.querySelector('.folder-pages')`);
 await main.evaluate(`aidiyIDE.goTo({type:'file',path:'src/sample.txt'})`);
 await main.until(`!!document.querySelector('.viewer-popup .viewer-meta')`);
 await main.evaluate(`document.querySelector('.explorer-toggle').click();window.savedOpen=window.open;window.open=()=>null`);
 await main.evaluate(`document.querySelector('[aria-label="エクスプローラーを別ウィンドウで開く"]').click()`);
 await main.until(`document.body.textContent.includes('ポップアップがブロックされました')`);
 assert.equal(await main.evaluate(`!!document.querySelector('.explorer-panel')`),true);
 await main.until(`!document.querySelector('.explorer-branch-enter-active')`);
 // 画面内は開いた時だけフェード。軌跡は共通の高さ展開を使い、本文へフェードを重ねない。
 await main.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await main.evaluate(`window.fadeCount=0;const panel=document.querySelector('.explorer-panel');const animate=panel.animate;panel.animate=function(...args){window.fadeCount++;return animate.apply(this,args)};document.querySelector('[aria-label="エクスプローラーを閉じる"]').click()`);
 await main.evaluate(`document.querySelector('.explorer-toggle').click()`);await main.until('fadeCount===1');
 await main.evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='閲覧軌跡').click()`);
 await main.until(`!!document.querySelector('.route-file-list')`);
 assert.equal(await main.evaluate(`getComputedStyle(document.querySelector('.route-file-list')).animationName`),'none');
 assert.equal(await main.evaluate(`getComputedStyle(document.querySelector('.route-reveal')).transitionProperty`),'height');
 assert.equal(await main.evaluate(`getComputedStyle(document.querySelector('.route-file-list')).transform`),'none');
 await main.evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='閲覧軌跡').click()`);
 assert.equal(await main.evaluate('fadeCount'),1);
 await main.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await main.evaluate(`window.popupFades=[];window.open=function(...args){window.pinFeatures=args[2];const child=savedOpen.apply(window,args);const animate=child.Element.prototype.animate;child.Element.prototype.animate=function(frames,options){popupFades.push({className:this.className,frames,options});return animate.call(this,frames,options)};return child};window.explorerNode=document.querySelector('.explorer-panel');window.treeNode=explorerNode.querySelector('[role=tree]');treeNode.scrollTop=250;window.treeTop=treeNode.scrollTop`);
 const before=await main.evaluate(`({scroll:treeTop,html:explorerNode.querySelector('[role=tree]').innerHTML,rect:(()=>{const r=explorerNode.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()})`);
 await main.evaluate(`const pin=document.querySelector('[aria-label="エクスプローラーを別ウィンドウで開く"]');pin.click();pin.click()`);
 await main.until(`!document.querySelector('.explorer-panel')`);
 let explorerTarget=(await targets()).find(t=>t.title==='AiDiy IDE / Explorer');assert.ok(explorerTarget);
 const explorer=await connect(explorerTarget);
 await explorer.until(`!!document.querySelector('.explorer-panel')`);
 const detached=await explorer.evaluate(`({scroll:document.querySelector('[role=tree]').scrollTop,html:document.querySelector('[role=tree]').innerHTML,background:getComputedStyle(document.querySelector('.explorer-panel')).backgroundColor,blur:getComputedStyle(document.querySelector('.explorer-panel')).backdropFilter,animation:getComputedStyle(document.querySelector('main')).animationName})`);
 assert.equal(detached.html,before.html);assert.equal(detached.scroll,before.scroll);assert.equal(detached.blur,'none');assert.equal(detached.animation,'none');
 await main.until(`popupFades.some(f=>f.className.includes('explorer-window')&&f.options.duration===260&&f.frames[0].opacity===0&&f.frames[1].opacity===1)`);
 assert.equal((await targets()).filter(t=>t.title==='AiDiy IDE / Explorer').length,1);
 assert.equal(await main.evaluate(`explorerNode.ownerDocument!==document&&treeNode===explorerNode.querySelector('[role=tree]')`),true);
 await explorer.evaluate(`document.querySelector('[data-path="src/file-01.txt"]').click()`);
 await main.until(`document.querySelector('.viewer-popup header')?.textContent.includes('file-01.txt')`);
 // grepを別窓で実行し、条件・結果・選択をリロードとX折畳み後の再表示も保持する。
 await explorer.evaluate(`document.querySelector('input[value="grep"]').click()`);
 await explorer.evaluate(`const input=document.querySelector('input[type=search]');input.value='Searchable';input.dispatchEvent(new Event('input',{bubbles:true}));Array.from(document.querySelectorAll('form button')).find(b=>b.textContent==='検索').click()`);
 await explorer.until(`document.querySelector('form [role=status]')?.textContent.includes('80ファイル一致')`);
 assert.equal(await explorer.evaluate(`document.querySelector('.search-results-toggle').getAttribute('aria-expanded')`),'false','別窓の検索結果も初期は閉じる');
 await explorer.capture('explorer-search-collapsed');
 await explorer.evaluate(`document.querySelector('.search-results-toggle').click()`);
 const grepBefore=await explorer.evaluate(`({query:document.querySelector('input[type=search]').value,status:document.querySelector('form [role=status]').textContent,count:document.querySelectorAll('.search-results-content li').length})`);
 await explorer.evaluate(`document.querySelector('.search-results-toggle').click()`);
 await explorer.until(`!document.querySelector('.search-results-content')`);
 assert.equal(await explorer.evaluate(`document.querySelector('form [role=status]').textContent`),grepBefore.status);
 await explorer.evaluate(`document.querySelector('.search-results-toggle').click()`);
 assert.equal(await explorer.evaluate(`document.querySelectorAll('.search-results-content li').length`),grepBefore.count);
 await explorer.capture('explorer-pinned');
 await explorer.send('Page.reload');
 await explorer.until(`!!document.querySelector('.search-results-content')`);
 assert.deepEqual(await explorer.evaluate(`({query:document.querySelector('input[type=search]').value,status:document.querySelector('form [role=status]').textContent,count:document.querySelectorAll('.search-results-content li').length})`),grepBefore);
 await explorer.send('Page.close');await main.until(`getComputedStyle(explorerNode).display==='none'`);
 await main.evaluate(`document.querySelector('.explorer-toggle').click()`);await main.until(`getComputedStyle(explorerNode).display!=='none'`);
 assert.equal(await main.evaluate(`explorerNode===document.querySelector('.explorer-panel')&&treeNode===document.querySelector('[role=tree]')`),true);
 assert.equal(await main.evaluate(`getComputedStyle(explorerNode).backdropFilter`),'blur(4px)');
 await main.capture('explorer-restored');
 await main.evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='3D').click();document.querySelector('[aria-label="エクスプローラーを別ウィンドウで開く"]').click()`);
 await main.until(`!document.querySelector('.explorer-panel')`);
 explorerTarget=(await targets()).find(t=>t.title==='AiDiy IDE / Explorer');const again=await connect(explorerTarget);
 await again.until(`!!document.querySelector('.search-results-content')`);
 // AI検索の未送信入力も同じインスタンス。APIを呼ばず再pin・本体への復帰で保持する。
 await again.evaluate(`document.querySelector('input[value="ai"]').click()`);
 await again.evaluate(`const input=document.querySelector('.ai-search-panel textarea');input.value='未送信の調査内容';input.dispatchEvent(new Event('input',{bubbles:true}))`);
 await again.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 assert.ok(await main.evaluate(`popupFades.filter(f=>f.className.includes('explorer-window')&&f.options.duration===260).length>=2`));
 await again.evaluate(`document.querySelector('[aria-label="本体へ戻す"]').click()`);await main.until(`!!document.querySelector('.explorer-panel')`);
 assert.equal(await main.evaluate(`document.querySelector('.ai-search-panel textarea').value`),'未送信の調査内容');
 // Viewerも同じ位置指定で起動し、閉鎖後は閲覧を破棄し、明示的に再open/pinできる。
 await main.evaluate(`document.querySelector('[aria-label="ファイルを別ウィンドウで開く"]').click()`);
 await main.until(`!document.querySelector('.viewer-popup')`);
 let viewerTarget=(await targets()).find(t=>t.title.startsWith('AiDiy IDE / Viewer - '));assert.ok(viewerTarget);const viewer=await connect(viewerTarget);
 await viewer.until(`!!document.querySelector('.viewer-pinned .viewer-meta')`);
 const features=await main.evaluate('pinFeatures');assert.match(features,/left=-?\d+,top=-?\d+,width=\d+,height=\d+/);
 assert.equal(await viewer.evaluate(`getComputedStyle(document.querySelector('.viewer-window')).animationName`),'none');
 await viewer.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await main.until(`popupFades.some(f=>f.className.includes('viewer-window')&&f.options.duration===260&&f.frames[0].opacity===0&&f.frames[1].opacity===1)`);
 await viewer.capture('viewer-pinned');await viewer.send('Page.close');
 await main.until(`!document.querySelector('.viewer-session')`);
 await main.evaluate(`aidiyIDE.goTo({type:'file',path:'src/file-01.txt'})`);await main.until(`!!document.querySelector('[aria-label="ファイルを別ウィンドウで開く"]')`);
 await main.evaluate(`document.querySelector('[aria-label="ファイルを別ウィンドウで開く"]').click()`);await main.until(`!document.querySelector('.viewer-popup')`);
 await main.evaluate(`document.querySelector('[aria-label="エクスプローラーを別ウィンドウで開く"]').click()`);await main.until(`!document.querySelector('.explorer-panel')`);
 await main.send('Page.close');await sleep(700);
 assert.equal((await targets()).filter(t=>t.title==='AiDiy IDE / Explorer'||t.title.startsWith('AiDiy IDE / Viewer - ')).length,0);
 assert.deepEqual(errors,[]);
 const result={before:{...before,html:undefined},detached:{...detached,html:undefined},grepBefore,features,shots,errors,operations:['popup失敗時本体保持','連打で1窓','同じDOM・スクロール保持','別窓選択とIDE連動','grep条件/結果の引継ぎ','子再読込','X折畳み・再表示','3D再pin','AI未送信入力保持','画面内・Web別窓260msフェードと軌跡の高さ展開','通常の更新で演出連発なし','Viewer X終了・再open/pin','親終了で子終了']};
 writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
 for(const ws of sockets)ws.close();chrome.kill();await app.close();await sleep(300);
 for(const folder of [project,profile]){if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');try{rmSync(folder,{recursive:true,force:true});}catch{}}
}
