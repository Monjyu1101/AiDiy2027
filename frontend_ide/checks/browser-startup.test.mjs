// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import browser from '../デスクトップ/ブラウザ.cjs';

const {HOME,browserStartupURL}=browser;
const local='http://127.0.0.1:8090/';

test('単独Browserの初期表示: 8090を1回だけ確認し、応答がある時だけローカルを開く',async()=>{
 for(const status of [200,204,301,302,307,308,404,500,503]){
  const calls=[];
  const target=await browserStartupURL(async(url,options)=>{calls.push({url,options});return{ok:status>=200&&status<300,status};});
  assert.equal(target,status<400?local:HOME);
  assert.equal(calls.length,1,'Googleへの到達確認やリダイレクト先への通信は行わない');
  assert.equal(calls[0].url,local);
  assert.equal(calls[0].options.method,'HEAD');
  assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].options.redirect,'manual');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
 }
 for(const error of [Error('ECONNREFUSED'),new DOMException('timeout','TimeoutError')]){
  assert.equal(await browserStartupURL(async()=>{throw error;}),HOME);
 }
 assert.equal(browser.browserURL('宇宙'),HOME+'search?q='+encodeURIComponent('宇宙'),'検索先はGoogleのまま');
 assert.equal(browser.browserURL(''),HOME,'空のアドレス入力は従来どおり');
});

test('単独Browserの初期表示: 実HTTPの応答・リダイレクト・未起動・無応答を判定する',async t=>{
 let status=200,hang=false;const requests=[];
 const server=createServer((request,response)=>{
  requests.push([request.method,request.url]);
  if(hang)return;
  response.writeHead(status,{Location:'https://example.invalid/'});response.end();
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.closeAllConnections();server.close();});
 const address=`http://127.0.0.1:${server.address().port}/`;
 const request=(url,options)=>{assert.equal(url,local);return fetch(address,options);};
 assert.equal(await browserStartupURL(request),local);
 status=302;assert.equal(await browserStartupURL(request),local,'確認中に外部リダイレクトを辿らない');
 status=503;assert.equal(await browserStartupURL(request),HOME);
 hang=true;
 const started=Date.now();
 assert.equal(await browserStartupURL(request),HOME,'無応答で起動を待ち続けない');
 assert.ok(Date.now()-started<4000,'確認は1.5秒で打ち切る');
 assert.deepEqual(requests,Array.from({length:4},()=>['HEAD','/']));
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 assert.equal(await browserStartupURL(request),HOME,'待受が無い場合もGoogleへ戻す');
});
