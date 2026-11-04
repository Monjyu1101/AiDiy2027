// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {randomUUID}=require('node:crypto');

// iframeやMonacoより手前の透明な面でカーソルを統一する。回転・拡縮は行わない。
// 外部Browserにも同じDOM表示だけを使い、preloadやIPCの権限は追加しない。
function mount(id,x,y){
 const surface=document.createElement('div');surface.id=id;surface.dataset.aidiyWindowMove='';
 surface.setAttribute('aria-hidden','true');surface.setAttribute('popover','manual');
 const style=(node,values)=>{for(const [name,value]of Object.entries(values))node.style.setProperty(name,value,'important');};
 style(surface,{all:'initial',position:'fixed',inset:'0',width:'100vw',height:'100vh',margin:'0',padding:'0',border:'0',background:'transparent',overflow:'hidden',cursor:'move','pointer-events':'auto','user-select':'none','z-index':'2147483647','-webkit-app-region':'no-drag'});
 const marker=document.createElementNS('http://www.w3.org/2000/svg','svg');marker.setAttribute('viewBox','0 0 28 28');marker.dataset.aidiyMoveMarker='';
 style(marker,{position:'absolute',left:Math.max(0,Math.min(innerWidth-28,x+12))+'px',top:Math.max(0,Math.min(innerHeight-28,y+12))+'px',width:'28px',height:'28px',display:'block','pointer-events':'none',background:'#080c1aee',border:'1px solid #81e4e8','box-sizing':'border-box'});
 const arrows=document.createElementNS(marker.namespaceURI,'path');arrows.setAttribute('d','M14 4V24M4 14H24M10 8L14 4L18 8M10 20L14 24L18 20M8 10L4 14L8 18M20 10L24 14L20 18');arrows.setAttribute('fill','none');arrows.setAttribute('stroke','#baf7ff');arrows.setAttribute('stroke-width','1.5');
 marker.append(arrows);surface.append(marker);document.documentElement.append(surface);surface.showPopover();
}

function showWindowMoveFeedback(contents,point){
 const id='aidiy-window-move-'+randomUUID();let removed=false,last={...point},pending=null,moving=false;
 const ready=contents.executeJavaScript(`(${mount.toString()})(${JSON.stringify(id)},${Number(point.x)||0},${Number(point.y)||0})`).catch(()=>{});
 async function update(){
  moving=true;await ready;
  try{while(pending&&!removed&&!contents.isDestroyed()){
   const {x,y}=pending;pending=null;
   await contents.executeJavaScript(`(()=>{const marker=document.getElementById(${JSON.stringify(id)})?.querySelector('[data-aidiy-move-marker]');if(marker){marker.style.setProperty('left',Math.max(0,Math.min(innerWidth-28,${x}+12))+'px','important');marker.style.setProperty('top',Math.max(0,Math.min(innerHeight-28,${y}+12))+'px','important');}})()`).catch(()=>{});
  }}finally{moving=false;}
 }
 return{ready,move(point){if(removed||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x===last.x&&point.y===last.y)return;last={...point};pending=last;if(!moving)void update();},remove(){if(removed)return Promise.resolve();removed=true;pending=null;return ready.then(()=>{if(!contents.isDestroyed())return contents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.remove()`).catch(()=>{});});}};
}
module.exports={showWindowMoveFeedback};
