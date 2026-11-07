// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue・実Navigation APIを通すstep-4。AI応答だけを合成し、Codeは開かない。
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';

const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const fixed=items=>items.map(({id,name,reason,weight,weightReason})=>({id,name,reason,weight,weightReason}));
function jsonFiles(directory){
 if(!existsSync(directory))return [];
 return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const file=join(directory,entry.name);
  return entry.isDirectory()?jsonFiles(file):entry.name.endsWith('.json')?[file]:[];
 });
}
function projectHashes(project){
 return Object.fromEntries(readdirSync(project).filter(name=>statSync(join(project,name)).isFile()).map(name=>[name,createHash('sha256').update(readFileSync(join(project,name))).digest('hex')]));
}
async function screenshot(port,targetId){
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const target=targets.find(item=>item.id!==targetId&&item.type==='page'&&item.title.includes('Navigator'));
 if(!target)throw Error('Navigatorの撮影対象がありません。');
 const socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
 try{
  const response=await new Promise((done,reject)=>{
   const timer=setTimeout(()=>reject(Error('撮影タイムアウト')),10000);
   socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id===1){clearTimeout(timer);done(message);}});
   socket.send(JSON.stringify({id:1,method:'Page.captureScreenshot',params:{format:'png'}}));
  });
  assert.equal(response.error,undefined);return Buffer.from(response.result.data,'base64');
 }finally{socket.close();}
}

export function createNavigationScreenRecord({name,temporary,project,stateRoot,progress=false}){
 const output=resolve(process.env.AIDIY_TEST_NAVIGATION_STEP4_OUTPUT||'temp/navigation-step4-check',name);
 mkdirSync(output,{recursive:true});
 const mockCalls=[],beforeProject=projectHashes(project);
 let context;
 const write=(name,data)=>writeFileSync(join(output,name),JSON.stringify(data,null,2)+'\n','utf8');
 async function readAPI(){
  const response=await fetch(new URL('/api/navigation?instance=navi-1',context.app.url));
  return {status:response.status,data:await response.json()};
 }
 async function capture(stage,error){
  const directory=join(output,stage);mkdirSync(directory,{recursive:true});
  const snapshot={stage,timestamp:new Date().toISOString(),error:error?{message:error.message,stack:error.stack}:null,mockCalls,agentInvocations:mockCalls.length||context?.getAiCalls?.()||0,projectHashes:projectHashes(project)};
  try{snapshot.api=await readAPI();}catch(e){snapshot.apiError=e.message;}
  try{snapshot.network=await context.evaluate('window.__navigationTestNetwork||[]');}catch(e){snapshot.networkError=e.message;}
  try{
   snapshot.windows=await context.evaluate(`(window.testNavi||[]).map(w=>{if(!w||w.closed)return {closed:true};const d=w.document;return {closed:false,title:d.title,text:d.body.innerText,html:d.documentElement.outerHTML,
    errors:[...d.querySelectorAll('.navigation-error,.navigation-unavailable,dialog[open]')].map(e=>e.textContent),
    legacyMark:!!d.querySelector('.mark-escape'),itemBars:d.querySelectorAll('.navigation-items .navigation-progress').length,allBars:d.querySelectorAll('.navigation-progress').length,
    network:w.__navigationTestNetwork||[]};})`);
   for(const [index,window] of snapshot.windows.entries())if(window.html)writeFileSync(join(directory,`window-${index+1}.html`),window.html,'utf8');
  }catch(e){snapshot.domError=e.message;}
  try{snapshot.browserErrors=context.errors;}catch{}
  snapshot.saved=[];
  for(const file of jsonFiles(stateRoot)){
   const name=relative(stateRoot,file),saved=JSON.parse(readFileSync(file,'utf8'));
   snapshot.saved.push({path:name,data:saved});
   const destination=join(directory,'saved',name);mkdirSync(resolve(destination,'..'),{recursive:true});writeFileSync(destination,JSON.stringify(saved,null,2)+'\n','utf8');
  }
  try{writeFileSync(join(directory,'screen.png'),await screenshot(context.port,context.target.id));}catch(e){snapshot.screenshotError=e.message;}
  writeFileSync(join(directory,'snapshot.json'),JSON.stringify(snapshot,null,2)+'\n','utf8');
  return snapshot;
 }
 return {
  output,mockCalls,bind(value){context=value;},capture,
  // 再評価は出力形式に含まれる保存済み固定情報を保持し、progressだけを変更する。
  async respond(prompt){
   const shape=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1).replace(/^出力形式: /,''));
   const evaluating=prompt.includes('\n保存済み: '),values=progress?(evaluating?[50,80,100]:[0,50,100]):(evaluating?[85,70]:[65,20]);
   const request=structuredClone(shape);
   if(!evaluating)shape.items=[
    {id:'one',name:'検索画面の入力を整える',reason:'入力欄を確認。空入力の検証を次に行います。'},
    {id:'two',name:'操作ガイドを整える',reason:'既存の章に追記する方針です。'},
    ...(progress?[{id:'three',name:'長い項目名でも縮小窓で折り返して読めることを確認する',reason:'表示確認用の模擬結果です。'}]:[]),
   ].map((item,index)=>({...item,weight:(progress?[60,30,10]:[80,20])[index],weightReason:'表示試験用の作業量見積もり'}));
   shape.schemaVersion=3;shape.items=shape.items.map((item,index)=>({...item,progress:values[index]}));
   shape.overall={progress:Math.round(shape.items.reduce((sum,item)=>sum+item.weight*item.progress,0)/100),reason:evaluating?'再評価で更新した達成度に基づく加重評価の模擬結果':'作業量に基づく加重評価の模擬結果'};
   shape.nextItemId=shape.items.find(item=>item.progress<100)?.id??null;
   shape.nextPrompt=shape.nextItemId?(evaluating?'再評価後の検索画面を確認し、残りの空入力検証を進めてください。':'検索画面の空入力とエラー表示を確認し、必要なテストを追加してください。'):'';
   mockCalls.push({action:evaluating?'evaluate':'navigate',request,response:structuredClone(shape)});write('mock-calls.json',mockCalls);
   await sleep(300);return {content:JSON.stringify(shape)};
  },
  async run(){
   const {child,errors,evaluate}=context;
   // fetchは実APIへ通し、画面が送受信した内容だけを複製する。
   // Vueは親で生成したままDOMだけを別窓へ移すため、通信のglobalは所有IDEにある。
   await evaluate(`(()=>{const original=window.fetch.bind(window);window.__navigationTestNetwork=[];window.fetch=async(input,options)=>{const response=await original(input,options);if(String(input).includes('/api/navigation')){const entry={url:String(input),method:options?.method||'GET',request:options?.body?JSON.parse(options.body):null,status:response.status};try{entry.response=await response.clone().json();}catch(error){entry.error=error.message;}__navigationTestNetwork.push(entry);}return response;};})()`);
   const ui=()=>child(0,`(()=>{const panel=document.querySelector('.navigation-panel');return {goal:panel.querySelector('textarea').value,items:[...panel.querySelectorAll('.navigation-items .navigation-progress')].map(e=>({name:e.getAttribute('aria-label'),progress:Number(e.getAttribute('aria-valuenow')),width:e.style.getPropertyValue('--progress-width')})),overall:Number(panel.querySelector('.navigation-overall [role=progressbar]')?.getAttribute('aria-valuenow')),prompt:panel.querySelector('.navigation-prompt')?.textContent,running:!!panel.querySelector('.navigation-display.running'),errors:[...panel.querySelectorAll('.navigation-error')].map(e=>e.textContent)};})()`);
   async function until(check,label){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await sleep(100);}throw Error('step-4待機タイムアウト: '+label);}
   const validate=(snapshot,display)=>{
    assert.equal(snapshot.api.status,200);const value=snapshot.api.data.result;
    assert.equal(snapshot.api.data.job.status,'complete');assert.equal(value.schemaVersion,3);
    for(const item of value.items){assert.ok(Number.isInteger(item.progress)&&item.progress>=0&&item.progress<=100);assert.ok(Number.isInteger(item.weight)&&item.weight>=1&&item.weight<=100);}
    assert.equal(value.items.reduce((sum,item)=>sum+item.weight,0),100);
    assert.ok(Number.isInteger(value.overall.progress)&&value.overall.progress>=0&&value.overall.progress<=100);
    assert.equal(value.overall.progress,Math.round(value.items.reduce((sum,item)=>sum+item.weight*item.progress,0)/100));
    const latest=snapshot.saved.filter(item=>item.path.endsWith('latest.json')),history=snapshot.saved.filter(item=>item.path.endsWith(value.navigationId+'.json'));
    assert.equal(latest.length,1);assert.equal(history.length,1);assert.deepEqual(latest[0].data,value);assert.deepEqual(history[0].data,value);
    assert.deepEqual(display.items.map(item=>item.progress),value.items.map(item=>item.progress));
    assert.deepEqual(display.items.map(item=>item.name),value.items.map(item=>item.name));
    assert.deepEqual(display.items.map(item=>item.width),value.items.map(item=>item.progress+'%'));
    assert.equal(display.overall,value.overall.progress);assert.equal(display.goal,value.goal);assert.equal(display.prompt,value.nextPrompt);assert.deepEqual(display.errors,[]);assert.equal(display.running,false);
    return value;
   };
   async function waitResult(previous){
    await until(async()=>{
     const api=await readAPI();assert.equal(api.status,200);
     if(api.data.job?.status==='failed')throw Error('Navigation API失敗: '+api.data.job.message);
     if(api.data.job?.status!=='complete'||api.data.result?.requestId===previous)return false;
     const display=await ui();return !display.running&&display.items.length===(progress?3:2)&&display.overall===api.data.result.overall.progress;
    },previous?'再評価の保存と画面反映':'ナビ作成の保存と画面反映');
   }
   await until(()=>child(0,`!!document.querySelector('.navigation-start:not(:disabled)')`),'実行可否');
   assert.equal(mockCalls.length,0);const initial=await capture('initial');assert.equal(initial.api.data.result,null);assert.equal(initial.saved.filter(item=>item.path.endsWith('latest.json')).length,0);
   await child(0,`(()=>{const input=document.querySelector('.navigation-goal-form textarea');input.value='検索画面を整える';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.navigation-start').click();})()`);
   await waitResult(null);const created=await capture('created'),createdUI=await ui(),before=validate(created,createdUI);
   assert.equal(mockCalls.length,1);assert.deepEqual(before.items.map(item=>item.progress),progress?[0,50,100]:[65,20]);
   await until(()=>child(0,`!!document.querySelector('.navigation-evaluate:not(:disabled)')`),'再評価ボタン');
   await child(0,`document.querySelector('.navigation-evaluate').click()`);
   await waitResult(before.requestId);const evaluated=await capture('evaluated'),evaluatedUI=await ui(),after=validate(evaluated,evaluatedUI);
   assert.equal(mockCalls.length,2);assert.deepEqual(after.items.map(item=>item.progress),progress?[50,80,100]:[85,70]);
   assert.deepEqual(fixed(before.items),fixed(after.items));assert.deepEqual(fixed(mockCalls[1].request.items),fixed(before.items));
   assert.equal(after.goal,before.goal);assert.equal(after.navigationId,before.navigationId);assert.equal(after.createdAt,before.createdAt);assert.notEqual(after.requestId,before.requestId);
   assert.equal(evaluated.saved.filter(item=>item.path.includes('history')).length,1);
   const posts=evaluated.network.filter(item=>item.method==='POST');
   assert.deepEqual(posts.map(item=>item.request.action),['navigate','evaluate']);assert.deepEqual(posts.map(item=>item.status),[202,202]);
   assert.equal(posts[0].response.job.id,before.requestId);assert.equal(posts[1].response.job.id,after.requestId);
   assert.equal(evaluated.network.some(item=>item.url.includes('/api/navigation/code')),false);
   assert.deepEqual(created.windows[0].errors,[]);assert.deepEqual(evaluated.windows[0].errors,[]);
   assert.deepEqual(projectHashes(project),beforeProject);assert.deepEqual(errors,[]);
   const result={pass:true,scope:'step-4 mock AI screen creation and evaluation',timestamp:new Date().toISOString(),mockCalls:mockCalls.length,realAI:'not invoked',realCode:'not opened',
    fixedFields:['id','name','reason','weight','weightReason'],fixedFieldsUnchanged:true,goalUnchanged:true,navigationIdUnchanged:true,
    before:{items:before.items,overall:before.overall},after:{items:after.items,overall:after.overall},ui:{created:createdUI,evaluated:evaluatedUI},
    projectUnchanged:true,skipped:['model dialog','second window isolation','scenery animation','history selection UI','VR','window dimensions','real AI quality']};
   write('result.json',result);console.log(JSON.stringify(result));return result;
  },
 };
}
