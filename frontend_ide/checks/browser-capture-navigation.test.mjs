// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import browser from '../デスクトップ/ブラウザ.cjs';
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const image={isEmpty:()=>false,toPNG:()=>Buffer.from('png'),getSize:()=>({width:800,height:600})};
function fixture(){
 let page;const sent=[],writes=[],images=[];
 class View{
  constructor(){page=this.webContents=Object.assign(new EventEmitter(),{url:'',getURL(){return this.url;},getTitle:()=>'',isLoading:()=>false,isDestroyed:()=>false,navigationHistory:{canGoBack:()=>false,canGoForward:()=>false},loadURL:async function(url){this.url=url;},setWindowOpenHandler(){},stop(){},close(){},capturePage(){const job=deferred();images.push(job);return job.promise;}});}
  setVisible(){}setBounds(){}
 }
 const window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,isFullScreen:()=>false,contentView:{addChildView(){}},webContents:Object.assign(new EventEmitter(),{send:(_channel,value)=>sent.push(value)})});
 const record={kind:'browser',window,url:'http://127.0.0.1:1234/',browserSession:'aidiy_browser test',browserTabId:'page'};
 const control=browser.createBrowserViews({projectRoot:'/fixture',WebContentsView:View,session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}}})},trustedEvent:event=>event.record,captureImage:()=>{const job=deferred();writes.push(job);return job.promise;}});
 control.attach(record,'https://example.test/');
 const action=name=>control.action({record},name);
 const save=async()=>{const result=action('capture');await flush();images.at(-1).resolve(image);await flush();writes.at(-1).resolve({path:'temp/input/browser.png'});return result;};
 return{control,page,window,record,sent,writes,images,action,save,close:()=>window.emit('closed')};
}
for(const kind of ['navigation','history','query','hash','reload'])test('Browser撮影: '+kind+'で保存を破棄し下書きにも古い画像を添付しない',async t=>{
 const f=fixture();t.after(f.close);assert.equal((await f.save()).ok,true);assert.equal((await f.action('state')).capturePath,'temp/input/browser.png');
 assert.match((await f.action('draft')).request.text,/browser.png/);
 if(kind==='navigation'||kind==='reload')f.page.emit('did-start-navigation',{},kind==='reload'?f.page.url:'https://example.test/next',false,true);
 else{f.page.url=kind==='history'?'https://example.test/back':kind==='query'?'https://example.test/?id=2':'https://example.test/#detail';f.page.emit('did-navigate-in-page',{},f.page.url,true);}
 assert.equal((await f.action('state')).capturePath,'');assert.ok(f.sent.at(-1).navigationRevision>0);assert.doesNotMatch((await f.action('draft')).request.text,/browser.png/);
 assert.equal((await f.save()).ok,true,'移動先で再撮影できる');assert.equal((await f.action('state')).capturePath,'temp/input/browser.png');
});
test('Browser撮影: iframeの遷移・読み込み・タイトル変更で主ページの保存を破棄しない',async t=>{
 const f=fixture();t.after(f.close);await f.save();
 f.page.emit('did-start-navigation',{},'https://frame.test/',false,false);f.page.emit('did-navigate-in-page',{},'https://frame.test/#part',false);f.page.emit('did-start-loading');f.page.emit('page-title-updated');
 assert.equal((await f.action('state')).capturePath,'temp/input/browser.png');
});
for(const phase of ['capture','save'])for(const returned of [false,true])test(`Browser撮影: ${phase}待機中の移動${returned?'・同じURLへの復帰':''}は古い成功を戻さない`,async t=>{
 const f=fixture();t.after(f.close);const result=f.action('capture');await flush();
 if(phase==='save'){f.images[0].resolve(image);await flush();assert.equal(f.writes.length,1);}
 const before=f.page.url;f.page.emit('did-start-navigation',{},'https://example.test/next',false,true);f.page.url='https://example.test/next';f.page.emit('did-navigate',{},f.page.url);
 if(returned){f.page.emit('did-start-navigation',{},before,false,true);f.page.url=before;f.page.emit('did-navigate',{},before);}
 if(phase==='capture')f.images[0].resolve(image);else f.writes[0].resolve({path:'temp/input/stale.png'});
 const response=await result;assert.equal(response.ok,false);assert.match(response.error,/ページや接続が変わりました/);assert.equal((await f.action('state')).capturePath,'');assert.ok(f.sent.every(value=>!value.capturePath));
 assert.equal(f.writes.length,phase==='save'?1:0);assert.equal((await f.save()).ok,true,'失効した撮影後も再試行できる');
});

test('Browser offline can capture and carry the saved image into a draft',async t=>{
 const f=fixture();t.after(f.close);f.control.setAvailable(f.record,true,false);
 assert.equal((await f.save()).ok,true);assert.match((await f.action('draft')).request.text,/browser.png/);
 assert.equal((await f.action('open-analysis')).ok,false);
});
