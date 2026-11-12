// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue + 本番scoped CSSをElectron rendererで測定する。通信/native IPC/重い宇宙だけ模擬。
// テスト専用の隠蔽CSSは追加しない。OS窓/DPI・画像目視の確認とは別の試験。
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript,compileStyle} from '@vue/compiler-sfc';
const root=fileURLToPath(new URL('..',import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'titlebar-renderer-'));
const readSource=path=>process.argv.includes('--baseline')?execFileSync('git',['show','HEAD:'+relative(dirname(root.replace(/\/$/,'')),path)],{cwd:root,encoding:'utf8'}):readFileSync(path,'utf8');
// 展開先は一時ディレクトリなので、本番の相対 CSS import を元の位置で解決する。
const readCSS=path=>readSource(path).replace(/@import\s+["'](\.[^"']+)["']\s*;/g,(_,target)=>readCSS(resolve(dirname(path),target)));
const entry=`import {createApp,h} from 'vue';
import Code from './src/components/コード/コードパネル.vue';
import Live from './src/components/ライブ/ライブパネル.vue';
import Console from './src/components/コンソール/コンソールパネル.vue';
import Navi from './src/components/開発スペース/Naviパネル.vue';
import Browser from './src/components/ブラウザ/ブラウザパネル.vue';
import App from './src/App.vue';
const kind=location.hash.slice(1)||'code';
window.runtimeErrors=[];addEventListener('error',e=>runtimeErrors.push(e.message));addEventListener('unhandledrejection',e=>runtimeErrors.push(String(e.reason)));
window.fetch=async()=>({ok:true,json:async()=>({active:true,mode:'online',connected:true,startedAt:1,project:{path:'/fixture',name:'fixture'},items:[],result:null,job:null,availability:{available:true},models:{},voices:{}})});
window.EventSource=class{close(){}};window.WebSocket=class{static OPEN=1;readyState=0;close(){}send(){}};
window.aidiyWindow={title:async()=> 'AiDiy '+kind,pinState:async()=>({pinned:false}),onPinChanged:()=>()=>{},onBrowserChanged:()=>()=>{},browserAction:async()=>({ok:true,available:true,connected:true,url:'https://example.test/'}),childWindows:async()=>({}),allDisplays:async()=>({ok:true,active:false}),onAllDisplaysChanged:()=>()=>{},collapsePanel:async()=>{await new Promise(r=>setTimeout(r,220));return{ok:true}}};
const component={code:Code,live:Live,console:Console,navi:Navi,browser:Browser,ide:App}[kind];
createApp({render:()=>h(component,{desktop:true,standalone:true,instance:'audit',project:{path:'/fixture',name:'fixture'},config:{kind:'ide'}})}).mount('#app');`;
try{
 const result=await build({stdin:{contents:entry,resolveDir:root},bundle:true,write:false,format:'iife',loader:{'.css':'empty'},plugins:[{name:'real-vue-titlebars',setup(b){
  b.onLoad({filter:/コード表示\.js$/},()=>({contents:'export const loadMonaco=async()=>null;export const monacoLanguage=()=>"plaintext";'}));
  b.onLoad({filter:/\.vue$/},args=>{
   if(basename(args.path)==='開発スペース.vue')return{contents:`import {h} from 'vue';export default {props:['viewMode'],setup(p,{expose}){expose({captureLayout:()=>({explorer:{},viewers:[]}),restoreLayout:async()=>[]});return()=>h('main',{class:'space-view'},[h('input',{value:'retained'}),h('p','space fixture')]);}};`};
   const {descriptor,errors}=parse(readSource(args.path),{filename:args.path});assert.deepEqual(errors,[]);
   const id='data-v-'+createHash('sha256').update(args.path).digest('hex').slice(0,8);
   const script=compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'component'});
   const css=descriptor.styles.map(style=>{const s=compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});assert.deepEqual(s.errors,[]);return s.code;}).join('\n');
   return{contents:script.content+`\ncomponent.__scopeId=${JSON.stringify(id)};export default component;{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);}`,resolveDir:dirname(args.path)};
  });
 }}]});
 if(process.argv.includes('--compile-only')){console.log('PASS: actual Code/Live/Console/Browser/Navi/App with production scoped CSS compile.');process.exit(0);}
 writeFileSync(join(temp,'app.js'),result.outputFiles[0].text);
 const css=readCSS(join(root,'src/style.css'))+'\n'+readCSS(join(root,'src/components/共通表示/会話表示.css'));
 writeFileSync(join(temp,'fixture.html'),`<!doctype html><meta charset="utf-8"><style>${css}</style><div id="app"></div><script src="app.js"></script>`);
 writeFileSync(join(temp,'index.html'),'<iframe id="fixture" width="1000" height="700" style="border:0"></iframe>');
 writeFileSync(join(temp,'run.cjs'),`const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');const {join}=require('node:path');
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 app.whenReady().then(async()=>{const win=new BrowserWindow({width:1100,height:850,show:false,frame:false,webPreferences:{sandbox:true,offscreen:true,backgroundThrottling:false}});await win.loadFile(join(__dirname,'index.html'));
 const evaluate=code=>win.webContents.executeJavaScript("document.querySelector('#fixture').contentWindow.eval("+JSON.stringify(code)+")");
 for(const kind of ['code','live','console','navi','browser','ide']){
  await win.webContents.executeJavaScript("document.querySelector('#fixture').src='fixture.html#"+kind+"'");
  let ready=false;for(let i=0;i<50;i++){await sleep(100);try{ready=await evaluate("!!document.querySelector('.code-panel-toggle')");if(ready)break;}catch{}}
  assert.ok(ready,kind+' mount');await sleep(200);
  const measure=()=>evaluate("(()=>{const b=document.querySelector('.connection-bar'),t=document.querySelector('.panel-brand');return {separatorGap:b.getBoundingClientRect().top-t.getBoundingClientRect().bottom,afterTitle:t.nextElementSibling===b,barDisplay:getComputedStyle(b).display,barHeight:b.getBoundingClientRect().height,titleHeight:t.getBoundingClientRect().height,titleBackground:getComputedStyle(t).backgroundColor,rootBackground:getComputedStyle(document.querySelector('.panel-collapsed')||document.querySelector('#app').firstElementChild).backgroundColor,expanded:document.querySelector('.code-panel-toggle').getAttribute('aria-expanded'),errors:window.runtimeErrors};})()");
  const before=await measure();assert.ok(before.barHeight>0,kind+' initially shown');assert.equal(before.titleHeight,31,kind+' initial title');assert.equal(before.afterTitle,true,kind+' separator follows title');assert.equal(before.separatorGap,0,kind+' separator directly below title');
  for(let n=0;n<3;n++){
   await win.webContents.executeJavaScript("document.querySelector('#fixture').width="+[360,800,1440][n]);await sleep(100);
   await evaluate("document.querySelector('.code-panel-toggle').click()");await sleep(350);const closed=await measure();console.log(JSON.stringify({kind,cycle:n,state:'closed',...closed}));
   assert.equal(closed.expanded,'false');assert.equal(closed.barDisplay,'none',kind+' display');assert.equal(closed.barHeight,0,kind+' hidden height');assert.equal(closed.titleHeight,31,kind+' title height');assert.equal(closed.rootBackground,closed.titleBackground,kind+' fractional native-height remainder background');assert.deepEqual(closed.errors,[],kind+' runtime');
   await evaluate("document.querySelector('.code-panel-toggle').click()");await sleep(350);const opened=await measure();assert.equal(opened.expanded,'true');assert.equal(opened.barHeight,before.barHeight,kind+' restored');assert.equal(opened.separatorGap,0,kind+' restored separator below title');assert.equal(opened.afterTitle,true,kind+' restored separator order');
  }
 }
 console.log('PASS: six actual Vue roots, 3 close/open cycles at 360/800/1440px; connection bar display:none and height:0, title:31px. Native resize/API mocked, no OS-window or screenshot claim.');win.destroy();app.exit(0);}).catch(e=>{console.error(e);app.exit(1)});`);
 const executable=process.env.ELECTRON_PATH;
 assert.ok(executable,'Set ELECTRON_PATH to an installed Electron binary.');
 const run=spawnSync(executable,['--headless','--no-sandbox','--disable-gpu',join(temp,'run.cjs')],{encoding:'utf8',timeout:60000,maxBuffer:5*1024*1024,env:{...process.env,HOME:temp,XDG_CONFIG_HOME:temp,XDG_CACHE_HOME:temp}});
 process.stdout.write(run.stdout||'');process.stderr.write(run.stderr||'');if(run.error)throw run.error;assert.equal(run.status,0,'Electron renderer test failed');
}finally{rmSync(temp,{recursive:true,force:true});}
