// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'../ui/src',name),'utf8');
test('Vue component source and precompiled runtime use no remote scripts or unsafe eval',()=>{
 const app=source('App.vue');assert.match(app,/導入状況\/導入状況パネル\.vue/);assert.match(app,/モデル一覧パネル/);
 const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8').replace(/^(<!doctype html>\r?\n)?<!-- COPYRIGHT \(C\)[\s\S]*?-->\r?\n/i,'$1');assert.match(html,/src="app.js"/);assert.doesNotMatch(html,/https?:|unpkg|cdn/);
 const js=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');assert.doesNotMatch(js,/new Function\(|eval\(/);
});
test('all-tests and install panel share only installation action, key tests require explicit row action',()=>{
 const app=source('App.vue');const install=source('components/導入状況/導入状況状態.mjs');
 assert.match(install,/api\/診断/);assert.doesNotMatch(install,/キーテスト|testKey|loadKeys/);
 assert.match(app,/<button id="run"[^>]*@click="tab==='start'\?起動\.一括操作\(\):tab==='manual'\?手動\.開始\(true\):全診断\(\)"/);assert.match(app,/async function 全診断\(\)\{if\([^;]*操作中\.value\|\|全診断中\.value[^;]*keyTesting\.value[^;]*\)return;全診断中\.value=true;try\{tab\.value='install';if\(!await 全テスト\(\)\)return;tab\.value='keys';await 一覧再取得\(\);await モデル書込\(\);tab\.value='integrations';await 外部連携確認\(\{再読込:false\}\);await 外部連携書込\(\);tab\.value='install';\}finally\{全診断中\.value=false;\}\}/);
 assert.match(app,/@確認="状況確認"/);assert.match(app,/@書込="書込"/);assert.match(install,/全テスト\(\) \{ return await 状況確認\(\) && await 書込\(\); \}/);assert.match(app,/@test="testKey"/);
 assert.match(app,/onMounted\(\(\)=>\{if\(key.value\)connect\(\);\}\)/);
 assert.match(source('components/モデル一覧/モデル一覧パネル.vue'),/まだモデルを取得していません/);
});
test('auth uses only scoped session storage with relative API and clears stale key results',()=>{
 const app=source('App.vue');assert.match(app,/history.replaceState/);assert.match(app,/new URL\(path,location.href\)/);assert.match(app,/credentials:'same-origin'/);const auth=source('components/ウィンドウ/認証セッション.mjs');assert.doesNotMatch(app+auth,/localStorage/);assert.match(auth,/globalThis\.sessionStorage/);assert.match(auth,/location\.origin\+location\.pathname/);assert.match(app,/認証セッション\.保存/);assert.match(app,/response\.status===401[^]*認証セッション\.破棄/);
 const state=source('components/キー設定共通/キー設定状態.mjs');assert.match(state,/if\(対象==='all'\)keyData.value=null;keyResults.value=保持/);assert.match(state,/generation!==keyGeneration/);
 assert.match(state,/generation===keyGeneration/);
 assert.match(app,/response.status===401/);
});
test('states and safe text interpolation preserve hierarchy and model text rendering',()=>{
 const install=source('components/導入状況/導入状況パネル.vue')+source('components/導入状況/導入状況表示.mjs');for(const label of ['未確認','ベース','CLI群','その他拡張'])assert.ok(install.includes(label));
 const keys=source('components/モデル一覧/モデル一覧パネル.vue');assert.match(keys,/\{\{model\}\}/);assert.match(keys,/未実施/);assert.match(source('components/キー設定共通/キー設定表示.mjs'),/設定済/);assert.match(source('components/キー設定共通/キー設定表示.mjs'),/未設定/);
 assert.doesNotMatch(source('App.vue')+install+keys,/v-html|innerHTML/);
 const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../診断/catalog.json'),'utf8'));assert.equal(catalog.length,19);assert.deepEqual(catalog.filter(e=>e.menuGroup==='ベース').map(e=>e.name),['Python','uv','Node.js','npm','npx','Electron']);
});
test('checked-in compiled assets match current Vue sources',async()=>{const {verify}=await import('../ui/verify.mjs');assert.equal(await verify(),true);});
test('source edits and altered bundle invalidate deployment manifest',async()=>{
 const os=require('node:os');const {pathToFileURL}=require('node:url');const folder=fs.mkdtempSync(path.join(os.tmpdir(),'diag-build-sync-'));
 try{for(const name of ['コード/パネル表示切替.vue','コード/パネル切替ドラッグ.js','共通表示/パネル折り畳み.js']){const dest=path.join(folder,'frontend_ide/src/components',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(__dirname,'../../frontend_ide/src/components',name),dest);}const root=path.join(__dirname,'..'),diag=path.join(folder,'backend_diag');fs.cpSync(path.join(root,'ui'),path.join(diag,'ui'),{recursive:true,filter:file=>!file.split(path.sep).includes('node_modules')});fs.cpSync(path.join(root,'static'),path.join(diag,'static'),{recursive:true});fs.cpSync(path.join(root,'runtime'),path.join(diag,'runtime'),{recursive:true});fs.mkdirSync(path.join(diag,'モデル試行'),{recursive:true});fs.copyFileSync(path.join(root,'モデル試行/defaults.mjs'),path.join(diag,'モデル試行/defaults.mjs'));fs.cpSync(path.join(root,'icons'),path.join(diag,'icons'),{recursive:true});
 const {verify}=await import(pathToFileURL(path.join(diag,'ui/verify.mjs')));assert.equal(await verify(),true);
 const palette=path.join(diag,'ui/src/components/共通表示/タイトルバー配色.css'),paletteSource=fs.readFileSync(palette);fs.appendFileSync(palette,'\n/* stale local palette */\n');assert.equal(await verify(),false);fs.writeFileSync(palette,paletteSource);assert.equal(await verify(),true);
 const app=path.join(diag,'ui/src/App.vue'),original=fs.readFileSync(app);fs.appendFileSync(app,'\n<!-- stale source -->\n');assert.equal(await verify(),false);fs.writeFileSync(app,original);
 fs.appendFileSync(path.join(diag,'static/app.js'),'\n// changed bundle\n');assert.equal(await verify(),false);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('config key order and public acquisition status are separate from tests with no router prerequisite',async()=>{
 const app=source('App.vue'),panel=source('components/モデル一覧/モデル一覧パネル.vue');const {KEY_PROVIDERS}=await import('../モデル情報/key_status.mjs');assert.deepEqual(KEY_PROVIDERS.slice(0,9).map(row=>row.id),['gemini','freeai','claude','openai','openai_oauth','grok','azure','copilot','openrt_chat']);
 assert.match(panel,/公開モデル一覧取得: <component :is="状態バッジ" class="public-indicator" :state="公開状態"\/>/);const view=source('components/モデル一覧/モデル一覧表示.mjs');assert.match(view,/取得元 === 'キャッシュ' \? 'キャッシュ利用' : 'OK'/);
 assert.doesNotMatch(app+panel,/prerequisite|先に実行してください|OpenRouter を選択/);assert.match(panel,/public-indicator/);const state=source('components/キー設定共通/キー設定状態.mjs');assert.match(state,/api\/公開モデル/);assert.match(state,/Number\(data.世代\)>=Number\(publicModels.value.世代\)/);assert.match(app,/response.status===401&&key.value===requestKey\)\{認証セッション\.破棄\(\);設定を破棄\(\)/);assert.match(state,/generation!==publicGeneration/);
});
test('Vue templates never use non-ASCII component tags (rendered as raw text); use <component :is>',()=>{
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):entry.name.endsWith('.vue')?[path.join(dir,entry.name)]:[]);
 for(const file of walk(path.join(__dirname,'../ui/src'))){
  const template=(fs.readFileSync(file,'utf8').match(/<template>([\s\S]*)<\/template>/)||['',''])[1];
  assert.doesNotMatch(template,/<\/?[^\x00-\x7F]/,path.relative(path.join(__dirname,'..'),file));
 }
});
test('all-tests button sits at the end of the tab bar without the scope caption',()=>{
 const app=source('App.vue');const tabs=app.match(/<nav class="tabs"[^]*?<\/nav>/)[0];
 assert.match(tabs,/<button id="run" class="run-all"[^>]*>[^<]*<\/button><\/nav>$/);
 assert.doesNotMatch(app,/全テストの対象/);
 // tools 接続確認の ON/OFF・再確認の行は持たない（接続状態はステータスバーに表示）。
 assert.doesNotMatch(app,/component-toolbar|tools-toggle|tools接続確認|再確認/);assert.match(app,/:enabled="true"/);
});

test('AI model trial guidance precedes the family tabs',()=>{
 const panel=source('components/AIモデル/AIモデルパネル.vue');
 const note='各タブのモデルと入力を選び、「動作確認」でCHAT → LIVE → PREDICTION → DECISION → CODEを順に試します。完了後はCHATへ戻ります。選択は設定へ保存されません。';
 assert.equal(panel.split(note).length-1,1);
 assert.ok(panel.indexOf(note)<panel.indexOf('<nav class="tabs ai-model-tabs"'));
 assert.match(panel,/<p class="panel-note">[^<]+<\/p>\s*<nav class="tabs ai-model-tabs"/);
});
test('panel perimeter reserves one pixel inside the unchanged viewport box',()=>{
 const css=source('style.css');
 assert.match(css,/#app\{box-sizing:border-box;border:1px solid var\(--aidiy-panel-border\)\}/);
 assert.match(css,/#app\{height:100vh;height:100dvh/);
});

test('icon mode removes only the panel perimeter and restores it on unmount',()=>{
 const css=source('components/アプリ起動/マイクロランチャー.css');
 assert.match(css,/html\.micro-mode #app\{border:0\}/);
 assert.match(source('style.css'),/#app\{box-sizing:border-box;border:1px solid var\(--aidiy-panel-border\)\}/);
 const launcher=source('components/アプリ起動/マイクロランチャー.vue');
 assert.match(launcher,/onMounted\(\(\)=>\{[^\n]*document\.documentElement\.classList\.add\('micro-mode'\)/);
 assert.match(launcher,/onBeforeUnmount\(\(\)=>\{[^\n]*document\.documentElement\.classList\.remove\('micro-mode'\)/);
 const deployed=fs.readFileSync(path.join(__dirname,'../static/style.css'),'utf8');
 assert.match(deployed,/html\.micro-mode #app\{border:0\}/);
});
