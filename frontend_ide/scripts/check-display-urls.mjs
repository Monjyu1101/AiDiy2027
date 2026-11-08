// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実VueとChromiumをローカル模擬APIで検証。AI・ユーザーデータ・配布ビルドは使用しない。
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript} from '@vue/compiler-sfc';
import WebSocket from 'ws';
const root=fileURLToPath(new URL('..',import.meta.url)),output=join(root,'temp/display-url-check');
mkdirSync(output,{recursive:true});
const appSource=join(root,'src/App.vue');
const parsed=parse(readFileSync(appSource,'utf8'),{filename:appSource});assert.deepEqual(parsed.errors,[]);compileScript(parsed.descriptor,{id:'app-check',inlineTemplate:true});
const bundle=await build({stdin:{contents:`import {createApp,h,ref} from 'vue';import Viewer from './src/components/ファイル閲覧/ファイルビューア.vue';import Analysis from './src/dialog/ファイル解析ダイアログ.vue';
localStorage.clear();window.browserCalls=[];window.aidiyWindow={openBrowser:async(...args)=>{browserCalls.push(args);return {ok:true}}};
const file=ref({name:'Screen.vue',path:'src/Screen.vue'}),dialog=ref(false),visible=ref(true),project=ref('/fixture');
window.changeFile=(path)=>{file.value={path,name:path.split('/').at(-1)}};window.changeRoot=(path)=>project.value=path;window.showDialog=()=>dialog.value=true;window.showViewer=()=>visible.value=true;
const app=createApp({render:()=>[visible.value?h(Viewer,{file:file.value,root:project.value,onClose:()=>visible.value=false}):null,dialog.value?h(Analysis,{key:file.value.path,file:file.value,root:project.value,onClose:()=>dialog.value=false}):null]});app.provide('browserAvailable',true);app.provide('openFileAnalysis',()=>dialog.value=true);app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,format:'iife',plugins:[{name:'test-vue',setup(build){
 build.onLoad({filter:/コード表示\.js$/},()=>({contents:'export const loadMonaco=async()=>null;export const monacoLanguage=()=>"plaintext";'}));
 build.onLoad({filter:/\.vue$/},args=>{const {descriptor,errors}=parse(readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[]);const compiled=compileScript(descriptor,{id:'display-url-check',inlineTemplate:true});return {contents:compiled.content+`\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.content).join('\n'))};document.head.append(style);}`,resolveDir:dirname(args.path)};});
}}]});
if(process.argv.includes('--compile-only')){console.log('PASS: FileViewer, FileAnalysisDialog and App.vue compile (no distribution build).');process.exit(0);}
const temporary=mkdtempSync(join(tmpdir(),'display-url-'));
const requests=[],pending=[];let analysisMode='saved';
const css=readFileSync(join(root,'src/style.css'),'utf8');
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),path=url.searchParams.get('path');requests.push({method:req.method,url:req.url});
 const json=value=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const saved={kind:'analysis',routes:[{path:'一覧画面',url:origin+'/fixture/list',reason:'router.ts:10 → List.vue:4 → shared.js'},{path:'詳細画面',url:origin+'/fixture/detail',reason:'router.ts:20 → Detail.vue:8 → shared.js'}],stale:true,reason:'ルーターの登録を確認しました。'};
 if(url.pathname==='/api/preview'){
  if(path.includes('Slow')){pending.push(()=>json(saved));return;}
  if(/Unknown\.(vue|js)$/.test(path))return json({error:'表示URLを特定できません。AI解析で調べてください。'});
  if(path.endsWith('Fallback.html'))return json({kind:'html',url:origin+'/fixture/fallback'});
  if(path.endsWith('Legacy.vue'))return json({kind:'vue',routes:[{path:'/legacy',url:origin+'/fixture/legacy'}]});
  return json(saved);
 }
 if(url.pathname==='/api/file')return json({kind:'text',text:'// '+path+'\nexport const screen = "読み取り専用のコード";',size:80});
 if(url.pathname==='/api/file-history')return json({versions:[]});
 if(url.pathname==='/api/file-analysis'){
  if(req.method!=='GET'){for await(const _ of req){}return json({ok:true});}
  const result={createdAt:Date.now(),instruction:'画面の役割を確認',content:'## 保存済みの解析\n画面と表示URLの対応を確認しました。'};
  if(analysisMode==='saved')Object.assign(result,{relatedSourceScope:'page',displayUrls:saved.routes.map(r=>({url:r.url,label:r.path,reason:r.reason})),displayUrlReason:saved.reason});
  if(analysisMode==='direct')Object.assign(result,{relatedSourceScope:'direct',displayUrls:[],displayUrlReason:'画面と関係ないためURLはありません。',content:'## 関連ソース（1次レベル）\n### 呼び出し元\napi.py:12 → read_item\n### 呼び出し先\ndb.py:8 → execute\n祖父・孫は探索していません。'});
  if(analysisMode==='unknown')Object.assign(result,{displayUrls:[],displayUrlReason:'実行時のルートが不明なため表示URLを特定できません。'});
  return json({result,stale:true,job:null,instruction:'画面の役割を確認'});
 }
 if(url.pathname.startsWith('/fixture/'))return res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><meta charset="utf-8"><body style="background:#eff6ff;color:#123;font:24px sans-serif"><h1>ローカル表示URL検証</h1><p>'+url.pathname+'</p>');
 if(url.pathname==='/app.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(bundle.outputFiles[0].text);
 if(url.pathname==='/')return res.writeHead(200,{'content-type':'text/html'}).end(`<!doctype html><meta charset="utf-8"><style>${css}\nhtml,body,#app{margin:0;width:100%;height:100%;background:#000;color:#e5edf8}.viewer-popup{position:relative;inset:auto;width:100%;height:100%;max-height:none}</style><div id="app"></div><script src="/app.js"></script>`);
 return res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--window-size=1100,850','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe'],env:{...process.env,HOME:temporary,XDG_CONFIG_HOME:temporary,XDG_CACHE_HOME:temporary}});
let browserErrors='',socket,evaluate,capture;chrome.stderr.on('data',data=>browserErrors+=data);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let n=0;n<160;n++){if(await check())return;await sleep(50);}throw Error('Timeout: '+label);}
try{
 let port;await until(()=>{try{port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0];return !!port;}catch{return false;}},'Chromium').catch(error=>{throw Error(error.message+'\n'+browserErrors)});
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const calls=new Map(),errors=[];socket.on('message',value=>{const data=JSON.parse(value);if(data.id){calls.get(data.id)?.(data);calls.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params);});
 const send=(method,params={})=>new Promise(resolve=>{calls.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
 evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response));return response.result.result.value;};
 const click=async selector=>{const p=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...p});};
 capture=async name=>writeFileSync(join(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 const codeReady=()=>until(()=>evaluate(`!!document.querySelector('.viewer-code pre')&&!document.querySelector('.viewer-browser')?.disabled`),'code ready');
 const change=async path=>{await evaluate(`localStorage.clear();changeFile(${JSON.stringify(path)})`);await codeReady();};
 await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:origin});await codeReady();
 assert.equal(await evaluate(`document.querySelector('.viewer-mode button').getAttribute('aria-pressed')`),'true');assert.equal(await evaluate(`document.querySelectorAll('iframe').length`),0);assert.equal(await evaluate(`document.querySelectorAll('.viewer-route option').length`),2);assert.match(await evaluate(`document.querySelector('.viewer-display-url').textContent`),/fixture\/list/);await capture('01-code-and-display-url');
 await evaluate(`(()=>{const el=document.querySelector('.viewer-route select');el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);await until(()=>evaluate(`document.querySelector('.viewer-display-url').textContent.includes('/fixture/detail')`),'second URL');
 await click('.viewer-browser');await until(()=>evaluate(`browserCalls.length===1`),'browser explicit target');assert.deepEqual(await evaluate('browserCalls[0]'),['src/Screen.vue',null,origin+'/fixture/detail',false]);
 assert.equal(await evaluate(`document.querySelector('.viewer-analysis-page').textContent`),'AI推定ページ');await click('.viewer-analysis-page');await until(()=>evaluate(`browserCalls.length===2`),'AI inferred page');assert.deepEqual(await evaluate('browserCalls[1]'),['src/Screen.vue',null,origin+'/fixture/detail',true]);
 await click('.viewer-mode button:nth-child(2)');await until(()=>evaluate(`document.querySelector('.viewer-preview')?.src.endsWith('/fixture/detail')`),'second iframe');await until(()=>requests.some(r=>r.url==='/fixture/detail'),'fixture loaded');assert.equal(await evaluate(`document.querySelector('.viewer-preview').sandbox.contains('allow-same-origin')`),false);await sleep(250);await capture('02-selected-url-iframe');
 await evaluate('showDialog()');await until(()=>evaluate(`document.querySelectorAll('.analysis-display-url').length===2`),'saved analysis URLs');assert.match(await evaluate(`document.querySelector('.analysis-display-urls').textContent`),/ルーターの登録/);await capture('03-analysis-saved-urls');await click('.analysis-display-url:nth-of-type(2) button');assert.deepEqual(await evaluate('browserCalls.at(-1)'),['src/Screen.vue',null,origin+'/fixture/detail',true]);await click('[aria-label="AI解析を閉じる"]');await until(()=>evaluate(`!document.querySelector('dialog')`),'dialog close saves');assert.ok(requests.some(r=>r.method==='PUT'&&r.url==='/api/file-analysis'));
 await change('src/shared.js');assert.equal(await evaluate(`document.querySelectorAll('.viewer-route option').length`),2);assert.match(await evaluate(`document.body.innerText`),/List.vue:4/);
 await evaluate(`(()=>{const el=document.querySelector('.viewer-route select');el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);await until(()=>evaluate(`document.querySelector('.viewer-display-url').textContent.includes('/fixture/detail')`),'JS second URL');await click('.viewer-analysis-page');assert.deepEqual(await evaluate('browserCalls.at(-1)'),['src/shared.js',null,origin+'/fixture/detail',true]);await capture('09-js-shared-multiple-screens');
 await evaluate('showDialog()');await until(()=>evaluate(`document.querySelector('.analysis-source-scope')?.textContent.includes('複数URL')`),'JS page scope');assert.match(await evaluate(`document.querySelector('.analysis-display-urls').textContent`),/Detail.vue:8/);await click('.analysis-display-url:nth-of-type(2) button');assert.deepEqual(await evaluate('browserCalls.at(-1)'),['src/shared.js',null,origin+'/fixture/detail',true]);await click('[aria-label="AI解析を閉じる"]');await until(()=>evaluate(`!document.querySelector('dialog')`),'JS dialog close');
 await change('src/Unknown.js');assert.equal(await evaluate(`document.querySelectorAll('.viewer-browser,.viewer-analysis-page,.viewer-mode,.viewer-display-url,iframe').length`),0);assert.equal(await evaluate(`getComputedStyle(document.querySelector('.viewer-code')).display!=='none'`),true);
 await change('crud.py');analysisMode='direct';await evaluate('showDialog()');await until(()=>evaluate(`document.querySelector('.analysis-source-scope')?.textContent.includes('1次レベル')`),'Python direct scope');assert.equal(await evaluate(`document.querySelectorAll('.analysis-display-url').length`),0);assert.match(await evaluate(`document.querySelector('.analysis-result').textContent`),/呼び出し元/);assert.match(await evaluate(`document.querySelector('.analysis-result').textContent`),/呼び出し先/);await capture('10-python-direct-relations');await click('[aria-label="AI解析を閉じる"]');await until(()=>evaluate(`!document.querySelector('dialog')`),'Python dialog close');analysisMode='saved';
 await change('src/Unknown.vue');assert.equal(await evaluate(`document.querySelectorAll('.viewer-analysis-page').length`),0);assert.equal(await evaluate(`document.querySelectorAll('.viewer-display-url,iframe').length`),0);await click('.viewer-browser');await until(()=>evaluate(`document.querySelector('.viewer-action-error')?.textContent.includes('表示URL')`),'unknown Browser error');await click('.viewer-mode button:nth-child(2)');await until(()=>evaluate(`document.querySelector('.viewer-content').textContent.includes('表示URLを特定できません')`),'unknown view');await capture('04-unknown-url');
 analysisMode='unknown';await evaluate('showDialog()');await until(()=>evaluate(`document.querySelector('.analysis-display-urls')?.textContent.includes('実行時のルート')`),'unknown reason');assert.equal(await evaluate(`document.querySelectorAll('.analysis-display-url').length`),0);await capture('05-analysis-unknown-reason');await click('[aria-label="AI解析を閉じる"]');await until(()=>evaluate(`!document.querySelector('dialog')`),'unknown close');
 analysisMode='legacy';await evaluate('showDialog()');await until(()=>evaluate(`document.querySelector('.analysis-display-urls')?.textContent.includes('表示URLの記録がありません')`),'legacy saved result');await capture('06-analysis-legacy-result');await click('[aria-label="AI解析を閉じる"]');await until(()=>evaluate(`!document.querySelector('dialog')`),'legacy close');
 await change('src/Legacy.vue');assert.equal(await evaluate(`document.querySelectorAll('.viewer-analysis-page').length`),0);assert.match(await evaluate(`document.querySelector('.viewer-display-url').textContent`),/fixture\/legacy/);await click('.viewer-mode button:nth-child(2)');await until(()=>evaluate(`document.querySelector('iframe')?.src.endsWith('/fixture/legacy')`),'legacy route iframe');await capture('07-legacy-router-fallback');
 await change('src/Fallback.html');assert.equal(await evaluate(`document.querySelectorAll('.viewer-analysis-page').length`),0);assert.equal(await evaluate(`document.querySelectorAll('iframe').length`),0);await click('.viewer-mode button:nth-child(2)');await until(()=>evaluate(`document.querySelector('iframe')?.src.endsWith('/fixture/fallback')`),'static HTML fallback');await capture('08-static-html-fallback');
 await evaluate(`localStorage.clear();changeFile('src/Slow.vue')`);await until(()=>pending.length===1,'delayed source');await change('src/Unknown.vue');assert.equal(await evaluate(`document.querySelectorAll('.viewer-analysis-page').length`),0);pending.shift()();await sleep(300);assert.equal(await evaluate(`document.querySelectorAll('.viewer-display-url,iframe').length`),0,'late previous-source URL must not leak');
 await evaluate(`changeFile('src/Slow.vue')`);await until(()=>pending.length===1,'delayed close');await click('.viewer-close');await until(()=>evaluate(`!document.querySelector('[data-component="FileViewer"]')`),'viewer close');pending.shift()();await sleep(200);assert.equal(await evaluate(`document.querySelectorAll('iframe').length`),0);
 await evaluate(`showViewer()`);await until(()=>pending.length===1,'delayed unmount');await evaluate('dispose()');pending.shift()();await sleep(200);assert.equal(await evaluate(`document.querySelectorAll('dialog,iframe,[data-component="FileViewer"]').length`),0);assert.deepEqual(errors,[]);assert.equal(requests.some(r=>r.method==='POST'),false,'no AI analysis job is started');
 console.log('PASS: real Chromium/Vue JS shared source with multiple URLs + evidence, Python direct caller/callee scope, code + URLs, selector and selected iframe, desktop Browser explicit URL, saved analysis URLs/reason, unknown and legacy results, static/legacy fallback, stale-source response, close/unmount. App.vue compiles. Screenshots: '+output);
}catch(error){try{console.error(await evaluate('document.body.innerText'));await capture('failure');}catch{}throw error;}
finally{socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}for(const reply of pending)reply();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sleep(200);rmSync(temporary,{recursive:true,force:true});}
