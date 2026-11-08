// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import native from '../デスクトップ/native-preview-actions.cjs';
import browser from '../デスクトップ/ブラウザ.cjs';
import {openBrowser} from '../src/components/ブラウザ/起動.js';
const badURLs=['javascript:alert(1)','file:///tmp/a.html','data:text/html,hi','//example.com/a','/screen','example.com','https://u:p@example.com','https://example.com/\npath',null,{},'https://example.com/\x7f'];
const target='http://localhost:8090/画面?view=1#part';
const normalized=new URL(target).href;
test('保存した表示URL: Electronはページ関連ソースだけにURLを許可し、ファイル境界とURLを検証する',async t=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-display-url-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const path of ['a.html','a.vue','a.js','a.tsx','a.svelte','a.d.ts','a.txt','a.mp3'])writeFileSync(join(root,path),'test');
 for(const path of ['a.html','a.vue','a.js','a.tsx','a.svelte'])assert.equal(await browser.browserFileTarget(root,path,target),normalized);
 assert.equal(await browser.browserFileTarget(root,'a.html'),pathToFileURL(join(root,'a.html')).href);
 for(const path of ['a.txt','a.mp3','a.d.ts','missing.vue','../a.html','/a.html'])await assert.rejects(browser.browserFileTarget(root,path,target));
 symlinkSync(join(tmpdir(),'outside.vue'),join(root,'link.vue'));
 await assert.rejects(browser.browserFileTarget(root,'link.vue',target));
 for(const value of badURLs)await assert.rejects(browser.browserFileTarget(root,'a.vue',value));
 assert.equal(await browser.browserOpenable('a.vue',target),true);
 assert.equal(await browser.browserOpenable('a.vue'),false);
 for(const path of ['a.js','a.tsx','a.svelte']){assert.equal(await browser.browserOpenable(path),false);assert.equal(await browser.browserOpenable(path,target),true);}
 assert.equal(await browser.browserOpenable('a.mp3',target),false);
});
function fixture({online=true,source=true,preview={url:'https://example.com/default'},disconnect=false}={}){
 const calls=[],navigation=[];
 const popup={opener:{},closed:false,location:{replace(url){navigation.push(url);}},close(){this.closed=true;}};
 let statuses=0;
 const win={open(url){calls.push(['open',url]);return popup;},async fetch(url){
  calls.push(['fetch',url]);
  if(url==='/api/connection')return{ok:true,json:async()=>({active:true,mode:online?'online':'offline',connected:online&&!(disconnect&&++statuses>1)})};
  if(url.startsWith('/api/file?'))return{ok:source};
  return{ok:true,json:async()=>preview};
 }};
 return{win,calls,popup,navigation};
}
test('保存した表示URL: Webはクリック中の空窓予約後に元ファイルと接続を確認し、保存URLを開く',async()=>{
 const f=fixture();assert.equal((await openBrowser('a.vue',7,f.win,target)).ok,true);
 assert.deepEqual(f.calls[0],['open','about:blank']);assert.equal(f.popup.opener,null);
 assert.deepEqual(f.navigation,[normalized]);assert.ok(f.calls.some(([,url])=>url.startsWith('/api/file?')));
 assert.ok(!f.calls.some(([,url])=>url.startsWith('/api/preview?')));
 const args=[];const desktop={aidiyWindow:{openBrowser:(...value)=>{args.push(value);return{ok:true};}}};
 assert.equal((await openBrowser('a.vue',7,desktop,target)).ok,true);assert.deepEqual(args,[['a.vue',7,target,false]]);
 assert.equal((await openBrowser('a.vue',undefined,desktop,target,true)).ok,true);assert.deepEqual(args[1],['a.vue',undefined,target,true]);
});

test('AI解析の表示URL: preloadは限定IPCへ再利用指定を渡し、従来呼出しは新規起動のまま',async()=>{
 let api;const calls=[];
 vm.runInNewContext(readFileSync(new URL('../デスクトップ/preload.cjs',import.meta.url),'utf8'),{
  require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'aidiyWindow');api=value;}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return{ok:true};}}})
 });
 assert.equal((await api.openBrowser('a.vue',undefined,target,true)).ok,true);
 assert.equal((await api.openBrowser('a.vue',undefined,target)).ok,true);
 assert.deepEqual(calls,[['development:open-browser','a.vue',undefined,target,true],['development:open-browser','a.vue',undefined,target,false]]);
});
test('保存した表示URL: 不正入力・対象外ファイル・ファイル消失・オフラインでは遷移せず予約窓を閉じる',async()=>{
 for(const [path,url,options] of [...badURLs.map(url=>['a.html',url,{}]),...['a.mp3','../a.vue','/a.vue','a.txt',undefined].map(path=>[path,target,{}]),['a.vue',target,{source:false}],['a.vue',target,{online:false}],['a.vue',target,{disconnect:true}]]){
  const f=fixture(options);assert.equal((await openBrowser(path,undefined,f.win,url)).ok,false,`${path} ${url}`);
  assert.deepEqual(f.navigation,[]);assert.equal(f.popup.closed,true);
 }
});
test('既定Webプレビュー: Vueルート・HTML・メディアを保持し、失敗時は別URLへ退避しない',async()=>{
 for(const [path,preview,url]of [['a.vue',{kind:'vue',routes:[{url:target}]},normalized],['a.html',{url:target},normalized],['a.mp3',{url:target},normalized]]){
  const f=fixture({preview});assert.equal((await openBrowser(path,undefined,f.win)).ok,true);assert.deepEqual(f.navigation,[url]);
 }
 for(const preview of [{kind:'vue',routes:[]},{kind:'vue',error:'ルートが見つかりません。'},{url:'javascript:alert(1)'}]){
  const f=fixture({preview});assert.equal((await openBrowser('a.vue',undefined,f.win)).ok,false);assert.deepEqual(f.navigation,[]);assert.equal(f.popup.closed,true);
 }
 const f=fixture();f.win.fetch=async()=>{throw Error('通信失敗');};assert.equal((await openBrowser('a.vue',undefined,f.win,target)).ok,false);assert.equal(f.popup.closed,true);
 assert.equal((await openBrowser('a.vue',undefined,{open:()=>null},target)).ok,false);
 for(const path of ['session/demo.html','100%.html','素材/token=demo.mp3']){
  const url='http://localhost:4567/p/temporary/'+path.split('/').map(encodeURIComponent).join('/');
  const f=fixture({preview:{url}});assert.equal((await openBrowser(path,undefined,f.win)).ok,true);assert.deepEqual(f.navigation,[url]);
 }
});

test('表示URL IPC: 信頼済みIDE・元の画面ID・接続再確認を保ち、拒否時は窓を作らない',async t=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-display-ipc-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'a.vue'),'test');
 const text=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const start=text.indexOf(" ipcMain.handle('development:open-browser',");
 const end=text.indexOf(" ipcMain.handle('development:draft-target-register'",start);
 let handler,source,status=0,offline=false,disconnect=false;const created=[],selected=[];
 const owner={kind:'ide',url:'http://127.0.0.1:9000/',revision:1,window:{isDestroyed:()=>false}};source=owner;
 vm.runInNewContext(text.slice(start,end),{ipcMain:{handle:(_name,fn)=>{handler=fn;}},trustedEvent:()=>source,
  validPreviewPath:native.validPreviewPath,browserOpenable:browser.browserOpenable,browserFileTarget:browser.browserFileTarget,
  selectedAllDisplay:(_owner,id)=>selected.push(id),sessionKey:()=> 'session',quitting:false,HOME:browser.HOME,
  readState:async()=>({active:true,project:{path:root},online:!offline&&!(disconnect&&++status>1)}),browserConnected:state=>state.online,
  createWindow:async(...args)=>created.push(args)});
 assert.equal((await handler({},'a.vue',7,target)).ok,true);
 assert.equal(created[0][6],7);assert.equal(created[0][7],normalized);assert.equal(selected[0],7);
 created.length=0;
 for(const invalid of badURLs)assert.equal((await handler({},'a.vue',undefined,invalid)).ok,false);
 offline=true;assert.equal((await handler({},'a.vue',undefined,target)).ok,false);offline=false;
 disconnect=true;status=0;assert.equal((await handler({},'a.vue',undefined,target)).ok,false);disconnect=false;
 source={kind:'viewer',owner,window:owner.window,linkKey:'session'};
 assert.equal((await handler({},'a.vue',7,target)).ok,false);
 source=null;assert.equal((await handler({},'a.vue',undefined,target)).ok,false);
 assert.equal(created.length,0);
});


test('ソース→画面URL: WebはJS/TS等の選択URLを維持し、宣言ファイルを除外する',async()=>{
 for(const ext of ['js','mjs','cjs','ts','mts','cts','jsx','tsx','svelte','astro']){
  const f=fixture();assert.equal((await openBrowser('src/shared.'+ext,undefined,f.win,target)).ok,true,ext);assert.deepEqual(f.navigation,[normalized]);
 }
 const f=fixture();assert.equal((await openBrowser('types.d.ts',undefined,f.win,target)).ok,false);assert.deepEqual(f.navigation,[]);
});
