// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Browser窓の代わりに模擬WebContentsを登録する。Electron・Chromeは起動しない。
const {join}=require('node:path');
const {EventEmitter}=require('node:events');
const {createInterface}=require('node:readline');
const {createBrowserCDP}=require('../デスクトップ/ブラウザCDP.cjs');
(async()=>{
 const bridges=[],directory=join(process.argv[2],'_ide_browser_sessions');
 function add(bridge,url,closeBridge){
  let destroyed=false;
  const contents=Object.assign(new EventEmitter(),{getTitle:()=>url,getURL:()=>url,isDestroyed:()=>destroyed,focus(){}});
  contents.debugger=Object.assign(new EventEmitter(),{isAttached:()=>true,sendCommand:async()=>({result:{type:'string',value:url}})});
  const record={window:{close(){destroyed=true;contents.emit('destroyed');if(closeBridge)bridge.close();},isMinimized:()=>false,show(){},focus(){}}};
  bridge.add(record,contents);return record;
 }
 async function ide(url){
  const bridge=await createBrowserCDP({directory,canUse:async()=>true,openPanel:ide,allowedURL:target=>target.startsWith('https://example.test/'),version:'mock-WebContents'});
  bridges.push(bridge);return add(bridge,url,true);
 }
 const source=await ide('https://example.test/source');
 let standalone;
 standalone=await createBrowserCDP({directory,sessionPrefix:'aidiy_browser',canUse:async()=>true,openPanel:async url=>add(standalone,url,false),allowedURL:target=>target.startsWith('https://example.test/'),version:'mock-WebContents'});
 bridges.push(standalone);add(standalone,'https://example.test/standalone',false);
 console.log(JSON.stringify({session:source.browserSession,tab_id:source.browserTabId,standalone:standalone.name}));
 const reader=createInterface({input:process.stdin});
 reader.on('line',line=>{if(line==='quit')reader.close();});
 reader.on('close',()=>{bridges.forEach(bridge=>bridge.close());process.stdin.destroy();});
})().catch(error=>{console.error(error);process.exitCode=1;});
