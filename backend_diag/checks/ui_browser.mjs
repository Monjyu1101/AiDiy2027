// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 合成データのみの実ブラウザ回帰（任意）。実キー読取・外部モデル API 呼出は行わない。
// Playwright（playwright-core / playwright）は依存に含めない。実行ディレクトリか backend_diag から解決する。
// 例: npm i --no-save playwright-core && node backend_diag/checks/ui_browser.mjs   （CHROMIUM_PATH で既存ブラウザを指定可）
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync} from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
function loadPlaywright(){
 for(const base of [process.cwd(),path.join(here,'..')])for(const name of ['playwright-core','playwright']){
  try{return createRequire(path.join(base,'noop.js'))(name);}catch{}
 }
 console.error('Playwright が見つかりません。npm i --no-save playwright-core の後に再実行してください。');process.exit(2);
}
function findChromium(){
 if(process.env.CHROMIUM_PATH)return process.env.CHROMIUM_PATH;
 const names=process.platform==='win32'?['chromium.exe','chrome.exe']:['chromium','chromium-browser','google-chrome'];
 for(const folder of (process.env.PATH??'').split(path.delimiter))for(const name of names){const candidate=path.join(folder,name);if(folder&&existsSync(candidate))return candidate;}
 return undefined;
}
const {chromium}=loadPlaywright();
const server=spawn(process.execPath,[path.join(here,'ui-fixture.mjs')],{stdio:['ignore','pipe','inherit'],windowsHide:true});
const stop=()=>{if(server.exitCode===null)server.kill();};
process.on('exit',stop);
const port=Number(await new Promise(resolve=>createInterface({input:server.stdout}).once('line',resolve)));
const output=mkdtempSync(path.join(os.tmpdir(),'diag-ui-synthetic-'));
const browser=await chromium.launch({executablePath:findChromium(),headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1360,height:950}}),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(String(error)));page.on('request',request=>{if(!decodeURIComponent(request.url()).endsWith('/起動/ログ'))requests.push([request.method(),request.url()]);});
 await page.goto(`http://127.0.0.1:${port}/proxy/8097/#token=synthetic-ui-test`);await page.getByRole('button',{name:'導入状況',exact:true}).click();await page.waitForSelector('#list .item');assert.ok(!page.url().includes('#'));
 assert.equal(await page.locator('#list .item').count(),19);
 assert.ok(!requests.some(([method])=>method==='POST'));
 assert.ok(await page.locator('#install-write').isDisabled(),'write must wait for a completed check');
 // 全テスト: 全項目が確認中で回り、上から順に結果へ変わり、確認後に書き込む。
 await page.locator('#run').click();await page.locator('#list .badge[data-state="確認中"] .badge-spinner').first().waitFor();
 await page.waitForFunction(()=>!document.querySelector('#run').disabled&&document.querySelector('#install-write').textContent==='書込済'&&document.querySelector('#models-write').textContent==='書込済'&&!document.querySelector('#message'));
 assert.equal(await page.locator('#list .badge[data-state="確認中"]').count(),0);
 // 全テスト中は処理中の画面へタブが切り替わり、完了後は導入状況タブへ戻る。各画面とも1項目目を表示。
 assert.equal(await page.locator('nav.tabs button.active').innerText(),'導入状況');assert.equal(await page.locator('#detail h2').innerText(),'Python');
 assert.equal(await page.locator('.model-key-panel article h2').innerText(),'OpenAI API');assert.equal(await page.locator('.integration-panel article h2').innerText(),'Hugging Face 読取');
 assert.equal(await page.evaluate(()=>document.querySelector('#list').closest('aside').scrollTop),0);
 await page.locator('#list .item').filter({hasText:'Node.js'}).click();assert.equal(await page.locator('#detail h2').innerText(),'Node.js');
 await page.screenshot({path:path.join(output,'install.png'),fullPage:true});
 // スクロールは各パネルの一覧・詳細の内側だけ。ページ全体はスクロールしない。
 for(const size of [{width:1360,height:500},{width:390,height:700}]){
  await page.setViewportSize(size);
  const layout=await page.evaluate(()=>{const aside=document.querySelector('#list').closest('aside');return {page:document.documentElement.scrollHeight>innerHeight,aside:getComputedStyle(aside).overflowY,scrolls:aside.scrollHeight>aside.clientHeight,article:getComputedStyle(document.querySelector('#detail')).overflowY};});
  assert.deepEqual(layout,{page:false,aside:'auto',scrolls:true,article:'auto'},JSON.stringify(size));
 }
 await page.setViewportSize({width:1360,height:950});
 await page.getByRole('button',{name:'モデル一覧',exact:true}).click();await page.waitForSelector('.key-row');assert.equal(await page.locator('.key-row').count(),3);
 assert.ok((await page.locator('.key-row').first().innerText()).includes('OpenAI API'));
 assert.equal(await page.locator('.model-key-panel').getByText(/Azure|GitHub Copilot/).count(),0,'確認不要の項目は表示しない');
 assert.equal(await page.locator('.public-indicator').count(),1);assert.equal(await page.locator('.public-indicator').innerText(),'OK');
 // 全テストは状況確認→書込のあと、テストできる行だけ一覧再取得→モデル書込まで行う。
 const firstRun=requests.filter(([method])=>method==='POST').map(([,url])=>decodeURIComponent(url).split('/api/')[1]);
 assert.deepEqual(firstRun,['診断','書込','キーテスト/openai','キーテスト/openrt','モデル書込','キーテスト/discord','外部連携書込'],String(firstRun));
 await page.locator('.key-row').first().getByRole('button',{name:'テスト',exact:true}).click();await page.waitForSelector('.models li');assert.equal(await page.locator('.models li').last().innerText(),'<script>alert(1)</script>');
 assert.ok(await page.locator('.key-row').nth(1).getByRole('button',{name:'テスト'}).isDisabled());
 assert.ok((await page.locator('.model-meta').innerText()).includes('128000'));
 await page.screenshot({path:path.join(output,'keys.png'),fullPage:true});
 await page.getByRole('button',{name:'外部連携',exact:true}).click();assert.equal(await page.locator('.integration-row').count(),3);
 assert.equal(await page.locator('.integration-panel .public-indicator').count(),0);assert.equal(await page.locator('.integration-panel .models').count(),0);
 // 外部連携は行ごとの「テスト」だけで認証を確認する（全テスト・一覧再取得では実行しない）。
 assert.equal(await page.locator('.integration-row .integration-test button').count(),3);
 await page.locator('.integration-row').filter({hasText:'Discord Bot'}).locator('.key-select').click();assert.equal(await page.locator('.integration-panel article h2').innerText(),'Discord Bot');
 assert.ok((await page.locator('.integration-panel article').innerText()).includes('discord_bot_token'));
 await page.screenshot({path:path.join(output,'integrations.png'),fullPage:true});
 await page.getByRole('button',{name:'モデル一覧',exact:true}).click();assert.equal(await page.locator('.model-key-panel article h2').innerText(),'OpenAI API');
 await page.getByRole('button',{name:'外部連携',exact:true}).click();assert.equal(await page.locator('.integration-panel article h2').innerText(),'Discord Bot');
 await page.locator('#integration-run').click();await page.waitForFunction(()=>document.querySelectorAll('.models li').length===2&&document.querySelector('#integration-run').textContent==='状況確認');
 assert.equal(await page.locator('.integration-row').filter({hasText:'Discord Bot'}).locator('.badge').getAttribute('data-state'),'OK');
 // 状況確認が終わったら、1項目目を表示する。
 await page.locator('.integration-panel article h2',{hasText:'Hugging Face 読取'}).waitFor({timeout:5000});
 await page.getByRole('button',{name:'モデル一覧',exact:true}).click();assert.equal(await page.locator('.model-key-panel article h2').innerText(),'OpenAI API');
 // 一覧再取得: 設定を読み直し、テストできる行を上から順に取得して、選択（右側）も追従する。
 assert.equal(await page.locator('.model-key-panel').getByRole('button',{name:'設定状況を更新'}).count(),0);
 await page.locator('#latest-models').click();await page.waitForFunction(()=>document.querySelector('#latest-models').textContent==='一括取得'&&document.querySelectorAll('.key-row .key-test .badge[data-state="OK"]').length===2);
 // 取得が終わったら、1項目目を表示する。
 await page.locator('.model-key-panel article h2',{hasText:'OpenAI API'}).waitFor({timeout:5000});
 assert.equal(await page.evaluate(()=>document.querySelector('.model-key-panel aside').scrollTop),0);
 assert.ok(!await page.locator('.key-row').first().getByRole('button',{name:'テスト',exact:true}).isDisabled());
 // 再取得はキャッシュ利用時だけ表示する（ネットワーク取得済みでは出さない）。
 assert.equal(await page.locator('.public-retry').count(),0);
 await page.locator('#run').click();await page.waitForFunction(()=>!document.querySelector('#run').disabled);
 const posts=requests.filter(([method])=>method==='POST').map(([,url])=>url);assert.equal(posts.length,18,String(posts));assert.equal(posts.filter(url=>url.includes('%E6%9B%B8%E8%BE%BC')).length,6,String(posts));
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'horizontal overflow');
 await page.getByRole('button',{name:'外部連携',exact:true}).click();await page.screenshot({path:path.join(output,'mobile-integrations.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'external horizontal overflow');
 await page.reload();await page.waitForSelector('#login');assert.ok(await page.locator('#run').isDisabled());assert.deepEqual(errors,[]);
 console.log('PASS: Chromium Vue mount, strict CSP, prefix URL/auth hash removal, installation 19 items, detail, separated settings tabs and selection persistence, explicit-only tests, disabled unset key, escaped models, refresh invalidation, all-test scope, mobile, reload login. external disabled test/no model UI, model metadata; POST requests:',posts.length);
}finally{await browser.close();stop();}
console.log('Synthetic screenshots:',output);
