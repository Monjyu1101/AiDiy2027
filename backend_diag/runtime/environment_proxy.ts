// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Discord と同じ環境変数優先順位。OS/PAC 設定や globalAgent は変更しない。
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import {isIP} from 'node:net';
import type {Duplex} from 'node:stream';

export function proxyRoute(address: URL, env: NodeJS.ProcessEnv = process.env): URL | null {
 const host=address.hostname.toLowerCase();
 // 固定 loopback の Ollama/MCP 等は NO_PROXY の指定漏れや不正 proxy でも外へ出さない。
 if(host==='localhost'||host.endsWith('.localhost')||host==='[::1]'||/^127\./.test(host))return null;
 const secure=address.protocol==='https:',port=address.port||(secure?'443':'80');
 for(const entry of (env.no_proxy||env.NO_PROXY||'').toLowerCase().split(/[,\s]+/).filter(Boolean)){
  if(entry==='*')return null;
  const match=entry.match(/^(.+):(\d+)$/);
  if(match&&match[2]!==port)continue;
  const name=match?.[1]||entry;
  if(name.startsWith('.')||name.startsWith('*')){if(host.endsWith(name.replace(/^\*/,'')))return null;}
  else if(host===name)return null;
 }
 const httpProxy=env.http_proxy||env.HTTP_PROXY||'';
 const value=secure?(env.https_proxy||env.HTTPS_PROXY||httpProxy):httpProxy;
 if(!value)return null; // ALL_PROXY / SOCKS / OS proxy は対象外。
 try{
  const proxy=new URL(value);
  if(!['http:','https:'].includes(proxy.protocol)||proxy.pathname!=='/'||proxy.search||proxy.hash)throw Error();
  decodeURIComponent(proxy.username);decodeURIComponent(proxy.password);
  return proxy;
 }catch{throw new Error('proxy-config');}
}

// 外部モデル API は HTTPS のみ。HTTP(S) proxy へ CONNECT し、その内側で接続先 TLS を検証する。
// リクエスト単位の所有権で、CONNECT 待ちも TLS 待ちも timeout/abort 時に破棄する。
export class MetadataProxyAgent extends https.Agent {
 private pending=new Set<http.ClientRequest>();
 private tunnels=new Set<Duplex>();
 private closed=false;
 constructor(private proxy:URL){super({keepAlive:false,maxCachedSessions:0});}
 override createConnection(options:https.RequestOptions,callback?:(error:Error|null,stream:Duplex)=>void):undefined {
  let complete=false;
  const done=(error:Error|null,socket?:Duplex)=>{
   if(complete)return;complete=true;
   callback?.(error,socket!);
  };
  if(this.closed){done(new Error('stopped'));return;}
  const hostname=String(options.hostname||options.host),authority=`${hostname}:${options.port||443}`;
  const headers:Record<string,string>={Host:authority};
  if(this.proxy.username||this.proxy.password)headers['Proxy-Authorization']='Basic '+Buffer.from(decodeURIComponent(this.proxy.username)+':'+decodeURIComponent(this.proxy.password)).toString('base64');
  const transport=this.proxy.protocol==='https:'?https:http;
  const request=transport.request({hostname:this.proxy.hostname.replace(/^\[|\]$/g,''),port:this.proxy.port||(this.proxy.protocol==='https:'?443:80),method:'CONNECT',path:authority,headers,agent:false,rejectUnauthorized:true});
  this.pending.add(request);
  request.once('close',()=>this.pending.delete(request));
  request.once('error',error=>done(error));
  request.once('connect',(response,socket,head)=>{
   this.pending.delete(request);
   if(this.closed){socket.destroy();done(new Error('stopped'));return;}
   if(response.statusCode!==200){socket.destroy();done(new Error(response.statusCode===407?'proxy-auth':'proxy-connect'));return;}
   // CONNECT の応答に予期しないデータがある場合は使用しない。
   if(head.length){socket.destroy();done(new Error('proxy-connect'));return;}
   this.tunnels.add(socket);socket.once('close',()=>this.tunnels.delete(socket));
   const secured=tls.connect({socket,servername:isIP(hostname)?undefined:hostname,rejectUnauthorized:true});
   this.tunnels.add(secured);secured.once('close',()=>this.tunnels.delete(secured));
   secured.once('error',error=>{socket.destroy();done(error);});
   secured.once('secureConnect',()=>done(null,secured));
  });
  request.end();
 }
 override destroy(){
  this.closed=true;
  for(const request of this.pending)request.destroy();
  for(const socket of this.tunnels)socket.destroy();
  this.pending.clear();this.tunnels.clear();super.destroy();
 }
}

// 固定分類だけを公開する。error.message / URL / header / response body はログへ渡さない。
export function networkFailure(error:unknown):string {
 const code=(error as NodeJS.ErrnoException)?.code||'';
 const message=error instanceof Error?error.message:'';
 if(['proxy-config','proxy-auth','proxy-connect','stopped'].includes(message))return message;
 if(['ENOTFOUND','EAI_AGAIN'].includes(code))return 'dns';
 if(['CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_TLS_CERT_ALTNAME_INVALID'].includes(code))return 'tls';
 return 'network';
}
