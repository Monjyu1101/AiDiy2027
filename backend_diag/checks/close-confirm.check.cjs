// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createServer}=require('node:http');
const {setImmediate:flush}=require('node:timers/promises');
const {終了確認を作成,起動状態を読む}=require('../起動/終了確認.cjs');

function fixture({status=async()=>({終了時停止あり:true}),confirm=async()=>({response:1})}={}){
 const window=new EventEmitter(),dialogs=[];let queries=0;
 window.isDestroyed=()=>!!window.destroyed;
 window.close=()=>{const event={preventDefault(){this.prevented=true;}};window.emit('close',event);if(!event.prevented)window.closed=true;};
 const control=終了確認を作成({window,状態取得:()=>{queries++;return status();},確認:async(parent,options)=>{assert.equal(parent,window);dialogs.push(options);return confirm();}});
 return {window,dialogs,control,get queries(){return queries;}};
}

test('idle closes without confirmation and running work defaults to cancel',async()=>{
 const idle=fixture({status:async()=>({終了時停止あり:false})});idle.window.close();await flush();
 assert.equal(idle.window.closed,true);assert.equal(idle.dialogs.length,0);
 const busy=fixture();busy.window.close();await flush();assert.equal(busy.window.closed,undefined);
 assert.equal(busy.dialogs.length,1);assert.equal(busy.dialogs[0].defaultId,1);assert.equal(busy.dialogs[0].cancelId,1);assert.match(busy.dialogs[0].message,/停止/);
});

test('approval closes, duplicate close requests share one pending check, and cancellation permits retry',async()=>{
 let answer,checks;const f=fixture({status:()=>new Promise(resolve=>checks=resolve),confirm:()=>new Promise(resolve=>answer=resolve)});
 f.window.close();f.window.close();assert.equal(f.queries,1);checks({終了時停止あり:true});await flush();
 f.window.close();assert.equal(f.dialogs.length,1);answer({response:1});await flush();assert.equal(f.window.closed,undefined);
 f.window.close();assert.equal(f.queries,2);checks({終了時停止あり:true});await flush();answer({response:0});await flush();assert.equal(f.window.closed,true);
});

test('unknown status requests confirmation and dialog failure leaves the window open',async()=>{
 const unknown=fixture({status:async()=>{throw Error('private details');}});unknown.window.close();await flush();
 assert.equal(unknown.window.closed,undefined);assert.match(unknown.dialogs[0].message,/確認できません/);assert.doesNotMatch(JSON.stringify(unknown.dialogs),/private details/);
 const failed=fixture({confirm:async()=>{throw Error('dialog failed');}});failed.window.close();await flush();assert.equal(failed.window.closed,undefined);
});

test('parent disconnect bypasses user confirmation and destroyed windows do not open a dialog',async()=>{
 const f=fixture();f.control.許可();f.window.close();await flush();assert.equal(f.window.closed,true);assert.equal(f.queries,0);
 const gone=fixture();gone.window.destroyed=true;gone.window.close();await flush();assert.equal(gone.dialogs.length,0);
});

test('fresh status uses authenticated loopback HTTP without URL token, redirects, or remote hosts',async t=>{
 let mode='ok',calls=0;
 const token='a'.repeat(43),server=createServer((request,response)=>{
  calls++;assert.equal(request.url,'/proxy/8097/api/'+encodeURIComponent('起動'));assert.equal(request.headers.authorization,'Bearer '+token);
  if(mode==='redirect'){response.writeHead(302,{Location:'https://outside.invalid/'});response.end();return;}
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({終了時停止あり:true}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/proxy/8097/#token=${token}`;
 assert.deepEqual(await 起動状態を読む(url),{終了時停止あり:true});mode='redirect';await assert.rejects(()=>起動状態を読む(url));assert.equal(calls,2);
 assert.throws(()=>起動状態を読む('https://outside.invalid/#token='+token));
});
