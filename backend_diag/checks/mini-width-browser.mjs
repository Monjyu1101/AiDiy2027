// 隔離したheadlessブラウザで配布CSSのミニ配置を確認。実Diag・サーバー・画像保存は使用しない。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
const executable=process.env.CHROME_PATH||[[process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'],[process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe']].filter(([base])=>base).map(([base,name])=>join(base,name)).find(existsSync)||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
assert.ok(executable,'既存Chrome/Edgeが必要です');
const profile=mkdtempSync(join(tmpdir(),'diag-start-browser-'));
const browser=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let ws;
try{
 let port;for(let i=0;i<100&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
 assert.ok(port,'ブラウザを起動できませんでした。');
 const page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
 let seq=0;const pending=new Map(),errors=[];
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){pending.get(message.id)?.(message);pending.delete(message.id);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise(resolve=>{pending.set(++seq,resolve);ws.send(JSON.stringify({id:seq,method,params}));});
 async function evaluate(expression){const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response));return response.result.result.value;}
 async function until(expression){for(let i=0;i<140;i++){if(await evaluate(expression))return;await sleep(50);}assert.fail(expression);}

 const css=readFileSync(new URL('../static/style.css',import.meta.url),'utf8');
 const buttons=(kind,n)=>Array.from({length:n},(_,i)=>`<button class="mini-${kind}-button"><span class="mini-icon-frame"><img width="40" height="40" alt="${i}"></span></button>`).join('');
 const title=`<header class="panel-brand desktop compact"><div class="launcher-selector"><button>アイコン化</button></div><strong>AiDiy ランチャー</strong><span class="window-actions">${['−','□','📌','×'].map(x=>`<button>${x}</button>`).join('')}</span></header><div class="connection-bar online"></div>`;
 const html=`<style>${css}</style><div id="app">${title}<section class="panel start-mini"><div class="mini-content"><div class="mini-app-launch"><div class="mini-app-buttons">${buttons('app',11)}</div><button class="mini-project-link mini-app-message required">SELECT YOUR PROJECT</button></div><div class="mini-cli-launch"><div class="mini-cli-buttons">${buttons('cli',8)}</div></div><div class="mini-services">${['Tools','Core','Apps','Task/Team','Web','Local'].map(x=>`<button class="mini-service"><span class="mini-name">${x}</span></button>`).join('')}</div></div></section></div>`;
 for(const scale of [1,1.25,1.5]){
  await send('Emulation.setDeviceMetricsOverride',{width:330,height:360,deviceScaleFactor:scale,mobile:false});
  await send('Page.setDocumentContent',{frameId:(await send('Page.getFrameTree')).result.frameTree.frame.id,html});
  const result=await evaluate(`(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
   const apps=[...document.querySelectorAll('.mini-app-button')].map(rect),cli=[...document.querySelectorAll('.mini-cli-button')].map(rect);
   return {apps,cli,overflow:document.documentElement.scrollWidth>innerWidth,height:document.querySelector('#app').scrollHeight,title:[...document.querySelector('.panel-brand').children].map(rect),hits:[...document.querySelectorAll('button')].every(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=330&&r.bottom<=360&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),icons:[...document.querySelectorAll('.mini-icon-frame')].every(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.x>=p.x&&r.right<=p.right&&r.bottom<=p.bottom})};
  })()`);
  assert.equal(result.overflow,false);assert.equal(result.hits,true);assert.equal(result.icons,true);
  assert.equal(result.apps.filter(r=>r.y===result.apps[0].y).length,6);
  assert.equal(result.cli.filter(r=>r.y===result.cli[0].y).length,6);
  assert.ok(result.title[0].right<=result.title[1].x&&result.title[1].right<=result.title[2].x);
  assert.ok(result.height<=360);console.log(JSON.stringify({scale,width:330,height:result.height,appWidth:result.apps[0].w,cliWidth:result.cli[0].w,clickTargets:'OK'}));
 }
}finally{ws?.close();browser.kill();assert.ok(resolve(profile).startsWith(resolve(tmpdir())+sep));for(let i=0;i<20;i++){try{rmSync(profile,{recursive:true,force:true});break;}catch{await sleep(100);}}}
