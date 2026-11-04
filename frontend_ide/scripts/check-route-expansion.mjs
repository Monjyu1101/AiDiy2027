// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 軌跡の3分類・実ツリー・別窓化・X折畳みを実ブラウザで確認。AI結果だけ模擬し、外部AIは起動しない。
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
const project=mkdtempSync(join(tmpdir(),'aidiy-route-'));
const profile=mkdtempSync(join(tmpdir(),'aidiy-route-browser-'));

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
const output=resolve('temp/route-expansion-check');mkdirSync(output,{recursive:true});
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
 for(let i=0;i<80&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
 assert.ok(port);const targets=async()=>await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const main=await connect((await targets()).find(t=>t.type==='page'));
 await main.send('Emulation.setDeviceMetricsOverride',{width:1920,height:800,deviceScaleFactor:1,mobile:false});
 await main.send('Page.navigate',{url:app.url});
 await main.until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='オフライン利用')`);
 await main.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='オフライン利用').click()`);
 await main.until('!!window.aidiyIDE');await main.evaluate('aidiyIDE.setAutoSpin(false);aidiyIDE.interact()');
 await main.evaluate(`Array.from(document.querySelectorAll('.ide-view-modes button')).find(b=>b.textContent==='2D').click()`);
 await main.until(`!!document.querySelector('.folder-pages')`);
 for(const path of ['src/sample.txt','README.txt','src/file-02.txt'])await main.evaluate(`aidiyIDE.goTo({type:'file',path:${JSON.stringify(path)}})`);

 await main.evaluate('aidiyIDE.clear()');
 await main.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 const trace=async(page,action)=>page.evaluate(`(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));getComputedStyle(document.querySelector('.route-reveal')).height;${action};const records=[],start=performance.now();await new Promise(resolve=>{function tick(){const panel=document.querySelector('.explorer-routes'),body=document.querySelector('.route-reveal'),content=document.querySelector('.route-file-list');records.push({t:performance.now()-start,height:body.getBoundingClientRect().height,top:panel.getBoundingClientRect().top,visible:!!content&&getComputedStyle(content).visibility==='visible',phase:body.dataset.phase});if(performance.now()-start<550)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});return records;})()`);
 const inlineOpen=await trace(main,`document.querySelector('.route-choice').click()`);
 assert.ok(inlineOpen.some(r=>r.height>2&&r.height<290));assert.ok(inlineOpen.some(r=>r.visible));assert.ok(inlineOpen.filter(r=>r.height<299).every(r=>!r.visible));assert.equal(new Set(inlineOpen.map(r=>r.top)).size,1);
 const inlineClose=await trace(main,`document.querySelector('.route-choice').click()`);assert.ok(inlineClose.every(r=>!r.visible));assert.equal(inlineClose.at(-1).height,0);
 assert.ok(await main.evaluate(`(()=>{const buttons=[...document.querySelectorAll('.route-controls>button')];return new Set(buttons.map(b=>Math.round(b.getBoundingClientRect().top))).size===1&&document.querySelector('.explorer-routes').getBoundingClientRect().height<50})()`));await main.capture('inline-small-bar');
 // 下端では上端を動かさず、入る分だけ展開する。
 await main.evaluate(`document.querySelector('.explorer-routes').style.top=(innerHeight-100)+'px'`);
 const bottomOpen=await trace(main,`document.querySelector('.route-choice').click()`);assert.ok(await main.evaluate(`document.querySelector('.explorer-routes').getBoundingClientRect().bottom<=innerHeight-8`));assert.equal(new Set(bottomOpen.map(r=>r.top)).size,1);
 await trace(main,`document.querySelector('.route-choice').click()`);await main.evaluate(`document.querySelector('.explorer-routes').style.top=''`);
 // 途中反転後、分類を切り替えても最後の開閉だけを反映する。
 const reverse=await trace(main,`const button=document.querySelector('.route-choice');button.click();setTimeout(()=>button.click(),80);setTimeout(()=>button.click(),140);setTimeout(()=>document.querySelectorAll('.route-choice')[1].click(),180)`);
 assert.equal(reverse.at(-1).phase,'open');assert.equal(await main.evaluate(`document.querySelector('.route-choice[aria-pressed=true]').textContent`),'検索軌跡');
 await main.evaluate(`document.querySelectorAll('.route-choice')[1].click()`);await sleep(350);
 await main.evaluate(`aidiyIDE.clear();document.querySelector('.route-choice').click();window.routeNode=document.querySelector('.explorer-routes');window.nativeOpen=window.open;window.open=()=>null;document.querySelector('[aria-label="軌跡バーを別ウィンドウで開く"]').click()`);
 await main.until(`document.body.textContent.includes('ポップアップがブロックされました')`);
 assert.equal(await main.evaluate(`document.querySelectorAll('.route-choice').length`),3);
 const initialRows=await main.evaluate(`Array.from(document.querySelectorAll('[data-route-point]'),el=>el.dataset.routePoint)`);assert.ok(initialRows.length>=3);await trace(main,`document.querySelector('.route-choice').click()`);
 await main.evaluate(`window.open=function(...args){window.popupArgs=args;return nativeOpen.apply(window,args)};const pin=document.querySelector('[aria-label="軌跡バーを別ウィンドウで開く"]');pin.click();pin.click()`);
 await main.until(`!document.querySelector('.explorer-routes')`);
 let target=(await targets()).find(t=>t.title==='AiDiy IDE / 軌跡');assert.ok(target);let child=await connect(target);await child.until(`!!document.querySelector('.route-controls')`);await child.until(`document.querySelector('.route-reveal').dataset.phase==='closed'`);assert.ok(await child.evaluate(`document.querySelector('.explorer-routes').getBoundingClientRect().height<100`));await child.capture('popup-small-bar');await child.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});const popupOpen=await trace(child,`document.querySelector('.route-choice').click()`);assert.ok(popupOpen.some(r=>r.height>2&&r.height<290));assert.ok(popupOpen.filter(r=>r.height<299).every(r=>!r.visible));
 assert.equal((await targets()).filter(t=>t.title==='AiDiy IDE / 軌跡').length,1);
 assert.deepEqual(await child.evaluate(`Array.from(document.querySelectorAll('[data-route-point]'),el=>el.dataset.routePoint)`),initialRows);
 assert.equal(await main.evaluate('routeNode.ownerDocument!==document'),true);
 const size=await child.evaluate('({width:innerWidth,height:innerHeight})');assert.ok(size.width<=500&&size.height<=400,JSON.stringify({...size,details:await child.evaluate('({outerWidth,outerHeight,screenY,available:screen.availHeight,panel:document.querySelector(".explorer-routes").getBoundingClientRect().toJSON()})')}));
 await child.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});assert.equal(await child.evaluate(`getComputedStyle(document.querySelector('main')).animationDuration`),'0.26s');
 await sleep(300);await child.capture('view-route-small-window');
 await child.send('Page.reload');await child.until(`document.querySelector('.route-reveal')?.dataset.phase==='open'`);assert.equal(await main.evaluate('routeNode.ownerDocument!==document'),true);
 await child.evaluate(`document.querySelector('[data-route-path="README.txt"]').click()`);await main.until(`aidiyIDE.selected?.path==='README.txt'`);
 // grep結果は実API。別窓の検索軌跡からジャンプする。
 await main.evaluate(`document.querySelector('.explorer-toggle').click();document.querySelector('input[value="grep"]').click()`);
 await main.evaluate(`const input=document.querySelector('.explorer-panel input[type=search]');input.value='Searchable';input.dispatchEvent(new Event('input',{bubbles:true}));Array.from(document.querySelectorAll('.explorer-search button')).find(b=>b.textContent==='検索').click();`);
 await child.until(`document.querySelector('[data-route-path="src/file-00.txt"]')!==null`);
 assert.equal(await child.evaluate(`document.querySelector('.route-choice[aria-pressed=true]').textContent`),'検索軌跡');
 await child.evaluate(`document.querySelector('[data-route-path="src/file-00.txt"]').click()`);await main.until(`aidiyIDE.selected?.path==='src/file-00.txt'`);
 // AiDiy履歴のみ固定結果。AI依頼POSTは禁止。
 await main.evaluate(`window.nativeFetch=window.fetch;window.aiPosts=0;window.fetch=(input,options)=>{if(String(input).startsWith('/api/ai-search')){if(options?.method==='POST'){aiPosts++;throw Error('AIは禁止');}const result=String(input).includes('id=')?{id:'fixture',query:'確認用',title:'2件の関連ファイル',files:[{path:'README.txt',reason:'入口'},{path:'src/sample.txt',reason:'詳細'}],route:['README.txt','src/sample.txt']}:{entries:[{id:'fixture',query:'確認用',title:'確認用',createdAt:Date.now(),count:2}]};return Promise.resolve(new Response(JSON.stringify(result)));}return nativeFetch(input,options);};`);
 await child.evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='AiDiy検索軌跡').click()`);
 await main.evaluate(`document.querySelector('.ai-history-header button').click()`);await main.until(`!!document.querySelector('.ai-history-open')`);await main.evaluate(`document.querySelector('.ai-history-open').click()`);
 await child.until(`document.querySelector('.ai-route-title')?.textContent==='2件の関連ファイル'`);
 await child.evaluate(`document.querySelector('[data-route-path="src/sample.txt"]').click()`);await main.until(`aidiyIDE.selected?.path==='src/sample.txt'`);
 await child.capture('ai-route-tree');assert.equal(await main.evaluate('aiPosts'),0);
 // 戻す/再pinは同じDOM。X後は閉じたバー、記録を保って再表示する。
 await child.evaluate(`document.querySelector('[aria-label="軌跡バーを本体へ戻す"]').click()`);await main.until(`document.querySelector('.explorer-routes')===routeNode`);
 await main.evaluate(`document.querySelector('[aria-label="軌跡バーを別ウィンドウで開く"]').click()`);await main.until(`!document.querySelector('.explorer-routes')`);
 target=(await targets()).find(t=>t.title==='AiDiy IDE / 軌跡');child=await connect(target);await child.until(`!!document.querySelector('.route-tree')`);
 await child.send('Page.close');await main.until(`getComputedStyle(routeNode).display==='none'&&!!document.querySelector('[aria-label="軌跡バーを開く"]')`);
 await main.evaluate(`document.querySelector('[aria-label="軌跡バーを開く"]').click();Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='AiDiy検索軌跡').click()`);
 await main.until(`!!document.querySelector('[data-route-path="src/sample.txt"]')`);
 await main.evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='閲覧軌跡').click()`);await main.until(`!!document.querySelector('[aria-label="閲覧軌跡をクリア"]')`);
 assert.ok(await main.evaluate(`document.querySelectorAll('[data-route-point]').length>=3`));
 await main.evaluate(`document.querySelector('[aria-label="軌跡バーを別ウィンドウで開く"]').click()`);await main.until(`!document.querySelector('.explorer-routes')`);
 child=await connect((await targets()).find(t=>t.title==='AiDiy IDE / 軌跡'));await child.until(`!!document.querySelector('[aria-label="閲覧軌跡をクリア"]')`);
 await child.evaluate(`document.querySelector('[aria-label="閲覧軌跡をクリア"]').click()`);await child.until(`document.querySelector('[aria-label="閲覧軌跡をクリア"]').disabled`);
 await child.evaluate(`Array.from(document.querySelectorAll('.route-choice')).find(b=>b.textContent==='AiDiy検索軌跡').click()`);await child.until(`!!document.querySelector('[data-route-path="README.txt"]')`);
 await child.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await child.evaluate(`getComputedStyle(document.querySelector('main')).animationName`),'panel-fade-in');
 await child.until(`document.querySelector('.route-reveal').dataset.phase==='open'`);assert.equal(await child.evaluate(`getComputedStyle(document.querySelector('.route-reveal')).transitionDuration`),'0.26s');
 const reducedClose=await trace(child,`document.querySelector('.route-choice[aria-pressed=true]').click()`);assert.ok(reducedClose.some(r=>r.height>0&&r.height<300&&!r.visible));
 const reducedOpen=await trace(child,`document.querySelectorAll('.route-choice')[2].click()`);assert.ok(reducedOpen.some(r=>r.height>0&&r.height<300));assert.equal(reducedOpen.at(-1).visible,true);
 await main.send('Page.close');await sleep(600);assert.equal((await targets()).filter(t=>t.title==='AiDiy IDE / 軌跡').length,0);assert.deepEqual(errors,[]);
 const result={ok:true,size,inlineOpen,inlineClose,bottomOpen,reverse,popupOpen,reducedClose,reducedOpen,shots,errors,operations:['3分類と実ツリーを同一DOMで移動','blocked popup保持','連打1窓','reload保持','閲覧/grep/AiDiy検索から実ジャンプ','AI外部送信なし','本体へ戻す','Xで折畳みと記録保持','閲覧クリアは他分類を保持','Webfade/OS設定による省略なし','親終了cleanup']};writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,inlineOpen:undefined,inlineClose:undefined,bottomOpen:undefined,reverse:undefined,popupOpen:undefined,reducedClose:undefined,reducedOpen:undefined},null,2));
}finally{
 for(const ws of sockets)ws.close();chrome.kill();await app.close();await sleep(300);
 for(const folder of [project,profile]){if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');try{rmSync(folder,{recursive:true,force:true});}catch{}}
}
