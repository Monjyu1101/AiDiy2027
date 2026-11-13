// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 合成モデルのみの任意ブラウザ回帰。既存 Chrome / Edge を使い、実設定・外部 API は使わない。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createServer} from '../diag/diag_main.mjs';
import {createModelTrials} from '../diag/モデル試行/trials.mjs';
const config={CODE_BASE_PATH:'/fixture/project',CHAT_AI_NAME:'freeai_chat',CHAT_FREEAI_MODEL:'chat-test',LIVE_AI_NAME:'freeai_live',LIVE_FREEAI_MODEL:'live-test',LIVE_FREEAI_VOICE:'Zephyr',CODE_AI1_NAME:'codex_cli',CODE_AI1_MODEL:'auto',TASK_AI_NAME:'codex_cli',TEAM_AI_NAME:'codex_cli'};
for(let i=2;i<=6;i++)config[`CODE_AI${i}_NAME`]='auto';
for(const family of ['TASK','TEAM'])for(const phase of ['plan','do','check'])config[`${family}_AI_MODEL_${phase}`]='auto';
let release,calls=0,keyCalls=0,scanCalls=0;
const gate=new Promise(resolve=>release=resolve);
const trials=createModelTrials({catalogReader:async()=>({}),credentialReader:async()=>null,installedClisFn:async()=>({}),reader:async()=>JSON.stringify(config),statusFn:async()=>({online:true}),request:async request=>{
 if(request.method==='DELETE')return {body:null};
 const {method,id}=request.body;
 if(method==='initialize')return {body:{jsonrpc:'2.0',id,result:{protocolVersion:'2024-11-05'}}};
 if(method==='notifications/initialized')return {body:null};
 assert.equal(method,'tools/call');calls++;await gate;
 return {body:{jsonrpc:'2.0',id,result:{structuredContent:{result:JSON.stringify({status:'OK',history_saved:true,result:'おはようございます',selected_model:'code-test'})}}}};
}});
const server=createServer({token:'synthetic-row-ui',modelTrials:trials,toolsStatusFn:async()=>({online:true}),publicCache:{snapshot:()=>({状態:'取得済',件数:0}),input:()=>({})},
 entries:[{id:'node',name:'Node.js',description:'合成データ',commands:['node'],menuGroup:'ベース'}],
 scanFn:async()=>{scanCalls++;return [{id:'node',状態:'OK',説明:'合成応答'}];},
 keyStatusFn:async()=>({設定状態:'読込済み',項目:[{id:'openai',名前:'OpenAI',キー名:'openai_key_id',設定済み:true,テスト可能:true},{id:'discord',名前:'Discord',キー名:'discord_bot_token',設定済み:true,テスト可能:false,理由:'接続テストは未対応です。'}]}),
 keyTestFn:async()=>{keyCalls++;return {id:'openai',状態:'OK',モデル:['synthetic-model']};},
});
const chromePath=process.env.CHROME_PATH||[
 [process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'],
 [process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'],
].filter(([base])=>base).map(([base,name])=>join(base,name)).find(existsSync)||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
assert.ok(chromePath,'CHROME_PATH に既存ブラウザを指定してください。');
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=mkdtempSync(join(tmpdir(),'diag-trial-browser-'));
const output=resolve(process.env.DIAG_SCREENSHOT_DIR||'temp/diag-trial-browser');mkdirSync(output,{recursive:true});
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let ws;
try{
 let port;for(let i=0;i<100&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
 assert.ok(port,'ブラウザの起動に失敗しました。');
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
 let sequence=0;const pending=new Map(),errors=[];
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++sequence,resolve);ws.send(JSON.stringify({id:sequence,method,params}));});
 async function evaluate(expression){const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response));return response.result.result.value;}
 async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail(expression);}
 async function capture(name){const response=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(response.result.data,'base64'));}
 await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/#token=synthetic-row-ui`});
 await until(`[...document.querySelectorAll('.tabs button')].some(b=>b.textContent==='設定モデル'&&!b.disabled)`);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.tabs button')].slice(0,4).map(b=>b.textContent)`),['導入状況','モデル一覧','外部連携','設定モデル']);
 await evaluate(`[...document.querySelectorAll('.tabs button')].find(b=>b.textContent==='導入状況').click()`);
 assert.equal(await evaluate(`document.querySelector('#install-run').textContent`),'状況確認');
 assert.equal(await evaluate(`document.querySelector('[aria-label="導入状況"] .panel-heading h2').textContent`),'導入状況');
 await capture('install-desktop');await evaluate(`document.querySelector('#install-run').click()`);await until(`!document.querySelector('#install-write').disabled`);assert.equal(scanCalls,1);
 await evaluate(`[...document.querySelectorAll('.tabs button')].find(b=>b.textContent==='モデル一覧').click()`);await until(`document.querySelectorAll('.key-row').length===1`);
 assert.equal(await evaluate(`document.querySelector('.model-key-panel .panel-heading h2').textContent`),'モデル一覧取得');
 assert.equal(await evaluate(`document.querySelector('#latest-models').textContent`),'一括取得');
 await capture('models-desktop');await evaluate(`document.querySelector('#latest-models').click()`);await until(`!document.querySelector('#models-write').disabled`);assert.equal(keyCalls,1);
 await evaluate(`[...document.querySelectorAll('.tabs button')].find(b=>b.textContent==='外部連携').click()`);await until(`document.querySelectorAll('.integration-row').length===1`);
 assert.equal(await evaluate(`document.querySelector('.integration-panel .panel-heading h2').textContent`),'外部連携確認');
 assert.equal(await evaluate(`document.querySelectorAll('.integration-test button').length`),1);assert.equal(await evaluate(`document.querySelector('.integration-test button').disabled`),true,'未対応の外部連携もテストボタンを表示し、無効にする');await capture('integrations-desktop');
 await evaluate(`[...document.querySelectorAll('.tabs button')].find(b=>b.textContent==='設定モデル').click()`);
 await until(`document.querySelectorAll('[data-trial-id]').length===16`);
 assert.equal(await evaluate(`document.querySelector('.trial-heading h2').textContent`),'モデル動作確認');
 assert.equal(await evaluate(`document.querySelector('#model-trial-start').textContent`),'動作確認');
 assert.equal(await evaluate(`!!document.querySelector('#model-trial-single')`),false);
 assert.equal(await evaluate(`document.querySelector('.trial-reload span:last-child').textContent`),'再読込');
 const header=await evaluate(`(()=>{const h=document.querySelector('.trial-heading'),title=h.querySelector('h2').getBoundingClientRect(),button=h.querySelector('.trial-reload').getBoundingClientRect(),start=h.querySelector('#model-trial-start').getBoundingClientRect();return {inline:Math.abs((title.top+title.bottom)-(button.top+button.bottom))<2,reloadInHeading:h.contains(document.querySelector('.trial-reload')),reloadLeft:button.left>title.right&&button.right<start.left};})()`);
 assert.deepEqual(header,{inline:true,reloadInHeading:true,reloadLeft:true});
 await evaluate(`document.querySelector('.trial-select').click()`);assert.equal(calls,0);
 await evaluate(`document.querySelector('[data-trial-id="CODE4"]').click();document.querySelector('[data-trial-id="CODE4"]').click()`);
 await until(`document.querySelectorAll('.trial-row .badge[data-state="実行中"]').length===12`);
 assert.equal(calls,1);assert.equal(await evaluate(`[...document.querySelectorAll('[data-trial-id]')].every(b=>b.disabled)`),true);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.trial-group-title')].map(h=>h.firstChild.textContent)`),['チャット','ライブ','入力予測','判断','コード','タスク','チーム']);
 const follow=await evaluate(`(()=>{const aside=document.querySelector('.model-trial-panel aside'),row=document.querySelector('.trial-row.selected').getBoundingClientRect(),box=aside.getBoundingClientRect();return {scrolled:aside.scrollTop>0,visible:row.top>=box.top&&row.bottom<=box.bottom};})()`);
 assert.deepEqual(follow,{scrolled:true,visible:true});
 await capture('pending-desktop');release();
 await until(`document.querySelectorAll('.trial-row .badge[data-state="OK"]').length===12`);
 assert.equal(calls,1);assert.ok(await evaluate(`document.querySelector('.trial-layout article').textContent.includes('会話履歴への保存を確認しました。')`),'成功した試行の結果説明を未実施と表示しない');await capture('result-desktop');
 const layouts=[];
 for(const [width,height] of [[768,1000],[390,844]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  const layout=await evaluate(`(()=>{const panel=document.querySelector('.model-trial-panel'),buttons=[...panel.querySelectorAll('button')];return {overflow:document.documentElement.scrollWidth>innerWidth||panel.scrollWidth>panel.clientWidth,noButtonWrap:buttons.every(b=>getComputedStyle(b).whiteSpace==='nowrap'||b.classList.contains('trial-select')),rowButtons:panel.querySelectorAll('[data-trial-id]').length};})()`);
  assert.equal(layout.overflow,false);assert.equal(layout.noButtonWrap,true);assert.equal(layout.rowButtons,16);layouts.push({width,height,...layout});await capture(`result-${width}`);
 }
 // 全7タブからランチャーへ切替え、元の選択へ戻る（実ブラウザ）。
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 for(const name of ['導入状況','モデル一覧','外部連携','設定モデル','AIモデル','システム起動','アプリ起動']){
  await evaluate(`[...document.querySelectorAll('.tabs button')].find(b=>b.textContent===${JSON.stringify(name)}).click()`);
  await evaluate(`document.querySelector('.title-mini-switch').click()`);await until(`!!document.querySelector('.start-mini')`);
  await evaluate(`document.querySelector('.mini-restore').click()`);await until(`!document.querySelector('.start-mini')`);
  assert.equal(await evaluate(`document.querySelector('.tabs button.active')?.textContent`),name);
 }
 assert.deepEqual(errors,[]);const result={tabs:['導入状況','モデル一覧','外部連携','設定モデル'],header,layouts,modelCalls:calls,keyCalls,scanCalls,errors,output};writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{
 release();ws?.close();chrome.kill();await trials.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sleep(300);
 if(!resolve(profile).startsWith(resolve(tmpdir())+sep))throw Error('不正な一時パス');
 try{rmSync(profile,{recursive:true,force:true});}catch{}
}
