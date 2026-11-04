// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実VueのExplorer・軌跡をdata:内で検証する。配布build、サーバー、AI、実ファイル操作は不要。
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await mkdtemp(join(tmpdir(), 'aidiy-panel-controls-'));
const entry = join(output, 'fixture-entry.js');
await writeFile(entry, `
import {createApp,h,reactive,nextTick} from 'vue';
import Explorer from ${JSON.stringify(join(root, 'src/components/ファイル閲覧/ファイル一覧.vue'))};
import ${JSON.stringify(join(root, 'src/style.css'))};
import ${JSON.stringify(join(root, 'src/components/共通表示/会話表示.css'))};
const state=reactive({root:'/fixture/project',startedAt:1,open:true,allDisplays:false,selected:'docs/sample.txt',current:'docs'});
const tree={n:'project',d:[{n:'docs',d:[],f:[['sample.txt',15,1000]]}],f:[['keep.txt',9,1000]]};
const log={requests:[],errors:[],detached:false,detachedEvents:[],selected:[],resizes:[]};
window.aidiyWindow={...window.panelFixtureNative,resizeRoutes:(name,height)=>{
 const node=window.fixture?.saved.routes,bar=node?.querySelector('.route-controls'),view=node?.ownerDocument.defaultView;
 log.resizes.push({name,height,innerWidth:view?.innerWidth,innerHeight:view?.innerHeight,barHeight:bar?.getBoundingClientRect().height,barWidth:bar?.getBoundingClientRect().width,scrollWidth:bar?.scrollWidth,detach:!!bar?.querySelector('.route-detach')});
 return window.panelFixtureNative.resizeRoutes(name,height);
}};
if(typeof crypto.randomUUID!=='function')crypto.randomUUID=()=> 'fixture-'+Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
window.addEventListener('error',event=>log.errors.push(event.message));
window.addEventListener('unhandledrejection',event=>log.errors.push(String(event.reason)));
window.fetch=async(url,options={})=>{
 log.requests.push({url:String(url),method:options.method||'GET'});
 if((options.method||'GET')!=='GET')throw Error('Mutation forbidden in fixture: '+url);
 const data=String(url).startsWith('/api/ai-search/history')?{entries:[]}:String(url).startsWith('/api/latest')?{files:[]}:null;
 if(!data)throw Error('Network forbidden in fixture: '+url);
 return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
};
const history=[{type:'file',path:'docs/sample.txt',at:1000},{type:'file',path:'keep.txt',at:2000}];
const app=createApp({render:()=>h('main',{class:['development-app','ide',{'all-displays':state.allDisplays}]},[
 h('div',{class:'ide-heading'},[h('div',{class:'connection-bar online'})]),
 h('section',{class:'space-view'},[h(Explorer,{...state,tree,scan:{root:state.root,tree},filter:false,viewHistory:history,viewVoyages:{},
  'onUpdate:open':value=>state.open=value,onDetached:value=>{log.detached=value;log.detachedEvents.push(value);},
  onSelect:row=>{state.selected=row.type==='file'?row.path:'';state.current=row.type==='dir'?row.path:row.path.split('/').slice(0,-1).join('/');log.selected.push(row);}
 })])
])});
app.mount('#app');
window.fixture={state,log,saved:{},remember(){this.saved.explorer=document.querySelector('.explorer-panel');this.saved.routes=document.querySelector('.explorer-routes');this.saved.input=document.querySelector('.grep-query input');},
 async setVR(value){await window.panelFixture.setVR(value);state.allDisplays=value;await nextTick();},
 unmount:()=>app.unmount(),ready:true};
`);
const bundle = await build({
  root, configFile: false, logLevel: 'warn', plugins: [vue()],
  resolve: { alias: { vue: join(root, 'node_modules/vue/dist/vue.runtime.esm-bundler.js') } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, cssCodeSplit: false, lib: { entry, name: 'PanelControlsFixture', formats: ['iife'] } },
});
const chunks = Array.isArray(bundle) ? bundle.flatMap(value => value.output) : bundle.output;
const javascript = chunks.filter(value => value.type === 'chunk').map(value => value.code).join('\n');
const css = chunks.filter(value => value.type === 'asset' && value.fileName.endsWith('.css')).map(value => value.source).join('\n');
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'"><title>Panel controls component QA</title><style>${css}</style><style>html,body,#app{margin:0;width:100%;height:100%;background:#111a2a}.space-view{--workspace-top:64px;--explorer-width:360px}.space-view .explorer-panel{top:64px;bottom:20px;left:20px}.explorer-window .explorer-panel{top:auto;bottom:auto;left:auto}.qa-heading{position:fixed;left:20px;top:15px;font:18px sans-serif;color:white}</style><div class="qa-heading">Explorer / 軌跡 · 実 Vue 部品、隔離データ</div><div id="app"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></html>`;
const htmlFile = join(output, 'fixture.html'), preload = join(output, 'fixture-preload.cjs');
await writeFile(htmlFile, html);
await writeFile(preload, `
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('panelFixtureNative',{
 nativeWindowMove:true,
 prepareExplorer:(rect,kind,content)=>ipcRenderer.invoke('panel-fixture:prepare',rect,kind,content),
 showExplorer:name=>ipcRenderer.invoke('panel-fixture:show',name),
 panelAction:(name,action)=>ipcRenderer.invoke('panel-fixture:action',name,action),
 resizeRoutes:(name,height)=>ipcRenderer.invoke('panel-fixture:resize',name,height),
 onPinChanged:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('panel-fixture:pin-changed',listener);return()=>ipcRenderer.removeListener('panel-fixture:pin-changed',listener);}
});
contextBridge.exposeInMainWorld('panelFixture',{setVR:value=>ipcRenderer.invoke('panel-fixture:vr',value)});
`);
const env = { ...process.env, AIDIY_PANEL_CONTROLS_HTML: htmlFile, AIDIY_PANEL_CONTROLS_OUTPUT: output, AIDIY_PANEL_CONTROLS_PRELOAD: preload };
delete env.ELECTRON_RUN_AS_NODE;
const electron = process.env.ELECTRON_PATH || createRequire(new URL('../host/package.json', import.meta.url))('electron');
const child = spawn(electron, [fileURLToPath(new URL('../checks/panel-controls-desktop.cjs', import.meta.url)), '--ozone-platform=headless'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
const [code, signal] = await once(child, 'exit');
if (code !== 0) throw Error(`Panel controls QA failed (${code ?? signal}); artifacts: ${output}`);
console.log(`Panel controls QA artifacts: ${output}`);
