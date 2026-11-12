// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { ref, onBeforeUnmount } from 'vue';
// 表示を破棄せずクリップするため、接続・入力・会話履歴を保持できる。
export function usePanelCollapse(props){
 const panelElement=ref(),panelCollapsed=ref(false),panelHidden=ref(false),panelBusy=ref(false);
 let revision=0,animation;
 // LDはmain側で窓の寸法を戻してから状態を通知する。再invokeせず表示だけ同期する。
 const stateApi=props.desktop?(props.windowApi??window.aidiyWindow):undefined;
 const stopState=stateApi?.onPanelCollapseState?.(state=>{
  if(!state||state.name!=null||typeof state.collapsed!=='boolean')return;
  revision++;animation?.cancel();
  panelCollapsed.value=state.collapsed;panelHidden.value=state.hidden===true;panelBusy.value=state.busy===true;
 });
 async function togglePanel(){
  const element=panelElement.value;if(!element)return;
  const current=++revision,collapsed=!panelCollapsed.value;
  panelBusy.value=true;
  panelCollapsed.value=collapsed;panelHidden.value=false;
  const api=props.desktop?(props.windowApi??window.aidiyWindow):undefined;
  if(api?.collapsePanel){
   try{const result=await api.collapsePanel(collapsed);if(current!==revision)return;if(!result?.ok){panelCollapsed.value=!collapsed;return;}panelHidden.value=collapsed;}
   catch{if(current===revision)panelCollapsed.value=!collapsed;}
   finally{if(current===revision)panelBusy.value=false;}
   return;
  }
  const from=element.getBoundingClientRect().height;
  animation?.cancel();
  element.style.maxHeight=collapsed?'31px':'';
  const to=element.getBoundingClientRect().height;
  animation=element.animate([{maxHeight:from+'px'},{maxHeight:to+'px'}],{duration:220,easing:'ease-out'});
  try{await animation.finished;if(current===revision)panelHidden.value=collapsed;}catch{}finally{if(current===revision)panelBusy.value=false;}
 }
 onBeforeUnmount(()=>{revision++;animation?.cancel();stopState?.();});
 return {panelElement,panelCollapsed,panelHidden,panelBusy,togglePanel};
}
