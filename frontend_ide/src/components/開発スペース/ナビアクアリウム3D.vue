<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
defineOptions({name:'ナビアクアリウム3D'});
import {ref,onMounted,onBeforeUnmount} from 'vue';
import {bindNavigationKeys,navigationKeyActive} from './ナビ入力.js';
import {ナビアクアリウム3D状態を作成} from './ナビアクアリウム3D状態.js';
import {ナビアクアリウム3D描画を作成} from './ナビアクアリウム3D描画.js';
const emit=defineEmits(['unsupported']);
const stage=ref(),canvas=ref(),unavailable=ref(false),ready=ref(false);
let cleanup=()=>{};
onMounted(()=>{
  const el=stage.value,surface=canvas.value,ナビアクアリウム3D状態=ナビアクアリウム3D状態を作成();
  let ナビアクアリウム3D描画;
  try{ナビアクアリウム3D描画=ナビアクアリウム3D描画を作成(surface,ナビアクアリウム3D状態);}catch{ナビアクアリウム3D状態.clear();unavailable.value=true;emit('unsupported');return;}
  let disposed=false,raf=0,frameOwner,last=0,time=0,hover=false,observer,observedDoc;
  const leave=()=>{hover=false;ナビアクアリウム3D状態.setPointer(null);};
  const point=event=>{
    const r=el.getBoundingClientRect();
    return r.width>0&&r.height>0?ナビアクアリウム3D描画.point((event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height):null;
  };
  const move=event=>ナビアクアリウム3D状態.setPointer(event.pointerType==='touch'?null:point(event));
  const enter=event=>{hover=true;move(event);};
  const feed=event=>{
    if(event.button!==0||event.defaultPrevented)return;
    const p=point(event);if(p)ナビアクアリウム3D状態.feed(p.x);
  };
  const keydown=event=>{
    if(!['Space','Enter'].includes(event.code)||event.repeat||event.altKey||event.ctrlKey||event.metaKey||!navigationKeyActive(event,el,hover))return;
    event.preventDefault();ナビアクアリウム3D状態.feed(0);
  };
  function schedule(){
    if(disposed||el.ownerDocument.hidden||raf)return;
    frameOwner=el.ownerDocument.defaultView;raf=frameOwner.requestAnimationFrame(frame);
  }
  function stopFrame(){if(raf)frameOwner?.cancelAnimationFrame(raf);raf=0;last=0;}
  function visibility(){stopFrame();leave();schedule();}
  function moved(doc){
    stopFrame();observedDoc?.removeEventListener('visibilitychange',visibility);observer?.disconnect();
    observedDoc=doc;doc.addEventListener('visibilitychange',visibility);
    observer=new doc.defaultView.ResizeObserver(()=>{last=0;schedule();});observer.observe(el);
    schedule();
  }
  const unbind=bindNavigationKeys(el,{keydown,blur:leave,moved});
  function failed(event){event?.preventDefault();cleanup();unavailable.value=true;emit('unsupported');}
  function frame(now){
    raf=0;if(disposed)return;
    const doc=el.ownerDocument,r=el.getBoundingClientRect();
    if(doc.hidden||r.width<=0||r.height<=0){last=0;return;}
    // 待機画面は約30fps、DPR上限1.5。背景・折り畳み中は描画を休止する。
    if(last&&now-last<32){schedule();return;}
    const dt=last?Math.min(.05,(now-last)/1000):0;last=now;time+=dt;
    try{ナビアクアリウム3D描画.resize(Math.floor(r.width),Math.floor(r.height),doc.defaultView.devicePixelRatio);ナビアクアリウム3D状態.step(dt);ナビアクアリウム3D描画.render(time,dt);ready.value=true;}
    catch{failed();return;}
    schedule();
  }
  el.addEventListener('pointerenter',enter);el.addEventListener('pointermove',move);
  el.addEventListener('pointerleave',leave);el.addEventListener('pointercancel',leave);el.addEventListener('click',feed);
  surface.addEventListener('webglcontextlost',failed);
  cleanup=()=>{
    if(disposed)return;disposed=true;stopFrame();unbind();observer?.disconnect();observedDoc?.removeEventListener('visibilitychange',visibility);
    el.removeEventListener('pointerenter',enter);el.removeEventListener('pointermove',move);el.removeEventListener('pointerleave',leave);
    el.removeEventListener('pointercancel',leave);el.removeEventListener('click',feed);surface.removeEventListener('webglcontextlost',failed);
    ナビアクアリウム3D描画.dispose();ナビアクアリウム3D状態.clear();
  };
});
onBeforeUnmount(()=>cleanup());
</script>
<template>
  <div v-if="!unavailable" ref="stage" data-scene="ナビアクアリウム3D" class="ナビアクアリウム3D" :class="{ready}" tabindex="0" role="img"
    aria-label="ナビアクアリウム3D。クリックで水面から餌を投入。魚はポインターを避け、ポインターから気泡が上がります。食後15秒は餌を追いません。スペース・Enterで中央に餌を投入。">
    <canvas ref="canvas" aria-hidden="true"></canvas>
    <div class="aquarium-vignette" aria-hidden="true"></div>
    <small aria-hidden="true">クリックで餌やり <span>·</span> ポインターから気泡</small>
  </div>
</template>
<style>
.ナビアクアリウム3D{position:absolute;inset:0;overflow:hidden;background:#000;outline:none}
.ナビアクアリウム3D canvas{display:block;width:100%;height:100%}
.ナビアクアリウム3D:focus-visible{box-shadow:inset 0 0 0 2px #8de8e0}
.aquarium-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 38%,transparent 44%,#0006 100%)}
.ナビアクアリウム3D small{position:absolute;bottom:9px;left:8px;right:8px;text-align:center;color:#afc8c7;font:10px/1.5 sans-serif;letter-spacing:.08em;text-shadow:0 1px 5px #000,0 0 8px #000;pointer-events:none}
.ナビアクアリウム3D small span{padding:0 8px;color:#70aaa5}
</style>
