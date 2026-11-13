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
   expect(title&&text,'title and body present');expect(!document.querySelector('.memo-board'),'no board');
   expect(document.querySelectorAll('textarea').length===1,'one note only');
   const adhesive=document.querySelector('.sticky-adhesive');
   const checkAdhesive=()=>{const r=adhesive.getBoundingClientRect(),style=getComputedStyle(adhesive);expect(r.top===0&&r.left===0&&r.width===innerWidth,'adhesive spans top edge');expect(Math.abs(r.height-parseFloat(style.fontSize)/2)<.1,'half-character adhesive height');expect(style.backgroundColor==='rgba(0, 0, 0, 0.07)','subtle shaded adhesive');expect(r.bottom<=title.getBoundingClientRect().top,'adhesive does not cover title');};
   checkAdhesive();
   const rect=document.querySelector('.sticky-note').getBoundingClientRect();expect(rect.width===320&&rect.height===260,'full pastel note '+JSON.stringify({width:rect.width,height:rect.height,innerWidth,innerHeight}));
   window.handlers.bounds({x:-200,y:50,width:320,height:260});document.querySelector('[aria-label="桃色の付箋"]').click();await wait(200);
   expect(window.calls.length===0,'blank geometry/color creates no file');window.handlers.blur();await wait(0);expect(window.closedCalls===1,'blank blur closes');
   title.value='タイトルだけ';title.dispatchEvent(new Event('input',{bubbles:true}));await wait(220);
   expect(window.calls.length===0,'typing title does not save');text.focus();await wait(20);expect(window.calls.length===0,'title to body does not save');window.handlers.blur();await wait(20);expect(window.calls.length===1&&window.calls[0].route==='api/メモ/作成','form blur saves title');expect(window.calls[0].body.色==='pink','pastel persisted');expect(window.calls[0].body.位置.x===-200,'native geometry persisted');
   text.value='すぐ閉じても失わない';text.dispatchEvent(new Event('input',{bubbles:true}));window.handlers.close({requestId:'c1',bounds:{x:-250,y:60,width:400,height:300}});await wait(10);
   expect(window.closeResult.ok===true,'close flush success');expect(window.calls.at(-1).body.本文==='すぐ閉じても失わない','latest body flushed');expect(window.calls.at(-1).body.位置.x===-250,'close latest bounds flushed');
   window.failSave=true;text.value='失敗しても残る';text.dispatchEvent(new Event('input',{bubbles:true}));window.handlers.blur();await wait(200);
   expect(document.querySelector('.sticky-error')&&text.value==='失敗しても残る','failed autosave keeps input');window.handlers.close({requestId:'c2'});await wait(10);expect(window.closeResult.ok===false,'failed close stays guarded');
   window.failSave=false;[...document.querySelectorAll('button')].find(x=>x.textContent==='再試行').click();await wait(10);expect(!document.querySelector('.sticky-error'),'retry resolves');
   for(const name of ['赤','青','緑','橙','紫','シアン']){
    document.querySelector('[aria-label="原色・'+name+'色の付箋"]').click();await wait(20);
    expect(getComputedStyle(title).color==='rgb(255, 255, 255)'&&getComputedStyle(text).color==='rgb(255, 255, 255)','vivid white title/body '+name);
    expect(window.calls.at(-1).body.色.startsWith('vivid-'),'vivid color saved '+name);checkAdhesive();
   }
   const palette=document.querySelector('.sticky-palette');expect(palette.getBoundingClientRect().width<150,'palette fits minimum note width');
   document.querySelector('[aria-label="桃色の付箋"]').click();await wait(20);expect(getComputedStyle(text).color==='rgb(41, 50, 46)','pastel dark text restored');
   const fire=(el,type,x,y)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y}));
   fire(text,'pointerdown',20,40);await wait(100);fire(window,'pointermove',40,50);fire(window,'pointerup',40,50);expect(window.dragCalls===0,'ordinary selection not window drag');
   fire(title,'pointerdown',20,20);await wait(0);fire(window,'pointerup',20,20);expect(window.dragCalls===0,'title remains editable');
   fire(text,'pointerdown',20,40);await wait(550);expect(!!document.querySelector('.sticky-move-marker'),'long press body shows movement marker');expect(window.dragCalls===1,'body long press native movement');fire(window,'pointerup',20,40);await wait(0);expect(!document.querySelector('.sticky-move-marker'),'release hides marker');
   fire(title,'pointerdown',20,20);await wait(550);expect(window.dragCalls===2,'title long press native movement');fire(window,'pointercancel',20,20);await wait(0);expect(!document.querySelector('.sticky-move-marker'),'cancel hides marker');
   title.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));fire(title,'pointerdown',20,20);await wait(550);expect(window.dragCalls===2,'IME composition prevents movement');title.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));fire(window,'pointerup',20,20);
   fire(document.querySelector('.sticky-header'),'pointerdown',300,12);await wait(0);expect(window.dragCalls===3,'header moves immediately');fire(window,'pointerup',300,12);fire(adhesive,'pointerdown',100,3);await wait(0);expect(window.dragCalls===4,'adhesive moves immediately');fire(window,'pointerup',100,3);
   const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
   const file=new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'image.png',{type:'image/png'});
   const transfer=new DataTransfer();transfer.items.add(file);
   const paste=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});text.dispatchEvent(paste);await wait(100);
   expect(innerWidth===320&&innerHeight===260,'image paste keeps window size');expect(paste.defaultPrevented,'image paste intercepted');expect(document.querySelector('.sticky-image-frame img')?.naturalWidth===1,'image decoded in frame');
   expect(window.calls.at(-1).body.画像==='data:image/png;base64,'+png,'base64 autosaved');
   const image=document.querySelector('.sticky-image-frame img'),frame=image.parentElement;expect(Math.abs(image.getBoundingClientRect().width-frame.clientWidth)<1,'image fills frame width');expect(Math.abs(image.getBoundingClientRect().height-image.getBoundingClientRect().width)<1,'square image scales proportionally beyond former fixed height');
   const content=document.querySelector('.sticky-content');expect(getComputedStyle(content).overflowY==='auto','content scrolls');content.scrollTop=content.scrollHeight;expect(content.scrollTop>0,'image reachable below text by scrolling');
   const plain=new ClipboardEvent('paste',{bubbles:true,cancelable:true});text.dispatchEvent(plain);expect(!plain.defaultPrevented,'text paste unaffected');
   const drop=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer});document.querySelector('.sticky-note').dispatchEvent(drop);await wait(100);expect(drop.defaultPrevented,'drop does not navigate');expect(document.querySelectorAll('.sticky-image-frame img').length===1,'replacement stays one image');expect(innerWidth===320&&innerHeight===260,'replacement keeps window size');
   for(const [width,height] of [[20,60],[60,20]]){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').fillRect(0,0,width,height);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const data=new DataTransfer();data.items.add(new File([blob],'ratio.png',{type:'image/png'}));text.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));await wait(100);const im=document.querySelector('.sticky-image-frame img'),r=im.getBoundingClientRect();expect(Math.abs(r.width-im.parentElement.clientWidth)<1,'portrait/landscape use full width');expect(Math.abs(r.height/r.width-height/width)<0.01,'portrait/landscape aspect ratio preserved');expect(innerWidth===320&&innerHeight===260,'ratio changes do not resize window');}
   document.querySelector('.sticky-image-remove').click();await wait(20);expect(!document.querySelector('.sticky-image-frame'),'image removed');expect(window.calls.at(-1).body.画像==='','removal saved');
   text.value='切替前の未保存';text.dispatchEvent(new Event('input',{bubbles:true}));window.handlers.close({requestId:'switch',waitOnly:true});await wait(10);expect(window.closeResult.ok&&window.calls.at(-1).body.本文==='切替前の未保存','project switch flushes deferred text');
   text.value='短いメモ';text.dispatchEvent(new Event('input',{bubbles:true}));window.dispatchEvent(new Event('blur'));await wait(30);
   expect(getComputedStyle(content).scrollbarWidth==='none','blur hides scrollbar');expect(!document.querySelector('.sticky-overflow-hint'),'short note has no continuation marker');
   text.value=Array(30).fill('長いメモ').join(String.fromCharCode(10));text.dispatchEvent(new Event('input',{bubbles:true}));await wait(30);content.scrollTop=0;content.dispatchEvent(new Event('scroll'));await wait(0);
   expect(!!document.querySelector('.sticky-overflow-hint'),'unfocused overflow shows ellipsis');
   window.dispatchEvent(new Event('focus'));await wait(10);expect(getComputedStyle(content).scrollbarWidth==='thin','focus shows scrollbar');expect(!document.querySelector('.sticky-overflow-hint'),'focus hides ellipsis');
   window.dispatchEvent(new Event('blur'));content.scrollTop=content.scrollHeight;content.dispatchEvent(new Event('scroll'));await wait(10);expect(!document.querySelector('.sticky-overflow-hint'),'end of content hides ellipsis');
   document.querySelector('.sticky-trash').click();await wait(10);expect(window.calls.at(-1).route==='api/メモ/削除','trash removes saved note');expect(window.closedCalls===2,'trash dismisses note');
   expect(window.identity?.id==='one.memo.json','created identity reported');
   return 'PASS image paste/drop/base64/replace/remove/scroll and one pastel note, title/body, blank discard, autosave, close flush/bounds, failure/retry, selection/immediate header drag/trash';
  })()`));
  // Strict 2/3 threshold, repeated resize, and immediate movement in either orientation.
  for(const [width,height,left] of [[300,200,false],[300,199,true],[320,260,false],[400,125,true],[200,200,false]]){
   w.setSize(width,height);await new Promise(resolve=>setTimeout(resolve,50));
   console.log(await w.webContents.executeJavaScript(`(async()=>{
    const strip=document.querySelector('.sticky-adhesive'),r=strip.getBoundingClientRect(),half=parseFloat(getComputedStyle(strip).fontSize)/2;
    if(r.top!==0||r.left!==0||Math.abs(r.width-(${left}?half:innerWidth))>.1||Math.abs(r.height-(${left}?innerHeight:half))>.1)throw Error('adhesive orientation at ${width}x${height}');
    const before=window.dragCalls;
    strip.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,button:0,clientX:2,clientY:2}));
    await new Promise(resolve=>setTimeout(resolve,0));
    if(window.dragCalls!==before+1)throw Error('adhesive immediate drag at ${width}x${height}');
    window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,button:0}));
    return 'PASS adhesive ${left?'left':'top'} at ${width}x${height}';
   })()`));
  }
  w.setSize(200,84);await new Promise(resolve=>setTimeout(resolve,50));
  console.log(await w.webContents.executeJavaScript(`(()=>{const note=document.querySelector('.sticky-note'),content=document.querySelector('.sticky-content'),palette=document.querySelector('.sticky-palette');if(innerHeight!==84||content.clientHeight<=0||palette.getBoundingClientRect().right>note.clientWidth)throw Error('minimum 200x84 layout');return 'PASS minimum 200x84 layout';})()`));app.exit(0);
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
