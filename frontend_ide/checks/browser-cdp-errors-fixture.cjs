// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実CDPブリッジだけを起動するfixture。Electron・Chrome・外部APIは起動しない。
const {join}=require('node:path');
const {EventEmitter}=require('node:events');
const {createInterface}=require('node:readline');
const {createBrowserCDP}=require('../デスクトップ/ブラウザCDP.cjs');
(async()=>{
 const commands=[],methods=[];let destroyed=false,maxListeners=0;
 const contents=Object.assign(new EventEmitter(),{getTitle:()=> 'CDP error fixture',getURL:()=> 'https://example.test/source',isDestroyed:()=>destroyed,focus(){}});
 const debuggerAPI=new EventEmitter();
 debuggerAPI.on('newListener',event=>{if(event==='message')maxListeners=Math.max(maxListeners,debuggerAPI.listenerCount('message')+1);});
 Object.assign(debuggerAPI,{isAttached:()=>true,sendCommand:async(method,params)=>{
  methods.push(method);commands.push(params.expression||method);
  if(params.expression==='close-before-response'){
   destroyed=true;contents.emit('destroyed');await new Promise(resolve=>setImmediate(resolve));
  }
  const value=params.expression==='commands'?[...methods]:params.expression==='max-listeners'?maxListeners:params.expression;
  return{result:{type:typeof value,value}};
 }});
 contents.debugger=debuggerAPI;
 const record={window:{close(){destroyed=true;contents.emit('destroyed');},isMinimized:()=>false,show(){},focus(){}}};
 const bridge=await createBrowserCDP({directory:join(process.argv[2],'_ide_browser_sessions'),canUse:async()=>true,openPanel:async()=>record,allowedURL:()=>true,version:'mock-WebContents'});
 bridge.add(record,contents);
 console.log(JSON.stringify({session:bridge.name,tab_id:record.browserTabId}));
 const reader=createInterface({input:process.stdin});
 reader.on('line',line=>{if(line==='stats')console.log(JSON.stringify({commands,methods,maxListeners}));else if(line==='quit')reader.close();});
 reader.on('close',()=>{bridge.close();process.stdin.destroy();});
})().catch(error=>{console.error(error);process.exitCode=1;});
