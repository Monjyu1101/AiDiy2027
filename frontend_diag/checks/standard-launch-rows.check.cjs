// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {render}=require('./ui-components.cjs');
const value=value=>({value});
function props(cli=true,online=true,folder='/project'){
 return {online,visible:true,state:{一覧:value(null),フォルダ:value(folder),処理中:value(''),選択中:value(false),通知:value(''),項目:value([{id:'chrome',名前:'Chrome'},{id:'code',名前:'Code'},{id:'ide',名前:'IDE'}]),結果:value({}),読込:async()=>{},利用可能:()=>true,不可理由:()=>''},
 cliState:{全項目:value(cli?[{id:'copilot',名前:'Copilot',利用可能:false},{id:'aidiy_pi',名前:'Pi',利用可能:true}]:[]),失敗:value(false),通知:value(''),処理中:value(''),読込:async()=>{}}};
}
test('標準ランチャーはアプリと全CLIを別段に保ち、各段の既存順序と未導入表示を維持',async()=>{
 const html=await render('components/アプリ起動/アプリ起動パネル.vue',props());
 assert.equal((html.match(/data-launch-row=/g)||[]).length,2);
 const [app,cli]=html.split('data-launch-row="app"')[1].split('data-launch-row="cli"');
 assert.deepEqual([...app.matchAll(/data-app="([^"]+)"/g)].map(m=>m[1]),['ide','code']);
 assert.doesNotMatch(app,/data-cli=/);
 assert.deepEqual([...cli.matchAll(/data-cli="([^"]+)"/g)].map(m=>m[1]),['aidiy_pi','copilot']);
 assert.deepEqual([...cli.matchAll(/data-(?:cli|app)="([^"]+)"/g)].map(m=>m[1]),['aidiy_pi','copilot','chrome']);
 assert.match(cli,/未導入/);
});
test('CLIがない場合は空段を表示せず、未接続・フォルダ未選択でも配置と禁止条件を維持',async()=>{
 const withoutCli=props(false);
 const chromeOnly=await render('components/アプリ起動/アプリ起動パネル.vue',withoutCli);
 assert.match(chromeOnly,/data-launch-row="cli"/);
 withoutCli.state.項目.value=withoutCli.state.項目.value.filter(item=>item.id!=='chrome');
 const empty=await render('components/アプリ起動/アプリ起動パネル.vue',withoutCli);
 assert.doesNotMatch(empty,/data-launch-row="cli"/);
 for(const p of [props(true,false),props(true,true,'')]){
  const html=await render('components/アプリ起動/アプリ起動パネル.vue',p);
  assert.equal((html.match(/data-launch-row=/g)||[]).length,2);
  const cli=html.split('data-launch-row="cli"')[1];
  assert.equal((cli.match(/<button[^>]* disabled/g)||[]).length,p.online?2:3);
 }
});
test('標準は8列・最大72pxのアイコンとし、狭い画面では列数を減らす',()=>{
 const css=readFileSync(new URL('../diag/ui/components/アプリ起動/アプリ起動.css',`file://${__filename}`),'utf8');
 assert.match(css,/#app>\.diag-panel\.app-launch-view>\.app-launch-panel>\.app-launch-rows\{display:flex;flex-direction:column/);
 assert.match(css,/grid-template-columns:repeat\(8,minmax\(0,1fr\)\);grid-auto-flow:row/);
 assert.match(css,/\.launch-frame-standard\{width:min\(72px,/);
 assert.match(css,/@media\(max-width:410px\).*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:310px\).*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.doesNotMatch(css,/grid-auto-flow:column|overflow-x:auto/);
});

test('短い窓も一覧を縮めて縦スクロールし、共通flex:noneに負けない',()=>{
 const css=readFileSync(new URL('../diag/ui/components/アプリ起動/アプリ起動.css',`file://${__filename}`),'utf8');
 const rows=css.match(/#app>\.diag-panel\.app-launch-view>\.app-launch-panel>\.app-launch-rows\{([^}]+)\}/)?.[1];
 assert.ok(rows);
 for(const rule of ['min-height:0','min-width:0','flex:1 1 auto','overflow-y:auto','overflow-x:hidden'])assert.ok(rows.includes(rule),rule);
 assert.doesNotMatch(css,/@media\(max-height:[^}]+(?:overflow:visible|overflow-y:auto|flex:none)/);
});

test('標準のプロジェクト欄はラベル・読取専用入力・操作を同じ行に置く',async()=>{
 const html=await render('components/アプリ起動/アプリ起動パネル.vue',props());
 assert.match(html,/<div class="app-project-row"><label for="app-project-folder">プロジェクト:<\/label><input[^>]*readonly/);
 assert.match(html,/class="app-launch-note" title="[^"]*Diag を閉じても/);
});

test('最大構成はアプリ13件とCLI・外部アプリ11件を別グループで維持する',async()=>{
 const p=props();
 p.state.項目.value=['ide','term','browser','navi','code','live','avatar','task','team','memo','cpu','discord','slack','chrome'].map(id=>({id,名前:id}));
 p.cliState.全項目.value=['aidiy_hermes','aidiy_pi','aidiy_codex','claude','codex','copilot','agy','grok','opencode','vscode'].map(id=>({id,名前:id,利用可能:false}));
 const html=await render('components/アプリ起動/アプリ起動パネル.vue',p);
 const [app,cli]=html.split('data-launch-row="app"')[1].split('data-launch-row="cli"');
 assert.equal((app.match(/data-app=/g)||[]).length,13);
 assert.equal((cli.match(/data-(?:app|cli)=/g)||[]).length,11);
 assert.equal((html.match(/未導入<\/span>/g)||[]).length,10);
 const css=readFileSync(new URL('../diag/ui/components/アプリ起動/アプリ起動.css',`file://${__filename}`),'utf8');
 assert.match(css,/min-height:92px;padding:3px 3px 14px/);
});
