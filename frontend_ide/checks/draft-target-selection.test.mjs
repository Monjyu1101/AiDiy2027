// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {createDraftTargetRegistry} from '../src/components/下書き連携/連携先登録.js';
const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
const target=(id,kind='code')=>({id,kind,label:`${kind} ${id}`,contextId:`context-${id}`,projectPath:'/project',maxLength:200000});
const walk=(node,predicate)=>predicate(node)?node:node.children?.map(child=>walk(child,predicate)).find(Boolean);
const textOf=node=>[node.text||'',...(node.children||[]).map(textOf)].join('');
const hasClass=(node,name)=>String(node.props?.class||'').split(/\s+/).includes(name);
const node=type=>({type,tagName:type.toUpperCase(),props:{},children:[],listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},removeEventListener(name){delete this.listeners[name];},get options(){return this.children.filter(item=>item.type==='option');}});
const renderer=vue.createRenderer({
 createElement:node,createText:text=>({...node('#text'),text}),createComment:text=>({...node('#comment'),text}),
 setText:(node,text)=>{node.text=text;},setElementText:(node,text)=>{node.text=text;node.children=[];},
 parentNode:node=>node.parent,nextSibling:node=>node.parent?.children[node.parent.children.indexOf(node)+1],
 insert(node,parent,anchor){if(node.parent){const at=node.parent.children.indexOf(node);if(at>=0)node.parent.children.splice(at,1);}node.parent=parent;const at=parent.children.indexOf(anchor);parent.children.splice(at<0?parent.children.length:at,0,node);},
 remove(node){const at=node.parent?.children.indexOf(node);if(at>=0)node.parent.children.splice(at,1);},
 patchProp(node,key,_old,value){node.props[key]=value;if(key==='value')node._value=node.value=value;},
});
function compile(path,{modules={},globals={},scriptOnly=false,vueApi=vue}={}){
 const {descriptor}=parse(readFileSync(new URL(path,import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:path,genDefaultAs:'component'});
 const template=scriptOnly?'':compileTemplate({source:descriptor.template.content,filename:path,id:path,compilerOptions:{bindingMetadata:script.bindings}}).code;
 const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template+'\n'+(scriptOnly?'':'component.render=render;')+'module.exports=component;',{format:'cjs'}).code,{module,console,AbortController,AbortSignal,URLSearchParams,Response,URL,Date,
  require:id=>id==='vue'?vueApi:modules[id]||{},...globals});
 return module.exports;
}
function dialogFixture(initial,{load,launch,frontmost=initial.length===1?initial[0].id:''}={}){
 let current=initial,preferred=frontmost,calls=0,apiResult={ok:true},state;
 const inserted=[],emitted=[];
 const component=compile('../src/dialog/下書き連携ダイアログ.vue',{modules:{'./共通ダイアログ.vue':vue.defineComponent({setup(_props,{slots}){return()=>vue.h('section',slots.default?.());}})}});
 const setup=component.setup;component.setup=(props,context)=>{state=setup(props,{...context,emit:(...args)=>emitted.push(args)});return state;};
 const root=node('root'),app=renderer.createApp(component,{request:{path:'file',projectPath:'/project',text:'reference'},
  loadTargets:async()=>{calls++;return load?load():{ok:true,sessionKey:'session',projectPath:'/project',mode:'online',targets:current,frontmostTargetId:preferred};},
  insertDraft:async request=>{inserted.push(request);return apiResult;},launchTarget:launch});
 app.mount(root);
 return{root,inserted,emitted,get state(){return state;},calls:()=>calls,setTargets:value=>current=value,setPreferred:value=>preferred=value,setResult:value=>apiResult=value,
  button(label){return walk(root,item=>item.type==='button'&&textOf(item)===label);},dispose:()=>app.unmount()};
}

test('ダイアログ実描画: 再選択は連携先行にあり、通常更新は明示選択を保持、押した時だけ最前面へ変更する',async()=>{
 const f=dialogFixture([target('one'),target('two'),target('live','live')]);
 try{await flush();const button=f.button('最前面を再選択');assert.ok(button);assert.ok(hasClass(button.parent,'draft-target-row'));
  assert.equal(f.button('連携先を再確認'),undefined);assert.equal(f.state.selected.value,'');
  f.state.selected.value='two';f.setPreferred('one');await f.state.refresh();assert.equal(f.state.selected.value,'two');
  await button.props.onClick();await flush();assert.equal(f.state.selected.value,'one');assert.equal(f.inserted.length,0);
  f.setPreferred('live');await button.props.onClick();assert.equal(f.state.selected.value,'live');assert.equal(f.inserted.length,0);
  await f.button('下書きへ追加').props.onClick();assert.equal(f.inserted[0].targetId,'live');assert.equal(f.inserted[0].contextId,'context-live');
 }finally{f.dispose();}
});

test('ダイアログ: 新規候補・閉じた候補・候補なし・未知の最前面を安全に扱い、自動追加しない',async()=>{
 const f=dialogFixture([target('old')]);
 try{await flush();assert.equal(f.state.selected.value,'old');
  f.setTargets([target('old'),target('new')]);f.setPreferred('new');await f.button('最前面を再選択').props.onClick();assert.equal(f.state.selected.value,'new');
  f.setTargets([target('old')]);f.setPreferred('old');await f.state.refresh(true);assert.equal(f.state.selected.value,'old');
  f.setPreferred('');await f.state.refresh(true);await flush();assert.equal(f.state.selected.value,'old');assert.equal(f.button('下書きへ追加').props.disabled,false);assert.match(textOf(f.root),/最前面は未確認/);
  f.setTargets([]);await f.state.refresh(true);await flush();assert.equal(f.state.selected.value,'');assert.equal(f.button('下書きへ追加').props.disabled,true);assert.match(textOf(f.root),/起動中のCode \/ Liveがありません/);
  f.setTargets([target('a'),target('b')]);f.setPreferred('closed');await f.state.refresh(true);assert.equal(f.state.selected.value,'');assert.match(f.state.error.value,/最前面の連携先を確認できません/);
  assert.equal(f.inserted.length,0);
 }finally{f.dispose();}
});

test('ダイアログ: 再選択連打・取消後の遅延結果・一覧取得失敗で古い対象を追加しない',async()=>{
 let resolve;const f=dialogFixture([],{load:()=>new Promise(done=>{resolve=done;})});
 await flush();const button=f.button('最前面を再選択');assert.equal(button.props.disabled,true);
 await button.props.onClick();assert.equal(f.calls(),1);f.dispose();resolve({ok:true,targets:[target('late')],frontmostTargetId:'late'});await flush();assert.equal(f.state.selected.value,'');assert.equal(f.inserted.length,0);
 const failure=dialogFixture([],{load:async()=>{throw Error('一覧取得失敗');}});
 try{await flush();assert.equal(failure.state.selected.value,'');assert.match(failure.state.error.value,/一覧取得失敗/);assert.equal(failure.button('下書きへ追加').props.disabled,true);}finally{failure.dispose();}
});

test('ダイアログ: 下書き追加失敗・上限超過を完了扱いにしない',async()=>{
 const f=dialogFixture([{...target('one'),maxLength:2}]);
 try{await flush();assert.equal(f.button('下書きへ追加').props.disabled,true);assert.match(textOf(f.root),/入力上限/);
  f.setTargets([target('one')]);await f.state.refresh();f.setResult({ok:false,error:'閉じた連携先'});await f.state.insert();assert.match(f.state.error.value,/閉じた/);assert.equal(f.emitted.length,0);
 }finally{f.dispose();}
});

test('Web候補: 表示した種別とマウント固有IDを使い、閉鎖・別プロジェクトを補わない',()=>{
 const registry=createDraftTargetRegistry(),inserted=[];
 const panel=(id,kind='code')=>({draftTarget:()=>target(id,kind),insertDraft:request=>{inserted.push(request);return{ok:true};}});
 const code=panel('code'),live=panel('live','live');
 const initial=registry.snapshot([code,live],'/project','live');assert.equal(initial.frontmostTargetId,initial.targets[1].id);
 assert.equal(registry.snapshot([code,live],'/project','code').frontmostTargetId,initial.targets[0].id);
 assert.equal(registry.snapshot([code],'/project','live').frontmostTargetId,'');
 assert.deepEqual(registry.snapshot([code,live],'/other','live'),{targets:[],frontmostTargetId:''});
 const reopened=registry.snapshot([panel('new')],'/project','code');assert.notEqual(reopened.frontmostTargetId,initial.targets[0].id);assert.equal(inserted.length,0);
});

test('Web App実setup: Code/Live表示・Console・ピン留め・追加後・利用再開で最前面候補を同期する',async()=>{
 const current={active:true,mode:'online',startedAt:1,project:{path:'/project'}},provided=new Map();
 const component=compile('../src/App.vue',{scriptOnly:true,vueApi:{...vue,onMounted(){},onBeforeUnmount(){},provide:(key,value)=>provided.set(key,value)},
  modules:{'./components/下書き連携/連携先登録.js':{createDraftTargetRegistry},'./components/共通表示/接続状態.js':{validConnectionState:()=>true}},
  globals:{window:{},location:{hash:'',origin:'http://localhost'},fetch:async url=>new Response(JSON.stringify(url.startsWith('/api/panels/')?{url:'/panel/'+url.split('/').at(-1)}:current))}});
 const scope=vue.effectScope(),s=scope.run(()=>component.setup({config:{kind:'ide'}},{expose(){}})),request={projectPath:'/project'};
 const panel=kind=>({draftTarget:()=>target(kind,kind),insertDraft:()=>({ok:true})});
 try{s.update(current);s.codePanel.value=panel('code');s.livePanel.value=panel('live');
  await s.openPanel('live');let result=await s.loadDraftTargets(request);assert.equal(result.frontmostTargetId,result.targets.find(item=>item.kind==='live').id);
  await s.openPanel('code');result=await s.loadDraftTargets(request);const code=result.targets.find(item=>item.kind==='code');assert.equal(result.frontmostTargetId,code.id);
  await s.openPanel('console');s.panelOpen.value=false;result=await s.loadDraftTargets(request);assert.equal(result.frontmostTargetId,code.id);
  const viewer={closed:false};provided.get('registerPinnedViewer')(viewer);result=await s.draftLink.list(viewer,request);assert.equal(result.frontmostTargetId,code.id);
  const live=result.targets.find(item=>item.kind==='live');assert.equal((await s.insertFileDraft({...request,targetId:live.id,contextId:live.contextId,sessionKey:result.sessionKey,text:'本文'})).ok,true);
  result=await s.loadDraftTargets(request);assert.equal(result.frontmostTargetId,live.id);
  current.startedAt=2;s.update(current);s.codePanel.value=panel('code');s.livePanel.value=panel('live');result=await s.loadDraftTargets(request);assert.equal(result.frontmostTargetId,'');
  await assert.rejects(s.draftLink.list(viewer,request),/利用が終了/);
 }finally{scope.stop();}
});

test('Codeパネル実setup: ホストが返したCode番号付きタイトルを使い、破棄後の遅い応答は反映しない',async()=>{
 for(const late of [false,true]){
  const mounted=[],unmounted=[];let resolve;
  const component=compile('../src/components/コード/コードパネル.vue',{scriptOnly:true,vueApi:{...vue,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn)},
   modules:{'markdown-it':class{constructor(){this.renderer={rules:{}};this.utils={escapeHtml:x=>x};}},'../コード/コード通信.js':{codeTransport:()=>({draft:()=>'',start(){},dispose(){}})},'../コード/会話到着演出':{chatArrival:()=>({dispose(){}})},'../下書き連携/下書き受け渡し.js':{createDraftReceiver:()=>({target(){},insert(){},publish(){},mount(){},dispose(){}})}},
   globals:{window:{aidiyWindow:{title:()=>new Promise(done=>{resolve=done;})}},location:{href:'http://localhost/'},ResizeObserver:class{observe(){}disconnect(){}}}});
  const scope=vue.effectScope(),s=scope.run(()=>component.setup({desktop:true,linked:true},{expose(){}}));
  for(const fn of mounted)fn();if(late)for(const fn of unmounted)fn();resolve('AiDiy IDE / Code 3');await flush();assert.equal(s.windowTitle.value,late?'':'AiDiy IDE / Code 3');
  if(!late)for(const fn of unmounted)fn();scope.stop();
 }
 const source=readFileSync(new URL('../src/components/コード/コードパネル.vue',import.meta.url),'utf8');assert.match(source,/<StatusBar\b[^>]*:title="windowTitle \|\|/);
});


test('初期表示: 複数候補の最前面を選び、手動変更後の通常更新では変えず、再表示時は再取得する',async()=>{
 const targets=[target('code1'),target('code2'),target('live','live')];
 for(const preferred of ['code2','live']){
  const f=dialogFixture(targets,{frontmost:preferred});
  try{await flush();assert.equal(f.calls(),1);assert.equal(f.state.selected.value,preferred);
   const select=walk(f.root,item=>item.type==='select');assert.equal(select.options[select.selectedIndex]._value,preferred);
   assert.equal(f.button('下書きへ追加').props.disabled,false);assert.equal(f.inserted.length,0);
   f.state.selected.value='code1';f.setPreferred(preferred==='live'?'code2':'live');await f.state.refresh();assert.equal(f.state.selected.value,'code1');
   await f.button('最前面を再選択').props.onClick();assert.equal(f.state.selected.value,preferred==='live'?'code2':'live');assert.equal(f.inserted.length,0);
  }finally{f.dispose();}
 }
});

test('初期表示: 1件は名前を表示して選択、複数の最前面不明は未選択、ゼロ件は起動案内のみ',async()=>{
 for(const targets of [[target('one')],[target('one'),target('two')]]){
  for(const preferred of ['', 'closed']){
   const f=dialogFixture(targets,{frontmost:preferred});
   try{await flush();
    if(targets.length===1){assert.equal(f.state.selected.value,'one');assert.equal(f.state.error.value,'');assert.match(textOf(f.root),/連携先: code one/);assert.match(textOf(f.root),/最前面は未確認/);assert.equal(f.button('下書きへ追加').props.disabled,false);}
    else{assert.equal(f.state.selected.value,'');assert.match(f.state.error.value,/最前面の連携先を確認できません/);assert.equal(f.button('下書きへ追加').props.disabled,true);}
    assert.equal(f.inserted.length,0);}
   finally{f.dispose();}
  }
 }
 const single=dialogFixture([target('only')],{frontmost:'only'}),empty=dialogFixture([]);
 try{await flush();assert.equal(single.state.selected.value,'only');assert.equal(single.state.error.value,'');assert.match(textOf(single.root),/連携先: code only/);assert.doesNotMatch(textOf(single.root),/最前面は未確認/);assert.equal(empty.state.selected.value,'');assert.equal(empty.state.error.value,'');assert.match(textOf(empty.root),/起動中のCode \/ Liveがありません/);assert.equal(single.inserted.length+empty.inserted.length,0);}
 finally{single.dispose();empty.dispose();}
});
