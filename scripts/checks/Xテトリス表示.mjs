// 盤面200セル・NEXT16セルを描画したCSS配置の回帰。ゲーム実行・外部通信なし。
// ルートから node scripts/checks/Xテトリス表示.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=await import(pathToFileURL(join(runtime,'playwright-core/index.mjs')).href);
const browser=await chromium.launch({executablePath:join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),headless:true});
try {
 const html=(await readFile('frontend_web/public/Xテトリス/index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/@import[^;]+;/g,'');
 for (const [width,height] of [[1536,740],[1280,720],[800,600],[600,800],[390,844]]) {
  const page=await browser.newPage({viewport:{width,height}});await page.setContent(html);
  await page.evaluate(()=>{for(let i=0;i<200;i++){const c=document.createElement('div');c.className='tetris-cell';document.querySelector('.tetris-board').append(c)}for(let i=0;i<16;i++){const c=document.createElement('div');c.className='next-cell';document.querySelector('.next-piece').append(c)}});
  const d=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();return {boardBottom:r('.tetris-board').bottom,lastCellBottom:document.querySelector('.tetris-board').lastElementChild.getBoundingClientRect().bottom,controlsTop:r('.controls').top,sideBottom:r('.side-panel').bottom,scrollHeight:document.querySelector('.game-container').scrollHeight,clientHeight:document.querySelector('.game-container').clientHeight}});
  assert.ok(Math.max(d.boardBottom,d.lastCellBottom,d.sideBottom)<=d.controlsTop+1, `盤面/情報欄とボタンの重なり: ${width}x${height}`);
  const reachable=await page.evaluate(()=>{const box=document.querySelector('.game-container');box.scrollTop=box.scrollHeight;const button=document.querySelector('#reset-btn').getBoundingClientRect();const outer=box.getBoundingClientRect();return button.top>=outer.top&&button.bottom<=outer.bottom});
  assert.ok(reachable, `末尾ボタンへ到達不可: ${width}x${height}`);
  console.log(JSON.stringify({width,height,...d,pass:true,reachable}));await page.close();
 }
}finally{await browser.close()}
