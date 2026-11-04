// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実VS Code拡張ホストと実Webviewの外周・表示領域を検証する。AI要求は送らない。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const host=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(host,'../..');
const dir=await mkdtemp(join(tmpdir(),'aidiy-vscode-layout-')),output=join(repo,'temp/vscode-layout');
const runtime=process.env.AIDIY_TEST_PLAYWRIGHT_MODULE||join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');
const {chromium}=await import(pathToFileURL(runtime).href);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){for(let i=0;i<600;i++){try{const value=await check();if(value)return value;}catch{}await sleep(100);}throw Error('VS Code確認期限: '+label);}
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
await mkdir(join(dir,'profile/User'),{recursive:true});await mkdir(join(dir,'extensions'));await mkdir(join(dir,'workspace'));await mkdir(output,{recursive:true});
await writeFile(join(dir,'profile/User/settings.json'),JSON.stringify({'security.workspace.trust.enabled':false,'workbench.startupEditor':'none','telemetry.telemetryLevel':'off','update.mode':'none','workbench.secondarySideBar.defaultVisibility':'visible'}));
const env={...process.env,AIDIY_LAYOUT_TEST_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(join(process.env.PROGRAMFILES,'Microsoft VS Code/Code.exe'),['--new-window','--disable-extensions','--disable-gpu','--skip-welcome','--skip-release-notes',`--user-data-dir=${join(dir,'profile')}`,`--extensions-dir=${join(dir,'extensions')}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--extensionDevelopmentPath=${host}`,`--extensionDevelopmentPath=${join(host,'aidiy_live')}`,`--extensionTestsPath=${join(host,'checks/webview-layout-host.cjs')}`,join(dir,'workspace')],{env,windowsHide:false,stdio:'ignore'});
let browser;
try{
 await until(async()=>{const r=await fetch(`http://127.0.0.1:${port}/json/version`);return r.ok;},'デバッグ接続');
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
 for(const kind of ['code','live']){
  await until(async()=>await readFile(join(dir,'stage'),'utf8')===kind,kind+'表示');
  const find=async()=>{for(const context of browser.contexts())for(const page of context.pages())for(const frame of page.frames()){try{if(await frame.locator('.'+kind+'-component').isVisible())return {page,frame};}catch{}}};
  const {page,frame}=await until(find,kind+'実Webview');
  await frame.locator('.'+kind+'-component').waitFor({state:'visible'});await sleep(1200);
  const result=await frame.evaluate(()=>{
   const root=document.querySelector('.development-app'),component=document.querySelector('.ai-component'),style=getComputedStyle(root),child=getComputedStyle(component),r=root.getBoundingClientRect();
   const buttons=[...document.querySelectorAll('.composer button,.composer textarea')].filter(e=>e.getClientRects().length).map(e=>{const b=e.getBoundingClientRect();return {tag:e.tagName,left:b.left,right:b.right,top:b.top,bottom:b.bottom};});
   return {kind:root.className,host:root.classList.contains('vscode-host'),dpr:devicePixelRatio,zoom:style.zoom,border:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],color:style.borderTopColor,innerBorder:[child.borderTopWidth,child.borderRightWidth,child.borderBottomWidth,child.borderLeftWidth],box:{x:r.x,y:r.y,width:r.width,height:r.height},width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,buttons};
  });
  await writeFile(join(output,kind+'.json'),JSON.stringify(result,null,2));await page.screenshot({path:join(output,kind+'.png')});
  // Chromiumは端数DPIで1 CSS pxの境界を整数の描画ピクセルへ切り下げる。
  const border=Math.floor(result.dpr)/result.dpr;
  assert.equal(result.host,true);for(const value of result.border)assert.ok(Math.abs(parseFloat(value)-border)<.01,JSON.stringify(result));assert.equal(result.color,'rgb(56, 56, 56)');assert.deepEqual(result.innerBorder,['0px','0px','0px','0px']);
  assert.ok(Math.abs(result.box.x)<.1);assert.equal(result.box.y,0);assert.ok(Math.abs(result.box.width-result.width)<1);assert.ok(Math.abs(result.box.height-result.height)<1);assert.ok(result.scroll<=result.width);
  assert.ok(result.buttons.length>0,'入力・送信領域あり');for(const b of result.buttons){assert.ok(b.left>=border-.1&&b.right<=result.width-border+.1);assert.ok(b.top>=border-.1&&b.bottom<=result.height-border+.1);}
  console.log('VS Code '+kind+': 実Webviewの外周1px灰色・外寸・端の入力操作領域 OK');
  await writeFile(join(dir,kind+'-done'),'ok');
 }
 await until(async()=>await readFile(join(dir,'passed'),'utf8')==='ok','拡張ホスト終了');
 await until(()=>child.exitCode!==null,'VS Code終了');assert.equal(child.exitCode,0);
}finally{
 await browser?.close().catch(()=>{});if(child.exitCode===null)child.kill();
 assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
