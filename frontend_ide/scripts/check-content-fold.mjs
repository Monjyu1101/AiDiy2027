// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Browser・Explorer Vueと内容変更通知を確認。OS窓のIPCは模擬する。
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'temp/content-fold-check');
const bundle = await build({
  stdin: { resolveDir: root, contents: `import {createApp,h,reactive,ref,nextTick} from 'vue';
import Browser from './src/components/ブラウザ/ブラウザパネル.vue';
import Explorer from './src/components/ファイル閲覧/ファイル一覧.vue';
import {contentRevision} from './デスクトップ/ブラウザ内容監視.cjs';
const kind=location.hash.slice(1)||'browser';
const page={url:'https://example.test/',title:'確認ページ',available:true,connected:true,session:'fixture',activeTabId:'a',navigationRevision:0,contentRevision:0,tabs:[]};
window.publish=value=>{Object.assign(page,value);window.browserChanged?.({...page});};
window.latestFiles=[];
window.fetch=async()=>({ok:true,json:async()=>({files:window.latestFiles,entries:[],result:null,job:null})});
const nativeInterval=window.setInterval.bind(window);
window.setInterval=(callback,ms,...args)=>{if(ms===60000)window.refreshLatest=callback;return nativeInterval(callback,ms,...args);};
window.aidiyWindow={title:async()=> 'AiDiy Browser',pinState:async()=>({pinned:false,locked:false}),onPinChanged:()=>()=>{},panelAction:async()=>({pinned:false,locked:false}),onBrowserChanged:callback=>{window.browserChanged=callback;return()=>{};},browserAction:async()=>({ok:true,...page}),async collapsePanel(collapsed){const doc=window.child?.document||document;const el=doc.querySelector('.ai-component');el.style.height=collapsed?'31px':'700px';return{ok:true};}};
if(kind==='explorer'){
 const state=reactive({root:'/fixture',startedAt:1,open:true,selected:'',current:'',tree:{n:'fixture',d:[{n:'docs',d:[],f:[['sample.txt',2,1000]]}],f:[['a.txt',1,1000]]}});
 window.explorerState=state;
 window.open=(_url,name)=>{const iframe=document.createElement('iframe');iframe.style.cssText='width:700px;height:700px;border:0';document.body.append(iframe);window.child=iframe.contentWindow;window.child.name=name;return window.child;};
 createApp({render:()=>h('main',{class:'development-app ide'},[h(Explorer,{...state,filter:false,'onUpdate:open':value=>state.open=value})])}).mount('#app');
 nextTick(()=>document.querySelector('.explorer-detach').click());
}else{
 createApp(Browser,{standalone:true}).mount('#app');
 // 実DOMのMutationObserverも確認。外部ページへのアクセスはしない。
 const iframe=document.createElement('iframe');iframe.style.display='none';document.body.append(iframe);
 window.pageDocument=iframe.contentDocument;
 window.readContent=()=>iframe.contentWindow.eval('('+contentRevision.toString()+')("read")');
}
window.tick=()=>nextTick();
` },
  bundle: true, write: false, format: 'iife', loader: {'.css':'empty'}, plugins: [{ name: 'vue-label-check', setup(builder) {
    builder.onLoad({ filter: /コード表示\.js$/ }, () => ({ contents: 'export const loadMonaco=async()=>null;export const monacoLanguage=()=>"plaintext";' }));
    builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor, errors } = parse(readFileSync(args.path, 'utf8'), { filename: args.path });
      assert.deepEqual(errors, []);
      const id='data-v-collapse-'+Buffer.from(args.path).toString('hex');
      const script = compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs:'component' });
      const css=descriptor.styles.map(style=>{const result=compileStyle({source:style.content,id,scoped:style.scoped});assert.deepEqual(result.errors,[]);return result.code;}).join('\n');
      return { contents: script.content + `\ncomponent.__scopeId=${JSON.stringify(id)};export default component;{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);}`, resolveDir: dirname(args.path) };
    });
  } }],
});
if (process.argv.includes('--compile-only')) {
  console.log('PASS: Browser and Explorer content notification components compile.'); process.exit(0);
}
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'panel-collapse-check-'));
const css = readFileSync(join(root, 'src/components/共通表示/タイトルバー配色.css'), 'utf8')+readFileSync(join(root, 'src/style.css'), 'utf8')+readFileSync(join(root, 'src/components/共通表示/会話表示.css'), 'utf8')+'html,body,#app{height:700px}.ai-component{height:700px}';
const server = createServer((req,res)=>res.end(`<!doctype html><meta charset="utf-8"><style>${css}</style><div id="app"></div><script>${bundle.outputFiles[0].text}</script>`));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const chrome = spawn(process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium'), ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', '--window-size=1200,850', '--user-data-dir=' + temporary, 'about:blank'], { windowsHide:true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, HOME: temporary, XDG_CONFIG_HOME: temporary, XDG_CACHE_HOME: temporary } });
let socket, browserErrors = ''; chrome.stderr.on('data', data => { browserErrors += data; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let n = 0; n < 160; n++) { if (await check()) return; await sleep(50); } throw Error('Timeout: ' + label); }
try {
  let port;
  await until(() => { try { port = readFileSync(join(temporary, 'DevToolsActivePort'), 'utf8').split('\n')[0]; return !!port; } catch { return false; } }, 'Chromium').catch(error => { throw Error(error.message + '\n' + browserErrors); });
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
  let id = 0; const pending = new Map(), errors = [];
  socket.on('message', value => { const data = JSON.parse(value); if (data.id) { pending.get(data.id)?.(data); pending.delete(data.id); } if (data.method === 'Runtime.exceptionThrown') errors.push(data.params); });
  const send = (method, params = {}) => new Promise(resolve => { pending.set(++id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); assert.equal(response.result?.exceptionDetails, undefined, JSON.stringify(response)); return response.result.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const capture = async name => writeFileSync(join(output, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await send('Runtime.enable'); await send('Page.enable');
  for(const kind of ['browser','explorer']){
   await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?kind=${kind}#${kind}`});
   const doc=kind==='explorer'?'window.child?.document':'document';
   const mark=`${doc}?.querySelector('.code-panel-mark')`;
   const button=`${doc}.querySelector('.code-panel-toggle')`;
   const tone=()=>evaluate(`${mark}?.className`);
   const bg=()=>evaluate(`getComputedStyle(${mark}).backgroundColor`);
   const toggle=async()=>{await evaluate(`${button}.click()`);await sleep(100);};
   await until(()=>evaluate(`!!${mark}`),'title '+kind).catch(async error=>{throw Error(error.message+' '+JSON.stringify(errors)+' '+await evaluate('document.body.innerText'));});
   assert.equal(await bg(),'rgb(0, 0, 0)');
   const change=async n=>{
    if(kind==='browser')await evaluate(`publish({url:'https://example.test/${n}'})`);
    else await evaluate(`explorerState.current='docs';explorerState.selected='docs/sample.txt';explorerState.tree.d[0].f[0][2]=${1000}+${n};tick()`);
    await sleep(100);
   };
   await change(1);assert.equal(await bg(),'rgb(0, 0, 0)','expanded stays black');
   await toggle();assert.equal(await bg(),'rgb(0, 0, 0)','collapse starts black');
   await capture(kind+'-01-black');
   await change(2);assert.match(await tone(),/tone-online/);
   await evaluate(`${mark}.getAnimations().forEach(animation=>animation.currentTime=2250)`);
   assert.equal(await evaluate(`getComputedStyle(${mark}).getPropertyValue('--connection-color')`),'#00ffff');
   await capture(kind+'-02-cyan');
   await sleep(15100);assert.match(await tone(),/tone-success/);assert.equal(await bg(),'rgb(0, 168, 58)');
   await capture(kind+'-03-green');
   // 同じ内容の再通知では緑のまま。新しい変更は再びシアン。
   await change(2);assert.match(await tone(),/tone-success/);
   if(kind==='browser'){
    const baseline=await evaluate('readContent()');
    await evaluate(`pageDocument.body.textContent='同じURLの新しい内容'`);
    const changed=await evaluate('readContent()');assert.notEqual(changed,baseline);
    await evaluate('publish({contentRevision:1})');await sleep(100);
   }else{
    await evaluate(`latestFiles=[{path:'new.txt',name:'new.txt',mtime:5000,size:4}];refreshLatest().then(tick)`);await sleep(100);
   }
   assert.match(await tone(),/tone-online/);await capture(kind+'-04-repeated');
   await toggle();assert.equal(await bg(),'rgb(0, 0, 0)');
   await change(4);assert.equal(await bg(),'rgb(0, 0, 0)');
   await toggle();assert.equal(await bg(),'rgb(0, 0, 0)','refold clears notification');
   await capture(kind+'-05-reset');
   if(kind==='explorer'){
    await evaluate(`explorerState.current='';explorerState.selected='a.txt';tick()`);await sleep(100);
    assert.match(await tone(),/tone-online/,'galaxy selection notifies while folded');
   }
  }
  assert.deepEqual(errors,[]);console.log('PASS: actual Browser/Explorer Vue, black expanded/collapsed, cyan 15s, green, unchanged refresh, repeated changes and reset. Native window IPC mocked. '+output);

} finally {
  socket?.close(); if (chrome.exitCode === null && chrome.signalCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await sleep(150); rmSync(temporary, { recursive: true, force: true, maxRetries:10, retryDelay:200 });
}
