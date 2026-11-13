// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),req=createRequire(path.join(__dirname,'../ui/package.json'));
const vue=req('vue'),{parse,compileScript}=req('@vue/compiler-sfc'),{transformSync}=req('esbuild');
const {source}=require('./ui-components.cjs');
const {閉じた幅}=require('../diag/起動/マイクロ表示.cjs');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();await vue.nextTick();};
const nodes=node=>[node,...node.children.flatMap(nodes)];
async function fixture({switching=false}={}){
 const modules={'./アプリアイコン.mjs':await import('../diag/ui/components/アプリ起動/アプリアイコン.mjs'),'./アイコン移動.mjs':await import('../diag/ui/components/アプリ起動/アイコン移動.mjs'),'./円周配置.cjs':require('../diag/ui/components/アプリ起動/円周配置.cjs')};
 const window=new EventTarget(),calls=[],sizes=[],menus=[];let menuCallback;
 window.aidiyWindow={onMicroMenu:callback=>{menuCallback=callback;return ()=>menuCallback=null;},showMicroMenu:items=>menus.push(items),resizeMicroLabel:async height=>{sizes.push(height);return true;},expandMicro:async(...args)=>{calls.push(args);return true;}};
 const {descriptor}=parse(source('components/アプリ起動/マイクロランチャー.vue'));
 const compiled=compileScript(descriptor,{id:'micro-project',inlineTemplate:true,genDefaultAs:'component'}),module={exports:{}};
 vm.runInNewContext(transformSync(compiled.content+'\nmodule.exports=component;',{format:'cjs'}).code,{module,exports:module.exports,window,document:{documentElement:{classList:{add(){},remove(){}}}},setTimeout,clearTimeout,require:id=>id==='vue'?vue:modules[id]||{}});
 const make=(tag,text='')=>({tag,_text:text,get text(){return this._text+this.children.filter(n=>n.tag!=='#comment').map(n=>n.text).join('');},set text(value){this._text=value;},children:[],props:{},style:{},parent:null,querySelector(){return null;},querySelectorAll(){return [];},getBoundingClientRect(){return {height:Math.max(18,Math.ceil(this.text.length/10)*18)};}});
 const renderer=vue.createRenderer({createElement:make,createText:text=>make('#text',text),createComment:text=>make('#comment',text),setText:(n,t)=>n.text=t,setElementText:(n,t)=>{n.text=t;n.children=[];},parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]||null,patchProp:(n,k,_old,v)=>n.props[k]=v,insert(n,p,anchor){if(n.parent){const old=n.parent.children.indexOf(n);if(old>=0)n.parent.children.splice(old,1);}n.parent=p;const index=anchor?p.children.indexOf(anchor):-1;if(index<0)p.children.push(n);else p.children.splice(index,0,n);},remove(n){n.parent?.children.splice(n.parent.children.indexOf(n),1);}});
 const appState={フォルダ:vue.ref('/work/project'),項目:vue.ref([]),処理中:vue.ref(''),選択中:vue.ref(false),読込(){},利用可能:()=>true,不可理由:()=>'',接続(){},終了(){}},cliState={項目:vue.ref([]),読込(){},利用可能:()=>true,不可理由:()=>'',接続(){},終了(){}};
 const state={進捗表示:vue.ref(null)};
 const root=make('root'),app=renderer.createApp({render:()=>vue.h(module.exports,{appState,cliState,state,online:true,switching})});app.mount(root);
 return {app,root,appState,cliState,state,calls,sizes,menus,menu:action=>menuCallback?.(action),label:()=>nodes(root).find(n=>n.props.class==='micro-project'),core:()=>nodes(root).find(n=>n.props.class==='micro-core')};
}

test('VS Codeを含む6アプリ・7CLI・エディターの14個をアイコン表示へ渡す',async()=>{
 const f=await fixture();
 try{
  f.appState.項目.value=['avatar','ide','console','code','live','discord'].map(id=>({id,名前:id}));
  f.cliState.項目.value=['claude','codex','copilot','agy','grok','opencode','aidiy_hermes'].map(id=>({id,名前:id,利用可能:true}));
  f.cliState.項目.value.push({id:'vscode',名前:'VS Code',種類:'editor',利用可能:true});
  await flush();
  assert.equal(nodes(f.root).filter(n=>n.props.class==='micro-app').length,14);
  assert.ok(nodes(f.root).some(n=>n.tag==='img'&&n.props.src==='CLI_vscode.svg'));
  f.core().props.onClick({detail:0});await flush();assert.deepEqual(f.calls.at(-1),[true,14]);
 }finally{f.app.unmount();}
});

test('アイコンの下に1つだけプロジェクト名を表示し、Windows/POSIX・末尾区切り・変更・長名を扱う',async()=>{
 const f=await fixture();
 try{
  for(const [folder,name] of [['/work/プロジェクト/','プロジェクト'],['C:\\work\\AiDiy2027\\','AiDiy2027'],['\\\\server\\share\\project\\\\','project'],['/work/日本語 & <test>','日本語 & <test>'],['/work/'+ '長い名前'.repeat(50),'長い名前'.repeat(50)],['C:\\','C:'],['/','/'],['','']]){
   f.appState.フォルダ.value=folder;await vue.nextTick();
   assert.equal(f.label().text,name);assert.equal(f.label().props.title,name);
   assert.equal(nodes(f.root).filter(n=>n.props.class==='micro-project').length,1);
   assert.equal(f.label().props['data-micro-hit'],'');
   for(const event of ['onPointerdown','onPointermove','onPointerup','onPointercancel','onLostpointercapture'])assert.equal(typeof f.label().props[event],'function');
  }
  const image=nodes(f.core()).find(n=>n.tag==='img');assert.equal(image.props.src,'AiDiy.png');assert.equal(image.props.width,'40');assert.equal(image.props.height,'40');
  f.core().props.onClick({detail:0});await flush();
  assert.notEqual(f.label().style.display,'none','展開中も名前を表示したままにする');
  f.core().props.onClick({detail:0});await new Promise(resolve=>setTimeout(resolve,480));await flush();
  assert.notEqual(f.label().style.display,'none','収納後も名前を表示する');
 }finally{f.app.unmount();}
});

test('名前は透明な同幅領域で日本語・空白なし英字も折り返す',()=>{
 const css=req('postcss').parse(source('components/アプリ起動/マイクロランチャー.css')),d={};
 css.walkRules(r=>{if(r.selector==='.micro-project')r.walkDecls(v=>d[v.prop]=v.value);});
 assert.equal(d.background,'transparent');assert.equal(d['white-space'],'normal');assert.equal(d['overflow-wrap'],'anywhere');
 assert.equal(d.width,'120px');assert.equal(d['min-height'],'18px');assert.equal(d['text-overflow'],undefined);
 assert.equal(d['pointer-events'],'auto');assert.equal(d['-webkit-app-region'],'no-drag');
 assert.equal(d.top,'calc(var(--core-y,64px) + 48px)');assert.ok(parseFloat(d.width)<閉じた幅);
 const unfolded={};css.walkRules(r=>{if(r.selector==='.micro-launcher.unfolded .micro-project-name')r.walkDecls(v=>unfolded[v.prop]=v.value);});
 assert.equal(unfolded['-webkit-line-clamp'],'2');assert.equal(unfolded.overflow,'hidden');
});

test('ラベルの実測高さを送り、長名から短名へ戻しても縮める',async()=>{
 const f=await fixture();
 try{
  for(const name of ['short','日本語プロジェクト'.repeat(20),'unbrokenEnglishProjectName'.repeat(12),'','short']){
   f.appState.フォルダ.value='/work/'+name;await flush();
   assert.equal(f.sizes.at(-1),Math.max(18,Math.ceil(f.label().text.length/10)*18));
  }
 }finally{f.app.unmount();}
});

test('切替中もラベル高さを通知し、main側で完成画像に反映できる',async()=>{
 const f=await fixture({switching:true});
 try{f.appState.フォルダ.value='/work/'+'長い名称'.repeat(50);await flush();assert.equal(f.sizes.at(-1),Math.ceil(f.label().text.length/10)*18);}finally{f.app.unmount();}
});

 test('アイコン表示も短い進行状況を表示し、ランチャーの操作を妨げない',async()=>{
 const f=await fixture();
 try{
  f.state.進捗表示.value={種別:'stop',状態:'running',通知:'Tools を停止しています。'};await flush();
  const notice=nodes(f.root).find(n=>n.props.class==='micro-batch-status');
  assert.equal(notice.text,'強制停止中…');assert.equal(notice.props.title,'Tools を停止しています。');
  assert.equal(f.core().props.disabled,undefined);
  for(const kind of ['start','stop']){
   f.state.進捗表示.value={種別:kind,状態:'running',通知:'処理中'};await flush();
   assert.match(nodes(f.root).find(n=>n.props.class==='micro-batch-status').text,kind==='stop'?/強制停止中/:/一括起動中/);
   assert.ok(nodes(f.root).some(n=>n.props.class==='micro-batch-spinner'));
   for(const terminal of ['done','cancelled']){
    f.state.進捗表示.value={種別:kind,状態:terminal,通知:'完了'};await flush();assert.equal(nodes(f.root).some(n=>n.props.class==='micro-batch-status'),false);
   }
  }
  f.state.進捗表示.value={種別:'stop',状態:'error',通知:'停止失敗'};await flush();
  const error=nodes(f.root).find(n=>n.props.class==='micro-batch-status');assert.match(error.text,/要確認/);assert.match(error.props.title,/停止失敗/);
  assert.ok(nodes(error).some(n=>n.tag==='button'),'エラー詳細を通常表示で確認できる');
  f.state.進捗表示.value=null;await flush();assert.equal(nodes(f.root).some(n=>n.props.class==='micro-batch-status'),false);
 }finally{f.app.unmount();}
});


test('右クリック一覧は表示アイコンと同じ順序・件数で、非表示項目や無効表示を加えない',async()=>{
 const f=await fixture();
 try{
  f.appState.項目.value=[{id:'chrome',名前:'Chrome'},{id:'browser',名前:'aidiy_browser'},{id:'discord',名前:'Discord'},{id:'code',名前:'Code'}];
  f.cliState.項目.value=[{id:'aidiy_hermes',名前:'AiDiy Hermes'}];
  f.appState.利用可能=()=>true;
  await flush();
  nodes(f.root).find(n=>n.props['aria-label']==='アイコン化ランチャー').props.onContextmenu({preventDefault(){}});
  assert.deepEqual(Array.from(f.menus.at(-1),x=>x.key),['app:browser','app:code','app:discord','cli:aidiy_hermes','app:chrome']);
  assert.deepEqual(Array.from(f.menus.at(-1),x=>x.label),['Browser','Code','Discord','Hermes','Chrome']);
  assert.ok(f.menus.at(-1).every(x=>!Object.hasOwn(x,'enabled')));
  f.cliState.項目.value=[];await flush();
  nodes(f.root).find(n=>n.props['aria-label']==='アイコン化ランチャー').props.onContextmenu({preventDefault(){}});
  assert.equal(f.menus.at(-1).length,4);
 }finally{f.app.unmount();}
});


test('二重円は外側完了後に内側を展開し、収納は同じ遅延を反転する',async()=>{
 const f=await fixture();
 try{
  f.appState.項目.value=['avatar','task','team','ide','console','code','live','discord','browser','chrome'].map(id=>({id,名前:id}));
  f.cliState.項目.value=['aidiy_hermes','claude','codex','copilot','agy','grok','opencode','vscode'].map(id=>({id,名前:id}));await flush();
  const positions=nodes(f.root).filter(n=>n.props.class==='micro-position');
  assert.equal(positions.length,18);
  const start=n=>parseFloat(n.props.style['--open-delay']),end=n=>parseFloat(n.props.style['--close-delay']);
  const inner=positions.slice(0,7),outer=positions.slice(7);
  assert.equal(start(outer[0]),0);assert.ok(start(inner[0])>=start(outer.at(-1))+420);
  assert.equal(end(inner.at(-1)),0);assert.ok(end(outer.at(-1))>=end(inner[0])+420);
  for(const n of positions)assert.equal(start(n)+end(n),1140);
 }finally{f.app.unmount();}
});


test('起動不可の項目は円周と右クリックから消え、復帰すると同じ順序へ戻る',async()=>{
 const f=await fixture();let launches=0;const blocked=vue.ref(new Set());
 try{
  const ids=['chrome','slack','discord','cpu','team','task','avatar','browser','live','code','console','navi','ide'];
  const cliIds=['vscode','opencode','grok','agy','copilot','codex','claude','aidiy_hermes','aidiy_pi'];
  const expected=['ide','console','browser','navi','code','live','avatar','task','team','cpu','discord','slack','aidiy_hermes','aidiy_pi','claude','codex','copilot','agy','grok','opencode','vscode','chrome'];
  f.cliState.項目.value=cliIds.map(id=>({id,名前:id,利用可能:true}));
  f.appState.項目.value=ids.map(id=>({id,名前:id}));f.appState.利用可能=id=>!blocked.value.has(id);f.appState.起動=()=>launches++;
  for(const missing of [[],['task','team'],['task','team','browser','chrome'],['task','team','browser','chrome','slack'],[]]){
   blocked.value=new Set(missing);await flush();
   const shown=nodes(f.root).filter(n=>n.props.class==='micro-app').map(n=>n.props['data-app']||n.props['data-cli']);
   assert.deepEqual(shown,expected.filter(id=>!missing.includes(id)));
   nodes(f.root).find(n=>n.props['aria-label']==='アイコン化ランチャー').props.onContextmenu({preventDefault(){}});
   assert.deepEqual(Array.from(f.menus.at(-1),x=>x.key),shown.map(id=>(cliIds.includes(id)?'cli:':'app:')+id));
   for(const id of missing)f.menu({type:'launch',key:'app:'+id});
   assert.equal(launches,0);
  }
 }finally{f.app.unmount();}
});

test('円形のVS Codeは導入状態の変化に追従して表示・非表示になる',async()=>{
 const {CLI状態を作成}=await import('../diag/ui/components/アプリ起動/CLI状態.mjs');
 const f=await fixture();let installed=false;
 const cli=CLI状態を作成({アプリ:f.appState,api:async()=>({対象:[{id:'vscode',名前:'VS Code',種類:'editor',利用可能:installed}]})});
 try{
  for(const value of [false,true,false,undefined,true]){
   installed=value;await cli.読込();f.cliState.項目.value=cli.項目.value;await flush();
   assert.equal(nodes(f.root).some(n=>n.tag==='img'&&n.props.src==='CLI_vscode.svg'),value===true);
  }
 }finally{f.app.unmount();}
});
