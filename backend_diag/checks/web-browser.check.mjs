// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {createWebBrowserOpener} from '../起動/Webブラウザ.mjs';
import {createServer} from '../diag_main.mjs';
import {起動状態を作成} from '../ui/src/components/起動/起動状態.mjs';

const ports=(tools,web)=>({対象:[{id:'tools',ポート:8095,開放:tools},{id:'web',ポート:8090,開放:web}]});
test('opening requires both live ports and sends only the fixed localhost page to Chrome MCP',async()=>{
 for(const [tools,web] of [[false,false],[true,false],[false,true],[null,true],[true,null],[true,true]]){
  const calls=[];
  const open=createWebBrowserOpener({portStatusFn:async()=>ports(tools,web),fetchFn:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({id:'page-1'})};}});
  if(tools!==true||web!==true){await assert.rejects(()=>open(),{status:409});assert.equal(calls.length,0);continue;}
  assert.equal((await open()).URL,'http://localhost:8090/');assert.equal(calls.length,1);
  assert.equal(calls[0].url,'http://127.0.0.1:8095/aidiy_chrome_devtools/new_page');
  assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.redirect,'error');
  assert.deepEqual(JSON.parse(calls[0].options.body),{url:'http://localhost:8090/',show_automation_banner:false});
 }
});

test('MCP failures never report success and do not prevent a later manual retry',async()=>{
 for(const result of [{ok:false},{ok:true,json:async()=>({error:'cannot create page'})}]){
  let fail=true;
  const open=createWebBrowserOpener({portStatusFn:async()=>ports(true,true),fetchFn:async()=>fail?result:{ok:true,json:async()=>({id:1})}});
  await assert.rejects(()=>open(),{status:503});fail=false;assert.ok((await open()).メッセージ.includes('開きました'));
 }
});

test('duplicate clicks are rejected and a disconnected request cancels the MCP call',async()=>{
 let started;
 const pending=new Promise(resolve=>started=resolve),controller=new AbortController();
 const open=createWebBrowserOpener({portStatusFn:async()=>ports(true,true),fetchFn:(_url,{signal})=>new Promise((_resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})});
 const first=open({signal:controller.signal});await pending;
 await assert.rejects(()=>open(),{status:409});controller.abort();await assert.rejects(()=>first,{status:503});
});

test('the browser API is authenticated and accepts no URL or process command',async t=>{
 let calls=0;
 const server=createServer({token:'web-browser-fixture',startManager:{close(){}},modelTrials:{close(){}},webBrowserOpenFn:async()=>{calls++;return {URL:'http://localhost:8090/'};}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const url=`http://127.0.0.1:${server.address().port}/api/${encodeURIComponent('起動')}/${encodeURIComponent('ブラウザ')}`;
 const headers={Authorization:'Bearer web-browser-fixture','Content-Type':'application/json'};
 assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
 for(const body of [{url:'https://example.com'}, {対象:'tools'}, {command:'start'}])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,400);
 assert.equal(calls,0);assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,200);assert.equal(calls,1);
});

test('the Web panel follows external ports, disables on unknown status, and never starts services',async t=>{
 let current=ports(false,false),release;
 const calls=[];
 const state=起動状態を作成({setTimer:()=>0,clearTimer(){},api:async(route,_method,_signal,_format,body)=>{
  calls.push({route,body});
  if(route==='api/起動')return {対象:[{id:'web',設定:{ブラウザ表示:false},状態:'未起動'}],実行中:false};
  if(route==='api/起動/ポート')return current;
  if(route==='api/起動/ブラウザ')return new Promise(resolve=>{release=()=>resolve({メッセージ:'ブラウザで開きました。'});});
  return {ログ:'',位置:0};
 }});
 t.after(()=>state.終了());state.選択.value='web';
 async function refresh(){state.表示(true);await flush();await flush();}
 for(const [tools,web] of [[false,false],[true,false],[false,true],[null,true],[true,true]]){
  current=ports(tools,web);await refresh();assert.equal(state.ブラウザ起動可能.value,tools===true&&web===true);
 }
 const first=state.ブラウザで開く();await flush();assert.equal(state.ブラウザ起動中.value,true);
 await state.ブラウザで開く();assert.equal(calls.filter(call=>call.route==='api/起動/ブラウザ').length,1);
 release();await first;assert.match(state.ブラウザ通知.value,/開きました/);
 current=ports(true,false);await refresh();await state.ブラウザで開く();
 assert.equal(calls.filter(call=>call.route==='api/起動/ブラウザ').length,1);
 assert.ok(!calls.some(call=>/再起動|停止|設定$/.test(call.route)));
});
