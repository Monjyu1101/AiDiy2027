// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentFoldTone} from '../src/components/共通表示/内容変更折畳配色.js';
import {browserContentKey} from '../src/components/ブラウザ/ブラウザ内容変更.js';
import {createBrowserContentMonitor} from '../デスクトップ/ブラウザ内容監視.cjs';
const flush=async()=>{for(let n=0;n<10;n++)await Promise.resolve();};
function clock(){let now=0,id=0;const jobs=new Map();return{jobs,setTimer(fn,ms){jobs.set(++id,{fn,at:now+ms});return id;},clearTimer(id){jobs.delete(id);},tick(ms){now+=ms;for(const [id,job]of jobs)if(job.at<=now){jobs.delete(id);job.fn();}}};}

test('折畳直後は黒、最後の変更から15秒シアン、その後緑。再変更で延長・再開',()=>{
 const time=clock(),fold=createContentFoldTone(time);
 fold.changed();assert.equal(fold.tone.value,'');assert.equal(time.jobs.size,0);
 fold.collapsed(true);assert.equal(fold.tone.value,'offline');
 fold.changed();assert.equal(fold.tone.value,'online');
 time.tick(14999);assert.equal(fold.tone.value,'online');
 fold.changed();time.tick(1);assert.equal(fold.tone.value,'online');
 time.tick(14999);assert.equal(fold.tone.value,'success');
 fold.changed();assert.equal(fold.tone.value,'online');
 time.tick(15000);assert.equal(fold.tone.value,'success');
 fold.collapsed(false);assert.equal(fold.tone.value,'');assert.equal(fold.blackExpanded,true);
 fold.changed();assert.equal(time.jobs.size,0);
 fold.collapsed(true);assert.equal(fold.tone.value,'offline');
 fold.changed();fold.dispose();time.tick(15000);assert.equal(fold.tone.value,'');assert.equal(time.jobs.size,0);
});
test('展開・再折畳後に古いタイマーが届いても黒を維持',()=>{
 const time=clock(),fold=createContentFoldTone(time);fold.collapsed(true);fold.changed();
 const old=[...time.jobs.values()][0].fn;
 fold.collapsed(false);fold.collapsed(true);old();assert.equal(fold.tone.value,'offline');
 fold.dispose();fold.changed();assert.equal(time.jobs.size,0);
});
test('Browserは状態取得・接続・寸法を除外し、URL・タイトル・タブ・内容番号を検知',()=>{
 const page={url:'https://example.test/',title:'page',session:'one',activeTabId:'a',navigationRevision:1,contentRevision:0,tabs:[{id:'a',url:'https://example.test/',title:'page'}]};
 assert.equal(browserContentKey(page),browserContentKey({...page,stateRevision:9,connected:false,fullscreen:true,loading:true}));
 for(const value of [{url:page.url+'next'},{title:'changed'},{activeTabId:'b'},{navigationRevision:2},{contentRevision:1},{tabs:[...page.tabs,{id:'b',url:'about:blank'}]}])assert.notEqual(browserContentKey(page),browserContentKey({...page,...value}));
});
test('Browser内容監視は折畳中だけ、同じ内容・遅延応答は通知せず、破棄で停止',async()=>{
 const time=clock();let value='document:0',count=0,reads=0,pending;
 const contents={isDestroyed:()=>false,executeJavaScriptInIsolatedWorld:async(world,scripts)=>{assert.equal(world,1006);if(scripts[0].code.endsWith('("stop")'))return null;reads++;return pending?await pending:value;}};
 const monitor=createBrowserContentMonitor({contents,changed:()=>count++,...time});
 assert.equal(reads,0);monitor.setEnabled(true);await flush();assert.equal(count,0);
 time.tick(1000);await flush();assert.equal(count,0);
 value='document:1';time.tick(1000);await flush();assert.equal(count,1);
 monitor.setEnabled(false);assert.equal(time.jobs.size,0);time.tick(2000);assert.equal(count,1);
 value='document:2';monitor.setEnabled(true);await flush();assert.equal(count,1);
 let resolve;pending=new Promise(yes=>resolve=yes);time.tick(1000);monitor.dispose();resolve('document:3');await flush();
 assert.equal(count,1);assert.equal(time.jobs.size,0);
});
