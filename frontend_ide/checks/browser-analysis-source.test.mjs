// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const {createBrowserSourceSelection}=createRequire(import.meta.url)('../デスクトップ/ブラウザ解析連携.cjs');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'browser-source-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'src'));await writeFile(join(root,'src/page.html'),'hello');
 const sent=[],focused=[];let alive=true,page='https://example.test/page';
 const owner={kind:'ide',revision:1,url:'http://127.0.0.1:12345/',window:{isDestroyed:()=>!alive,webContents:{send:(...args)=>sent.push(args)}}};
 const source={kind:'browser',owner,linkKey:'online:10',window:{isDestroyed:()=>false}};
 let state={active:true,connected:true,mode:'online',startedAt:10,project:{path:root}};
 const result={id:'job-1',files:[{path:'src/page.html'}]};let beforeFetch=()=>{};
 const select=createBrowserSourceSelection({trustedEvent:event=>event.source,readState:async()=>state,sessionKey:s=>`${s.mode}:${s.startedAt}`,connected:s=>s.connected,context:()=>({url:page}),focusWindow:w=>focused.push(w),fetcher:async target=>{assert.equal(target.origin,owner.url.slice(0,-1));await beforeFetch();return{ok:true,json:async()=>({result})};}});
 return{root,owner,source,sent,focused,result,select:(value={url:page,id:'job-1',path:'src/page.html'},event={source})=>select(event,value),setState:value=>state=value,setPage:value=>page=value,setFetch:fn=>beforeFetch=fn,destroy:()=>alive=false};
}
test('Browser source selects exact owning IDE, preserving source path and session',async t=>{const f=await fixture(t);assert.deepEqual(await f.select(),{ok:true});assert.deepEqual(f.sent,[['development:browser-select-source',{path:'src/page.html',startedAt:10,projectPath:f.root}]]);assert.equal(f.focused[0],f.owner.window);});
test('standalone/untrusted Browser cannot select IDE source',async t=>{const f=await fixture(t);delete f.source.owner;assert.equal((await f.select()).ok,false);assert.equal((await f.select(undefined,{source:null})).ok,false);assert.equal(f.sent.length,0);});
test('source must belong to matching saved analysis',async t=>{const f=await fixture(t);for(const value of [{url:'https://example.test/page',id:'old',path:'src/page.html'},{url:'https://example.test/page',id:'job-1',path:'other.html'},{url:'https://other.test/',id:'job-1',path:'src/page.html'},{url:'https://example.test/page',id:'job-1',path:'../escape'}])assert.equal((await f.select(value)).ok,false);assert.equal(f.sent.length,0);});
test('session changes and window destruction during response prevent source selection',async t=>{for(const change of ['session','closed','page']){const f=await fixture(t);f.setFetch(()=>{if(change==='session')f.setState({active:true,connected:true,mode:'online',startedAt:11,project:{path:f.root}});if(change==='closed')f.destroy();if(change==='page')f.setPage('https://other.test/');});assert.equal((await f.select()).ok,false);assert.equal(f.sent.length,0);}});
test('realpath boundaries reject symlinks out of project even if listed',async t=>{const f=await fixture(t);await symlink(tmpdir(),join(f.root,'escape'));f.result.files=[{path:'escape/not-a-file'}];assert.equal((await f.select({url:'https://example.test/page',id:'job-1',path:'escape/not-a-file'})).ok,false);assert.equal(f.sent.length,0);});
test('credential and excluded paths rejected even if listed',async t=>{const f=await fixture(t);await mkdir(join(f.root,'node_modules'));await writeFile(join(f.root,'node_modules/hidden.js'),'');f.result.files=[{path:'node_modules/hidden.js'}];assert.equal((await f.select({url:'https://example.test/page',id:'job-1',path:'node_modules/hidden.js'})).ok,false);});

test('Browser context uses native page and draft dialog retains its existing visibility behavior',async t=>{
 const {EventEmitter}=await import('node:events');const {createBrowserViews}=createRequire(import.meta.url)('../デスクトップ/ブラウザ.cjs');let view;
 class View{constructor(){view=this;this.webContents=Object.assign(new EventEmitter(),{url:'',getURL(){return this.url;},getTitle:()=> '実際の画面',isLoading:()=>false,isDestroyed:()=>false,navigationHistory:{canGoBack:()=>false,canGoForward:()=>false},loadURL:async function(url){this.url=url;},setWindowOpenHandler(){},close(){}});}setVisible(value){this.visible=value;}setBounds(){}}
 const sent=[],window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,isFullScreen:()=>false,getContentBounds:()=>({x:0,y:0,width:800,height:600}),contentView:{addChildView(){}},webContents:Object.assign(new EventEmitter(),{send:(...args)=>sent.push(args)})});
 const record={kind:'browser',window,url:'http://127.0.0.1:12345/',owner:{kind:'ide',window:{isDestroyed:()=>false}}};
 const browser=createBrowserViews({WebContentsView:View,projectRoot:'/tmp/project',session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}}})},trustedEvent:event=>event.record});
 browser.attach(record,'https://example.test/page');t.after(()=>window.emit('closed'));
 assert.deepEqual((await browser.action({record},'analysis-context',{url:'https://forged.test/'})).context,{url:'https://example.test/page',title:'実際の画面',baseName:'project',projectPath:'/tmp/project',canSelectSource:true});
 assert.equal((await browser.action({record:{kind:'browser'}},'analysis-context')).ok,false);
 await browser.action({record},'draft-dialog',true);assert.equal(view.visible,false);
 await browser.action({record},'draft-dialog',false);assert.equal(view.visible,true);
 delete record.owner;assert.equal((await browser.action({record},'analysis-context')).context.canSelectSource,false);
});
