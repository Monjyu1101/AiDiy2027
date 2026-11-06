// 一時配置先と偽 fetch のみ。Core / Bot を起動しない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { Core認証 } from '../src/接続/Core認証';
import { モデル情報取得 } from '../src/モデル情報/モデル情報';
import { authFixture } from './internal-auth-fixture';

test('REST はヘッダーだけに認証を付け、転送を拒否し毎回更新を読む', async t => {
 const f = authFixture(); t.after(f.cleanup);
 const seen: string[] = [];
 const request: typeof fetch = async (input, options) => {
  seen.push(new Headers(options?.headers).get('Authorization')!);
  assert.equal(options?.redirect, 'error');
  assert.equal(new URL(String(input)).search, '');
  assert.equal(JSON.stringify(options?.body).includes('fixture-token'), false);
  return Response.json({status:'OK',data:{モデル設定:{},available_models:{live_models:{},live_voices:{},chat_models:{},code_models:{}}}});
 };
 assert.ok(await モデル情報取得('http://127.0.0.1:8091/', request, f.root, {wait: async () => {}}));
 f.rotate('rotated-fixture-token-abcdefghijkl');
 assert.ok(await モデル情報取得('http://127.0.0.1:8091/', request, f.root, {wait: async () => {}}));
 assert.deepEqual(seen, ['Bearer fixture-token-not-a-real-credential','Bearer rotated-fixture-token-abcdefghijkl']);
});

test('別ホスト・別ポート・URL秘密・欠落/期限切れ/破損トークンを送信前に拒否', async t => {
 const f = authFixture(); t.after(f.cleanup);
 let calls = 0;
 const request: typeof fetch = async () => {calls++; throw Error('must not send');};
 for (const url of ['http://example.com:8091/','http://127.0.0.1:8092/','http://localhost:8091/',
  'http://user:secret@127.0.0.1:8091/','http://127.0.0.1:8091/?token=secret',
  'http://127.0.0.1:8091/#secret','https://127.0.0.1:8091/','file:///tmp/token','http://127.0.0.1:8091/core/利用者/一覧'])
  assert.equal(await モデル情報取得(url, request, f.root, {wait: async () => {}}), undefined);
 f.rotate('expired-fixture-token-abcdefghijkl', Date.now()-1);
 assert.equal(await モデル情報取得('http://127.0.0.1:8091/', request, f.root, {wait: async () => {}}), undefined);
 writeFileSync(f.file, '{secret');
 assert.throws(() => Core認証('http://127.0.0.1:8091/', f.root), error => {
  assert.ok(error instanceof Error); assert.doesNotMatch(error.message,/secret|fixture-token/); return true;
 });
 rmSync(f.file);
 assert.equal(await モデル情報取得('http://127.0.0.1:8091/', request, f.root, {wait: async () => {}}), undefined);
 assert.equal(calls,0);
});

import WebSocket from 'ws';
import { Coreソケット, Core初期接続 } from '../src/ライブ/Coreソケット';
test('Liveソケットは認証ヘッダーを更新し転送しない（ネットワークなし）', t => {
 const f = authFixture(); t.after(f.cleanup);
 const calls: {url:string; options:WebSocket.ClientOptions}[] = [];
 class FakeSocket { constructor(url:string,options:WebSocket.ClientOptions) {calls.push({url,options});} }
 const Socket = FakeSocket as unknown as typeof WebSocket;
 const url = 'ws://127.0.0.1:8091/core/ws/AIコア';
 for (const token of ['input-fixture-token-abcdefghijkl','output-fixture-token-abcdefghijkl','audio-fixture-token-abcdefghijkl']) {
  f.rotate(token); Coreソケット(url,f.root,Socket);
  assert.equal(calls.at(-1)?.options.headers?.Authorization,`Bearer ${token}`);
  assert.equal(calls.at(-1)?.options.followRedirects,false);
  assert.equal(calls.at(-1)?.url,url);
 }
 assert.throws(() => Coreソケット('ws://remote.invalid:8091/core/ws/AIコア',f.root,Socket));
 assert.equal(calls.length,3);
});

test('再起動の旧トークン拒否後は同じ値を再送せず、原子的置換の隙間から新値を読む', async t => {
 const f = authFixture(); t.after(f.cleanup);
 const seen: string[] = [];
 let waits = 0;
 const request: typeof fetch = async (_url, options) => {
  const token = new Headers(options?.headers).get('Authorization')!; seen.push(token);
  return seen.length === 1 ? new Response('', {status:401}) : Response.json({status:'OK',data:{モデル設定:{},available_models:{live_models:{},live_voices:{},chat_models:{},code_models:{}}}});
 };
 const result = await モデル情報取得('http://127.0.0.1:8091/', request, f.root, {wait:async () => {
  waits++;
  if (waits === 2) rmSync(f.file);
  if (waits === 3) f.rotate('replacement-fixture-token-abcdefghijkl');
 }});
 assert.ok(result); assert.equal(waits,3);
 assert.deepEqual(seen,['Bearer fixture-token-not-a-real-credential','Bearer replacement-fixture-token-abcdefghijkl']);
});

test('初回ファイル欠落は待機して復旧し、期限内の旧値が拒否され続けても有界', async t => {
 const f = authFixture(); t.after(f.cleanup);
 rmSync(f.file); let calls = 0; let waits = 0;
 const request: typeof fetch = async () => {calls++; return new Response('',{status:403});};
 assert.equal(await モデル情報取得('http://127.0.0.1:8091/',request,f.root,{wait:async()=>{waits++; f.rotate();}}),undefined);
 assert.equal(calls,1); assert.equal(waits,4);
});

test('再起動待機を停止すると認証要求を再送しない', async t => {
 const f = authFixture(); t.after(f.cleanup);
 const controller = new AbortController(); let calls=0;
 const request: typeof fetch = async (_url,options) => {
  calls++; assert.equal(options?.signal?.aborted,false); return new Response('',{status:401});
 };
 assert.equal(await モデル情報取得('http://127.0.0.1:8091/',request,f.root,{signal:controller.signal,wait:async()=>{controller.abort();}}),undefined);
 assert.equal(calls,1);
 assert.equal(await モデル情報取得('http://127.0.0.1:8091/',request,f.root,{signal:controller.signal}),undefined);
 assert.equal(calls,1);
});

test('Live初期接続の欠落と拒否は新トークンで復旧し、init後の失敗は再送しない',async t=>{
 const f=authFixture(); t.after(f.cleanup); rmSync(f.file);
 const seen:string[]=[]; let waits=0;
 await Core初期接続(async()=>{
  const header=Core認証('ws://127.0.0.1:8091/core/ws/AIコア',f.root).Authorization;
  seen.push(header);
  if(header.includes('not-a-real')) throw Error('401');
 },()=>true,{wait:async()=>{waits++; if(waits===1) f.rotate(); else f.rotate('reconnected-fixture-token-abcdefghijkl');}});
 assert.equal(waits,2);
 assert.deepEqual(seen,['Bearer fixture-token-not-a-real-credential','Bearer reconnected-fixture-token-abcdefghijkl']);
 let calls=0;
 await assert.rejects(Core初期接続(async()=>{calls++; throw Error('after init');},()=>false,{wait:async()=>{}}),/after init/);
 assert.equal(calls,1);
});

test('Live初期接続の復旧は最大5回で、停止後は再接続しない',async()=>{
 let calls=0;
 await assert.rejects(Core初期接続(async()=>{calls++; throw Error('offline');},()=>true,{wait:async()=>{}}),/再接続/);
 assert.equal(calls,5);
 const controller=new AbortController(); calls=0;
 await assert.rejects(Core初期接続(async()=>{calls++; throw Error('offline');},()=>true,{signal:controller.signal,wait:async()=>{controller.abort();}}));
 assert.equal(calls,1);
});

import { Discordパネル } from '../src/接続パネル/パネル操作';
import { config } from './helpers';
import { join } from 'node:path';
test('パネル停止はモデル候補の復旧待機を中断しBotを起動しない',async t=>{
 const f=authFixture(); t.after(f.cleanup); let created=0; let signal:AbortSignal|undefined;
 const readAPI:typeof モデル情報取得=async(_url,_request,_root,options)=>{
  signal=options?.signal;
  await new Promise<void>(resolve=>signal!.addEventListener('abort',()=>resolve(),{once:true}));
  return undefined;
 };
 const panel=new Discordパネル(()=>{},config,()=>{created++; throw Error('must not start');},join(f.root,'panel.json'),()=>{},undefined,()=>({models:{},voices:{}}),readAPI);
 const pending=panel.開始();
 assert.ok(signal); await panel.停止(); await pending;
 assert.equal(signal.aborted,true); assert.equal(created,0); assert.equal(panel.状態.phase,'idle');
 await panel.終了();
});
