// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

export const VIEWER_IDLE_MS = 180_000;
// 閲覧セッション単位。解除済みのcallbackも世代と条件で無効にする。
export function createViewerIdle({close,now=Date.now,schedule=setTimeout,cancel=clearTimeout,delay=VIEWER_IDLE_MS}) {
  let enabled=false,disposed=false,timer,generation=0,deadline=0;
  function clear(){generation++;cancel(timer);timer=undefined;}
  function activity(){
    if(disposed||!enabled)return;
    clear();deadline=now()+delay;const own=generation;
    timer=schedule(()=>{if(disposed||!enabled||own!==generation)return;if(now()<deadline){timer=schedule(()=>{if(!disposed&&enabled&&own===generation)close();},deadline-now());return;}timer=undefined;close();},delay);
  }
  return {
    configure({inline,autoSpin,pinning=false}){const next=!!inline&&!!autoSpin&&!pinning&&!disposed;if(next===enabled)return;enabled=next;clear();if(enabled)activity();},
    activity,
    dispose(){disposed=true;enabled=false;clear();},
  };
}

// scroll.isTrustedだけではプログラムによる同期scrollを区別できない。
// 実入力の直後の慣性/Monacoスクロールだけを操作として扱う。
export function createViewerActivity(notify,now=Date.now) {
  let lastInput=-Infinity,disposed=false;
  const inputs=new Set(['pointerdown','click','keydown','wheel','touchstart','touchmove','change']);
  function scroll(){if(!disposed&&now()-lastInput>=0&&now()-lastInput<=1500)notify();}
  function handle(event){
    if(disposed||!event||event.isTrusted===false)return;
    if(event.type==='scroll'){scroll();return;}
    if(!inputs.has(event.type)&&!(event.type==='pointermove'&&event.buttons))return;
    lastInput=now();notify();
  }
  return {handle,scroll,dispose(){disposed=true;lastInput=-Infinity;}};
}

// preview/Markdown iframeも同じ入力判定を使う。単なる再描画を親へ通知しない。
export const viewerActivityScript=`(()=>{const activity=(${createViewerActivity.toString()})(()=>parent.postMessage({type:'aidiy-ide-viewer-activity',userInput:true},'*'));for(const type of ['pointerdown','pointermove','click','keydown','wheel','touchstart','touchmove','scroll','change'])addEventListener(type,activity.handle,{capture:true,passive:true});addEventListener('pagehide',()=>activity.dispose(),{once:true});})();`;
