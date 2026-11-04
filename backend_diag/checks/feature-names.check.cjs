// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {render,source}=require('./ui-components.cjs');

test('nine tabs and feature modules use the requested names while stable tab IDs remain',()=>{
 const tabs=[...source('App.vue').matchAll(/@click="changeTab\('([^']+)'\)">([^<]+)<\/button>/g)].map(([,id,name])=>[id,name]);
 assert.deepEqual(tabs,[['install','導入状況'],['keys','モデル一覧'],['integrations','外部連携'],['trials','設定モデル'],['manual','AIモデル'],['settings','設定再起動'],['tools','Tools'],['start','システム起動'],['apps','アプリ起動']]);
 for(const name of tabs.map(([,name])=>name==='システム起動'?'起動':name==='設定再起動'?'AI設定':name))assert.ok(fs.existsSync(path.join(__dirname,'../ui/src/components',name,`${name}パネル.vue`)));
 for(const name of ['インストール','モデルキー設定','外部連携設定','configモデル試行'])assert.equal(fs.existsSync(path.join(__dirname,'../ui/src/components',name)),false);
 assert.match(source('components/導入状況/導入状況状態.mjs'),/api\/診断/);
 assert.match(source('components/キー設定共通/キー設定状態.mjs'),/api\/キー設定/);
 assert.match(source('components/設定モデル/設定モデル状態.mjs'),/api\/モデル試行/);
});

test('headings and main actions match each tab and valid write/refresh actions remain',async()=>{
 const install=await render('components/導入状況/導入状況パネル.vue',{項目:[],結果:[],接続済み:true});
 assert.match(install,/<h2>導入状況<\/h2>/);assert.match(install,/id="install-run"[^>]*>状況確認<\/button>/);assert.match(install,/id="install-write"/);
 const models=await render('components/モデル一覧/モデル一覧パネル.vue',{data:{項目:[]},results:{},connected:true});
 assert.match(models,/<h2>モデル一覧取得<\/h2>/);assert.match(models,/id="latest-models"[^>]*>一括取得<\/button>/);assert.match(models,/id="models-write"/);
 const external=await render('components/外部連携/外部連携パネル.vue',{data:{項目:[]},connected:true});
 assert.match(external,/<h2>外部連携確認<\/h2>/);assert.match(external,/id="integration-run"[^>]*>状況確認<\/button>/);assert.match(external,/id="integration-write"/);assert.doesNotMatch(external,/設定状況を更新/);
 const configured=await render('components/設定モデル/設定モデルパネル.vue',{data:{項目:[]},results:{},online:true});
 assert.match(configured,/<h2>モデル動作確認<\/h2>/);assert.match(configured,/id="model-trial-start"[^>]*>動作確認<\/button>/);
 assert.match(configured,/<div class="panel-heading trial-heading">[^]*?<button class="trial-reload refresh-button"[^>]*aria-label="設定モデルを再読込"[^>]*><span[^>]*>↺<\/span><span>再読込<\/span><\/button>/);
});
