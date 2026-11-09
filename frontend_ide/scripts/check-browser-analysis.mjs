// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue・模擬APIの隔離確認。実AI、配布build、外部サイトは使用しない。
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
const root=fileURLToPath(new URL('..',import.meta.url)),output=join(root,'temp/browser-analysis-check');
mkdirSync(output,{recursive:true});
const bundle=await build({stdin:{contents:`import {createApp,h,ref} from 'vue';import Browser from './src/components/ブラウザ/ブラウザパネル.vue';import AnalysisWindow from './src/components/ブラウザ/ブラウザ解析ウィンドウ.vue';
const context={url:'https://example.test/form',title:'入力フォーム',baseName:'sample-project',projectPath:'/fixture/sample-project',canSelectSource:true};
const shown=ref(false);let analysisContext;let browserChanged;window.browserCalls=[];window.navigatePage=url=>{context.url=url;browserChanged?.({url,title:context.title,available:true});};window.setStandalone=value=>context.canSelectSource=!value;window.setIDEAvailability=(running,ready)=>{context.ideRunning=running;context.viewerAvailable=ready;};
window.aidiyWindow={title:async()=> 'AiDiy IDE / Browser 1',onBrowserChanged:fn=>{browserChanged=fn;return()=>{browserChanged=null;};},onBrowserOpenAnalysis:()=>()=>{},browserAction:async(name,value)=>{browserCalls.push({name,value});if(name==='open-analysis'&&!shown.value){analysisContext={...context};shown.value=true;}if(name==='analysis-window-close')shown.value=false;return name==='analysis-window-context'?{ok:true,context:analysisContext}:{ok:true,url:context.url,title:context.title,available:true}}};
const app=createApp({setup(){return()=>h('div',[h(Browser),shown.value?h(AnalysisWindow):null]);}});app.mount('#app');window.dispose=()=>app.unmount();`,resolveDir:root},bundle:true,write:false,format:'iife',plugins:[{name:'test-vue',setup(build){build.onLoad({filter:/\.vue$/},args=>{const {descriptor,errors}=parse(readFileSync(args.path,'utf8'),{filename:args.path});assert.deepEqual(errors,[]);const compiled=compileScript(descriptor,{id:'browser-analysis-check',inlineTemplate:true});return{contents:compiled.content+`\n{const style=document.createElement('style');style.textContent=${JSON.stringify(descriptor.styles.map(s=>s.content).join('\n'))};document.head.append(style);}`,resolveDir:dirname(args.path)};});}}]});
if(process.argv.includes('--compile-only')){console.log('PASS: Browser panel and analysis dialog compile (no distribution build).');process.exit(0);}
const temporary=mkdtempSync(join(tmpdir(),'browser-analysis-')),css=readFileSync(join(root,'src/style.css'),'utf8');
const result={id:'saved-analysis',createdAt:Date.now(),summary:'## 入力画面\nユーザー情報を入力し、APIへ送信する画面です。\n\n確認済みの関連ソースを下の一覧に表示します。',files:[{role:'html',path:'server/src/html/xxx.html',summary:'入力フォーム'},{role:'API',path:'server/src/routes/users.js',summary:'入力内容の検証と登録'}]};
let mode='saved',polls=0,backgroundComplete=false,backgroundStarted=false;const requests=[];
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');const json=value=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value));
 if(url.pathname==='/api/browser-analysis'){
  requests.push(req.method);
  if(req.method==='POST'){for await(const _ of req){}if(mode==='background')backgroundStarted=true;else mode='waiting';polls=0;return json({id:'next',status:'waiting'});}
  const target=url.searchParams.get('url');
  if(target!=='https://example.test/form'||mode==='empty')return json({url:target,result:null,job:null});
  const waiting=mode==='background'?backgroundStarted&&!backgroundComplete:mode==='waiting'&&polls++===0;
  return json({url:target,result:waiting?result:mode==='waiting'||mode==='background'?{...result,id:'next'}:result,job:{id:'next',status:waiting?'waiting':'complete'}});
 }
 if(url.pathname==='/app.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(bundle.outputFiles[0].text);
 if(url.pathname==='/')return res.writeHead(200,{'content-type':'text/html'}).end(`<!doctype html><meta charset="utf-8"><style>${css}</style><div id="app"></div><script src="/app.js"></script>`);res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--window-size=1200,900','--user-data-dir='+temporary,'about:blank'],{stdio:['ignore','ignore','pipe'],env:{...process.env,HOME:temporary,XDG_CONFIG_HOME:temporary,XDG_CACHE_HOME:temporary}});
let browserErrors='',socket,evaluate,capture;chrome.stderr.on('data',data=>browserErrors+=data);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));async function until(check,label){for(let n=0;n<160;n++){if(await check())return;await sleep(50);}throw Error('Timeout: '+label);}
try{
 let port;await until(()=>{try{port=readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0];return !!port;}catch{return false;}},'Chromium').catch(error=>{throw Error(error.message+'\n'+browserErrors)});
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 let id=0;const calls=new Map(),errors=[];socket.on('message',value=>{const data=JSON.parse(value);if(data.id){calls.get(data.id)?.(data);calls.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params);});
 const send=(method,params={})=>new Promise(resolve=>{calls.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
 evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response));return response.result.result.value;};
 const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 capture=async name=>writeFileSync(join(output,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:origin});await until(()=>evaluate(`!!document.querySelector('.browser-analysis')&&!document.querySelector('.browser-analysis').disabled`),'Browser ready');
 await click('.browser-analysis');await until(()=>evaluate(`document.querySelectorAll('tbody tr').length===2`),'saved sources');assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('dialog h3'),node=>node.textContent)`),['表示中のURL','関連ソース']);assert.equal(await evaluate(`document.querySelectorAll('.analysis-result').length`),0);await capture('01-ide-related-sources');await click('.browser-analysis-source');assert.deepEqual(await evaluate(`browserCalls.find(c=>c.name==='analysis-select-source').value`),{url:'https://example.test/form',id:'saved-analysis',path:'server/src/html/xxx.html'});
 await click('[aria-label="Browser AI解析を閉じる"]');await until(()=>evaluate(`!document.querySelector('dialog')`),'close');assert.equal(await evaluate(`browserCalls.at(-1).name`),'analysis-window-close');assert.equal(await evaluate(`browserCalls.some(c=>c.name==='analysis-dialog')`),false);
 await evaluate('setStandalone(true)');await click('.browser-analysis');await until(()=>evaluate(`document.querySelectorAll('tbody tr').length===2`),'standalone result');assert.equal(await evaluate(`document.querySelectorAll('.browser-analysis-source').length`),0);await capture('02-standalone-sources');await click('[aria-label="Browser AI解析を閉じる"]');
 for(const ready of [false,true]){await evaluate(`setIDEAvailability(true,${ready})`);await click('.browser-analysis');await until(()=>evaluate(`!!document.querySelector('.browser-analysis-viewer-available')`),'IDE guidance');assert.equal(await evaluate(`document.querySelectorAll('.browser-analysis-source').length`),0);assert.equal(await evaluate(`document.querySelector('.browser-analysis-viewer-available').textContent.includes('tools接続後')`),!ready);await capture(ready?'06-standalone-ide-ready':'05-standalone-ide-not-ready');await click('[aria-label="Browser AI解析を閉じる"]');}
 mode='empty';await click('.browser-analysis');await until(()=>evaluate(`document.querySelector('dialog')?.textContent.includes('まだありません')`),'empty result');await capture('03-no-analysis');await click('.browser-analysis-actions button');await until(()=>requests.includes('POST'),'submit mock');await until(()=>evaluate(`document.querySelector('.browser-analysis-actions button')?.disabled===false&&document.querySelectorAll('tbody tr').length===2`),'poll completion');await capture('04-completed-analysis');assert.equal(requests.filter(r=>r==='POST').length,1);
 await click('[aria-label="Browser AI解析を閉じる"]');mode='background';backgroundComplete=false;backgroundStarted=false;await click('.browser-analysis');await until(()=>evaluate(`!!document.querySelector('.browser-analysis-actions button')&&!document.querySelector('.browser-analysis-actions button').disabled`),'background ready');await click('.browser-analysis-actions button');await until(()=>evaluate(`!!document.querySelector('.browser-analysis-background')`),'background controls');await capture('07-background-dialog');await click('.browser-analysis-background');await until(()=>evaluate(`!document.querySelector('dialog')&&document.querySelector('.browser-analysis').textContent==='AI解析中…'`),'background status');
 await evaluate(`navigatePage('https://example.test/other')`);await until(()=>evaluate(`document.querySelector('.browser-analysis').textContent==='AI解析'`),'other page');await capture('08-background-other-page');await evaluate(`navigatePage('https://example.test/form')`);await until(()=>evaluate(`document.querySelector('.browser-analysis').textContent==='AI解析中…'`),'return waiting');await capture('09-background-return-waiting');
 backgroundComplete=true;await until(()=>evaluate(`document.querySelector('.browser-analysis').textContent==='AI解析済'`),'background completed');await capture('10-background-completed');await click('.browser-analysis');await until(()=>evaluate(`document.querySelectorAll('tbody tr').length===2&&!document.querySelector('.browser-analysis-background')`),'restored result');await capture('11-background-restored-result');assert.equal(requests.filter(r=>r==='POST').length,2,'navigation/reopen must not submit a new analysis');await evaluate('dispose()');assert.equal(await evaluate(`document.querySelectorAll('dialog').length`),0);assert.deepEqual(errors,[]);
 console.log('PASS: Browser analysis real Vue UI, saved/empty results, source action, standalone, close, polling, unmount. Screenshots: '+output);
}finally{socket?.close();if(chrome.exitCode===null&&chrome.signalCode===null){const exited=once(chrome,'exit');chrome.kill();await exited;}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sleep(100);rmSync(temporary,{recursive:true,force:true});}
