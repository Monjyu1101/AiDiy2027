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
import {createServer} from '../diag/diag_main.mjs';
import {createModelTrials} from '../diag/モデル試行/trials.mjs';
const config={CODE_BASE_PATH:'/fixture/project',CHAT_AI_NAME:'freeai_chat',CHAT_FREEAI_MODEL:'saved-chat',LIVE_AI_NAME:'freeai_live',LIVE_FREEAI_MODEL:'saved-live',LIVE_FREEAI_VOICE:'Zephyr',DECISION_AI_NAME:'freeai_chat',DECISION_FREEAI_MODEL:'saved-decision',CODE_AI1_NAME:'codex_cli',CODE_AI1_MODEL:'saved-code'};
const calls=[],requests=[];let mode='ok',audioFailure=false,online=true;
function wav(ms){const n=ms*48,b=Buffer.alloc(44+n);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n,40);for(let i=0;i<n/2;i++)b.writeInt16LE(Math.sin(i/24000*440*Math.PI*2)*1000,44+i*2);return {mime:'audio/wav',duration_ms:ms,data_base64:b.toString('base64')};}
const trials=createModelTrials({credentialReader:async()=>null,installedClisFn:async()=>({}),reader:()=>JSON.stringify(config),statusFn:async()=>({online}),catalogReader:async name=>{
 if(name==='live_voices')return {freeai_live:{voices:{Zephyr:'Zephyr',Puck:'Puck'}}};
 const providers={chat_models:['freeai_chat','openai_chat'],live_models:['freeai_live'],decisions_models:['freeai_chat'],code_models:['codex_cli']};return Object.fromEntries((providers[name]||[]).map(p=>[p,{models:{'catalog-model':'カタログモデル'}}]));
},request:async o=>{
 if(o.method==='DELETE')return {body:null};
 const live=o.path==='/internal/live_model_check';
 if(!live&&o.body.method==='initialize')return {session:'mock',body:{jsonrpc:'2.0',id:o.id,result:{protocolVersion:'2024-11-05'}}};
 if(!live&&o.body.method==='notifications/initialized')return {body:null};
 const name=live?'live':o.body.params.name;calls.push({name,body:o.body});
 if(mode==='pending')await new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));
 if(live)return {body:{status:'OK',reply:'こんにちは。音声の合成応答です。',provider:'freeai_live',model:'resolved-live',...(mode==='none'?{}:{audio:wav(mode==='short'?500:1200)})}};
 let result={status:'OK',history_saved:true,result:'手動試行の合成応答です。',ai_name:name==='code_agents_run'?'codex_cli':'freeai_chat',ai_model:'resolved-chat',selected_model:'resolved-code'};
 if(name==='decisions_check'){
  if(mode==='raw')return {body:{jsonrpc:'2.0',id:o.id,result:{content:[{type:'text',text:'<script>window.__injected=1</script>\nJSONではない元応答'}]}}};
  const q=o.body.params.arguments.questions[0];result={status:'OK',message:'判断が完了しました',data:{ai_name:'freeai_chat',model:'resolved-decision',answers:[{type:'choice',name:q.name,choice:q.choices[0].value,confidence:1,probabilities:q.choices.map((c,i)=>({value:c.value,probability:i?0:1}))}],usage:{input_tokens:12,output_tokens:8}}};
 }
 return {body:{jsonrpc:'2.0',id:o.id,result:{structuredContent:{result:JSON.stringify(result)}}}};
}});
const originalAudio=trials.audio;trials.audio=id=>audioFailure?null:originalAudio(id);
const server=createServer({token:'manual-fixture',modelTrials:trials,toolsStatusFn:async()=>({online}),publicCache:{snapshot:()=>({}),input:()=>({})}});
server.on('request',req=>requests.push({url:decodeURIComponent(req.url),method:req.method}));
const executable=process.env.CHROME_PATH||[[process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'],[process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe']].filter(([base])=>base).map(([base,name])=>join(base,name)).find(existsSync);
assert.ok(executable,'既存Chrome/Edgeが必要です');await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=mkdtempSync(join(tmpdir(),'diag-manual-browser-')),output=resolve(process.env.DIAG_SCREENSHOT_DIR||'temp/diag-manual-browser');mkdirSync(output,{recursive:true});
const chrome=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
 let port;for(let i=0;i<100&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}assert.ok(port);
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let seq=0;const pending=new Map(),errors=[];ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(r=>{pending.set(++seq,r);ws.send(JSON.stringify({id:seq,method,params}));});
 async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(result.result?.exceptionDetails,undefined,JSON.stringify(result));return result.result.result.value;}
 async function until(expression){for(let i=0;i<120;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail(expression);}
 const panel='.ai-model-panel',q=selector=>`document.querySelector(${JSON.stringify(selector)})`;
 async function family(name){await evaluate(`[...document.querySelectorAll('.ai-model-tabs button')].find(b=>b.textContent==='${name.toUpperCase()}').click()`);}
 async function set(label,value,type='change'){await evaluate(`(()=>{const e=${q(`${panel} [aria-label="${label}"]`)};e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('${type}',{bubbles:true}));})()`);}
 async function run(){
  const selected=await evaluate("document.querySelector('.ai-model-tabs .active').textContent"),before=calls.length;
  await evaluate(`${q('#ai-model-start')}.click()`);await until(`${q('#ai-model-start')}.textContent==='動作確認'&&!${q('#ai-model-start')}.disabled`);
  assert.equal(await evaluate(`${q(`${panel} [role="status"]`)}?.textContent`),'一括試行が完了しました。');
  assert.deepEqual(calls.slice(before).map(c=>c.name),['chat_llms_run','live','decisions_check','code_agents_run']);
  assert.equal(await evaluate("document.querySelector('.ai-model-tabs .active').textContent"),'CHAT');
  if(selected!=='CHAT')await family(selected);
  if(selected==='LIVE'&&mode==='ok'&&!audioFailure)assert.equal(await evaluate(`Boolean(${q('.ai-model-audio button')})`),false,'通常は音声の手動再読込不要');
 }
 async function capture(name){const result=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(result.result.data,'base64'));}
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*']});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__revoked=[];window.__paused=0;const revoke=URL.revokeObjectURL;URL.revokeObjectURL=function(url){window.__revoked.push(url);return revoke.call(this,url)};const pause=HTMLMediaElement.prototype.pause;HTMLMediaElement.prototype.pause=function(){window.__paused++;return pause.call(this)};`});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/#token=manual-fixture`});
 for(const motion of ['reduce','no-preference']){
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:motion}]});
 await until("document.querySelector('.connection-bar.online')?.getAnimations().length===1");
 const cyanSamples=await evaluate(`(()=>{const bar=document.querySelector('.connection-bar.online'),animation=bar.getAnimations()[0];animation.pause();return [0,562.5,1125,2250,3375,4500].map(time=>{animation.currentTime=time;return {color:getComputedStyle(bar).backgroundColor,opacity:getComputedStyle(bar).opacity};});})()`);
 assert.deepEqual(cyanSamples.map(s=>s.color),['rgb(0, 0, 0)','rgb(0, 98, 98)','rgb(0, 180, 180)','rgb(0, 255, 255)','rgb(0, 180, 180)','rgb(0, 0, 0)']);
 assert.ok(cyanSamples.every(s=>s.opacity==='1'));
 await evaluate("document.querySelector('.connection-bar').getAnimations()[0].currentTime=2250");await capture('cyan-peak');
 await evaluate("(()=>{const a=document.querySelector('.connection-bar').getAnimations()[0];a.currentTime=0;a.play();})()");
 await sleep(500);
 const moving=await evaluate("(()=>{const bar=document.querySelector('.connection-bar'),a=bar.getAnimations()[0];return {time:a.currentTime,state:a.playState,color:getComputedStyle(bar).backgroundColor};})()");
 assert.equal(moving.state,'running',motion);assert.ok(moving.time>100,motion);assert.notEqual(moving.color,'rgb(0, 0, 0)',motion);
 }

 await until(`[...document.querySelectorAll('.tabs button')].some(b=>b.textContent==='AIモデル'&&!b.disabled)`);await evaluate(`[...document.querySelectorAll('.tabs button')].find(b=>b.textContent==='AIモデル').click()`);await until(`${q(`${panel} [aria-label="モデル"]`)}.value==='saved-chat'`);
 assert.equal(calls.length,0);assert.equal(await evaluate(`${q('#run')}.textContent`),'一括試行');
 for(const [f,model] of [['CHAT','saved-chat'],['LIVE','saved-live'],['DECISION','saved-decision'],['CODE','saved-code']]){await family(f);assert.equal(await evaluate(`${q(`${panel} [aria-label="モデル"]`)}.value`),model);assert.equal(await evaluate(`${q(`${panel} [aria-label="自由プロンプト"]`)}.value`),'おはよう');}
 await family('CHAT');let count=requests.filter(r=>!r.url.includes('tools-status')).length;await set('プロバイダ','openai_chat');await set('モデル','catalog-model');await set('プロバイダ','freeai_chat');await sleep(150);assert.equal(requests.filter(r=>!r.url.includes('tools-status')).length,count);assert.equal(calls.length,0);
 await run();await capture('chat-1280');await family('LIVE');await run();await until(`${q(`${panel} audio`)}?.readyState>=1`);assert.equal(await evaluate(`${q(`${panel} audio`)}.controls`),true);assert.ok(await evaluate(`${q(`${panel} audio`)}.duration>=1`));await evaluate(`${q(`${panel} audio`)}.muted=true;${q(`${panel} audio`)}.play()`);await until(`${q(`${panel} audio`)}.currentTime>0||${q(`${panel} audio`)}.ended`);await capture('live-1280');
 const revoked=await evaluate('window.__revoked.length');await family('DECISION');assert.equal(await evaluate('window.__revoked.length'),revoked);assert.ok(await evaluate('window.__paused')>0);assert.equal(await evaluate(`${q(`${panel} audio`)}===null`),true);await run();assert.match(await evaluate(`${q('.ai-model-reply')}.textContent`),/\n  "status": "OK"/);assert.match(await evaluate(`${q('.ai-model-reply')}.textContent`),/"usage"/);await capture('decision-1280');
 mode='raw';await run();assert.match(await evaluate(`${q('.ai-model-reply')}.textContent`),/<script>/);assert.equal(await evaluate('window.__injected||null'),null);mode='ok';await family('CODE');await run();await capture('code-1280');
 await evaluate(`window.__batchTabs=[];window.__batchObserver=new MutationObserver(()=>{const name=document.querySelector('.ai-model-tabs .active')?.textContent;if(name&&window.__batchTabs.at(-1)!==name)window.__batchTabs.push(name)});window.__batchObserver.observe(document.querySelector('.ai-model-tabs'),{subtree:true,attributes:true,attributeFilter:['class']});`);
 const before=calls.length;await evaluate(`${q('#run')}.click();${q('#run')}.click()`);await until(`${q(`${panel} [role="status"]`)}?.textContent==='一括試行が完了しました。'`);assert.deepEqual(calls.slice(before).map(c=>c.name),['chat_llms_run','live','decisions_check','code_agents_run']);assert.deepEqual(await evaluate('window.__batchTabs'),['CHAT','LIVE','PREDICTION','DECISION','CODE','CHAT']);await evaluate('window.__batchObserver.disconnect()');await family('LIVE');assert.equal(await evaluate(`Boolean(${q('.ai-model-audio button')})`),false);await until(`${q(`${panel} audio`)}?.readyState>=1`);
 const audioRequests=requests.filter(r=>r.url.includes('/音声/')).length,modelCalls=calls.length;
 const audioSrc=await evaluate(`${q(`${panel} audio`)}.src`);
 for(const name of ['設定モデル','AIモデル'])await evaluate(`[...document.querySelectorAll('.tabs button')].find(b=>b.textContent==='${name}').click()`);
 await until(`${q(`${panel} audio`)}?.readyState>=1`);assert.equal(await evaluate(`${q(`${panel} audio`)}.src`),audioSrc);
 assert.equal(requests.filter(r=>r.url.includes('/音声/')).length,audioRequests);assert.equal(calls.length,modelCalls,'タブ往復でモデルを再実行しない');
 for(const [width,height] of [[720,1000],[390,844]]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false);await capture(`live-${width}`);await evaluate(`${q('.ai-model-audio')}.scrollIntoView({block:'center'})`);await capture(`live-output-${width}`);}
 mode='short';await run();assert.equal(await evaluate(`${q(`${panel} audio`)}===null`),true);assert.match(await evaluate(`${q('.ai-model-audio')}.textContent`),/1秒以上/);mode='none';await run();assert.equal(await evaluate(`${q(`${panel} audio`)}===null`),true);
 mode='ok';audioFailure=true;await run();await until(`${q('.ai-model-audio')}.textContent.includes('取得できません')`);audioFailure=false;await evaluate(`${q('.ai-model-audio button')}.click()`);await until(`${q(`${panel} audio`)}?.readyState>=1`);
 mode='pending';const startCount=calls.length;await evaluate(`${q('#ai-model-start')}.click()`);for(let i=0;i<100&&calls.length===startCount;i++)await sleep(20);await set('自由プロンプト','変更で中止','input');await until(`${q('#ai-model-start')}.textContent==='動作確認'`);mode='ok';assert.equal(await evaluate(`${q(`${panel} audio`)}===null`),true);
 assert.deepEqual(errors,[]);const result={passed:true,calls:calls.map(c=>c.name),requests:requests.length,layouts:[1280,720,390],audioPlayback:true,revoked:await evaluate('window.__revoked.length'),paused:await evaluate('window.__paused'),noSelectionRequests:true,errors};writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{ws?.close();chrome.kill();await trials.close();server.closeAllConnections();await new Promise(r=>server.close(r));await sleep(300);if(!resolve(profile).startsWith(resolve(tmpdir())+sep))throw Error('invalid profile');try{rmSync(profile,{recursive:true,force:true});}catch{}}
