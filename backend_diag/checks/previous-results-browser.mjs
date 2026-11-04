// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 一時プロファイルの既存ブラウザ + loopback + 合成MCP/音声のみ。実AIを呼ばない。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createServer} from '../diag_main.mjs';
const old='2026-10-17T01:02:03Z',requests=[];
const previousResults={snapshot:async()=>({導入状況:{結果:[{id:'node',状態:'OK',バージョン:'saved-version',前回結果:true}],前回実行日時:old},モデル一覧:{結果:[{id:'openai',状態:'OK',モデル:['saved-model'],前回結果:true}],前回実行日時:old},外部連携:{結果:[{id:'discord',状態:'NG',説明:'保存済み結果',前回結果:true}],前回実行日時:old}})};
const makeServer=()=>createServer({token:'previous-fixture',previousResults,entries:[{id:'node',name:'Node.js',menuGroup:'ベース',commands:['node']}],toolsStatusFn:async()=>({online:true}),modelTrials:{snapshot:async()=>({項目:[],版:'fixture'}),catalogs:async()=>({区分:{}}),close:()=>{}},installWriteFn:async()=>({件数:1}),modelsWriteFn:async()=>[],integrationWriteFn:async()=>({件数:1}),publicCache:{snapshot:()=>({状態:'未取得'}),input:()=>({})},keyStatusFn:async()=>({設定状態:'読込済み',項目:[{id:'openai',名前:'OpenAI',テスト可能:true},{id:'discord',名前:'Discord',テスト可能:true}]}),scanFn:async()=>[{id:'node',状態:'NG'}],keyTestFn:async id=>({id,状態:'OK',モデル:['new-model']})});
let server=makeServer();
server.on('request',req=>requests.push({url:decodeURIComponent(req.url),method:req.method}));
const executable=process.env.CHROME_PATH||[[process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'],[process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe']].filter(([base])=>base).map(([base,name])=>join(base,name)).find(existsSync);
assert.ok(executable,'既存Chrome/Edgeが必要です');await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=mkdtempSync(join(tmpdir(),'diag-previous-browser-')),output=resolve(process.env.DIAG_SCREENSHOT_DIR||'temp/diag-previous-browser');mkdirSync(output,{recursive:true});
const chrome=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
 let port;for(let i=0;i<100&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}assert.ok(port);
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let seq=0;const pending=new Map(),errors=[];ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(r=>{pending.set(++seq,r);ws.send(JSON.stringify({id:seq,method,params}));});
 async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(result.result?.exceptionDetails,undefined,JSON.stringify(result));return result.result.result.value;}
 async function until(expression){for(let i=0;i<120;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail(expression);}
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 async function open(){await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/#token=previous-fixture`});await until("document.querySelector('#list .badge')?.dataset.state==='OK'");await tab('導入状況');}
 async function tab(name){await evaluate(`[...document.querySelectorAll('.tabs button')].find(b=>b.textContent==='${name}').click()`);}
 async function check(panel,button){
  await until(`document.querySelector('${panel} .previous-run time')?.dateTime==='${old}'`);
  const position=await evaluate(`(()=>{const t=document.querySelector('${panel} .previous-run').getBoundingClientRect(),b=document.querySelector('${button}').getBoundingClientRect();return t.right<=b.left&&Math.abs(t.top-b.top)<20})()`);assert.ok(position,button);
 }
 await open();await check('[aria-label="導入状況"]','#install-run');
 await tab('モデル一覧');await until("document.querySelector('.key-row .badge')?.dataset.state==='OK'");await check('.model-key-panel','#latest-models');
 await evaluate("document.querySelector('.key-row .key-select').click()");await until("document.querySelector('.models')?.textContent.includes('saved-model')");
 await tab('外部連携');await until("document.querySelector('.integration-row .badge')?.dataset.state==='NG'");await check('.integration-panel','#integration-run');
 assert.equal(requests.filter(r=>r.method==='POST'&&!r.url.endsWith('/起動/ログ')).length,0);
 assert.ok(await evaluate("document.querySelector('#install-write').disabled&&document.querySelector('#models-write').disabled&&document.querySelector('#integration-write').disabled"));
 for(const [name,panel,button] of [['導入状況','[aria-label="導入状況"]','#install-run'],['モデル一覧','.model-key-panel','#latest-models'],['外部連携','.integration-panel','#integration-run']]){
  await tab(name);await evaluate(`document.querySelector('${button}').click()`);await until(`document.querySelector('${panel} .previous-run time')?.dateTime!=='${old}'&&!document.querySelector('${button}').disabled`);
  for(const width of [1280,390]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'-'+width+'.png'),Buffer.from(shot.result.data,'base64'));}
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 }
 assert.ok(!requests.some(r=>r.url.includes('書込')));
 await send('Page.navigate',{url:'about:blank'});server.closeAllConnections();await new Promise(r=>server.close(r));server=makeServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 await open();await check('[aria-label="導入状況"]','#install-run');await tab('モデル一覧');await check('.model-key-panel','#latest-models');await tab('外部連携');await check('.integration-panel','#integration-run');
 // 書込済みは全タブの往復でも、他の種類の確認・書込でも維持する。
 const written=[];
 for(const [name,run,write] of [['導入状況','#install-run','#install-write'],['モデル一覧','#latest-models','#models-write'],['外部連携','#integration-run','#integration-write']]){
  await tab(name);await evaluate(`document.querySelector('${run}').click()`);await until(`!document.querySelector('${run}').disabled&&!document.querySelector('${write}').disabled`);
  for(const id of written)assert.equal(await evaluate(`document.querySelector('${id}').textContent`),'書込済',name+'再確認後も'+id+'を保持');
  await evaluate(`document.querySelector('${write}').click()`);await until(`document.querySelector('${write}').textContent==='書込済'`);written.push(write);
  const reads=requests.filter(r=>r.url.includes('api/キー設定')).length;
  for(const destination of ['設定モデル','AIモデル','外部連携','モデル一覧','導入状況',name])await tab(destination);
  assert.equal(requests.filter(r=>r.url.includes('api/キー設定')).length,reads,'タブ移動だけで結果を再読込しない');
  for(const id of written){assert.equal(await evaluate(`document.querySelector('${id}').textContent`),'書込済');assert.equal(await evaluate(`document.querySelector('${id}').classList.contains('write-next')`),false);}
 }
 await tab('モデル一覧');await evaluate("document.querySelector('#latest-models').click()");await until("!document.querySelector('#latest-models').disabled");
 assert.equal(await evaluate("document.querySelector('#models-write').textContent"),'書込');assert.equal(await evaluate("document.querySelector('#models-write').classList.contains('write-next')"),true);
 assert.equal(await evaluate("document.querySelector('#integration-write').textContent"),'書込済');assert.equal(await evaluate("document.querySelector('#install-write').textContent"),'書込済');
 assert.deepEqual(errors,[]);console.log('前回結果の初期表示、日時位置、再実行更新、未保存での再起動、390px/1280px表示、5タブ往復・別タブ再確認後の書込済み保持: OK');
}finally{ws?.close();chrome.kill();server.close();server.closeAllConnections();await sleep(300);if(resolve(profile).startsWith(resolve(tmpdir())+sep))try{rmSync(profile,{recursive:true,force:true});}catch{}}
