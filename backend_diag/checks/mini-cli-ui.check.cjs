// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),req=createRequire(path.join(__dirname,'../ui/package.json'));
const vue=req('vue'),{parse,compileScript}=req('@vue/compiler-sfc'),{transformSync}=req('esbuild');
const {source,render,component,dependency}=require('./ui-components.cjs');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();await vue.nextTick();};
const descendants=node=>[node,...node.children.flatMap(descendants)];
const text=node=>node.text+node.children.map(text).join('');

test('通常のCLIアイコンは確認なしで起動し、未導入は非表示にして起動要求を送らない',async()=>{
 const {CLI状態を作成}=await import('../ui/src/components/アプリ起動/CLI状態.mjs');
 const icons=await import('../ui/src/components/アプリ起動/アプリアイコン.mjs');
 const state={項目:vue.ref([]),フォルダ:vue.ref('/fixture/project'),処理中:vue.ref(''),選択中:vue.ref(false),一覧:vue.ref(null),通知:vue.ref(''),結果:vue.ref({}),読込(){},利用可能:()=>true,不可理由:()=>'',接続(){},終了(){}};
 let prompts=0,failLaunch=false;const launches=[];
 const cliState=CLI状態を作成({アプリ:state,確認:()=>{prompts++;return false;},api:async(route,_method,_signal,_format,body)=>{
  if(route==='api/CLI起動')return {対象:[{id:'codex',名前:'Codex CLI',利用可能:true},{id:'grok',名前:'Grok Build',利用可能:false}]};
  launches.push(body);if(failLaunch)throw Error('fixture CLI failure');return {通知:'fixture launch'};
 }});
 const ui=mount(compile('components/アプリ起動/アプリ起動パネル.vue',{modules:{'./アプリアイコン.mjs':icons}}),()=>({state,cliState,online:true,visible:true}));
 try{
  await flush();assert.equal(ui.button('Grok Build をConsoleで起動'),undefined);
  await cliState.起動('grok',{確認省略:true});await flush();assert.equal(launches.length,0);assert.equal(prompts,0);
  ui.button('Codex CLI をConsoleで起動').props.onClick();await flush();
  assert.equal(prompts,0);assert.deepEqual(launches,[{対象:'codex',フォルダ:'/fixture/project',自動承認確認:true}]);
  assert.doesNotMatch(text(ui.root),/fixture launch/);
  failLaunch=true;ui.button('Codex CLI をConsoleで起動').props.onClick();await flush();assert.match(text(ui.root),/fixture CLI failure/);
 }finally{ui.app.unmount();}
});
function compile(name,{globals={},modules={},inline=true}={}){
 modules={'./起動モーション.mjs':dependency('components/アプリ起動/起動モーション.mjs'),'./ミニアイコン列.vue':component('components/アプリ起動/ミニアイコン列.vue'),...modules};
 const {descriptor}=parse(source(name),{filename:name});const compiled=compileScript(descriptor,{id:name,inlineTemplate:inline,genDefaultAs:'component'}),module={exports:{}};
 vm.runInNewContext(transformSync(compiled.content+'\nmodule.exports=component;',{format:'cjs'}).code,{module,exports:module.exports,URLSearchParams,AbortController,ResizeObserver:class{observe(){}disconnect(){}},...globals,require:id=>id==='vue'?vue:modules[id]||{}});return module.exports;
}
function mount(component,props){
 const make=(tag,text='')=>({tag,text,children:[],props:{},style:{setProperty(key,value){this[key]=value;}},offsetWidth:360,parent:null});
 const renderer=vue.createRenderer({createElement:tag=>make(tag),createText:text=>make('#text',text),createComment:text=>make('#comment',text),setText:(node,value)=>node.text=value,setElementText:(node,value)=>{node.text=value;node.children=[];},parentNode:node=>node.parent,nextSibling:node=>node.parent?.children[node.parent.children.indexOf(node)+1]||null,patchProp:(node,key,_old,value)=>node.props[key]=value,insert(node,parent,anchor){if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);node.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,node);},remove(node){node.parent?.children.splice(node.parent.children.indexOf(node),1);}});
 const root=make('root'),app=renderer.createApp({render:()=>vue.h(component,props())});app.mount(root);return {root,app,nodes:()=>descendants(root),button:label=>descendants(root).find(n=>n.tag==='button'&&(n.props['aria-label']===label||text(n)===label))};
}
test('実Vueタイトル欄: ミニ→最小化→最大化→ピン→終了の順、クリックと復帰は独立する',async()=>{
 const calls=[],window=new EventTarget();window.aidiyWindow={isMaximized:async()=>false,minimize:async()=>calls.push('minimize'),maximize:async()=>calls.push('maximize'),close:async()=>calls.push('close')};
 const props=vue.reactive({connected:true,compact:false,switching:false,onMini:()=>calls.push('mini'),onRestore:()=>calls.push('restore')});
 const ui=mount(compile('components/ウィンドウ/ステータスバー.vue',{globals:{window}}),()=>props);
 try{await flush();assert.deepEqual(ui.nodes().filter(n=>n.tag==='button').map(n=>n.props['aria-label']),['ランチャー表示','アイコン化','最小化','最大化','ピン止め（最前面 ON）','終了']);ui.button('ランチャー表示').props.onClick();assert.deepEqual(calls,['mini']);for(const label of ['最小化','最大化','終了'])ui.button(label).props.onClick();await flush();assert.deepEqual(calls,['mini','minimize','maximize','close']);props.compact=true;await flush();assert.deepEqual(ui.nodes().filter(n=>n.tag==='button').map(n=>n.props['aria-label']),['アイコン化','最小化','元のサイズに戻す','ピン止め（最前面 ON）','終了']);assert.equal(ui.button('元のサイズに戻す').props.disabled,false);ui.button('元のサイズに戻す').props.onClick();assert.equal(calls.at(-1),'restore');props.compact=false;props.connected=false;await flush();assert.equal(ui.button('ランチャー表示').props.disabled,true);}finally{ui.app.unmount();}
 const css=source('style.css');assert.match(css,/\.panel-brand\.desktop\{[^}]*-webkit-app-region:drag[;}]/);assert.match(css,/\.panel-brand button,\.window-actions\{[^}]*-webkit-app-region:no-drag[;}]/);
});
async function appState(switchMini=async()=>true,globals={}){
 const {認証セッションを作成}=await import('../ui/src/components/ウィンドウ/認証セッション.mjs');
 const 自動起動表示=await import('../ui/src/components/起動/自動起動表示.mjs');
 const 表示切替準備=await import('../ui/src/components/ウィンドウ/表示切替準備.mjs');
 const {起動ミニ表示を作成}=await import('../ui/src/components/ウィンドウ/起動ミニ表示.mjs');const displays=[],switches=[],noop=()=>{};
 const methods={接続:noop,終了:noop,中止:noop,切断:noop,表示を離れる:noop,読込:async()=>{},一覧:vue.ref(null),実行中:vue.ref(false)};
 const modules={
  './components/ウィンドウ/表示切替準備.mjs':表示切替準備,
  './components/ウィンドウ/認証セッション.mjs':{認証セッションを作成:options=>認証セッションを作成({...options,storage:()=>globals.sessionStorage})},
  './components/導入状況/導入状況状態.mjs':{導入状況状態を作成:()=>({一覧を反映:noop})},'./components/導入状況/導入操作状態.mjs':{導入操作状態を作成:()=>methods},
  './components/キー設定共通/キー設定状態.mjs':{キー設定状態を作成:()=>({終了:noop,resetPublic:noop,設定を破棄:noop})},'./components/ウィンドウ/Tools接続.mjs':{Tools接続を作成:()=>methods},
  './components/起動/起動状態.mjs':{起動状態を作成:()=>({表示:(...args)=>displays.push(args),終了:noop,自動起動完了:vue.ref(null)})},'./components/アプリ起動/アプリ状態.mjs':{アプリ状態を作成:()=>({...methods,フォルダ:vue.ref('')})},
  './components/起動/自動起動表示.mjs':自動起動表示,
  './components/アプリ起動/CLI状態.mjs':{CLI状態を作成:()=>methods},'./components/ウィンドウ/起動ミニ表示.mjs':{起動ミニ表示を作成:options=>起動ミニ表示を作成({...options,切替:async value=>{switches.push(value);return switchMini(value);}})},
  './components/AIモデル/AIモデル状態.mjs':{AIモデル状態を作成:()=>methods},'./components/設定モデル/設定モデル状態.mjs':{設定モデル状態を作成:()=>methods},
 };
 const app=compile('App.vue',{inline:false,modules,globals:{location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},window:{},fetch:async()=>{throw Error('unexpected request');},...globals}});
 const scope=vue.effectScope();let state;const warn=console.warn;console.warn=()=>{};try{state=scope.run(()=>app.setup({}, {expose(){}}));}finally{console.warn=warn;}
 return {scope,state,displays,switches};
}
test('実App状態: 自動起動完了でアプリ起動へ一度だけ移り、表示モードを変えない',async()=>{
 const {scope,state,displays,switches}=await appState();
 try{
  state.connected.value=true;await flush();
  state.起動.自動起動完了.value={実行ID:'auto-1',自動起動:true,種別:'start',状態:'done'};await flush();
  assert.equal(state.tab.value,'apps');assert.equal(state.ミニ表示.value,false);assert.deepEqual(switches,[]);assert.deepEqual(displays.at(-1),[true,false]);
  await state.changeTab('start');state.起動.自動起動完了.value={実行ID:'auto-1',自動起動:true,種別:'start',状態:'done'};await flush();assert.equal(state.tab.value,'start');
 }finally{scope.stop();}
});
test('実App状態: 完了前のタブ選択・表示切替を優先する',async()=>{
 for(const action of ['tab','mini']){
  const {scope,state}=await appState();
  try{
   state.connected.value=true;await flush();
   if(action==='tab')await state.changeTab('start');else await state.表示切替('mini');
   state.起動.自動起動完了.value={実行ID:'auto-2',自動起動:true,種別:'start',状態:'done'};await flush();
   assert.equal(state.tab.value,'start');assert.equal(state.ミニ表示.value,action==='mini');
  }finally{scope.stop();}
 }
});
test('実App状態: 全7タブからミニへ移行し元のタブへ復帰、ミニ中はポート監視を維持する',async()=>{
 const {scope,state,displays,switches}=await appState();
 try{state.connected.value=true;await flush();for(const tab of ['install','keys','integrations','trials','manual','start','apps']){state.tab.value=tab;await flush();assert.equal(state.ミニ表示.value,false);await state.ミニ.変更(true);await flush();assert.equal(state.tab.value,tab);assert.equal(state.ミニ表示.value,true);assert.deepEqual(displays.at(-1),[true,false]);await state.ミニ.変更(false);await flush();assert.equal(state.tab.value,tab);assert.equal(state.ミニ表示.value,false);}assert.equal(switches.length,14);await state.ミニ.変更(true);state.connected.value=false;await flush();assert.equal(state.ミニ表示.value,false);}finally{scope.stop();}
 const appSource=source('App.vue');for(const tab of ['install','keys','integrations','trials','manual'])assert.ok(appSource.includes(`v-show="tab==='${tab}'&&!ミニ表示"`));assert.match(appSource,/v-if="ミニ\.表示中\.value&&!マイクロ表示" :is="起動ミニパネル"/);
});
test('電光掲示板はネイティブbuttonで、全7タブのミニからアプリ起動へ復帰し連打をまとめる',async()=>{
 const {scope,state,switches}=await appState();
 const app={項目:vue.ref([]),結果:vue.ref({}),フォルダ:vue.ref(''),処理中:vue.ref(''),選択中:vue.ref(false),読込(){},利用可能:()=>true,不可理由:()=>'',接続(){},終了(){}};
 const services={進捗表示:vue.ref(null),ポート項目:vue.ref([]),項目:vue.ref([]),停止警告対象:vue.ref(new Set())};
 const panel=component('components/起動/起動ミニパネル.vue').default;
 const ui=mount({render:()=>state.ミニ表示.value?vue.h(panel,{appState:app,appOnline:true,state:services,online:true,onOpenApps:state.アプリ起動へ戻る}):null},()=>({}));
 try{
  state.connected.value=true;await flush();
  for(const tab of ['install','keys','integrations','trials','manual','start','apps']){
   state.tab.value=tab;await state.ミニ.変更(true);await flush();
   const banner=ui.button('アプリ起動パネルでプロジェクトを選択');
   assert.ok(banner);assert.equal(banner.tag,'button');assert.equal(banner.props.type,'button');assert.match(text(banner),/SELECT YOUR PROJECT/);
   // Enter/Spaceはネイティブbuttonに任せ、独自key/pointer処理で二重発火や長押し移動を起こさない。
   assert.equal(banner.props.tabindex,undefined);assert.equal(banner.props.role,undefined);assert.equal(banner.props.onKeydown,undefined);assert.equal(banner.props.onKeyup,undefined);assert.equal(banner.props.onPointerdown,undefined);assert.equal(banner.props.onMousedown,undefined);
   const before=switches.length;banner.props.onClick();banner.props.onClick();
   assert.equal(state.ミニ.切替中.value,true);assert.equal(state.tab.value,'apps');
   await flush();assert.deepEqual(switches.slice(before),[false]);assert.equal(state.ミニ表示.value,false);assert.equal(ui.button('アプリ起動パネルでプロジェクトを選択'),undefined);
  }
  assert.equal(switches.length,14);
 }finally{ui.app.unmount();scope.stop();}
 assert.match(source('App.vue'),/@open-apps="アプリ起動へ戻る"/);
});
test('実Vue CLI行: 確認なしで並行起動し、処理中・成功・失敗でも通知行を増やさない',async()=>{
 const {CLI状態を作成}=await import('../ui/src/components/アプリ起動/CLI状態.mjs');const アプリ={フォルダ:vue.ref(''),処理中:vue.ref(''),選択中:vue.ref(false)};
 const launches=[],pending=[];let prompts=0;
 const state=CLI状態を作成({アプリ,確認:()=>{prompts++;return false;},api:async(route,method,_signal,format,body)=>{
  if(route==='api/CLI起動')return {対象:[{id:'copilot',名前:'GitHub Copilot CLI',モード:'YOLO',利用可能:true}]};
  assert.equal(route,'api/CLI起動/開始');launches.push({method,format,body});return new Promise((resolve,reject)=>pending.push({resolve,reject}));
 }});
 const ui=mount(compile('components/アプリ起動/ミニCLI起動.vue'),()=>({state,appState:アプリ,online:true}));
 const cli=()=>ui.nodes().find(n=>n.props['data-cli']==='copilot'),message=()=>ui.nodes().find(n=>n.props.class?.includes('mini-cli-message'));
 try{
  await flush();assert.equal(cli().props.disabled,true);assert.equal(text(cli()),'');assert.equal(cli().props['aria-label'],'GitHub Copilot CLI をConsoleで起動（YOLO）');assert.equal(descendants(cli()).find(n=>n.tag==='img').props.src,'CLI_copilot.svg');assert.match(cli().props.title,/YOLO.*モデル指定なし/);
  アプリ.フォルダ.value='/日本語 path & ;';await flush();assert.equal(cli().props.disabled,false);
  cli().props.onClick();cli().props.onClick();assert.equal(prompts,0);assert.equal(launches.length,2);
  assert.deepEqual(launches[0],{method:'POST',format:'json',body:{対象:'copilot',フォルダ:'/日本語 path & ;',自動承認確認:true}});
  assert.deepEqual(launches[0],launches[1]);assert.match(cli().props.title,/複数起動可/);
  await flush();assert.equal(cli().props.disabled,false);assert.equal(state.処理中.value,'copilot');assert.equal(アプリ.処理中.value,'cli:copilot');assert.equal(message(),undefined);
  pending[1].resolve({通知:'Console 起動受付'});await flush();assert.equal(message(),undefined);
  pending[0].resolve({通知:'古い起動受付'});await flush();assert.equal(cli().props.disabled,false);assert.equal(state.通知.value,'');assert.doesNotMatch(text(ui.root),/Console 起動受付/);assert.equal(message(),undefined);
  cli().props.onClick();pending[2].reject(Error('Console を開始できません'));await flush();assert.equal(launches.length,3);assert.equal(prompts,0);assert.equal(cli().props.disabled,false);assert.equal(message(),undefined);assert.equal(state.通知.value,'Console を開始できません');assert.doesNotMatch(text(ui.root),/Console を開始できません/);
  cli().props.onClick();await flush();assert.equal(cli().props.disabled,false);assert.doesNotMatch(text(ui.root),/Console を開始できません/);pending[3].resolve({通知:'再試行の起動受付'});await flush();assert.equal(message(),undefined);assert.doesNotMatch(text(ui.root),/再試行の起動受付/);
  アプリ.選択中.value=true;await flush();assert.equal(cli().props.disabled,true);アプリ.選択中.value=false;アプリ.処理中.value='code';await flush();assert.equal(cli().props.disabled,true);
 }finally{ui.app.unmount();}
 const panel=source('components/起動/起動ミニパネル.vue');assert.ok(panel.indexOf(':is="ミニアプリ起動"')<panel.indexOf(':is="ミニCLI起動"'));assert.ok(panel.indexOf(':is="ミニCLI起動"')<panel.indexOf('class="mini-services"'));
});
test('実Vue AiDiy行: 6アプリは確認なしで起動し、処理中・成功・失敗でもプロジェクト表示を保つ',async()=>{
 const {アプリ状態を作成}=await import('../ui/src/components/アプリ起動/アプリ状態.mjs'),icons=await import('../ui/src/components/アプリ起動/アプリアイコン.mjs');
 const ids=['avatar','ide','console','code','live','discord'],launches=[];let release,prompts=0;
 const state=アプリ状態を作成({api:async(route,method,_signal,format,body)=>{
  if(route==='api/アプリ起動')return {対象:ids.map(id=>({id,名前:id}))};
  assert.equal(route,'api/アプリ起動/開始');launches.push({method,format,body});return new Promise((resolve,reject)=>release={resolve,reject});
 }});
 const ui=mount(compile('components/アプリ起動/ミニアプリ起動.vue',{modules:{'./アプリアイコン.mjs':icons},globals:{confirm:()=>{prompts++;return false;}}}),()=>({state,online:true}));
 const buttons=()=>ui.nodes().filter(n=>n.props['data-app']),button=id=>buttons().find(n=>n.props['data-app']===id),message=()=>ui.nodes().find(n=>n.props.class?.includes('mini-app-message'));
 try{
  await flush();assert.equal(buttons().length,6);assert.ok(buttons().every(n=>n.props.disabled));assert.match(text(message()),/SELECT YOUR PROJECT/);
  state.フォルダ.value='/日本語 project & ;';await flush();assert.equal(text(message()),state.フォルダ.value);
  for(const [index,id] of ids.entries()){
   button(id).props.onClick();button(id).props.onClick();assert.equal(launches.length,index+1);assert.equal(prompts,0);
   assert.deepEqual(launches.at(-1),{method:'POST',format:'json',body:{対象:id,フォルダ:'/日本語 project & ;'}});
   await flush();assert.ok(buttons().every(n=>n.props.disabled));assert.equal(text(message()),state.フォルダ.value);
   const notification=id+' の起動結果の説明';release.resolve({通知:notification,起動済み:index%2===1});await flush();
   assert.equal(state.結果.value[id].通知,notification);assert.equal(text(message()),state.フォルダ.value);assert.equal(message().props.title,state.フォルダ.value);assert.doesNotMatch(text(ui.root),/起動結果の説明/);assert.ok(buttons().every(n=>!n.props.disabled));
  }
  button('code').props.onClick();release.reject(Error('Code を開始できません'));await flush();assert.equal(text(message()),state.フォルダ.value);assert.equal(state.結果.value.code.通知,'Code を開始できません');assert.doesNotMatch(text(ui.root),/Code を開始できません/);assert.ok(buttons().every(n=>!n.props.disabled));
  button('code').props.onClick();await flush();assert.equal(text(message()),state.フォルダ.value);assert.doesNotMatch(text(ui.root),/Code を開始できません/);release.resolve({通知:'Code の再試行を受け付けました'});await flush();assert.equal(text(message()),state.フォルダ.value);assert.doesNotMatch(message().props.class,/error/);
  state.フォルダ.value='';await flush();assert.match(text(message()),/SELECT YOUR PROJECT/);assert.ok(buttons().every(n=>n.props.disabled));assert.equal(prompts,0);
 }finally{ui.app.unmount();}
});
test('CLIの名前は安全なテキスト、エラーはミニに表示しない',async()=>{
 const state={項目:vue.ref([{id:'copilot',名前:'<script>bad</script>',モード:'YOLO'}]),読込中:vue.ref(false),処理中:vue.ref(''),通知:vue.ref('<script>error</script>'),失敗:vue.ref(true),読込(){},利用可能:()=>true,不可理由:()=>'',接続(){},終了(){},切断(){}};
 const html=await render('components/アプリ起動/ミニCLI起動.vue',{state,appState:{フォルダ:vue.ref('/project'),処理中:vue.ref(''),選択中:vue.ref(false)},online:true});assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;bad/);assert.doesNotMatch(html,/&lt;script&gt;error|mini-cli-message/);
});

test('ミニのCLI更新ボタンと空見出しをなくし、表示・再接続時の自動読込は維持する',async()=>{
 let reads=0,disconnects=0;const online=vue.ref(true),state={項目:vue.ref([]),読込中:vue.ref(false),処理中:vue.ref(''),通知:vue.ref(''),失敗:vue.ref(false),読込(){reads++;},切断(){disconnects++;}};
 const ui=mount(compile('components/アプリ起動/ミニCLI起動.vue'),()=>({state,appState:{フォルダ:vue.ref('/project'),処理中:vue.ref(''),選択中:vue.ref(false)},online:online.value}));
 try{
  await flush();assert.equal(reads,1);assert.doesNotMatch(text(ui.root),/外部CLI\s*[·・]\s*自動承認|↻/);
  assert.ok(!ui.nodes().some(n=>n.props['aria-label']==='利用可能なCLIを再確認'||n.props.class==='mini-cli-heading'));
  state.読込中.value=true;await flush();assert.equal(reads,1);state.読込中.value=false;
  online.value=false;await flush();assert.equal(disconnects,1);assert.equal(reads,1);
  online.value=true;await flush();assert.equal(reads,2);
 }finally{ui.app.unmount();}
 assert.doesNotMatch(source('components/起動/起動ミニ.css'),/mini-cli-heading/);
});


test('外部CLI0件は行ごと非表示、1・3・6件だけ表示し、Hermesは件数に含めない',async()=>{
 const ids=['claude','codex','copilot','agy','grok','opencode'],entry=id=>({id,名前:id,モード:'YOLO'});
 const state={項目:vue.ref([entry('aidiy_hermes')]),読込中:vue.ref(false),処理中:vue.ref(''),通知:vue.ref(''),失敗:vue.ref(false),読込(){},利用可能:()=>true,不可理由:()=>'',接続(){},終了(){},切断(){}};
 const ui=mount(compile('components/アプリ起動/ミニCLI起動.vue'),()=>({state,appState:{フォルダ:vue.ref('/project'),処理中:vue.ref(''),選択中:vue.ref(false)},online:true}));
 try{
  for(const count of [0,1,3,6,0]){
   state.項目.value=[entry('aidiy_hermes'),...ids.slice(0,count).map(entry)];await flush();
   assert.equal(ui.nodes().filter(n=>n.props.class==='mini-cli-launch').length,count?1:0);
   assert.deepEqual(ui.nodes().filter(n=>n.props['data-cli']).map(n=>n.props['data-cli']),ids.slice(0,count));
   assert.ok(!ui.nodes().some(n=>n.props.class==='mini-cli-heading'||n.props.class==='mini-cli-empty'));
   assert.doesNotMatch(text(ui.root),/利用可能な外部CLIなし|↻/);
  }
  state.失敗.value=true;state.通知.value='CLI一覧を取得できません';await flush();
  assert.equal(ui.nodes().filter(n=>n.props.class==='mini-cli-launch').length,0);
  assert.doesNotMatch(text(ui.root),/CLI一覧を取得できません/);assert.ok(!ui.nodes().some(n=>n.props.class?.includes('mini-cli-message')));
  state.失敗.value=false;state.通知.value='';await flush();assert.ok(!ui.nodes().some(n=>n.props.class?.includes('mini-cli-message')));
 }finally{ui.app.unmount();}
});

test('アイコンは上段AiDiy7種（CPUを含む）＋Hermes、下段外部CLI6種。HermesとCLIは並行起動・成功非表示',async()=>{
 const {CLI状態を作成}=await import('../ui/src/components/アプリ起動/CLI状態.mjs');const icons=await import('../ui/src/components/アプリ起動/アプリアイコン.mjs');
 const ids=['claude','codex','copilot','agy','grok','opencode','aidiy_hermes'],apps=['avatar','ide','cpu','console','code','live','discord'];let prompts=0;const launches=[],appLaunches=[],pending=[];
 const app={項目:vue.ref(apps.map((id,i)=>({id,名前:['Avatar','IDE','CPU','Console','Code','Live','Discord'][i]}))),結果:vue.ref({}),フォルダ:vue.ref(''),処理中:vue.ref(''),選択中:vue.ref(false),読込(){},利用可能:()=>true,不可理由:()=>'',接続(){},終了(){},利用可能:()=>true,不可理由:()=>'',起動:id=>appLaunches.push(id)};
 const state=CLI状態を作成({アプリ:app,確認:()=>{prompts++;return false;},api:async(route,_method,_signal,_format,body)=>route==='api/CLI起動'?{対象:ids.map(id=>({id,名前:id,モード:'YOLO',利用可能:true}))}:(launches.push(body),new Promise((resolve,reject)=>pending.push({resolve,reject})))});
 const upper=mount(compile('components/アプリ起動/ミニアプリ起動.vue',{modules:{'./アプリアイコン.mjs':icons}}),()=>({state:app,cliState:state,online:true}));
 const lower=mount(compile('components/アプリ起動/ミニCLI起動.vue'),()=>({state,appState:app,online:true}));
 const upperButtons=()=>upper.nodes().filter(n=>n.props['data-app']||n.props['data-cli']),lowerButtons=()=>lower.nodes().filter(n=>n.props['data-cli']),hermes=()=>upper.nodes().find(n=>n.props['data-cli']==='aidiy_hermes');
 try{await flush();assert.equal(upperButtons().length,8);assert.deepEqual(upperButtons().map(n=>n.props['data-app']||n.props['data-cli']),['ide','console','code','live','aidiy_hermes','avatar','cpu','discord']);assert.deepEqual(lowerButtons().map(n=>n.props['data-cli']),ids.filter(id=>id!=='aidiy_hermes'));assert.equal(lowerButtons().length,6);assert.ok(!lowerButtons().some(n=>n.props['data-cli']==='aidiy_hermes'));assert.equal(hermes().props.disabled,true);
  assert.ok([...upper.nodes(),...lower.nodes()].every(n=>!n.props.class?.includes('mini-icon-caption')));
  for(const button of [...upperButtons(),...lowerButtons()]){
   const img=descendants(button).find(n=>n.tag==='img'),appId=button.props['data-app'],cliId=button.props['data-cli'];
   assert.equal(img.props.width,'36');assert.equal(img.props.height,'36');assert.equal(button.children[0].props.class,'mini-icon-frame');assert.equal(text(button),'');
   const name=cliId==='aidiy_hermes'?'Hermes':appId?app.項目.value.find(item=>item.id===appId).名前:state.項目.value.find(item=>item.id===cliId).名前;
   assert.ok(button.props['aria-label'].includes(name));assert.ok(button.props.title.includes(name));
   assert.equal(img.props.src,appId?icons.アプリアイコン[appId]:cliId==='aidiy_hermes'?'CLI_aidiy_hermes.png':'CLI_'+cliId+'.svg');
  }
  app.フォルダ.value='/project';await flush();assert.equal(hermes().props.disabled,false);
  hermes().props.onClick();hermes().props.onClick();lowerButtons()[0].props.onClick();assert.equal(prompts,0);assert.equal(launches.length,3);assert.deepEqual(launches[0],{対象:'aidiy_hermes',フォルダ:'/project',自動承認確認:true});assert.deepEqual(launches[1],launches[0]);assert.equal(launches[2].対象,'claude');
  await flush();assert.ok(upperButtons().filter(n=>n.props['data-app']).every(n=>n.props.disabled));assert.ok([hermes(),...lowerButtons()].every(n=>!n.props.disabled));assert.equal(appLaunches.length,0);
  pending[1].resolve({通知:'Hermes Console 起動受付'});await flush();assert.equal(state.処理中.value,'claude');
  pending[2].resolve({通知:'Claude Console 起動受付'});await flush();assert.equal(state.処理中.value,'aidiy_hermes');
  pending[0].resolve({通知:'古いHermes受付'});await flush();assert.equal(hermes().props.disabled,false);assert.doesNotMatch(text(upper.root)+text(lower.root),/Hermes Console 起動受付|Claude Console 起動受付|古いHermes受付/);assert.equal(lower.nodes().find(n=>n.props.class?.includes('mini-cli-message')),undefined);
  hermes().props.onClick();pending[3].reject(Error('Hermes の起動に失敗しました'));await flush();assert.equal(prompts,0);assert.equal(launches.length,4);assert.doesNotMatch(text(upper.root)+text(lower.root),/Hermes の起動に失敗しました/);assert.equal(state.通知.value,'Hermes の起動に失敗しました');assert.equal(hermes().props.disabled,false);
  state.項目.value=state.項目.value.filter(item=>item.id!=='aidiy_hermes');await flush();assert.equal(upperButtons().length,7);assert.equal(lowerButtons().length,6);assert.equal(hermes(),undefined);
 }finally{upper.app.unmount();lower.app.unmount();}
 const css=source('components/起動/起動ミニ.css');assert.match(css,/\.mini-icon-track\{display:grid;[^}]*justify-content:center;gap:2px;overflow:clip/);assert.match(css,/\.mini-icon-track\[data-overflow\]\{justify-content:flex-start/);assert.match(css,/\.mini-app-buttons \.mini-app-button,\.mini-cli-buttons \.mini-cli-button\{flex:0 0 48px\}/);assert.match(css,/\.mini-services\{flex:none;display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);assert.match(css,/\.mini-icon-frame\{[^}]*width:36px;height:36px/);assert.match(css,/\.mini-icon-frame img\{[^}]*width:36px;height:36px;object-fit:contain/);
});

test('実App認証: URLを消した後の再読込・手入力・401をセッションへ反映する',async()=>{
 const data=new Map(),sessionStorage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 let location=new URL('http://127.0.0.1:3456/#token=fixture'),ok=true,malformed=false,pending401;const headers=[];
 const globals={URL,get location(){return location;},sessionStorage,history:{replaceState(_state,_title,target){location=new URL(target,location);}},fetch:async(_url,options)=>{headers.push(options.headers.Authorization);if(_url.pathname.endsWith('/delayed'))return new Promise(resolve=>pending401=resolve);return {ok,status:ok?200:401,json:async()=>{if(malformed)throw SyntaxError('invalid JSON');return {};}};}};
 let current=await appState(undefined,globals);
 try{
  assert.equal(location.hash,'');await current.state.connect();assert.equal(current.state.connected.value,true);assert.equal(headers.at(-1),'Bearer fixture');
 }finally{current.scope.stop();}
 current=await appState(undefined,globals);
 try{
  assert.equal(current.state.key.value,'fixture');await current.state.connect();assert.equal(current.state.connected.value,true);
  current.state.input.value=' manual ';current.state.submit();await flush();assert.equal(current.state.key.value,'manual');assert.equal(headers.at(-1),'Bearer manual');
  ok=false;await assert.rejects(current.state.api('api/一覧'));assert.equal(current.state.key.value,'');assert.equal(current.state.connected.value,false);assert.equal(data.size,0);
  ok=true;current.state.input.value='next';current.state.submit();await flush();assert.equal(data.size,1);
  const delayed=current.state.api('api/delayed');const rejected=assert.rejects(delayed);current.state.input.value='newer';current.state.submit();await flush();
  pending401({ok:false,status:401,json:async()=>({})});await rejected;assert.equal(current.state.key.value,'newer');assert.equal(current.state.connected.value,true);assert.ok([...data.values()].includes('newer'));
  ok=false;malformed=true;await assert.rejects(current.state.api('api/一覧'),/invalid JSON/);assert.equal(current.state.key.value,'');assert.equal(data.size,0);
 }finally{current.scope.stop();}
 current=await appState(undefined,globals);try{assert.equal(current.state.key.value,'');}finally{current.scope.stop();}
});
test('VS Code は通常とミニで編集用ラベルを表示し同じフォルダの専用APIへ送る',async()=>{
 const {CLI状態を作成}=await import('../ui/src/components/アプリ起動/CLI状態.mjs');
 const icons=await import('../ui/src/components/アプリ起動/アプリアイコン.mjs');
 const state={項目:vue.ref([]),フォルダ:vue.ref('/fixture/日本語 project'),処理中:vue.ref(''),選択中:vue.ref(false),一覧:vue.ref(null),通知:vue.ref(''),結果:vue.ref({}),読込(){},利用可能:()=>true,不可理由:()=>'',接続(){},終了(){}};
 const launches=[];const cliState=CLI状態を作成({アプリ:state,確認:()=>assert.fail('editor confirmation'),api:async(route,_method,_signal,_format,body)=>{
  if(route==='api/CLI起動')return {対象:[{id:'vscode',名前:'VS Code',種類:'editor',モード:'プロジェクトフォルダを開く',利用可能:true}]};launches.push({route,body});return {};
 }});
 for(const [file,props] of [['components/アプリ起動/アプリ起動パネル.vue',{state,cliState,online:true,visible:true}],['components/アプリ起動/ミニCLI起動.vue',{state:cliState,appState:state,online:true}]]){
  const ui=mount(compile(file,{modules:{'./アプリアイコン.mjs':icons}}),()=>props);
  try{await flush();const button=ui.button('VS Code でフォルダを開く');assert.ok(button);assert.doesNotMatch(button.props.title,/モデル指定なし|自動承認/);button.props.onClick();await flush();assert.deepEqual(launches.at(-1),{route:'api/VSCode起動/開始',body:{フォルダ:state.フォルダ.value}});assert.ok(ui.nodes().some(node=>node.tag==='img'&&node.props.src==='CLI_vscode.svg'));}finally{ui.app.unmount();}
 }
});


test('Chrome / Browser icons render in full and mini launchers; Chrome works without project and Browser stays gated',async()=>{
 const {アプリ状態を作成}=await import('../ui/src/components/アプリ起動/アプリ状態.mjs');
 const icons=await import('../ui/src/components/アプリ起動/アプリアイコン.mjs');
 for(const name of ['components/アプリ起動/アプリ起動パネル.vue','components/アプリ起動/ミニアプリ起動.vue']){
  const calls=[];const state=アプリ状態を作成({api:async(route,_method,_signal,_format,body)=>{calls.push({route,body});return route==='api/アプリ起動'?{対象:[{id:'chrome',名前:'Chrome',利用可能:true},{id:'browser',名前:'aidiy_browser',利用可能:true}],フォルダ:''}:{メッセージ:'opened'};}});
  await state.読込();const cliState={項目:vue.ref([]),全項目:vue.ref([]),読込(){},失敗:vue.ref(false)};
  const modules={'./アプリアイコン.mjs':icons};
  const target=name.includes('ミニアプリ')?{setup:()=>()=>vue.h('div',[vue.h(compile(name,{modules}),{state,cliState,online:true}),vue.h(compile('components/アプリ起動/ミニCLI起動.vue',{modules}),{state:cliState,appState:state,online:true})])}:compile(name,{modules});
  const ui=mount(target,()=>({state,cliState,online:true,visible:true}));
  try{
   await flush();assert.deepEqual(ui.nodes().filter(n=>n.props['data-app']).map(n=>n.props['data-app']),['browser','chrome']);assert.equal(ui.button('Chrome を起動').props.disabled,false);assert.equal(ui.button('Browser を起動').props.disabled,true);
   assert.ok(ui.nodes().some(n=>n.tag==='img'&&n.props.src==='Chrome.svg'));assert.ok(ui.nodes().some(n=>n.tag==='img'&&n.props.src==='AiDiy_browser.png'));
   ui.button('Chrome を起動').props.onClick({});await flush();assert.deepEqual(calls.at(-1),{route:'api/起動/ブラウザ',body:{}});
   state.フォルダ.value='/project';await flush();assert.equal(ui.button('Browser を起動').props.disabled,false);
   state.項目.value[0].利用可能=false;await flush();const chrome=ui.nodes().find(n=>n.tag==='button'&&String(n.props['aria-label']).startsWith('Chrome を起動'));if(name.includes('ミニ'))assert.equal(chrome,undefined);else assert.equal(chrome.props.disabled,true);state.項目.value[0].利用可能=true;await flush();assert.ok(ui.button('Chrome を起動'));
  }finally{ui.app.unmount();state.終了();}
 }
});

test('通常・ミニのVS CodeとCLIは導入済みだけ表示する',async()=>{
 const {CLI状態を作成}=await import('../ui/src/components/アプリ起動/CLI状態.mjs');
 const icons=await import('../ui/src/components/アプリ起動/アプリアイコン.mjs');
 for(const name of ['components/アプリ起動/アプリ起動パネル.vue','components/アプリ起動/ミニCLI起動.vue']){
  const appState={項目:vue.ref([]),フォルダ:vue.ref('/fixture'),処理中:vue.ref(''),選択中:vue.ref(false),一覧:vue.ref(null),通知:vue.ref(''),結果:vue.ref({}),読込(){},利用可能:()=>true,不可理由:()=>''};
  let installed=false,launches=0;
  const cliState=CLI状態を作成({アプリ:appState,api:async route=>{
   if(route==='api/CLI起動')return {対象:[{id:'vscode',名前:'VS Code',種類:'editor',利用可能:installed},{id:'grok',名前:'Grok Build',利用可能:false}]};
   launches++;throw Error('render must not launch');
  }});
  const mini=name.includes('ミニ'),ui=mount(compile(name,{modules:{'./アプリアイコン.mjs':icons}}),()=>mini?{state:cliState,appState,online:true}:{state:appState,cliState,online:true,visible:true});
  try{
   for(const value of [false,true,false,undefined,true]){
    installed=value;await cliState.読込();await flush();
    assert.equal(ui.nodes().some(n=>n.tag==='img'&&n.props.src==='CLI_vscode.svg'),value===true);
    assert.equal(ui.nodes().some(n=>n.tag==='img'&&n.props.src==='CLI_grok.svg'),false);
   }
   assert.equal(launches,0);
  }finally{ui.app.unmount();}
 }
});

test('実App状態: 標準/ミニの折畳みからランチャー・アイコンへ開いた状態で遷移する',async()=>{
 for(const initialMini of [false,true])for(const target of ['mini','micro','normal']){
  const calls=[],window={aidiyWindow:{collapsePanel:async value=>{calls.push(['collapse',value]);return {ok:true};},beginDisplay:async mode=>{calls.push(['begin',mode]);return true;},finishDisplay:async()=>true,startMicro:async()=>true}};
  const {scope,state}=await appState(async()=>true,{window});
  try{
   state.connected.value=true;state.アプリ.フォルダ.value='/fixture';await flush();
   if(initialMini)await state.ミニ.変更(true);
   state.パネル折畳み.value=true;state.パネル非表示.value=true;
   assert.equal(await state.表示切替(target),true);assert.deepEqual(calls,[['collapse',false],['begin',target]]);
   assert.equal(state.パネル折畳み.value,false);assert.equal(state.パネル非表示.value,false);assert.equal(state.パネル表示世代.value,1);
   assert.equal(state.マイクロ表示.value,target==='micro');assert.equal(state.ミニ.表示中.value,target==='mini');
  }finally{scope.stop();}
 }
});
