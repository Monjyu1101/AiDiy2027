// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Codeの表示状態ごとに寸法だけを保持する。位置は現在の窓を使い、再起動時には引き継がない。
export function createNavigationSizeMemory(expandedWidth=960){
 let expanded=false,sizes=[null,null],applied;
 return{
  prepare(next,current){
   if(next===expanded)return null;
   const saved=sizes.map(value=>value&&({...value})),index=Number(expanded);
   saved[index]??={width:current.width,height:current.height};
   // 画面境界で縮めただけの寸法を手動指定として上書きしない。
   for(const key of ['width','height'])if(!applied||current[key]!==applied[key])saved[index][key]=current[key];
   const target=Number(next);
   saved[target]??={width:Math.max(expandedWidth,current.width),height:current.height};
   // すでに標準の2倍以上ある窓は、記憶幅の復元でも狭めない。
   // この一時的な幅維持では、Code側の手動指定そのものは書き換えない。
   const size={...saved[target]};
   if(next&&current.width>=expandedWidth)size.width=Math.max(current.width,size.width);
   return{expanded:next,sizes:saved,size};
  },
  commit(change,actual){expanded=change.expanded;sizes=change.sizes;applied={width:actual.width,height:actual.height};},
 };
}

export function fitNavigationBounds(current,size,area){
 const margin=8,width=Math.min(size.width,Math.max(1,area.width-margin*2)),height=Math.min(size.height,Math.max(1,area.height-margin*2));
 return{x:Number.isFinite(area.x)?Math.max(area.x+margin,Math.min(current.x,area.x+area.width-margin-width)):current.x,y:Number.isFinite(area.y)?Math.max(area.y+margin,Math.min(current.y,area.y+area.height-margin-height)):current.y,width,height};
}

// ブラウザー別窓も同じ記憶規則を使う。通常タブ/IDE本体の窓は呼び出し側で除外する。
export function createNavigationPopupSizer({settle=win=>new Promise(done=>win.setTimeout(done,100))}={}){
 const windows=new WeakMap();
 return async function resize(win,expanded){
  const read=()=>({x:win.screenX,y:win.screenY,width:win.outerWidth,height:win.outerHeight});
  let memory=windows.get(win);if(!memory){memory=createNavigationSizeMemory();windows.set(win,memory);}
  const current=read(),change=memory.prepare(expanded,current);if(!change)return;
  const screen=win.screen,area={x:screen.availLeft,y:screen.availTop,width:screen.availWidth,height:screen.availHeight};
  const next=fitNavigationBounds(current,change.size,area);
  win.resizeTo?.(next.width,next.height);
  if(next.x!==current.x||next.y!==current.y)win.moveTo?.(next.x,next.y);
  // resizeToの反映は非同期で、ブラウザーによっては無視/制限される。実寸を記録する。
  await settle(win);
  memory.commit(change,read());
 };
}
