// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),req=createRequire(path.join(__dirname,'../ui/package.json'));
const {source,component,dependency,render}=require('./ui-components.cjs');
const {parse:parseCss}=req('postcss'),{parse,compileScript}=req('@vue/compiler-sfc'),{transformSync}=req('esbuild');
const vue=req('vue'),{renderToString}=req('@vue/server-renderer');
const css=parseCss(source('components/Tools/Tools.css'));
function rule(selector,media){let found;css.walkRules(node=>{if(node.selector===selector&&(media?node.parent.params===media:node.parent.type==='root'))found=node;});assert.ok(found,selector);return found;}
function declarations(selector,media){return Object.fromEntries(rule(selector,media).nodes.filter(n=>n.type==='decl').map(n=>[n.prop,n.value]));}
const rows=[{id:'aidiy_chrome_devtools',label:'Chrome',enabled:true,available:true,status:'OK',defaultsKey:null},{id:'aidiy_text_to_speech',label:'Speech',enabled:true,available:true,status:'OK',defaultsKey:'text_to_speech'}];
async function authenticated(selected=rows[0],extraRows=[],busy=false){
 const state=dependency('components/Tools/Tools状態.mjs').Tools状態を作成({api:()=>assert.fail('SSRからAPIを呼ばない'),代表テスト:dependency('components/Tools/Tools代表テスト.mjs').Tools代表テスト});
 state.認証済み.value=true;state.処理中.value=busy?'test':'';state.項目.value=selected?[selected,...extraRows]:[];state.選択ID.value=selected?.id||'';state.編集値.value={text_to_speech:{auto_provider:'edge'}};state.schema.value={text_to_speech:{auto_provider:['edge','openai']}};
 const module={exports:{}};const compiled=compileScript(parse(source('components/Tools/Toolsパネル.vue')).descriptor,{id:'tools-layout',inlineTemplate:true});
 vm.runInNewContext(transformSync(compiled.content,{format:'cjs',loader:'js'}).code,{module,exports:module.exports,require:id=>id==='vue'?vue:id.endsWith('Tools状態.mjs')?{Tools状態を作成:()=>state}:id.endsWith('Tools代表テスト.mjs')?dependency('components/Tools/Tools代表テスト.mjs'):id.endsWith('.vue')?component('components/共通表示/状態バッジ.vue'):{}});
 const html=await renderToString(vue.createSSRApp({render:()=>vue.h(module.exports.default,{connected:true,coreOnline:true,toolsOnline:true,visible:true})}));state.終了();return html;
}
test('Tools本文は共通flex:noneを明示上書きし、残り高だけを各ペインへ渡す',()=>{
 const shell=declarations('.tools-panel>.tools-scroll');assert.equal(shell.flex,'1 1 auto');assert.ok(rule('.tools-panel>.tools-scroll').nodes.find(n=>n.prop==='flex').important);assert.equal(shell['min-height'],'0');assert.equal(shell.overflow,'auto');
 assert.equal(declarations('.tools-scroll.tools-authenticated').overflow,'hidden');
 const columns=declarations('.tools-columns');assert.equal(columns.flex,'1 1 auto');assert.equal(columns['min-height'],'0');assert.equal(columns['grid-template-rows'],'minmax(0,1fr)');assert.equal(columns.overflow,'hidden');
 const panes=declarations('.tools-list,.tools-detail');assert.equal(panes['min-height'],'0');assert.equal(panes.overflow,'auto');assert.equal(panes['overscroll-behavior'],'contain');
 assert.doesNotMatch(source('components/Tools/Tools.css'),/height:calc\([^)]*100(?:d?vh)/,'タイトルや折返しタブの高さを固定値で差し引かない');
});
test('701px以上はAIモデルと同じ左右、狭幅でも一覧40%と右内容の高さを別確保',()=>{
 let columns;css.nodes.filter(n=>n.type==='rule'&&n.selector==='.tools-columns').forEach(n=>columns=Object.fromEntries(n.nodes.map(v=>[v.prop,v.value])));
 assert.equal(columns['grid-template-columns'],'minmax(0,1fr) minmax(0,1fr)');
 const narrow=declarations('.tools-columns','(max-width:700px)');assert.equal(narrow['grid-template-columns'],'minmax(0,1fr)');assert.equal(narrow['grid-template-rows'],'minmax(0,40%) minmax(0,1fr)');
 assert.equal(declarations('.tools-panel .tools-heading','(max-height:500px)').padding,'6px 12px');
 assert.equal(declarations('.tools-config-row','(max-width:480px)')['grid-template-columns'],'minmax(0,1fr)');
});
test('認証後の右ペインは実行前もテスト内容・条件・結果・未実施応答を表示',async()=>{
 const html=await authenticated();assert.match(html,/class="panel-heading tools-heading"/);assert.match(html,/aria-label="既定値とテスト内容" tabindex="0"/);assert.match(html,/<h3>テスト内容<\/h3>/);assert.match(html,/<legend>テスト条件<\/legend>/);assert.match(html,/aria-label="テスト結果"/);assert.match(html,/data-state="未実施"/);assert.match(html,/テストの応答はまだありません/);assert.match(html,/tools-detail-test/);assert.match(html,/headless/);
});
test('未対応・OFF・利用不可でも右内容は消えず、理由とdisabled操作を保つ',async()=>{
 for(const row of [{...rows[1],id:'unknown'},{...rows[0],enabled:false},{...rows[0],available:false}]){
  const html=await authenticated(row);assert.match(html,/<h3>テスト内容<\/h3>/);assert.match(html,/aria-label="テスト結果"/);assert.match(html,/class="single-test-button tools-detail-test" disabled/);
  if(row.id==='unknown'){assert.match(html,/このToolの代表機能テストは未対応/);assert.match(html,/<select/);}else assert.match(html,/サービス外|この環境では利用できません/);
 }
});
test('登録0件でも右結果の枠は残り、長い登録一覧も省略・非公開にしない',async()=>{
 assert.match(await authenticated(null),/一覧からToolを選択してください/);
 const extra=Array.from({length:20},(_,i)=>({...rows[1],id:'aidiy_'+i,label:'長い名称_'.repeat(12)+i}));const html=await authenticated(rows[0],extra);assert.equal((html.match(/class="tools-name"/g)||[]).length,21);assert.match(html,/aria-label="テスト結果"/);
});

test('生成系の軽量試験は説明APIだけと表示し、Chrome専用のheadless条件を表示しない',async()=>{
 const html=await authenticated(rows[1]);
 assert.match(html,/説明APIの疎通確認/);assert.match(html,/実機能の動作確認とは別/);
 assert.doesNotMatch(html,/headless|専用ブラウザを終了/);
 assert.doesNotMatch(html,/class="single-test-button tools-detail-test" disabled/);
});

test('一括テストは認証後の見出し右側に置き、対象なしでは無効',async()=>{
 const html=await authenticated();assert.match(html,/<div class="panel-actions"><button[^>]*tools-batch-test/);assert.match(html,/>一括テスト<\/button>/);
 assert.match(await authenticated(null),/tools-batch-test" disabled/);
 const guest=await render('components/Tools/Toolsパネル.vue',{connected:true,coreOnline:true,toolsOnline:true});assert.doesNotMatch(guest,/tools-batch-test/);
});
test('未認証のログイン領域も内部スクロールに入れ、一覧・右ペインは認証後だけ',async()=>{
 const html=await render('components/Tools/Toolsパネル.vue',{connected:true,coreOnline:true,toolsOnline:true,visible:true});assert.match(html,/class="tools-scroll"/);assert.match(html,/class="tools-auth"/);assert.match(html,/Coreへログイン/);assert.doesNotMatch(html,/class="tools-columns"|aria-label="テスト結果"/);
});
test('Toolを選び直すと右だけ先頭へ戻し、長い一覧の位置と状態処理を変えない',()=>{
 const panel=source('components/Tools/Toolsパネル.vue');assert.match(panel,/watch\(\(\)=>current.value\?\.id,async\(\)=>\{await nextTick\(\);if\(detailPane.value\)detailPane.value.scrollTop=0;/);assert.match(panel,/ref="detailPane" class="tools-detail"/);assert.doesNotMatch(panel,/scrollIntoView|window.scroll|scrollTop\s*=\s*(?!0)/);
});

test('Backupの条件は初期batch ON、実保存と受付だけのOKを個別・一括で明記',async()=>{
 const row={...rows[0],id:'aidiy_backup',label:'Backup'};
 const html=await authenticated(row);assert.match(html,/<input[^>]*type="checkbox"[^>]*checked/);assert.match(html,/batch（コピーを別スレッド/);assert.match(html,/実際にバックアップを作成/);assert.match(html,/コピー完了ではありません/);assert.match(html,/title="[^"]*実際のバックアップ作成/);assert.doesNotMatch(html,/headless|専用ブラウザを終了/);
 for(const [changed,busy]of [[{...row,enabled:false},false],[{...row,available:false},false],[row,true]]){const disabled=await authenticated(changed,[],busy);assert.match(disabled,/<input[^>]*type="checkbox"[^>]*disabled[^>]*checked/);}
});
