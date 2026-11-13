// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
// Synthetic fixture: no user notes, external APIs or persistent settings.
// AIDIY_TEST_ELECTRON=/path/to/electron node checks/memo-ui-browser.cjs
const fs=require('node:fs'),path=require('node:path');
if(process.versions.electron){
 const {app,BrowserWindow}=require('electron');app.disableHardwareAcceleration();
 app.whenReady().then(async()=>{
  const w=new BrowserWindow({width:320,height:260,show:false,frame:false});
  await w.loadFile(process.env.AIDIY_MEMO_UI_FIXTURE);w.setSize(321,261);w.setSize(320,260);await new Promise(resolve=>setTimeout(resolve,100));
  console.log(await w.webContents.executeJavaScript(`(async()=>{
   const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
   const expect=(value,label)=>{if(!value)throw Error(label)};
   const title=document.querySelector('.sticky-title'),text=document.querySelector('.sticky-text');
   expect(title&&text,'title and body present');expect(!document.querySelector('header,.memo-board'),'no header or board');
   expect(document.querySelectorAll('textarea').length===1,'one note only');
   const rect=document.querySelector('.sticky-note').getBoundingClientRect();expect(rect.width===320&&rect.height===260,'full pastel note '+JSON.stringify({width:rect.width,height:rect.height,innerWidth,innerHeight}));
   window.handlers.bounds({x:-200,y:50,width:320,height:260});document.querySelector('[aria-label="桃色の付箋"]').click();await wait(200);
   expect(window.calls.length===0,'blank geometry/color creates no file');window.handlers.blur();await wait(0);expect(window.closedCalls===1,'blank blur closes');
   title.value='タイトルだけ';title.dispatchEvent(new Event('input',{bubbles:true}));await wait(220);
   expect(window.calls.length===1&&window.calls[0].route==='api/メモ/作成','title-only autosaves');expect(window.calls[0].body.色==='pink','pastel persisted');expect(window.calls[0].body.位置.x===-200,'native geometry persisted');
   text.value='すぐ閉じても失わない';text.dispatchEvent(new Event('input',{bubbles:true}));window.handlers.close({requestId:'c1',bounds:{x:-250,y:60,width:400,height:300}});await wait(10);
   expect(window.closeResult.ok===true,'close flush success');expect(window.calls.at(-1).body.本文==='すぐ閉じても失わない','latest body flushed');expect(window.calls.at(-1).body.位置.x===-250,'close latest bounds flushed');
   window.failSave=true;text.value='失敗しても残る';text.dispatchEvent(new Event('input',{bubbles:true}));await wait(200);
   expect(document.querySelector('.sticky-error')&&text.value==='失敗しても残る','failed autosave keeps input');window.handlers.close({requestId:'c2'});await wait(10);expect(window.closeResult.ok===false,'failed close stays guarded');
   window.failSave=false;[...document.querySelectorAll('button')].find(x=>x.textContent==='再試行').click();await wait(10);expect(!document.querySelector('.sticky-error'),'retry resolves');
   const fire=(el,type,x,y)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,button:0,clientX:x,clientY:y}));
   fire(text,'pointerdown',20,40);await wait(100);fire(window,'pointermove',40,50);fire(window,'pointerup',40,50);expect(window.dragCalls===0,'ordinary selection not window drag');
   fire(text,'pointerdown',20,40);await wait(550);fire(window,'pointerup',20,40);expect(window.dragCalls===1,'500ms hold moves window');
   expect(window.identity?.id==='one.memo.json','created identity reported');
   return 'PASS one pastel note, title/body, blank discard, autosave, close flush/bounds, failure/retry, selection/longpress';
  })()`));app.exit(0);
 }).catch(error=>{console.error(error);app.exit(1)});
}else{
 (async()=>{
  const electron=process.env.AIDIY_TEST_ELECTRON;if(!electron)throw Error('AIDIY_TEST_ELECTRON に検証用Electronを指定してください。');
  const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'aidiy-memo-ui-'));
  try{
   const req=require('node:module').createRequire(path.resolve(__dirname,'../ui/package.json'));
   const {build}=req('esbuild'),{parse,compileScript}=req('@vue/compiler-sfc');
   const component=path.resolve(__dirname,'../memo/ui/src/メモ画面.vue');
   fs.writeFileSync(path.join(temp,'entry.js'),`import {createApp} from 'vue';import Memo from ${JSON.stringify(component)};
window.handlers={};window.calls=[];window.closedCalls=0;window.dragCalls=0;
window.aidiyMemo={getInitialState:async()=>({note:null,sources:[{id:'project:one',名前:'プロジェクト',パス:'/fixture/_AIDIY/aidiy_memo'}],sourceId:'project:one',bounds:{x:0,y:0,width:320,height:260}}),onBounds(fn){window.handlers.bounds=fn},onBlur(fn){window.handlers.blur=fn},onCloseRequested(fn){window.handlers.close=fn},completeClose:async value=>{window.closeResult=value},close:async()=>{window.closedCalls++},setNoteIdentity:async value=>{window.identity=value},beginWindowMove:async()=>{window.dragCalls++;return 'drag-token'},moveWindow:async()=>true,endWindowMove:async()=>true};
createApp(Memo,{api:async(route,{body})=>{window.calls.push({route,body});if(window.failSave)throw Object.assign(Error('合成競合'),{status:409});return {...body,id:body.id||'one.memo.json',保存先:body.保存先,revision:'revision-'+window.calls.length}}}).mount('#app');`);
   fs.writeFileSync(path.join(temp,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="app"></div><script src="app.js"></script>');
   await build({entryPoints:[path.join(temp,'entry.js')],outfile:path.join(temp,'app.js'),bundle:true,alias:{vue:req.resolve('vue/dist/vue.runtime.esm-bundler.js')},define:{'process.env.NODE_ENV':'"production"',__VUE_OPTIONS_API__:'false',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'vue-sfc',setup(b){b.onLoad({filter:/\.vue$/},async({path:filename})=>{const {descriptor,errors}=parse(fs.readFileSync(filename,'utf8'));if(errors.length)throw errors[0];return {contents:compileScript(descriptor,{id:'memo',inlineTemplate:true}).content,loader:'js',resolveDir:path.dirname(filename)}})}}]});
   const result=require('node:child_process').spawnSync(electron,['--no-sandbox','--headless','--disable-gpu',__filename],{env:{...process.env,XDG_CONFIG_HOME:path.join(temp,'config'),AIDIY_MEMO_UI_FIXTURE:path.join(temp,'index.html')},encoding:'utf8',timeout:20000});
   process.stdout.write(result.stdout||'');if(result.status!==0){process.stderr.write(result.stderr||'');throw result.error||Error(`UI check failed: ${result.status}`);}
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
 })().catch(error=>{console.error(error);process.exitCode=1});
}
