// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// オフラインfixtureでExplorer/Viewerの別窓化・状態保持・X復元・Webフェードを実画面検証する。
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
const project=mkdtempSync(join(tmpdir(),'aidiy-compare-'));
const profile=mkdtempSync(join(tmpdir(),'aidiy-compare-browser-'));

mkdirSync(join(project,'src'));
writeFileSync(join(project,'src','sample.txt'),'Glass panel fixture\nReadable text stays opaque.\n');
writeFileSync(join(project,'README.txt'),'Second fixture file.');
for(let i=0;i<80;i++)writeFileSync(join(project,'src',`file-${String(i).padStart(2,'0')}.txt`),'Searchable fixture '+i);
const lines=Array.from({length:250},(_,i)=>`const line${i} = ${i};`).join('\n');
writeFileSync(join(project,'src','sample.txt'),lines);
for(const date of ['20261010','20261011']){const backup=join(project,'.aidiy_backup',date,'120000.all','src');mkdirSync(backup,{recursive:true});writeFileSync(join(backup,'sample.txt'),lines.replace('line100 = 100',`line100 = ${date}`));}
const app=await startDevelopment(project);
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sockets=[],errors=[],shots=[];
const output=resolve('temp/compare-pin-check');mkdirSync(output,{recursive:true});
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
 await main.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await main.send('Page.navigate',{url:app.url});
 await main.until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='オフライン利用')`);
 await main.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
 await main.until('!!window.aidiyIDE');await main.evaluate('aidiyIDE.setAutoSpin(false);aidiyIDE.interact()');
 await main.evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
 await main.until(`!!document.querySelector('.folder-pages')`);
 await main.evaluate(`aidiyIDE.goTo({type:'file',path:'src/sample.txt'})`);
 await main.until(`!!document.querySelector('.viewer-history')`);
 await main.until(`!!window.monaco?.editor`);
 // Monacoの実エディターを記録し、pin/reloadで同じmodelとscrollを使うことを確認する。
 await main.evaluate(`window.diffEditors=[];window.makeDiff=monaco.editor.createDiffEditor;monaco.editor.createDiffEditor=function(...args){const value=makeDiff.apply(this,args);diffEditors.push(value);return value;};document.querySelector('.viewer-history').click()`);
 await main.until(`!!document.querySelector('.file-history-changes')&&!document.querySelector('.file-history-changes').textContent.includes('計算中')`);
 await main.evaluate(`window.originalCompare=document.querySelector('.file-history-editor');window.initialDiff=diffEditors.at(-1);initialDiff.getOriginalEditor().setScrollTop(700);initialDiff.getModifiedEditor().setScrollTop(700);window.initialModel=initialDiff.getModel();window.nativeOpen=window.open;window.open=()=>null;document.querySelector('[aria-label="ソース比較を別ウィンドウで開く"]').click()`);
 await main.until(`document.body.textContent.includes('ポップアップがブロックされました')`);
 assert.equal(await main.evaluate('diffEditors.length'),1);
 await main.evaluate(`window.open=function(...args){window.popupArgs=args;return nativeOpen.apply(window,args)};const button=document.querySelector('[aria-label="ソース比較を別ウィンドウで開く"]');button.click();button.click()`);
 await main.until(`!document.querySelector('.viewer-session')`);
 let childTarget=(await targets()).find(t=>t.title.startsWith('AiDiy IDE / Viewer'));assert.ok(childTarget);
 const child=await connect(childTarget);await child.until(`!!document.querySelector('.history-embedded')`);
 assert.equal((await targets()).filter(t=>t.title.startsWith('AiDiy IDE / Viewer')).length,1);
 assert.equal(await main.evaluate(`initialDiff.getModel()===initialModel&&diffEditors.length===1&&originalCompare.ownerDocument!==document`),true);
 assert.equal(await main.evaluate('initialDiff.getOriginalEditor().getScrollTop()'),700);
 assert.equal(await child.evaluate(`getComputedStyle(document.querySelector('main')).animationName`),'panel-fade-in');
 await child.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 assert.equal(await child.evaluate(`getComputedStyle(document.querySelector('main')).animationDuration`),'0.26s');
 assert.ok(await child.evaluate(`innerWidth>500`),'比較は隠れたviewerではなく比較パネルの幅で開く');
 await sleep(350);await child.capture('comparison-pinned');
 await child.send('Page.reload');await child.until(`!!document.querySelector('.history-embedded')`);
 assert.equal(await main.evaluate(`initialDiff.getModel()===initialModel&&diffEditors.length===1`),true);
 assert.equal(await main.evaluate('initialDiff.getOriginalEditor().getScrollTop()'),700);
 // 遅延した比較を無視して最後に選んだ旧版を表示する。
 await main.evaluate(`window.nativeFetch=window.fetch;window.releaseOld=null;window.fetch=async(...args)=>{if(String(args[0]).includes('/api/file-history?')&&String(args[0]).includes('version=')&&!releaseOld){const response=await nativeFetch(...args);return await new Promise(resolve=>{releaseOld=()=>resolve(response)});}return nativeFetch(...args);}`);
 await child.evaluate(`var select=document.querySelector('select');select.selectedIndex=1;select.dispatchEvent(new Event('change',{bubbles:true}))`);
 await main.until('!!releaseOld');
 await child.evaluate(`var select=document.querySelector('select');select.selectedIndex=0;select.dispatchEvent(new Event('change',{bubbles:true}))`);
 await child.until(`!!document.querySelector('.file-history-changes')`);
 await main.evaluate('releaseOld();window.fetch=nativeFetch');await sleep(250);
 assert.equal(await child.evaluate(`document.querySelector('select').selectedIndex`),0);
 assert.match(await main.evaluate('diffEditors.at(-1).getModel().original.getValue()'),/20261011/);
 await child.evaluate(`document.querySelector('[aria-label="更新履歴を閉じる"]').click()`);
 await child.until(`getComputedStyle(document.querySelector('.viewer-pinned')).display!=='none'`);
 await child.evaluate(`document.querySelector('.viewer-history').click()`);await child.until(`!!document.querySelector('.file-history-changes')`);
 assert.equal(await main.evaluate(`!!document.querySelector('.file-history-dialog')`),false);
 await child.send('Page.close');await main.until('monaco.editor.getModels().length===0');
 assert.equal(await main.evaluate(`!!document.querySelector('.viewer-session')`),false);
 // 通常viewerのpin経路も、比較を同じ窓に開く。Xは復元しない。
 await main.evaluate(`aidiyIDE.goTo({type:'file',path:'src/sample.txt'})`);await main.until(`!!document.querySelector('.viewer-history')`);
 await main.evaluate(`document.querySelector('[aria-label="ファイルを別ウィンドウで開く"]').click()`);await main.until(`!document.querySelector('.viewer-session')`);
 childTarget=(await targets()).find(t=>t.title.startsWith('AiDiy IDE / Viewer'));const again=await connect(childTarget);
 await again.until(`!!document.querySelector('.viewer-history')`);await again.evaluate(`document.querySelector('.viewer-history').click()`);await again.until(`!!document.querySelector('.file-history-changes')`);
 // Explorer Xは折畳み。バーガーで再表示しても入力は保持する。
 await main.evaluate(`document.querySelector('.explorer-toggle').click();window.explorerNode=document.querySelector('.explorer-panel');document.querySelector('input[value="grep"]').click()`);
 await main.evaluate(`const input=document.querySelector('.explorer-panel input[type=search]');input.value='保持する検索';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="エクスプローラーを別ウィンドウで開く"]').click()`);
 await main.until(`!document.querySelector('.explorer-panel')`);const explorer=await connect((await targets()).find(t=>t.title==='AiDiy IDE / Explorer'));
 await explorer.until(`!!document.querySelector('.explorer-panel')`);await explorer.send('Page.close');await main.until(`!!document.querySelector('.explorer-toggle')&&getComputedStyle(explorerNode).display==='none'`);
 await main.evaluate(`document.querySelector('.explorer-toggle').click()`);await main.until(`getComputedStyle(explorerNode).display!=='none'`);
 assert.equal(await main.evaluate(`explorerNode.querySelector('input[type=search]').value`),'保持する検索');
 await main.capture('explorer-reopened');
 await main.send('Page.close');await sleep(700);
 assert.equal((await targets()).filter(t=>t.title==='AiDiy IDE / Explorer'||t.title.startsWith('AiDiy IDE / Viewer')).length,0);
 assert.deepEqual(errors,[]);
 const result={shots,errors,operations:['比較から直接pin','pin失敗時保持','連打1窓','比較model/左右scroll保持','子reload同一model','古い比較応答を破棄','別窓で比較解除/開始/対象変更','Xでviewer/model破棄・再open','通常viewerから比較は同じ窓','本体に重複なし','Explorer X折畳み・入力保持・再表示','親終了で子終了']};
 writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
 for(const ws of sockets)ws.close();chrome.kill();await app.close();await sleep(300);
 for(const folder of [project,profile]){if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');try{rmSync(folder,{recursive:true,force:true});}catch{}}
}
