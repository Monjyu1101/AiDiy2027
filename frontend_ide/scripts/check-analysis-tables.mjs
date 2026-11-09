// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue・コンパイル後のscoped CSS・模擬APIで表を検証。実AI・配布buildは使用しない。
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript,compileStyle} from '@vue/compiler-sfc';
import WebSocket from 'ws';
const root=fileURLToPath(new URL('..',import.meta.url)),output=join(root,'temp/analysis-tables-check');
let scope=0;
const bundle=await build({stdin:{contents:`import {createApp,h,ref} from 'vue';import File from './src/dialog/ファイル解析ダイアログ.vue';import Browser from './src/dialog/ブラウザ解析ダイアログ.vue';
const selected=ref(''),linked=ref(true);window.calls=[];window.aidiyWindow={browserAction:async(name,value)=>{calls.push({name,value});return{ok:true}}};
window.openFile=()=>selected.value='file';window.openBrowser=(value=true)=>{linked.value=value;selected.value='browser'};
const app=createApp({render:()=>selected.value==='file'?h(File,{file:{name:'商品一覧.vue',path:'frontend_web/src/views/商品一覧.vue'},root:'/fixture',onClose:()=>selected.value=''}):selected.value==='browser'?h(Browser,{nativeWindow:true,context:{url:'http://example.test/products',title:'商品一覧',projectPath:'/fixture',baseName:'検証プロジェクト',canSelectSource:linked.value},onClose:()=>selected.value=''}):null});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,format:'iife',plugins:[{name:'test-vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{
 const {descriptor,errors}=parse(readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[]);const id='data-v-table-'+(++scope);
 const script=compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'component'});
 const css=descriptor.styles.map(style=>{const result=compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(result.errors,[]);return result.code;}).join('\n');
 return{contents:script.content+`\ncomponent.__scopeId=${JSON.stringify(id)};export default component;{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);}`,resolveDir:dirname(args.path)};
});}}]});
if(process.argv.includes('--compile-only')){console.log('PASS: Both analysis dialogs and their scoped styles compile.');process.exit(0);}
mkdirSync(output,{recursive:true});
const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',dateStyle:'short',timeStyle:'medium'}).format(new Date()).replace(/\D/g,'');let shot=0;
const markdown='| 項目 | 処理の内容 | 件数 |\n| :--- | :--- | ---: |\n'+Array.from({length:24},(_,i)=>`| 処理 ${i+1} | 商品情報を読み込み、入力値と権限を確認します。\\\`frontend_web/src/views/商品管理/商品一覧.vue\\\` を参照します。 | ${i+1} |`).join('\n').replaceAll('\\`','`');
const fileResult={createdAt:1,content:markdown,instruction:'表で説明してください。',relatedSourceScope:'direct',summaries:[{analyses:[1],content:markdown}],analyses:[{id:'original',index:1,result:{content:markdown}}]};
const files=Array.from({length:24},(_,i)=>({role:i%2?'API':'画面',path:i%2?`backend_server/routers/商品管理/関連機能/商品処理_${i+1}.py`:`frontend_web/src/components/商品管理/共通処理と表示部品/商品情報一覧_${i+1}.vue`,summary:'商品情報を読み込み、検索条件・入力値・利用者権限を確認します。\n保存結果を一覧に反映し、失敗した場合は理由を表示します。'}));
const requests=[],css=readFileSync(join(root,'src/style.css'),'utf8'),temporary=mkdtempSync(join(tmpdir(),'analysis-tables-'));
const server=createServer(async(req,res)=>{
 const json=value=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value));
 if(req.url.startsWith('/api/file-analysis')){requests.push(req.method);if(req.method==='PUT'){for await(const _ of req){}return json({});}return json({result:fileResult,instruction:fileResult.instruction,job:null});}
 if(req.url.startsWith('/api/browser-analysis'))return json({result:{id:'saved',createdAt:1,files},job:null});
 if(req.url==='/app.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(bundle.outputFiles[0].text);
 if(req.url==='/')return res.writeHead(200,{'content-type':'text/html'}).end(`<!doctype html><meta charset="utf-8"><style>${css}</style><div id="app"></div><script src="/app.js"></script>`);
 res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe'],env:{...process.env,HOME:temporary,XDG_CONFIG_HOME:temporary,XDG_CACHE_HOME:temporary}});
let socket,stderr='';chrome.stderr.on('data',data=>stderr+=data);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));async function until(check,label){for(let n=0;n<160;n++){if(await check())return;await sleep(50);}throw Error('Timeout: '+label+'\n'+stderr);}
try{
 let port;await until(()=>{try{port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0];return !!port;}catch{return false;}},'Chromium');
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const pending=new Map(),errors=[];socket.on('message',raw=>{const data=JSON.parse(raw);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const reply=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(reply.result?.exceptionDetails,undefined,JSON.stringify(reply));return reply.result.result.value;};
 const capture=async label=>writeFileSync(join(output,`${stamp}_${String(++shot).padStart(2,'0')}_${label}.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await until(()=>evaluate('typeof openFile==="function"'),'app');
 for(const width of [1200,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await evaluate('openFile()');await until(()=>evaluate('!!document.querySelector(".analysis-table-scroll")'),'file results');
  const metrics=await evaluate(`(()=>{const box=document.querySelector('.analysis-table-scroll'),table=box.querySelector('table'),cells=table.querySelectorAll('td');return{width:box.clientWidth,total:box.scrollWidth,body:document.querySelector('.analysis-history').scrollWidth,bodyWidth:document.querySelector('.analysis-history').clientWidth,display:getComputedStyle(table).display,font:getComputedStyle(cells[0]).fontSize,alignment:getComputedStyle(cells[2]).textAlign,zebra:getComputedStyle(cells[0]).backgroundColor!==getComputedStyle(cells[3]).backgroundColor,scope:table.querySelector('th').scope}})()`);
  assert.equal(metrics.display,'table');assert.equal(metrics.font,'13px');assert.equal(metrics.alignment,'right');assert.equal(metrics.zebra,true);assert.equal(metrics.scope,'col');assert.ok(metrics.body<=metrics.bodyWidth+1,'only table may overflow horizontally');if(width===390)assert.ok(metrics.total>metrics.width,'narrow file table scrolls instead of crushing columns');
  await evaluate(`document.querySelector('.analysis-table-scroll').scrollIntoView({block:'start'})`);await capture(`file-${width}`);
  await evaluate(`document.querySelector('.analysis-table-scroll').scrollTop=150;document.querySelector('.analysis-table-scroll').scrollLeft=100`);await sleep(80);
  assert.ok(await evaluate(`(()=>{const box=document.querySelector('.analysis-table-scroll');return Math.abs(box.querySelector('th').getBoundingClientRect().top-box.getBoundingClientRect().top)<3})()`),'sticky file header');
  await click('.analysis-individual summary');assert.equal(await evaluate(`document.querySelectorAll('.analysis-table-scroll').length`),2,'saved original uses same table rendering');await click('[aria-label="AI解析を閉じる"]');await until(()=>evaluate('!document.querySelector("dialog")'),'file close');
  await evaluate('openBrowser()');await until(()=>evaluate('document.querySelectorAll(".browser-analysis-sources tbody tr").length===24'),'browser results');
  const browser=await evaluate(`(()=>{const box=document.querySelector('.browser-analysis-sources'),dialog=document.querySelector('dialog'),headers=box.querySelectorAll('th');return{overflow:box.scrollWidth>box.clientWidth,dialogOverflow:dialog.scrollWidth>dialog.clientWidth,summary:headers[2].getBoundingClientRect().width,source:headers[1].getBoundingClientRect().width,radius:getComputedStyle(dialog).borderRadius,filename:box.querySelector('strong').textContent,directory:box.querySelector('small').textContent,label:box.querySelector('button').getAttribute('aria-label')}})()`);
  assert.equal(browser.dialogOverflow,false);assert.ok(browser.summary>browser.source);assert.equal(browser.radius,'0px');assert.equal(browser.filename,'商品情報一覧_1.vue');assert.equal(browser.directory+browser.filename,files[0].path);assert.equal(browser.label,files[0].path+' をIDEで表示');if(width===390)assert.equal(browser.overflow,true);
  await evaluate(`document.querySelector('.browser-analysis-sources').scrollIntoView({block:'start'})`);await capture(`browser-${width}`);
  await evaluate(`document.querySelector('.browser-analysis-sources').scrollTop=180`);await sleep(80);assert.ok(await evaluate(`(()=>{const box=document.querySelector('.browser-analysis-sources');return Math.abs(box.querySelector('th').getBoundingClientRect().top-box.getBoundingClientRect().top)<3})()`),'sticky browser header');
  await click('.browser-analysis-source');assert.deepEqual(await evaluate('calls.at(-1)'),{name:'analysis-select-source',value:{url:'http://example.test/products',id:'saved',path:files[0].path}});await click('[aria-label="Browser AI解析を閉じる"]');await until(()=>evaluate('!document.querySelector("dialog")'),'browser close');
 }
 await evaluate('openBrowser(false)');await until(()=>evaluate('!!document.querySelector(".browser-analysis-source-path")'),'standalone');assert.equal(await evaluate('document.querySelectorAll(".browser-analysis-source").length'),0);await click('[aria-label="Browser AI解析を閉じる"]');
 await evaluate('openFile()');await until(()=>evaluate('!!document.querySelector(".analysis-table-scroll")'),'reopen');await evaluate('dispose()');assert.equal(await evaluate('document.querySelectorAll("dialog").length'),0);assert.equal(requests.filter(x=>x==='PUT').length,2);assert.deepEqual(errors,[]);
 console.log('PASS: Both dialogs at 1200px/390px, scroll containment, sticky headers, alignment, zebra rows, complete source paths, IDE action, standalone, saved originals, close/reopen/unmount. Screenshots: '+output);
}finally{socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sleep(100);rmSync(temporary,{recursive:true,force:true});}
