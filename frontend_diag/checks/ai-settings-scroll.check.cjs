// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{readFileSync}=require('node:fs');
const {createRequire}=require('node:module'),req=createRequire(path.join(__dirname,'../ui/package.json'));
const {source,render}=require('./ui-components.cjs');
const {parse}=req('postcss');
const base=parse(source('style.css')),settings=parse(source('components/AI設定/パネル.css')),form=parse(source('components/AI設定/AI設定.css'));
const selector='#app > .diag-panel > .ai-settings-tab';
function values(css,selector){let result;css.walkRules(rule=>{if(rule.selectors.includes(selector))result={...result,...Object.fromEntries(rule.nodes.filter(n=>n.type==='decl').map(n=>[n.prop,n.value]))};});assert.ok(result,selector);return result;}
// このflex chainに実際にマッチするルールを詳細度順で評価する。import順を逆転しても共通flex:noneに負けない。
const specificity=selector=>[(selector.match(/#/g)||[]).length,(selector.match(/\./g)||[]).length];
const stronger=(a,b)=>{const x=specificity(a),y=specificity(b);return x[0]-y[0]||x[1]-y[1];};
test('設定再起動の実際の親diag-panelに限定して残り高さを使い、共通flex:noneを上書きする',()=>{
 const app=source('App.vue'),panel=source('components/AI設定/AI設定パネル.vue');
 assert.match(app,/<div[^>]*class="diag-panel ai-component"[\s\S]*<AI設定パネル[^>]*v-show="tab==='settings'&&!ミニ表示"/);
 assert.match(panel,/<section class="ai-settings-tab"/);
 assert.doesNotMatch(source('components/AI設定/パネル.css'),/#app\s*>\s*\.ai-settings-tab/);
 assert.equal(values(base,'#app>.diag-panel>*').flex,'none');
 assert.ok(stronger(selector,'#app>.diag-panel>*')>0);
 const actual=values(settings,selector);
 assert.equal(actual.flex,'1 1 auto');assert.equal(actual['min-height'],'0');assert.equal(actual['min-width'],'0');assert.equal(actual.overflow,'auto');assert.equal(actual['overscroll-behavior'],'contain');
 assert.equal(values(base,'#app>.diag-panel')['min-height'],'0');
 assert.equal(values(base,'#app').overflow,'hidden');
 assert.equal(values(base,'#app>.diag-panel>*').flex,'none','タイトル・タブは固定のまま');
});
test('420px最小幅でも内側の固定高さや独立スクロールを作らず、下端の書込みまで同じスクロール領域に含む',()=>{
 assert.match(readFileSync(path.join(__dirname,'../diag/起動/electron-main.cjs'),'utf8'),/minWidth:420,minHeight:320/);
 assert.equal(values(settings,'.ai-settings-tab .config-panel-embedded').height,'auto');
 assert.equal(values(settings,'.ai-settings-tab .config-panel-embedded .config-panel').height,'auto');
 assert.equal(values(settings,'.ai-settings-tab .config-panel-embedded .config-panel-body').overflow,'visible');
 assert.equal(values(settings,'.ai-settings-tab .config-panel-embedded .config-panel-body').flex,'none');
 assert.ok(stronger('.ai-settings-tab .config-panel-embedded .config-panel-body','.config-panel-embedded .config-panel-body')>0);
 assert.ok(stronger('.ai-settings-tab .config-panel-embedded .config-panel','.config-panel-embedded .config-panel')>0);
 const entry=source('main.js');assert.ok(entry.indexOf("import './components/AI設定/パネル.css'")<entry.indexOf("import './components/AI設定/AI設定.css'"));
 // 後から読み込む共通フォームCSSより詳細度を高め、height:100%・overflow-y:auto・flex:1への逆戻りを防ぐ。
 assert.equal(values(form,'.config-panel-embedded .config-panel-actions')['flex-wrap'],'wrap');
 const vue=source('dialog/AI設定再起動.vue');assert.match(vue,/class="config-panel-actions"[\s\S]*class="save"[^>]*@click="handleSaveOnly">書込み<\/button>/);
 assert.match(vue,/class="config-panel-embedded"[\s\S]*class="config-panel"[\s\S]*class="config-panel-actions"/);
 assert.match(source('components/AI設定/AI設定パネル.vue'),/<AI設定再起動[^>]*v-if="connected&&coreOnline&&state.認証済み.value/);
});
test('ログイン前・切断時も同じフォーカス可能なスクロール領域を維持し、キーや入力を横取りしない',async()=>{
 for(const props of [{connected:true,coreOnline:true},{connected:true,coreOnline:false},{connected:false,coreOnline:false}]){
  const html=await render('components/AI設定/AI設定パネル.vue',{...props,api:()=>assert.fail('SSRで認証や書込みを行わない')});
  assert.match(html,/<section class="ai-settings-tab" aria-label="設定再起動" tabindex="0"/);
  if(props.connected&&props.coreOnline)assert.match(html,/autocomplete="username"/);
 }
 assert.doesNotMatch(source('components/AI設定/AI設定パネル.vue'),/@(?:wheel|keydown).*prevent|scrollTop\s*=/);
});
