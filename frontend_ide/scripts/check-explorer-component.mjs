// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue部品を一時的なdata:画面へ束ねる。HTTPサーバー、AI、実ファイル操作は使わない。
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
const output = await mkdtemp(join(tmpdir(), 'aidiy-explorer-component-'));
const entry = join(output, 'fixture-entry.js');
const fixture = `
import {createApp,h,reactive,nextTick} from 'vue';
import Explorer from ${JSON.stringify(join(root, 'src/components/ファイル閲覧/ファイル一覧.vue'))};
import ${JSON.stringify(join(root, 'src/style.css'))};
const files=new Map([['docs',{type:'dir'}],['target',{type:'dir'}],['docs/sample.txt',{type:'file',text:'sample original'}],['keep.txt',{type:'file',text:'untouched'}]]);
const state=reactive({root:'/fixture/project',startedAt:1,open:true,tree:null,selected:'',current:''});
const log={requests:[],clipboard:[],trash:[],selected:[],errors:[],detached:false};
// data: は非secure context。実アプリのloopback URLで利用可能なUUIDだけをfixture内で補う。
if(typeof crypto.randomUUID!=='function')crypto.randomUUID=()=> 'fixture-'+Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
window.addEventListener('error',event=>log.errors.push(event.message));
window.addEventListener('unhandledrejection',event=>log.errors.push(String(event.reason)));
function tree(){
 const root={n:'project',d:[],f:[]},dirs=new Map([['',root]]);
 for(const [path,item] of [...files].sort(([a],[b])=>a.localeCompare(b))){
  const parts=path.split('/'),name=parts.pop(),parent=dirs.get(parts.join('/'));if(!parent)throw Error('fixture parent missing: '+path);
  if(item.type==='dir'){const node={n:name,d:[],f:[]};parent.d.push(node);dirs.set(path,node);}
  else parent.f.push([name,item.text.length,1000]);
 }return root;
}
state.tree=tree();
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
window.fetch=async(url,options={})=>{
 log.requests.push({url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
 if(String(url).startsWith('/api/ai-search/history'))return reply({entries:[]});
 if(String(url).startsWith('/api/latest'))return reply({files:[]});
 if(url!=='/api/explorer/actions')throw Error('Network forbidden in fixture: '+url);
 const body=JSON.parse(options.body),action=body.action,source=body.path,item=files.get(source),parent=body.directory||'';
 let path,name,previousPath=source;
 if(action==='rename'){
  name=body.name;path=[...source.split('/').slice(0,-1),name].join('/');
  if(files.has(path))return reply({message:'同じ名前の項目が既にあります。'},409);
  for(const [key,value]of [...files])if(key===source||key.startsWith(source+'/')){files.delete(key);files.set(path+key.slice(source.length),value);}
 }else if(action==='trash'){
  if(!body.confirmed)throw Error('fixture trash requires confirmation');
  path=source;name=source.split('/').at(-1);log.trash.push({path,item});
  for(const key of [...files.keys()])if(key===source||key.startsWith(source+'/'))files.delete(key);
 }else if(action==='copy'){
  name=source.split('/').at(-1);path=(parent?parent+'/':'')+name;
  if(files.has(path)){const dot=name.lastIndexOf('.');name=dot>0?name.slice(0,dot)+' - コピー'+name.slice(dot):name+' - コピー';path=(parent?parent+'/':'')+name;}
  for(const [key,value]of [...files])if(key===source||key.startsWith(source+'/'))files.set(path+key.slice(source.length),{...value});
 }else if(action==='create-file'||action==='create-folder'){
  name=body.name;path=(parent?parent+'/':'')+name;files.set(path,{type:action==='create-folder'?'dir':'file',text:''});
 }else throw Error('fixture action unsupported: '+action);
 return reply({action,path,previousPath,name,type:(item?.type||files.get(path)?.type)==='dir'?'directory':'file'});
};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>log.clipboard.push(text)}});
const app=createApp({render:()=>h('main',{class:'development-app ide'},[h('section',{class:'space-view'},[h(Explorer,{
 ...state,scan:{root:state.root,tree:state.tree},filter:false,viewHistory:[],viewVoyages:{},
 'onUpdate:open':value=>state.open=value,onDetached:value=>log.detached=value,
 onSelect:row=>{state.selected=row.type==='file'?row.path:'';state.current=row.type==='dir'?row.path:row.path.split('/').slice(0,-1).join('/');log.selected.push(row);},
 applyFileChange:async()=>{state.tree=tree();await nextTick();},reload:async()=>{state.tree=tree();await nextTick();}
 })])])});
app.mount('#app');
window.fixture={state,log,files,unmount:()=>app.unmount(),mutations:()=>log.requests.filter(request=>request.url==='/api/explorer/actions'),ready:true};
`;
await writeFile(entry, fixture);
const bundle = await build({
  root, configFile: false, logLevel: 'warn',
  plugins: [vue()],
  resolve: { alias: { vue: join(root, 'node_modules/vue/dist/vue.runtime.esm-bundler.js') } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, cssCodeSplit: false, lib: { entry, name: 'ExplorerFixture', formats: ['iife'] } },
});
const chunks = Array.isArray(bundle) ? bundle.flatMap(value => value.output) : bundle.output;
const javascript = chunks.filter(value => value.type === 'chunk').map(value => value.code).join('\n');
const css = chunks.filter(value => value.type === 'asset' && value.fileName.endsWith('.css')).map(value => value.source).join('\n');
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'"><title>Explorer component QA</title><style>${css}</style><style>html,body,#app{margin:0;width:100%;height:100%;background:#111a2a}.space-view{--workspace-top:20px;--explorer-width:360px}.space-view .explorer-panel{top:20px;bottom:20px;left:20px}.explorer-window .explorer-panel{top:auto;bottom:auto;left:auto}.qa-heading{position:fixed;left:420px;top:30px;font:20px sans-serif;color:white}</style><div class="qa-heading">Explorer · isolated component fixture</div><div id="app"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></html>`;
const htmlFile = join(output, 'fixture.html');
await writeFile(htmlFile, html);
const env = { ...process.env, AIDIY_EXPLORER_FIXTURE_HTML: htmlFile, AIDIY_EXPLORER_FIXTURE_OUTPUT: output };
delete env.ELECTRON_RUN_AS_NODE;
const electron = process.env.ELECTRON_PATH || createRequire(new URL('../host/package.json', import.meta.url))('electron');
const child = spawn(electron, [fileURLToPath(new URL('../checks/explorer-component-desktop.cjs', import.meta.url)), '--ozone-platform=headless'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
const [code, signal] = await once(child, 'exit');
if (code !== 0) throw Error(`Explorer component QA failed (${code ?? signal}); artifacts: ${output}`);
console.log(`Explorer component QA artifacts: ${output}`);
