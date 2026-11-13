// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue/scoped CSSの描画。native IPCは模擬し、OS寸法試験とは分ける。
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {parse,compileScript,compileStyle} from '@vue/compiler-sfc';
const root=fileURLToPath(new URL('..',import.meta.url));
const output=mkdtempSync(join(tmpdir(),'browser-titlebar-'));
const entry=`import {createApp,h} from 'vue';import Browser from './src/components/ブラウザ/ブラウザパネル.vue';
const query=new URLSearchParams(location.search),headerOnly=query.has('header');
window.runtimeErrors=[];addEventListener('error',e=>runtimeErrors.push(e.message));addEventListener('unhandledrejection',e=>runtimeErrors.push(String(e.reason)));
window.fetch=async()=>({ok:true,json:async()=>({active:true,mode:'online',connected:true,project:{path:'/fixture'},items:[],result:null})});
window.EventSource=class{close(){}};
window.aidiyWindow={title:async()=>query.has('long')?'AiDiy IDE / Browser very long title '.repeat(10):'AiDiy IDE / Browser',pinState:async()=>({pinned:false}),onPinChanged:()=>()=>{},onBrowserChanged:()=>()=>{},browserAction:async()=>({ok:true,mode:'online',available:true,connected:true,url:'https://example.test/',tabs:[],fullscreen:headerOnly}),allDisplays:async()=>({ok:true,active:false}),onAllDisplaysChanged:()=>()=>{},collapsePanel:async()=>({ok:true})};
createApp({render:()=>h(Browser,{standalone:true,headerOnly})}).mount('#app');`;
const result=await build({stdin:{contents:entry,resolveDir:root},bundle:true,write:false,format:'iife',loader:{'.css':'empty'},plugins:[{name:'browser-vue',setup(b){b.onLoad({filter:/\.vue$/},args=>{
 const {descriptor}=parse(readFileSync(args.path,'utf8'),{filename:args.path});
 const id='data-v-'+createHash('sha256').update(args.path).digest('hex').slice(0,8);
 const script=compileScript(descriptor,{id,inlineTemplate:true,genDefaultAs:'component'});
 const css=descriptor.styles.map(style=>{const s=compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped});if(s.errors.length)throw Error(s.errors.join('\n'));return s.code;}).join('\n');
 return{contents:script.content+`\ncomponent.__scopeId=${JSON.stringify(id)};export default component;{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);}`,resolveDir:dirname(args.path)};
});}}]});
const readCSS=path=>readFileSync(path,'utf8').replace(/@import\s+["'](\.[^"']+)["']\s*;/g,(_,target)=>readCSS(resolve(dirname(path),target)));
writeFileSync(join(output,'app.js'),result.outputFiles[0].text);
writeFileSync(join(output,'index.html'),`<!doctype html><meta charset="utf-8"><style>${readCSS(join(root,'src/style.css'))}\n${readCSS(join(root,'src/components/共通表示/会話表示.css'))}</style><div id="app"></div><script src="app.js"></script>`);
console.log(output);
