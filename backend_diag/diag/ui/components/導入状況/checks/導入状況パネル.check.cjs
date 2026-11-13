// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const { render, source } = require('../../../../../checks/ui-components.cjs');

test('install list keeps categories and badges without search, legend or state filter', async () => {
  const html = await render('components/導入状況/導入状況パネル.vue', {
    項目: [{ id: 'node', name: 'Node.js', description: 'runtime', commands: ['node'], category: 'base', menuGroup: 'ベース' }],
    結果: [{ id: 'node', 状態: 'OK' }], 確認中: false, 接続済み: true,
  });
  assert.match(html, /id="install-run"/);
  assert.match(html, /<button id="install-write"[^>]*\bdisabled[^>]*>書込<\/button>/);
  assert.match(html, /ベース/);
  assert.doesNotMatch(html, /class="legend"|<select|状態で絞り込む|<input|プログラムを検索/);
  assert.equal((html.match(/data-state="OK"/g) || []).length, 1);
  assert.match(html, /class="panel install-panel"/);
});

test('導入だけ一覧を広げ、1行目の左に名称・右に確認と状態、2行目の左に導入操作を置く', () => {
  const css = source('components/導入状況/導入状況.css');
  assert.match(css, /\.install-panel>main\{grid-template-columns:clamp\(400px,34vw,480px\) minmax\(0,1fr\)/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) auto;grid-template-areas:"name check" "manage manage";align-items:center/);
  assert.match(css, /\.install-name>\.item\{width:auto;min-width:0;padding:11px 0;overflow-wrap:anywhere/);
  assert.match(css, /\.install-manage\{grid-area:manage;display:flex;justify-content:flex-start;flex-wrap:wrap;gap:4px;padding:0 10px 10px\}/);
  assert.match(css, /\.install-check\{display:flex;align-items:center;justify-content:flex-end;flex-wrap:nowrap;gap:8px;padding:0 10px 0 0\}/);
  assert.match(css, /\.install-check\{grid-area:check;min-width:0\}/);
  assert.match(css, /@media\(max-width:900px\)\{\.install-panel>main\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /#app>\.install-panel>main\{grid-template-rows:minmax\(0,45%\) minmax\(0,1fr\)/);
  assert.equal((css.match(/grid-template-areas:/g) || []).length, 1, '狭幅でも導入操作は2行目を保つ');
  assert.match(source('style.css'), /main\{display:grid;grid-template-columns:310px minmax\(0,1fr\)/, '他画面の既定幅は変更しない');
});

test('write button is enabled only after a completed check', async () => {
  const props = { 項目: [{ id: 'node', name: 'Node.js', commands: ['node'], menuGroup: 'ベース' }], 結果: [{ id: 'node', 状態: 'OK' }], 確認中: false, 接続済み: true, 確認済み: true, 書込中: false, 書込済み: false };
  assert.match(await render('components/導入状況/導入状況パネル.vue', props), /<button id="install-write"[^>]*>書込<\/button>/);
  assert.doesNotMatch(await render('components/導入状況/導入状況パネル.vue', props), /id="install-write"[^>]*\bdisabled/);
  assert.match(await render('components/導入状況/導入状況パネル.vue', { ...props, 書込済み: true }), />書込済<\/button>/);
  assert.match(await render('components/導入状況/導入状況パネル.vue', { ...props, 確認中: true }), /id="install-write"[^>]*\bdisabled/);
});

test('エラーは共通通知欄へ表示する', () => {
  const controller = source('components/導入状況/導入状況状態.mjs');
  assert.match(controller, /catch \(error\) \{ 待機中 = false; 結果.value = 前回; 通知.value = error.message;/);
  assert.match(source('App.vue'), /<p v-if="message" id="message" role="status"/);
});

test('全項目に独立した確認ボタンがあり、実行中の1行だけ確認中と表示する',async()=>{
 const props={項目:[{id:'node',name:'Node.js',commands:['node'],menuGroup:'ベース'},{id:'ollama',name:'Ollama',commands:['ollama'],menuGroup:'CLI群'}],結果:[{id:'node',状態:'確認中'},{id:'ollama',状態:'OK'}],接続済み:true,確認済み:true,個別確認中:'node'};
 const html=await render('components/導入状況/導入状況パネル.vue',props);
 assert.equal((html.match(/data-install-check=/g)||[]).length,2);
 assert.match(html,/<button\b[^>]*data-install-check="node"[^>]*aria-label="Node.js の導入状況を確認"[^>]*disabled[^>]*>確認中…<\/button>/);
 assert.doesNotMatch(html,/<button\b[^>]*data-install-check="ollama"[^>]*disabled/);
 assert.match(html,/id="install-run"[^>]*disabled/);assert.match(html,/id="install-write"[^>]*disabled/);
 assert.doesNotMatch(html,/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/,'選択ボタンに確認ボタンを入れ子にしない');
 const ready=await render('components/導入状況/導入状況パネル.vue',{...props,個別確認中:''});
 assert.doesNotMatch(ready,/data-install-check="[^"]+"[^>]*disabled/);
 for(const busy of [{接続済み:false},{確認中:true},{書込中:true}]){
  const disabled=await render('components/導入状況/導入状況パネル.vue',{...props,個別確認中:'',...busy});
  assert.equal((disabled.match(/data-install-check="[^"]+"[^>]*disabled/g)||[]).length,2);
 }
});

test('Appは個別確認イベントと実行中IDを配線し、全テストの重複も抑止する',()=>{
 const app=source('App.vue');
 assert.match(app,/:個別確認中="個別確認中"/);assert.match(app,/@個別確認="個別確認"/);
 assert.match(app,/id="run"[^>]*:disabled="[^"]*Boolean\(個別確認中\)/);
 const panel=source('components/導入状況/導入状況パネル.vue');
 assert.match(panel,/@click="選択ID=item.id;\$emit\('個別確認',item.id\)"/);
});

test('実Vueイベントで選択は確認せず、確認ボタンは対象だけ実行して完了後の選択を保持する',async()=>{
 const {createRequire}=require('node:module');
 const path=require('node:path');
 const {createRenderer,h,nextTick,ref}=createRequire(path.join(__dirname,'../../../../../ui/package.json'))('vue');
 const {component}=require('../../../../../checks/ui-components.cjs');
 const {導入状況状態を作成}=await import('../導入状況状態.mjs');
 const make=(tag,text='')=>({tag,text,children:[],props:{},parent:null});
 const renderer=createRenderer({
  createElement:tag=>make(tag),createText:text=>make('#text',text),createComment:text=>make('#comment',text),
  setText:(node,text)=>node.text=text,setElementText:(node,text)=>{node.text=text;node.children=[];},
  parentNode:node=>node.parent,nextSibling:node=>node.parent?.children[node.parent.children.indexOf(node)+1]||null,
  patchProp:(node,key,_old,value)=>node.props[key]=value,
  insert(node,parent,anchor){if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);node.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,node);},
  remove(node){node.parent?.children.splice(node.parent.children.indexOf(node),1);},
 });
 let finish;const calls=[],runs=[];
 const state=導入状況状態を作成({api:(url,method)=>{calls.push([url,method]);return new Promise(resolve=>{finish=resolve;});},接続済み:ref(true),通知:ref(''),間隔:0});
 state.一覧を反映({項目:[{id:'node',name:'Node.js',commands:['node'],menuGroup:'ベース'},{id:'ollama',name:'Ollama',commands:['ollama'],menuGroup:'CLI群'}],結果:[{id:'node',状態:'OK'},{id:'ollama',状態:'未検出'}]});
 const root=make('root');
 const app=renderer.createApp({render:()=>h(component('components/導入状況/導入状況パネル.vue').default,{項目:state.項目.value,結果:state.結果.value,確認中:state.確認中.value,個別確認中:state.個別確認中.value,接続済み:true,確認済み:state.確認済み.value,書込中:state.書込中.value,表示中:state.表示中.value,on個別確認:id=>runs.push(state.個別確認(id))})});
 const descendants=node=>[node,...node.children.flatMap(descendants)];
 const select=id=>descendants(root).find(node=>node.props['data-install-check']===id).parent.parent.children.find(node=>node.props.class==='install-name').children.find(node=>node.tag==='button');
 try{
  app.mount(root);select('node').props.onClick();await nextTick();assert.equal(calls.length,0);
  const check=descendants(root).find(node=>node.props['data-install-check']==='ollama');
  for(let parent=check.parent;parent;parent=parent.parent)assert.notEqual(parent.tag,'button');
  check.props.onClick();check.props.onClick();await nextTick();
  assert.deepEqual(calls,[['api/診断/ollama','POST']]);assert.equal(select('ollama').props['aria-pressed'],true);
  assert.equal(check.props.disabled,true);
  assert.equal(descendants(root).find(node=>node.props['data-install-check']==='node').props.disabled,false);
  select('node').props.onClick();await nextTick();
  finish({結果:{id:'ollama',状態:'OK'},確認済み:false});await Promise.all(runs);await nextTick();
  assert.equal(select('node').props['aria-pressed'],true);assert.equal(select('ollama').props['aria-pressed'],false);
  assert.ok(descendants(root).filter(node=>node.props['data-install-check']).every(node=>!node.props.disabled));
  assert.deepEqual(state.結果.value.map(row=>[row.id,row.状態]),[['node','OK'],['ollama','OK']]);
  state.結果.value=[{id:'node',状態:'注意',バージョン:'24.22.0',説明:'バージョンが古い！ セキュリティパッチ未対応です。'}];await nextTick();
  const warning=descendants(root).find(node=>node.props.class==='security-version-warning');
  assert.ok(warning);assert.equal(warning.props.role,'status');
  assert.ok(descendants(warning).some(node=>node.text.includes('セキュリティパッチ未対応')));
  state.結果.value=[{id:'node',状態:'OK',バージョン:'24.22.1',説明:'正常終了'}];await nextTick();
  assert.equal(descendants(root).some(node=>node.props.class==='security-version-warning'),false);
 }finally{app.unmount();}
});
