// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// ElectronのboundsはDIP。負の原点も含め、OSの拡大率を重ねず全画面の外接矩形を使う。
function displayBounds(displays) {
 const areas=displays.map(display=>display.bounds).filter(rect=>rect&&['x','y','width','height'].every(key=>Number.isFinite(rect[key]))&&rect.width>0&&rect.height>0);
 if(!areas.length)throw Error('ディスプレイの配置を取得できません。');
 const x=Math.floor(Math.min(...areas.map(rect=>rect.x))),y=Math.floor(Math.min(...areas.map(rect=>rect.y)));
 return{x,y,width:Math.ceil(Math.max(...areas.map(rect=>rect.x+rect.width)))-x,height:Math.ceil(Math.max(...areas.map(rect=>rect.y+rect.height)))-y};
}
function restoreBounds(bounds,screen) {
 const areas=screen.getAllDisplays().map(display=>display.workArea);
 // 元の右上操作ボタンが見える間は、通常窓の配置をそのまま戻す。
 if(areas.some(area=>bounds.x+bounds.width-40>=area.x&&bounds.x+bounds.width<=area.x+area.width&&bounds.y>=area.y&&bounds.y+32<=area.y+area.height))return bounds;
 const area=screen.getDisplayMatching(bounds).workArea;
 const width=Math.min(bounds.width,area.width),height=Math.min(bounds.height,area.height);
 return{x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-height)),width,height};
}
function setBounds(window,bounds) {
 window.setBounds(bounds);
 // 拡大率の異なる画面へ戻す最初の呼び出しは、WM_DPICHANGEDにより
 // 旧画面の倍率で寸法が換算される場合がある。大差は丸め誤差に足さず、
 // 移動先が確定した同じ窓へ保存寸法を再適用する。
 let actual=window.getBounds();
 if(Math.abs(bounds.width-actual.width)>4||Math.abs(bounds.height-actual.height)>4){window.setBounds(bounds);actual=window.getBounds();}
 // 125%などの端数DPIでは、指定値を1 DIP変えても同じ実寸になることがある。
 // 元の目標値ではなく直前の指定値へ残差を足し、実寸が一致するまで補正する。
 // 整数DIPで表せない寸法もあるため、回数と同じ指定値の再訪を制限し、
 // 一致しない場合は最も近かった指定値へ戻して振動を残さない。
 const keys=['x','y','width','height'],error=rect=>keys.reduce((sum,key)=>sum+Math.abs(bounds[key]-rect[key]),0);
 let request={...bounds},best={request:{...request},error:error(actual)};
 const seen=new Set([JSON.stringify(request)]);
 for(let attempt=0;attempt<4&&error(actual)!==0;attempt++){
  const corrected=Object.fromEntries(keys.map(key=>[key,request[key]+bounds[key]-actual[key]]));
  const signature=JSON.stringify(corrected);
  if(corrected.width<=0||corrected.height<=0||seen.has(signature))break;
  seen.add(signature);window.setBounds(corrected);request=corrected;actual=window.getBounds();
  const distance=error(actual);if(distance<best.error)best={request:{...request},error:distance};
 }
 if(error(actual)>best.error)window.setBounds(best.request);
}

function createAllDisplays({screen,trustedEvent,syncChildren=()=>{},platform=process.platform,panels}) {
 const entries=new WeakMap();
 function state(record) {
  const entry=entries.get(record);
  if(!entry?.active)return{ok:true,active:false};
  const bounds=record.window.getBounds(),area=screen.getPrimaryDisplay().workArea;
  // 各画面の作業領域の右上。負座標・段差・窓のzoomにも割合で追従する。
  const position=area=>({left:(area.x-bounds.x)/bounds.width*100,top:(area.y-bounds.y)/bounds.height*100,width:area.width/bounds.width*100});
  const toolbars=screen.getAllDisplays().map(display=>({displayId:display.id,...position(display.workArea)}));
  return{ok:true,active:true,bounds,displayCount:toolbars.length,toolbar:position(area),toolbars};
 }
 function notify(record) {if(!record.window.isDestroyed()){syncChildren(record);record.window.webContents.send('development:all-displays-changed',state(record));}}
 function apply(record) {
  const entry=entries.get(record),window=record.window;
  if(!entry?.active||window.isDestroyed())return;
  const bounds=displayBounds(screen.getAllDisplays());
  // Windowsのフレームレス窓にもDWMの細い外枠が残る。
  // VR中だけ外枠を表示領域の外へ出す（DPI丸めを含め各辺2 DIP）。
  // thickFrame:falseは通常窓の端ドラッグまで無効にするため使わない。
  const margin=platform==='win32'?2:0;
  const coverage={x:bounds.x-margin,y:bounds.y-margin,width:bounds.width+margin*2,height:bounds.height+margin*2};
  if(!window.isMinimized()){
   if(window.isMaximized())window.unmaximize();
   setBounds(window,coverage);
  }
  notify(record);
 }
 function register(record) {
  if(record.kind!=='ide'||record.owner||entries.has(record))return;
  const entry={active:false,saved:null};entries.set(record,entry);
  const refresh=()=>{try{panels?.cancel(record);apply(record);}catch(error){record.window.webContents.send('development:all-displays-changed',{...state(record),error:error.message});}};
  for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,refresh);
  record.window.on('restore',refresh);
  record.window.once('closed',()=>{
   panels?.forget(record);
   for(const event of ['display-added','display-removed','display-metrics-changed'])screen.removeListener(event,refresh);
   record.window.removeListener('restore',refresh);entries.delete(record);
  });
 }
 function leave(record,{maximize=false}={}) {
  const entry=entries.get(record),window=record.window;
  if(!entry?.active)return false;
  panels?.remember(record);
  const saved=entry.saved;entry.active=false;entry.saved=null;
  window.setMovable(saved.movable);window.setResizable(saved.resizable);
  setBounds(window,restoreBounds(saved.bounds,screen));
  if(maximize||saved.maximized)window.maximize();
  notify(record);return true;
 }
 function handle(event,action) {
  const record=trustedEvent(event);
  if(!record||record.kind!=='ide'||record.owner||!entries.has(record))return{ok:false,error:'IDE本体だけで使用できます。'};
  if(action==='state')return state(record);
  if(record.panelCollapsed)return{ok:false,error:'IDEを展開してからVRモードへ切り替えてください。'};
  if(action!=='toggle')return{ok:false,error:'対応していない操作です。'};
  const entry=entries.get(record),window=record.window;
  try{
   if(entry.active)leave(record);
   else{
    displayBounds(screen.getAllDisplays());
    entry.saved={bounds:window.isMaximized()?window.getNormalBounds():window.getBounds(),maximized:window.isMaximized(),movable:window.isMovable(),resizable:window.isResizable()};
    if(window.isMinimized())window.restore();
    entry.active=true;
    window.setMovable(false);window.setResizable(false);apply(record);
    // rendererの移行中表示は、この移動の終了まで維持する。
    if(panels)return panels.restore(record).then(()=>state(record)).catch(error=>{if(entry.active)leave(record);return{ok:false,error:error.message};});
   }
   return state(record);
  }catch(error){if(entry.active)try{leave(record);}catch{}return{ok:false,error:error.message};}
 }
 function attachExitKey(record,contents=record.window.webContents){
  const owner=record.owner||record;
  // 子パネルやBrowser本文にフォーカスがあっても、所属IDEのVRだけを解除する。
  const input=(event,key)=>{
   if(key.type!=='keyDown'||key.key!=='F11'||key.control||key.alt||key.shift||key.meta||!entries.get(owner)?.active)return;
   event.preventDefault();
   try{leave(owner);}catch(error){owner.window.webContents.send('development:all-displays-changed',{...state(owner),error:error.message});}
  };
  const dispose=()=>{contents.removeListener('before-input-event',input);contents.removeListener('destroyed',dispose);};
  contents.on('before-input-event',input);contents.once('destroyed',dispose);
  return dispose;
 }
 return{register,handle,leave,state,attachExitKey,isActive:record=>entries.get(record)?.active===true};
}
module.exports={displayBounds,restoreBounds,createAllDisplays,setWindowBounds:setBounds};
