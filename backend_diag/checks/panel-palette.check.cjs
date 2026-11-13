// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// アプリの本文面だけを真黒にし、入力・選択・警告・透明アイコンの意味を保つ。
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire}=require('node:module'),req=createRequire(path.join(__dirname,'../ui/package.json'));
const {parse}=req('postcss'),{source}=require('./ui-components.cjs');
const styles=new Map();
function declarations(file,selector){
 if(!styles.has(file))styles.set(file,parse(source(file)));
 const values={};styles.get(file).walkRules(rule=>{if(rule.selector===selector)rule.walkDecls(({prop,value})=>values[prop]=value);});return values;
}
test('シアンバーより下の通常本文・タブ・見出し・応答・ランチャーの面は真黒',()=>{
 const surfaces={
  'style.css':[':root','body','header','#message','aside','.login','.panel-heading','.tabs','.tabs button[class*="tab-"]'],
  'components/起動/起動.css':['.start-panel','.start-targets','.start-console-heading','.start-panel .start-console','.start-message'],
  'components/起動/起動ミニ.css':['#app:has(>.diag-panel>.start-mini)','#app>.diag-panel>.panel.start-mini','.mini-app-buttons .mini-app-button','.mini-services .mini-service','.mini-cli-buttons .mini-cli-button'],
  'components/アプリ起動/アプリ起動.css':['.app-project','.app-launch-card','.app-launch-button','.app-folder-dialog','.app-launch-panel .app-launch-button','.app-launch-panel .app-single'],
  'components/AIモデル/AIモデル.css':['.ai-model-reply'],
  'components/設定モデル/設定モデル.css':['.trial-reply'],
  'components/導入状況/導入状況.css':['.install-console'],
  'components/AI設定/AI設定.css':['.config-panel-embedded .config-panel','.config-panel-embedded .config-panel-header','.config-panel-embedded .config-panel-body','.config-panel-embedded .config-panel-section','.config-panel-embedded .config-panel-actions'],
 };
 for(const [file,selectors]of Object.entries(surfaces))for(const selector of selectors)assert.equal(declarations(file,selector).background,'#000',`${file}: ${selector}`);
});
test('黒い本文でも入力・選択・警告の識別と透明microを保ち、外枠だけタイトル色を使う',()=>{
 const normal=s=>declarations('style.css',s),settings=s=>declarations('components/AI設定/AI設定.css',`.config-panel-embedded ${s}`);
 assert.equal(normal('button,input,select').background,'#1a2c3a');
 assert.equal(normal('.tabs button[class*="tab-"].active').background,'var(--tab-bg)');
 assert.equal(normal('.tabs button[class*="tab-"].active').color,'#1e293b');
 assert.equal(normal('.tabs button[class*="tab-"]:not(.active):hover:not(:disabled)').color,'#fff');
 assert.equal(normal('#app').border,'1px solid var(--aidiy-panel-border)');
 assert.equal(declarations('components/起動/起動.css','.start-targets button.active').background,'#1b2d3d');
 assert.equal(declarations('components/起動/起動ミニ.css','.mini-service[data-tone=running]').background,'#0d2523');
 assert.equal(declarations('components/導入状況/導入状況.css','.security-version-warning').background,'#3b301c');
 for(const selector of ['.config-panel-select','.config-panel-input']){assert.equal(settings(selector).background,'#ffffff');assert.equal(settings(selector).color,'#0f172a');}
 assert.equal(settings('.config-panel').color,'#e5edf7');assert.equal(settings('.config-panel-label').color,'#d8e3ed');
 assert.equal(settings('.config-panel-error').background,'#fee2e2');assert.equal(settings('.config-panel-actions button.danger').background,'#dc2626');
 assert.equal(declarations('components/アプリ起動/マイクロランチャー.css','html.micro-mode,html.micro-mode body,html.micro-mode #app').background,'transparent');
 assert.equal(declarations('components/アプリ起動/マイクロランチャー.css','html.micro-mode #app').border,'0');
});
