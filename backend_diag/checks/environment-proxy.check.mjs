// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {proxyRoute,networkFailure} from '../runtime/environment_proxy.mjs';
const fixtures=new URL('./fixtures/proxy/',import.meta.url);
const cert=await readFile(new URL('test-only-cert.fixture',fixtures));
const key=await readFile(new URL('test-only-key.fixture',fixtures));
const tlsOptions={cert,key};
test('Discord-compatible environment priority, exclusions and local protection',()=>{
 const route=(url,env)=>proxyRoute(new URL(url),env)?.href||'';
 const high='http://lower.invalid/',low='http://upper.invalid/';
 assert.equal(route('https://api.example',{https_proxy:high,HTTPS_PROXY:low,http_proxy:low}),high);
 assert.equal(route('https://api.example',{HTTPS_PROXY:high,HTTP_PROXY:low}),high);
 assert.equal(route('https://api.example',{http_proxy:high,HTTP_PROXY:low}),high);
 assert.equal(route('http://api.example',{http_proxy:high,HTTP_PROXY:low,HTTPS_PROXY:low}),high);
 assert.equal(route('https://api.example',{ALL_PROXY:high,all_proxy:high}),'');
 for(const no_proxy of ['*','API.EXAMPLE','api.example:443','.example','*.example','elsewhere, api.example'])assert.equal(route('https://api.example',{HTTP_PROXY:high,no_proxy}),'');
 for(const no_proxy of ['api.example:80','example','badexample','.api.example'])assert.equal(route('https://api.example',{HTTP_PROXY:high,no_proxy}),high);
 assert.equal(route('https://api.example',{HTTP_PROXY:high,no_proxy:'other',NO_PROXY:'*'}),high);
 for(const host of ['localhost','x.localhost','127.0.0.1','127.3.4.5','[::1]'])assert.equal(route(`http://${host}:8095`,{HTTP_PROXY:'invalid',HTTPS_PROXY:'invalid'}),'');
 for(const value of ['invalid','socks5://example','http://x/path','http://x/#fragment','http://user:%xx@x'])assert.throws(()=>route('https://api.example',{HTTPS_PROXY:value}),{message:'proxy-config'});
});
test('network errors never expose untrusted messages or properties',()=>{
 for(const [code,reason] of [['EAI_AGAIN','dns'],['ENOTFOUND','dns'],['CERT_HAS_EXPIRED','tls'],['ERR_TLS_CERT_ALTNAME_INVALID','tls'],['ECONNRESET','network']])assert.equal(networkFailure(Object.assign(Error('synthetic-password https://private.invalid'),{code})),reason);
});
async function listen(server){
 const sockets=new Set();server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {port:server.address().port,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
async function client(options,env={},trusted=true){
 const childEnv={...process.env};
 for(const name of Object.keys(childEnv))if(/^(https?_proxy|all_proxy|no_proxy|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED)$/i.test(name))delete childEnv[name];
 Object.assign(childEnv,env);if(trusted)childEnv.NODE_EXTRA_CA_CERTS=fileURLToPath(new URL('test-only-cert.fixture',fixtures));
 const child=spawn(process.execPath,[fileURLToPath(new URL('client.mjs',fixtures)),JSON.stringify(options)],{env:childEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 assert.equal(code,0,stderr);assert.equal(stdout,'ok');assert.ok(!stderr.includes('synthetic'));
}
async function scenario({secure=false,status=200,hang=false,reason,trusted=true,provider,abort=false,direct=false,noProxy=false,reset=false}={}){
 let apiCount=0,proxyCount=0;const upstreamSockets=new Set();
 const target=await listen(https.createServer(tlsOptions,(request,response)=>{
  apiCount++;assert.equal(request.headers.authorization,'Bearer synthetic-api-secret');assert.equal(request.headers['proxy-authorization'],undefined);
  response.end('{"data":[]}');
 }));
 const proxyServer=secure?https.createServer(tlsOptions):http.createServer();
 proxyServer.on('connect',(request,socket)=>{
  proxyCount++;assert.equal(request.headers.authorization,undefined);
  assert.equal(request.headers['proxy-authorization'],'Basic '+Buffer.from('synthetic-user:synthetic-password').toString('base64'));
  assert.equal(request.url,`${provider==='google'?'generativelanguage.googleapis.com':'api.openai.com'}:443`);
  if(reset){socket.destroy();return;}
  if(hang)return;
  if(status!==200){socket.end(`HTTP/1.1 ${status} synthetic-secret\r\nContent-Length: 0\r\n\r\n`);return;}
  const upstream=net.connect(target.port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(upstream).pipe(socket);});
  upstreamSockets.add(upstream);upstream.on('close',()=>upstreamSockets.delete(upstream));
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
 });
 const proxy=await listen(proxyServer);
 try{
  const env=direct?{}:{HTTPS_PROXY:`${secure?'https':'http'}://synthetic-user:synthetic-password@127.0.0.1:${proxy.port}`};
  if(noProxy)env.NO_PROXY='api.openai.com:443';
  await client({reason,provider,abort,...(direct||noProxy?{directPort:target.port}:{})},env,trusted);
  assert.equal(proxyCount,direct||noProxy||secure&&!trusted?0:1);
  assert.equal(apiCount,reason?0:1);
 }finally{for(const socket of upstreamSockets)socket.destroy();await proxy.close();await target.close();}
}
test('HTTP and HTTPS CONNECT really carry requests; proxy credentials stay outside API TLS',async()=>{
 await scenario();await scenario({secure:true});
});
test('NO_PROXY and no proxy settings really use direct transport',async()=>{
 await scenario({noProxy:true});await scenario({direct:true});
});
test('certificate verification stays enabled for target, proxy and direct connections',async()=>{
 await scenario({trusted:false,reason:'tls'});
 await scenario({secure:true,trusted:false,reason:'tls'});
 await scenario({direct:true,trusted:false,reason:'tls'});
 await scenario({provider:'google',reason:'tls'}); // trusted certificate, wrong hostname
});
test('proxy rejection, redirect and abort never fall back to direct API access',async()=>{
 for(const status of [407,403,302])await scenario({status,reason:status===407?'proxy-auth':'proxy-connect'});
 await scenario({hang:true,abort:true,reason:'stopped'});
 await scenario({reset:true,reason:'network'});
 await client({reason:'proxy-config'},{HTTPS_PROXY:'http://synthetic-user:%xx@invalid'});
});
test('CONNECT timeout closes pending transport without direct fallback',async()=>{
 await scenario({hang:true,reason:'timeout'});
});
test('loopback Ollama remains direct even with invalid proxy configuration',async()=>{
 let calls=0;const server=await listen(http.createServer((_request,response)=>{calls++;response.end('{"data":[]}');}));
 try{await client({localPort:server.port,provider:'ollama-local'},{HTTP_PROXY:'invalid',HTTPS_PROXY:'invalid'});assert.equal(calls,1);}finally{await server.close();}
});
