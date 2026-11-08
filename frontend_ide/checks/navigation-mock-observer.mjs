// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// --import で子ハーネスに適用。自分のサーバー以外へのfetchと実AI子プロセスを拒否する。
import http from 'node:http';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {appendFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const file=process.env.AIDIY_NAVIGATION_MOCK_AUDIT,ports=new Set(),profiles=[];
const record=value=>appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...value})+'\n');
const emit=http.Server.prototype.emit;
http.Server.prototype.emit=function(type,...args){
 if(type==='listening'){ports.add(this.address().port);record({event:'listen',port:this.address().port});}
 if(type==='request'){
  const [req,res]=args,path=new URL(req.url,'http://localhost').pathname;
  const end=res.end;res.end=function(chunk,...rest){if(/\.(?:js|css|html|cjs)$/.test(path)||path==='/'){const body=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk||'');record({event:'loadedAsset',path,status:this.statusCode,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});}return end.call(this,chunk,...rest);};
 }
 return emit.call(this,type,...args);
};
const fetcher=globalThis.fetch;
globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);for(const profile of profiles){try{ports.add(Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]));}catch{}}if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!ports.has(Number(url.port))){record({event:'blockedFetch',origin:url.origin,path:url.pathname});throw Error('模擬試験外への通信を拒否: '+url.origin);}return fetcher(input,options);};
const spawn=cp.spawn;
cp.spawn=function(executable,args=[],options={}){
 const browser=/[\\/](?:chrome|msedge|chromium)(?:\.exe)?$/i.test(executable),compiler=/[\\/]esbuild(?:\.exe)?$/i.test(executable);
 if(!browser&&!compiler){record({event:'blockedSpawn',executable});throw Error('模擬試験外の子プロセスを拒否');}
 if(browser)args=[...args,'--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'];
 if(browser)profiles.push(args.find(a=>a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length));
 const browserEnv={...(options.env||process.env)};for(const key of ['USERPROFILE','HOME','APPDATA','LOCALAPPDATA'])if(process.env['AIDIY_MOCK_BROWSER_'+key])browserEnv[key]=process.env['AIDIY_MOCK_BROWSER_'+key];
 const child=spawn(executable,args,{...options,...(browser?{stdio:['ignore','pipe','pipe'],env:browserEnv}:{ }),windowsHide:true});record({event:'spawn',executable,args,pid:child.pid,browserUsesExplicitIsolatedProfile:browser});
 if(browser){child.stderr?.on('data',data=>appendFileSync(file+'.browser.stderr.txt',data));child.stdout?.on('data',data=>appendFileSync(file+'.browser.stdout.txt',data));}
 child.once('exit',(code,signal)=>record({event:'childExit',pid:child.pid,code,signal}));return child;
};
syncBuiltinESMExports();
const NativeSocket=globalThis.WebSocket;
globalThis.WebSocket=class extends NativeSocket{
 constructor(...args){super(...args);this.navigationIds=new Set();this.addEventListener('message',event=>{const data=JSON.parse(event.data);if(this.navigationIds.has(data.id))record({event:'browserNavigation',response:data});if(data.method==='Runtime.exceptionThrown')record({event:'browserException',details:data.params});});}
 send(data){const request=JSON.parse(data);if(request.method==='Page.navigate')this.navigationIds.add(request.id);return super.send(data);}
};
process.on('exit',code=>record({event:'exit',code}));
