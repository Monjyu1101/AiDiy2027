// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
const test = require('node:test');
const assert = require('node:assert/strict');
const {render} = require('./ui-components.cjs');
const {createRequire} = require('node:module');
const path = require('node:path');
const {ref} = createRequire(path.join(__dirname, '../ui/package.json'))('vue');

test('standard keeps a disabled Git card; both compact modes show Git only when usable, directly after Team',async()=>{
 const items=[{id:'git',名前:'Git'},{id:'team',名前:'Team'},{id:'task',名前:'Task'}];
 const cliState={項目:ref([]),読込:()=>{},失敗:ref(false),通知:ref(""),処理中:ref("")},props={online:true,visible:true,cliState};
 const standard='components/アプリ起動/アプリ起動パネル.vue',mini='components/アプリ起動/ミニアプリ起動.vue',micro='components/アプリ起動/マイクロランチャー.vue';
 const gitCard=/<article class="app-launch-card" data-app="git"><button[^>]*>/;
 for(const enabled of [false,true]){
  const state={項目:ref(items),フォルダ:ref('/selected'),処理中:ref(''),通知:ref(''),結果:ref({}),選択中:ref(false),一覧:ref(null),
   読込:()=>{},利用可能:id=>id!=='git'||enabled,不可理由:id=>id==='git'&&!enabled?'Git 利用不可':'',Git無効表示:()=> 'Git 利用不可'};
  for(const name of [standard,mini,micro]){
   const html=await render(name,{...props,state,appState:state});
   if(name===standard)assert.equal(/ disabled/.test(html.match(gitCard)[0]),!enabled);
   else assert.equal(html.includes('data-app="git"'),enabled);
   if(enabled||name===standard){
    const ids=[...html.matchAll(/data-app="([^"]+)"/g)].map(x=>x[1]);
    assert.deepEqual(ids,['task','team','git']);
    assert.match(html,/AiDiy_git\.png/);
   }
  }
 }
});
