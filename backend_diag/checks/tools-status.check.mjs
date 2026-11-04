// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createToolsStatusChecker,TOOLS_TIMEOUT_MS,TOOLS_RESPONSE_LIMIT} from '../診断/tools_status.mjs';

const good = JSON.stringify({status:'ok', name:'aidiy_code_agents', secret:'never-return-this'});
async function server(t, handler) {
  const value = http.createServer(handler);
  value.listen(0, '127.0.0.1'); await once(value, 'listening');
  t.after(() => { value.closeAllConnections(); return new Promise(resolve => value.close(resolve)); });
  return value.address().port;
}
const checker = (port, options = {}) => createToolsStatusChecker({reader:async () => JSON.stringify({PORT_TOOLS:port, openai_key_id:'synthetic-secret'}), ...options});

test('Tools ping uses fixed loopback GET without credentials and returns only online', async t => {
  const port = await server(t, (req,res) => {
    assert.equal(req.method,'GET'); assert.equal(req.url,'/aidiy_code_agents/ping');
    assert.equal(req.headers.authorization,undefined); assert.equal(req.headers.cookie,undefined);
    assert.equal(req.headers['x-api-key'],undefined); res.end(good);
  });
  assert.deepEqual(await checker(String(port))(), {online:true});
  assert.deepEqual(await checker(port, {reader:async path => { assert.match(path, /_config[/\\]AiDiy_key\.json$/); return '\uFEFF'+JSON.stringify({PORT_TOOLS:port}); }})(), {online:true});
});

test('Tools down, HTTP errors, redirects, malformed, wrong-service and oversized bodies are offline', async t => {
  for (const mode of ['down','redirect','http','malformed','wrong','large','truncated','utf8']) {
    const port = await server(t, (req,res) => {
      if (mode === 'down') return req.socket.destroy();
      if (mode === 'redirect') { res.writeHead(302, {Location:'https://example.invalid/never'}); return res.end(); }
      if (mode === 'http') { res.writeHead(503); return res.end(good); }
      if (mode === 'truncated') { res.writeHead(200, {'Content-Length':'500'}); res.write(good); return res.destroy(); }
      res.end(mode === 'malformed' ? 'synthetic-secret' : mode === 'wrong' ? '{"status":"ok","name":"other"}' : mode === 'large' ? ' '.repeat(TOOLS_RESPONSE_LIMIT + 1) + good : Buffer.from([0xff]));
    });
    assert.deepEqual(await checker(port)(), {online:false}, mode);
  }
});

test('invalid config/ports never cause a request, and config BOM is supported', async () => {
  for (const value of [0,-1,65536,1.5,true,[],{},'','http://example.invalid','8095/path','NaN']) {
    assert.deepEqual(await checker(value)(), {online:false});
  }
  for (const raw of ['malformed-secret','[]','null',' '.repeat(128*1024+1)]) {
    assert.deepEqual(await createToolsStatusChecker({reader:async () => raw})(), {online:false});
  }
});

test('timeout bounds stalled response and config read', async t => {
  assert.equal(TOOLS_TIMEOUT_MS,5000);
  const port = await server(t, (_req,res) => {res.writeHead(200);res.write('{');});
  for (const check of [checker(port,{timeoutMs:30}), createToolsStatusChecker({timeoutMs:30, reader:() => new Promise(() => {})})]) {
    const start = Date.now(); assert.deepEqual(await check(),{online:false});
    assert.ok(Date.now()-start < 1000);
  }
});

test('brief startup latency does not disconnect a healthy Tools service', async t => {
  const port = await server(t, (_req,res) => {
    const timer=setTimeout(()=>res.end(good),2000);
    res.once('close',()=>clearTimeout(timer));
  });
  assert.deepEqual(await checker(port)(),{online:true});
});

test('concurrent polls share one request; one disconnected waiter does not cancel others', async t => {
  let calls = 0;
  let ready; const requested = new Promise(resolve => {ready=resolve;});
  let reply;
  const port = await server(t, (_req,res) => {calls++;reply=()=>res.end(good);ready();});
  const check = checker(port), abort = new AbortController();
  const first = check({signal:abort.signal}), second = check();
  await requested; abort.abort();
  assert.deepEqual(await first,{online:false}); reply();
  assert.deepEqual(await second,{online:true}); assert.equal(calls,1);
});

test('last disconnect destroys socket and a later poll starts a fresh request', async t => {
  let calls = 0, ready;
  const requested = new Promise(resolve => {ready=resolve;});
  let closed;
  const port = await server(t, (req,res) => {
    calls++;
    if (calls > 1) return res.end(good);
    closed = once(req.socket,'close');ready();
  });
  const check = checker(port), abort = new AbortController();
  const first = check({signal:abort.signal});await requested;abort.abort();
  assert.deepEqual(await first,{online:false});await closed;
  assert.deepEqual(await check(),{online:true});assert.equal(calls,2);
  assert.deepEqual(await check({signal:AbortSignal.abort()}),{online:false});assert.equal(calls,2);
});

test('missing config/port uses 8095 and invalid configuration makes no network request', async () => {
  const original = http.request;
  try {
    const seen = [];
    http.request = options => { seen.push(options); throw Error('synthetic failure'); };
    for (const reader of [async () => '{}', async () => {throw Object.assign(Error('missing'),{code:'ENOENT'});}]) {
      assert.deepEqual(await createToolsStatusChecker({reader})(),{online:false});
      assert.equal(seen.at(-1).port,8095);
      assert.equal(seen.at(-1).hostname,'127.0.0.1');
      assert.equal(seen.at(-1).agent,false);
      assert.deepEqual(seen.at(-1).headers,{Accept:'application/json'});
    }
    const before = seen.length;
    for (const raw of ['{','[]',' '.repeat(128*1024+1),'{"PORT_TOOLS":true}','{"PORT_TOOLS":"65536"}']) {
      assert.deepEqual(await createToolsStatusChecker({reader:async () => raw})(),{online:false});
    }
    assert.equal(seen.length,before);
  } finally {http.request=original;}
});

test('cancel during config read cannot start a delayed request', async () => {
  let release;
  const read = new Promise(resolve => {release=resolve;});
  const abort = new AbortController();
  const check = createToolsStatusChecker({reader:() => read});
  const pending = check({signal:abort.signal});abort.abort();
  assert.deepEqual(await pending,{online:false});
  const original = http.request;
  let calls = 0;
  try {
    http.request = () => {calls++;throw Error('unexpected request');};
    release('{"PORT_TOOLS":8095}');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls,0);
  } finally {http.request=original;}
});
