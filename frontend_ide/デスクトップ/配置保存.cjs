// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const fs=require('node:fs');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
const {programDataDirectory,preparePrivateDirectory}=require('../host/scripts/project-storage.cjs');
const {setWindowBounds}=require('./全画面横断.cjs');
const {windowBounds}=require('./window-layout.cjs');
const kinds=new Set(['console','browser','code','live','cpu','task','team','viewer','explorer','panel-viewer','panel-routes','panel-navigation']);
const domKinds=new Set(['explorer','panel-viewer','panel-routes','panel-navigation']);
const limit=1024*1024;
function bounds(value){
 if(!value||!['x','y','width','height'].every(key=>Number.isSafeInteger(value[key])&&Math.abs(value[key])<=100000)||value.width<1||value.height<1)throw Error('保存されたウィンドウ位置が不正です。');
 return Object.fromEntries(['x','y','width','height'].map(key=>[key,value[key]]));
}
// 一枚の画面だけでなく、隣接画面をまたぐ窓も扱う。画面間の空白・欠けた部分は画面外。
function onScreen(rect,areas){
 let pieces=[bounds(rect)];
 for(const area of areas){
  const next=[];
  for(const part of pieces){
   const x=Math.max(part.x,area.x),y=Math.max(part.y,area.y),right=Math.min(part.x+part.width,area.x+area.width),bottom=Math.min(part.y+part.height,area.y+area.height);
   if(x>=right||y>=bottom){next.push(part);continue;}
   if(part.y<y)next.push({...part,height:y-part.y});
   if(bottom<part.y+part.height)next.push({...part,y:bottom,height:part.y+part.height-bottom});
   if(part.x<x)next.push({x:part.x,y,width:x-part.x,height:bottom-y});
   if(right<part.x+part.width)next.push({x:right,y,width:part.x+part.width-right,height:bottom-y});
  }
  pieces=next;if(!pieces.length)return true;
 }
 return false;
}
function placement(record){
 const win=record.window,maximized=win.isMaximized?.()===true;
 return{bounds:bounds(maximized&&win.getNormalBounds?win.getNormalBounds():win.getBounds()),maximized};
}
function applyPlacement(record,value,screen){
 const win=record.window;if(win.isDestroyed())throw Error('復元先のウィンドウが閉じられました。');
 const target=bounds(value.bounds),visible=onScreen(target,screen.getAllDisplays().map(display=>display.workArea));
 if(win.isMinimized?.())win.restore();
 if(win.isMaximized?.())win.unmaximize();
 if(visible)setWindowBounds(win,target);
 else if(record.kind==='ide')setWindowBounds(win,windowBounds('ide',screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea));
 // 画面外の子窓は既存の起動処理で決めた初期位置をそのまま使う。
 if(visible&&value.maximized)win.maximize();
 return visible;
}
function text(value,max=4096){if(typeof value!=='string'||!value||value.length>max||value.includes('\0'))throw Error('保存されたパネル情報が不正です。');return value;}
function validateRenderer(value){
 if(!value||value.version!==1||!['2d','3d'].includes(value.viewMode)||!Array.isArray(value.navigation)||value.navigation.length>100||!value.space||!Array.isArray(value.space.viewers)||value.space.viewers.length>100)throw Error('保存された画面構成が不正です。');
 const explorer=value.space.explorer||{};
 return{version:1,viewMode:value.viewMode,navigation:value.navigation.map(item=>({name:text(item.name,200)})),space:{explorer:{...(explorer.explorerName?{explorerName:text(explorer.explorerName,200)}:{}),...(explorer.routesName?{routesName:text(explorer.routesName,200)}:{})},viewers:value.space.viewers.map(item=>({name:text(item.name,200),file:{path:text(item.file?.path),name:text(item.file?.name),type:text(item.file?.type,100)}}))}};
}
function validate(value){
 if(!value||value.version!==1||!Array.isArray(value.panels)||value.panels.length>100)throw Error('保存された配置の形式に対応していません。');
 const result={version:1,ide:{bounds:bounds(value.ide?.bounds),maximized:value.ide?.maximized===true},panels:value.panels.map(item=>{
  if(!kinds.has(item.kind)||item.kind==='task'&&!['request','flow','detail'].includes(item.view))throw Error('保存されたパネル種別が不正です。');
  return{kind:item.kind,bounds:bounds(item.bounds),maximized:item.maximized===true,...(domKinds.has(item.kind)?{name:text(item.name,200)}:{}),...(item.kind==='viewer'?{path:text(item.path)}:{}),...(item.kind==='task'?{view:item.view}:{})};
 }),renderer:validateRenderer(value.renderer)};
 if(value.avatar!=null){
  if(!Array.isArray(value.avatar.windows)||value.avatar.windows.length>20)throw Error('保存されたAvatarの配置が不正です。');
  result.avatar={windows:value.avatar.windows.map(item=>({role:text(item.role,100),bounds:bounds(item.bounds)}))};
 }
 return result;
}
function layoutFile(project){return join(programDataDirectory(project,'aidiy_ide'),'window-layout.json');}
function readLayout(project){
 const filename=layoutFile(project);let info;
 try{info=fs.lstatSync(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!info.isFile()||info.isSymbolicLink()||info.size>limit)throw Error('保存された配置を安全に読み込めません。');
 try{return validate(JSON.parse(fs.readFileSync(filename,'utf8')));}catch(error){throw Error('保存された配置を読み込めません: '+error.message);}
}
function writeLayout(project,value,guard=()=>{}){
 const filename=layoutFile(project),directory=programDataDirectory(project,'aidiy_ide');preparePrivateDirectory(directory);
 const serialized=JSON.stringify(validate(value),null,2);if(Buffer.byteLength(serialized)>limit)throw Error('保存する配置が大きすぎます。');
 const temporary=join(directory,'layout-'+randomUUID()+'.tmp');
 try{fs.writeFileSync(temporary,serialized+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});guard();fs.renameSync(temporary,filename);}
 finally{try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
function createLayoutManager({windows,trustedEvent,readState,sessionKey,screen,allDisplays,avatarLauncher,openNative,isQuitting=()=>false,read=readLayout,write=writeLayout,timeout=60000}){
 const busy=new WeakMap(),requests=new Map();
 const ownedAvatar=owner=>avatarLauncher.owned?.(owner)??avatarLauncher.active(owner);
 const children=owner=>[...windows.values()].filter(record=>record.owner===owner&&kinds.has(record.kind)&&!(record.kind==='task'&&record.taskView==='dialog')&&!record.window.isDestroyed());
 const count=owner=>children(owner).length+(ownedAvatar(owner)?1:0);
 function ask(owner,action,payload){
  return new Promise((resolve,reject)=>{
   const requestId=randomUUID();
   const finish=(error,value)=>{clearTimeout(timer);requests.delete(requestId);owner.window.removeListener('closed',closed);error?reject(error):resolve(value);};
   const closed=()=>finish(Error('IDEが終了しました。'));
   const timer=setTimeout(()=>finish(Error('画面構成の確認がタイムアウトしました。')),timeout);
   requests.set(requestId,{owner,finish});owner.window.once('closed',closed);
   owner.window.webContents.send('development:layout-request',{requestId,action,payload});
  });
 }
 function reply(event,value){
  const request=requests.get(value?.requestId);if(!request||trustedEvent(event)!==request.owner)return;
  if(value.ok!==true)return request.finish(Error(typeof value.error==='string'?value.error.slice(0,500):'画面構成を確認できません。'));
  try{if(Buffer.byteLength(JSON.stringify(value.result))>limit)throw Error('画面構成が大きすぎます。');request.finish(null,value.result);}catch(error){request.finish(error);}
 }
 async function handle(event,action){
  const owner=trustedEvent(event);if(!owner||owner.kind!=='ide'||owner.owner)return{ok:false,error:'IDE本体から操作してください。'};
  if(!['state','save','load'].includes(action))return{ok:false,error:'配置の操作が不正です。'};
  if(action!=='state'&&busy.has(owner))return{ok:false,error:'配置を処理しています。完了をお待ちください。'};
  const operation={};if(action!=='state')busy.set(owner,operation);
  let restored=0;
  try{
   const revision=owner.revision,state=await readState(owner),key=sessionKey(state),project=state.project?.path;
   const guard=()=>{if(isQuitting()||owner.window.isDestroyed()||trustedEvent(event)!==owner||owner.revision!==revision)throw Error('IDEの利用状態が変わりました。');};
   guard();if(!state.active||state.mode!=='online'||!project)throw Error('AiDiy接続利用を開始してください。');
   const confirm=async()=>{guard();if(allDisplays.isActive(owner))throw Error('VRモードを終了してから配置を保存・復元してください。');const current=await readState(owner);guard();if(allDisplays.isActive(owner))throw Error('VRモードが開始されたため配置の処理を中止しました。');if(sessionKey(current)!==key||current.project?.path!==project||current.mode!=='online')throw Error('IDEの利用状態が変わりました。');};
   if(action==='state'){let saved=false;try{saved=!!read(project);}catch{}return{ok:true,count:count(owner),saved,busy:busy.has(owner)};}
   if(allDisplays.isActive(owner))throw Error('VRモードを終了してから配置を保存・復元してください。');
   if(owner.pending.size)throw Error('パネルの起動完了をお待ちください。');
   if(action==='save'){
    if(count(owner)<3)throw Error('IDE以外のパネルを3つ以上開いてからSaveしてください。');
    const renderer=validateRenderer(await ask(owner,'capture'));
    const avatar=ownedAvatar(owner)?await avatarLauncher.capture(owner):null;
    if(!avatar&&ownedAvatar(owner))throw Error('Avatarの配置を取得できませんでした。保存済みの配置は変更していません。');
    await confirm();
    const panels=children(owner).map(record=>({kind:record.kind,...placement(record),...(domKinds.has(record.kind)?{name:record.name}:{}),...(record.kind==='viewer'?{path:record.viewerPath}:{}),...(record.kind==='task'?{view:record.taskView}:{})}));
    const snapshot={version:1,ide:placement(owner),panels,renderer,...(avatar?{avatar}:{})};
    write(project,snapshot,guard);return{ok:true,count:count(owner),saved:true};
   }
   if(count(owner))throw Error('パネルをすべて閉じてからLoadしてください。');
   const snapshot=read(project);if(!snapshot)throw Error('保存された配置がありません。先にSaveしてください。');
   await confirm();if(count(owner))throw Error('パネルの状態が変わりました。');
   applyPlacement(owner,snapshot.ide,screen);
   const failures=[];let taskDone=false;
   for(const panel of snapshot.panels){
    if(domKinds.has(panel.kind)||panel.kind==='task'&&taskDone)continue;
    await confirm();
    const batch=panel.kind==='task'?snapshot.panels.filter(item=>item.kind==='task'):[panel];if(panel.kind==='task')taskDone=true;
    try{const created=await openNative(event,batch);await confirm();for(let i=0;i<batch.length;i++){if(!created[i])throw Error('起動中の別アプリがあるため復元できません。');applyPlacement(created[i],batch[i],screen);restored++;}}
    catch(error){guard();failures.push(panel.kind+': '+error.message);}
   }
   if(snapshot.avatar){
    await confirm();try{await openNative(event,[{kind:'avatar'}]);await confirm();const result=await avatarLauncher.restore(owner,snapshot.avatar);if(!result?.ok)throw Error(result?.error||'Avatarの位置を復元できません。');restored++;}catch(error){guard();failures.push('Avatar: '+error.message);}
   }
   await confirm();
   const mapping=await ask(owner,'restore',snapshot.renderer);await confirm();
   for(const panel of snapshot.panels.filter(item=>domKinds.has(item.kind))){
    const name=mapping?.panels?.find(item=>item.previousName===panel.name)?.name;
    const record=children(owner).find(item=>item.name===name&&item.kind===panel.kind);
    if(record){applyPlacement(record,panel,screen);restored++;}else failures.push(panel.kind+': パネルを復元できません。');
   }
   return failures.length?{ok:false,error:'一部のパネルを復元できませんでした。'+failures.join(' / '),count:count(owner),restored}:{ok:true,count:count(owner),restored};
  }catch(error){return{ok:false,error:error.message,count:count(owner),restored};}
  finally{if(busy.get(owner)===operation)busy.delete(owner);}
 }
 function invalidate(owner){for(const request of [...requests.values()])if(request.owner===owner)request.finish(Error('IDEの利用状態が変わりました。'));busy.delete(owner);}
 return{handle,reply,count,invalidate};
}
module.exports={bounds,onScreen,placement,applyPlacement,validate,validateRenderer,readLayout,writeLayout,createLayoutManager};
