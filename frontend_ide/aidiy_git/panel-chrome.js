// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {createPanelToggleDrag} from './toggle-drag.js';
import {createWindowPinController} from './window-actions.js';

const $=id=>document.getElementById(id);
export function installGitChrome({request}){
 const api=window.top===window?window.aidiyWindow:undefined;
 const embedded=window.parent!==window&&document.querySelector('meta[name=aidiy-embedded]').content==='1';
 const notifyParent=(type,hidden)=>{if(embedded)window.parent.postMessage({type,hidden},location.origin);};
 if(api)document.querySelector('.panel-brand').classList.add('desktop');
 const button=$('fold'),mark=$('fold-mark'),connectionBar=$('connection-bar'),check=$('tools-check');
 let collapsed=false,hidden=false,foldBusy=false,sequence=0,animation=null,foldTone='',runningOperation=false;
 let enabled=true,online=false,checking=null,disposed=false,lastTone='',pulseTimer;
 function displayConnection(){
  const tone=enabled?(online?'online':'disconnected'):'offline';
  connectionBar.dataset.tone=tone;
  $('connection-label').textContent=enabled?(online?'接続済':'未接続'):'確認OFF';
  $('connection-dot').classList.toggle('online',enabled&&online);
  check.setAttribute('aria-checked',String(enabled));
  check.title='Tools接続確認 '+(enabled?'ON':'OFF');
  if(lastTone!==tone){lastTone=tone;drawPulse();}
 }
 function drawPulse(){
  const pulse=Math.round(255*Math.abs(Math.sin(((Date.now()/1000)%9)/9*Math.PI*2)));
  const color=lastTone==='offline'?'#000':lastTone==='online'?`rgb(0, ${pulse}, ${pulse})`:`rgb(${pulse}, 0, 0)`;
  connectionBar.style.backgroundColor=color;
  mark.style.backgroundColor={online:`rgb(0, ${pulse}, ${pulse})`,success:'#00a83a',failure:'#d81f2a'}[foldTone]||'';
 }
 function syncPulse(){
  clearInterval(pulseTimer);pulseTimer=undefined;drawPulse();
  if(!document.hidden&&((!hidden&&enabled)||(collapsed&&foldTone==='online')))pulseTimer=setInterval(drawPulse,50);
 }
 function displayFold({next=collapsed,bodyHidden=hidden,busy=foldBusy}={}){
  if(next!==collapsed){
   foldTone=next&&runningOperation?'online':'';
   collapsed=next;
  }
  hidden=bodyHidden;foldBusy=busy;
  mark.textContent=collapsed?'▶':'▽';
  button.setAttribute('aria-expanded',String(!collapsed));
  const label=collapsed?'パネル内容を表示':'パネル内容を非表示';
  button.setAttribute('aria-label',label);button.title=label+(api?'（ドラッグで移動）':'');
  connectionBar.hidden=hidden;$('main').hidden=hidden;
  document.body.classList.toggle('panel-collapsed',hidden);
  notifyParent('aidiy-git-fold',hidden);syncPulse();
 }
 const stopFold=api?.onPanelCollapseState?.(state=>{
  if(!state||state.name!=null||typeof state.collapsed!=='boolean')return;
  sequence++;animation?.cancel();
  displayFold({next:state.collapsed,bodyHidden:state.hidden===true,busy:state.busy===true});
 });
 async function toggle(){
  if(foldBusy||disposed)return;
  const next=!collapsed,run=++sequence;
  const from=document.body.getBoundingClientRect().height;
  displayFold({next,bodyHidden:false,busy:true});
  if(api?.collapsePanel){
   try{
    const result=await api.collapsePanel(next);
    if(run!==sequence||disposed)return;
    displayFold({next:result?.ok?next:!next,bodyHidden:result?.ok?next:!next,busy:false});
   }catch{if(run===sequence&&!disposed)displayFold({next:!next,bodyHidden:!next,busy:false});}
   return;
  }
  // Webの子フレームは展開時に親へ通常寸法を知らせてからアニメーションする。
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(run!==sequence||disposed)return;
  const to=next?31:document.body.getBoundingClientRect().height;
  animation=document.body.animate([{maxHeight:from+'px'},{maxHeight:to+'px'}],{duration:220,easing:'ease-out'});
  try{await animation.finished;}catch{/* 復元通知や終了で中断した場合は後続の状態を優先。 */}
  if(run===sequence&&!disposed)displayFold({next,bodyHidden:next,busy:false});
 }
 const drag=createPanelToggleDrag({api,win:window,toggle});
 for(const [event,name] of [['pointerdown','down'],['pointermove','move'],['pointerup','up'],['pointercancel','cancel'],['lostpointercapture','up'],['click','click']])button.addEventListener(event,drag[name]);
 button.addEventListener('dragstart',event=>event.preventDefault());
 const pin=createWindowPinController({api,changed:value=>{
  $('pin').disabled=!value.ready||value.busy||value.locked;
  $('pin').setAttribute('aria-pressed',String(value.pinned));
  $('pin').title=value.error||(value.locked?'ピン留め中（解除不可）':value.pinned?'ピン留めを解除':'ピン留め（最前面を維持）');
  $('pin').setAttribute('aria-label',$('pin').title);
 }});
 async function syncMaximize(){
  try{
   const max=!!await api?.isMaximized?.();
   if(!disposed){$('max').classList.toggle('restoring',max);$('max').title=max?'元のサイズに戻す':'最大化';$('max').setAttribute('aria-label',$('max').title);}
  }catch{/* 終了時などの通知は無視する。 */}
 }
 const onFocus=()=>{void syncMaximize();void pin.refresh();};
 if(api){
  for(const element of document.querySelectorAll('.native'))element.hidden=false;
  $('min').onclick=()=>void Promise.resolve(api.minimize()).catch(()=>{});
  $('max').onclick=()=>void Promise.resolve(api.maximize()).then(syncMaximize).catch(()=>{});
  $('pin').onclick=()=>void pin.toggle();
  $('close').hidden=false;$('close').onclick=()=>void Promise.resolve(api.close()).catch(()=>{});
  void pin.start();void syncMaximize();window.addEventListener('resize',syncMaximize);window.addEventListener('focus',onFocus);
 }else if(embedded){$('close').hidden=false;$('close').onclick=()=>notifyParent('aidiy-git-close');}
 async function ping(){
  if(disposed||!enabled||checking)return;
  const controller=new AbortController();checking=controller;
  try{
   const result=await request('tools-status',undefined,controller.signal);
   if(enabled&&checking===controller&&!disposed)online=result.online===true;
  }catch{if(enabled&&checking===controller&&!disposed)online=false;}
  finally{if(checking===controller){checking=null;if(!disposed)displayConnection();}}
 }
 check.onclick=()=>{
  enabled=!enabled;
  if(!enabled){checking?.abort();checking=null;online=false;}
  displayConnection();syncPulse();
  if(enabled)void ping();
 };
 document.addEventListener('visibilitychange',syncPulse);
 const interval=setInterval(ping,10000);
 displayConnection();displayFold();void ping();
 window.addEventListener('pagehide',()=>{
  disposed=true;sequence++;animation?.cancel();checking?.abort();clearInterval(interval);clearInterval(pulseTimer);
  stopFold?.();drag.dispose();pin.dispose();document.removeEventListener('visibilitychange',syncPulse);
  window.removeEventListener('resize',syncMaximize);window.removeEventListener('focus',onFocus);
 },{once:true});
 return {
  operationStarted(){runningOperation=true;},
  operationFinished(ok){runningOperation=false;if(foldTone==='online'){foldTone=ok?'success':'failure';syncPulse();}},
 };
}
