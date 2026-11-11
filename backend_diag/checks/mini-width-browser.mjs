// 隔離したheadlessブラウザで配布CSSのミニ配置を確認。実Diag・サーバー・画像保存は使用しない。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import miniWindow from '../起動/ミニ表示.cjs';
const require=createRequire(new URL('../ui/package.json',import.meta.url));
const {build}=require('esbuild'),{parse,compileScript}=require('@vue/compiler-sfc');
const {width:miniWidth,height}=miniWindow.ミニ寸法;
const {outputFiles:[fixture]}=await build({
 stdin:{resolveDir:fileURLToPath(new URL('../ui/',import.meta.url)),contents:`
 import {createApp,h,ref,nextTick} from 'vue';
 import Row from './src/components/アプリ起動/ミニアイコン列.vue';
 import {起動モーション} from './src/components/アプリ起動/起動モーション.mjs';
 const counts=ref([5,6]),clicks=[];
 window.fixture={counts:async(app,cli)=>{counts.value=[app,cli];await nextTick();},clicks};
 const icons=(kind,count)=>h(Row,{class:'mini-'+kind+'-buttons'},()=>Array.from({length:count},(_,i)=>
  h('button',{class:'mini-'+kind+'-button',key:i,onClick:event=>{clicks.push(i);起動モーション(event)();}},
   h('span',{class:'mini-icon-frame'},h('span',{class:'launch-frame launch-frame-36'},[
    h('span',String(i)),h('span',{class:'launch-trace'}),
   ])))));
 createApp({render:()=>[
  h('header',{class:'panel-brand desktop compact'},h('strong','AiDiy ランチャー')),
  h('div',{class:'connection-bar online'}),
  h('section',{class:'panel start-mini'},h('div',{class:'mini-content'},[
   h('div',{class:'mini-launch-scroll'},[
    h('div',{class:'mini-app-launch'},[icons('app',counts.value[0]),h('button',{class:'mini-app-message required mini-project-link'},'SELECT YOUR PROJECT')]),
    h('div',{class:'mini-cli-launch'},icons('cli',counts.value[1])),
   ]),
   h('div',{class:'mini-services'},['Tools','Core','Apps','Task/Team','Web','Local'].map(name=>h('button',{class:'mini-service'},name))),
  ])),
 ]}).mount('#app');`},
 bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"'},
 plugins:[{name:'vue',setup(build){build.onLoad({filter:/\.vue$/},({path})=>{
  const {descriptor}=parse(readFileSync(path,'utf8'),{filename:path});
  return{contents:compileScript(descriptor,{id:path,inlineTemplate:true}).content,loader:'js'};
 });}}],
});
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
 const setWidth=(width,deviceScaleFactor=1.875)=>send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor,mobile:false});
 await send('Runtime.enable');await setWidth(miniWidth);
 await send('Page.setDocumentContent',{frameId:(await send('Page.getFrameTree')).result.frameTree.frame.id,html:`<html class="desktop-window"><style>${css}</style><div id="app"></div>`});
 await evaluate(fixture.text);
 const state=()=>evaluate(`[...document.querySelectorAll('.mini-icon-track')].map(track=>{
  const rect=track.getBoundingClientRect(),buttons=[...track.children].map(el=>el.getBoundingClientRect());
  return {left:rect.left,y:rect.y+rect.height/2,width:rect.width,right:rect.right,frame:track.parentElement.getBoundingClientRect().toJSON(),
   overflow:track.hasAttribute('data-overflow'),positions:buttons.map(button=>button.left-rect.left),
   centered:Math.abs(buttons[0].left-rect.left-(rect.right-buttons.at(-1).right))<1,
   visible:buttons.filter(button=>button.left>=rect.left-.1&&button.right<=rect.right+.1).length,
   oneRow:buttons.every(button=>button.top===buttons[0].top)};
 })`);
 const stopMotion=()=>evaluate(`document.querySelectorAll('.mini-icon-track').forEach(track=>track.dispatchEvent(new PointerEvent('pointerenter')))`);
 const assertFullWidth=async()=>{
  for(const row of await state()){
   assert.ok(Math.abs(row.left-row.frame.left)<.1,'アイコン列は親の左端から表示する');
   assert.ok(Math.abs(row.right-row.frame.right)<.1,'アイコン列は端数幅を切り捨てず親の右端まで表示する');
  }
 };
 const assertHeight=async()=>assert.deepEqual(await evaluate(`[
  innerHeight,document.querySelector('.start-mini').clientHeight,
  document.querySelector('.mini-launch-scroll').scrollHeight-document.querySelector('.mini-launch-scroll').clientHeight,
  Math.round(document.querySelector('.mini-services').getBoundingClientRect().bottom),
 ]`),[height,height-36,0,height-1]);
 const fitted=await state();
 for(const row of fitted){assert.equal(row.overflow,false);assert.equal(row.centered,true);}
 await stopMotion();
 await evaluate('fixture.counts(9,9)');
 await until(`document.querySelectorAll('.mini-icon-track[data-overflow]').length===2`);
 for(const row of await state()){
  assert.equal(row.positions[0],0);assert.equal(row.visible,7);assert.equal(row.oneRow,true);
 }
 await assertHeight();
 await setWidth(400);
 await until(`document.querySelector('.mini-app-buttons').clientWidth===390`);
 await assertFullWidth();
 await setWidth(miniWidth);
 await until(`document.querySelector('.mini-app-buttons').clientWidth===350`);
 await evaluate(`document.querySelector('.mini-icon-track').dispatchEvent(new PointerEvent('pointerleave'))`);
 await until(`document.querySelector('.mini-icon-track').children[1].getBoundingClientRect().left-document.querySelector('.mini-icon-track').getBoundingClientRect().left<46`);
 await stopMotion();
 const [row]=await state(),x=row.left+140,y=row.y;
 const mouse=(type,x,buttons)=>send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1});
 const drag=async distance=>{
  await mouse('mouseMoved',x,0);await mouse('mousePressed',x,1);
  await mouse('mouseMoved',x+distance,1);await mouse('mouseReleased',x+distance,0);
 };
 await drag(40);
 const right=(await state())[0].positions[2];assert.ok(Math.abs(right-row.positions[2]-40)<1);
 await drag(-90);
 const left=(await state())[0].positions[2];assert.ok(Math.abs(left-right+90)<1);
 const wrapped=(await state())[0].positions[0];assert.ok(wrapped>250,'左端を過ぎたアイコンが右側へ回る');
 assert.deepEqual(await evaluate('fixture.clicks'),[]);
 await mouse('mouseMoved',x,0);await mouse('mousePressed',x,1);await mouse('mouseReleased',x,0);
 assert.equal(await evaluate('fixture.clicks.length'),1);
 await until(`document.querySelectorAll('.launch-active').length===1`);
 const paused=(await state()).map(row=>row.positions);
 await evaluate(`document.querySelectorAll('.mini-icon-track').forEach(track=>track.dispatchEvent(new PointerEvent('pointerleave')))`);
 await sleep(250);
 assert.deepEqual((await state()).map(row=>row.positions),paused,'光の演出中は上下2列ともポインターを離しても流れない');
 await until(`!document.querySelector('.launch-active')`);
 await until(`document.querySelector('.mini-icon-track').children[1].getBoundingClientRect().left-document.querySelector('.mini-icon-track').getBoundingClientRect().left!==${paused[0][1]}`);
 await stopMotion();
 for(const scale of [1,1.25,1.5,1.875]){
  await setWidth(410,scale);
  await until(`document.querySelector('.mini-icon-track').clientWidth===400`);
  await assertFullWidth();
  assert.ok((await state()).every(row=>row.overflow&&row.oneRow));
  await setWidth(460,scale);
  await until(`document.querySelectorAll('.mini-icon-track[data-overflow]').length===0`);
  assert.ok((await state()).every(row=>row.centered&&row.visible===9));
  await assertHeight();
 }
 assert.deepEqual(errors,[]);
 console.log('ミニ表示: 360×190、両行の中央揃えと左端開始、左方向の循環、左右ドラッグとクリック抑止、起動演出中の停止・再開、幅変更と倍率を確認。');
}finally{ws?.close();browser.kill();assert.ok(resolve(profile).startsWith(resolve(tmpdir())+sep));for(let i=0;i<20;i++){try{rmSync(profile,{recursive:true,force:true});break;}catch{await sleep(100);}}}
