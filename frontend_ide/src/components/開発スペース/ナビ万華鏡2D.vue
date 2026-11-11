<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
defineOptions({name:'ナビ万華鏡2D'});
import {ref, onMounted, onBeforeUnmount} from 'vue';
import {bindNavigationKeys,navigationKeyActive} from './ナビ入力.js';
import {ナビ万華鏡2D描画を作成,ナビ万華鏡2D再生速度} from './ナビ万華鏡2D.js';
const emit = defineEmits(['unsupported']);
const stage=ref(),canvas=ref(),表情名=ref('極光の花冠');
let cleanup=()=>{};
onMounted(()=>{
  const el=stage.value,surface=canvas.value;
  let ctx;
  try{ctx=surface.getContext('2d');}catch{/* 非対応なら開始表示へ戻す */}
  if(!ctx){emit('unsupported');return;}
  const ナビ万華鏡2D描画=ナビ万華鏡2D描画を作成();
  let time=0,raf=0,frameOwner,last=0,painted=0,disposed=false,hover=false;
  const move=event=>{
    const rect=el.getBoundingClientRect();
    if(rect.width>0&&rect.height>0)ナビ万華鏡2D描画.setPointer({x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height});
  };
  const enter=event=>{hover=true;move(event);};
  const leave=()=>{hover=false;ナビ万華鏡2D描画.setPointer(null);};
  const change=()=>{ナビ万華鏡2D描画.next(time);表情名.value=ナビ万華鏡2D描画.state.name;};
  const click=event=>{if(event.button!==0)return;el.focus({preventScroll:true});change();};
  const keydown=event=>{
    if(event.code!=='Space'||event.repeat||!navigationKeyActive(event,el,hover))return;
    event.preventDefault();change();
  };
  const unbind=bindNavigationKeys(el,{keydown,blur:leave,moved:()=>{
    if(raf){frameOwner?.cancelAnimationFrame(raf);last=painted=0;schedule();}
  }});
  el.addEventListener('pointerenter',enter);el.addEventListener('pointerleave',leave);
  el.addEventListener('pointermove',move);el.addEventListener('pointercancel',leave);el.addEventListener('click',click);
  function schedule(){frameOwner=el.ownerDocument.defaultView;raf=frameOwner.requestAnimationFrame(frame);}
  function frame(now){
    if(disposed)return;
    const dt=last?Math.min(.1,(now-last)/1000):0;last=now;
    const doc=el.ownerDocument,owner=doc.defaultView,rect=el.getBoundingClientRect();
    if(!doc.hidden&&rect.width>0&&rect.height>0){
      time+=dt*ナビ万華鏡2D再生速度;
      if(now-painted>=1000/30){
        painted=now-((now-painted)%(1000/30));
        const w=Math.max(1,Math.floor(rect.width)),h=Math.max(1,Math.floor(rect.height)),dpr=Math.min(owner.devicePixelRatio||1,1.5);
        if(surface.width!==Math.round(w*dpr)||surface.height!==Math.round(h*dpr)){surface.width=Math.round(w*dpr);surface.height=Math.round(h*dpr);}
        try{
          ctx.setTransform(dpr,0,0,dpr,0,0);ナビ万華鏡2D描画.draw(ctx,w,h,time);
          表情名.value=ナビ万華鏡2D描画.state.name;
        }catch{cleanup();emit('unsupported');return;}
      }
    }
    schedule();
  }
  cleanup=()=>{
    disposed=true;frameOwner?.cancelAnimationFrame(raf);unbind();
    el.removeEventListener('pointerenter',enter);el.removeEventListener('pointerleave',leave);
    el.removeEventListener('pointermove',move);el.removeEventListener('pointercancel',leave);el.removeEventListener('click',click);
    ナビ万華鏡2D描画.dispose();surface.width=surface.height=0;
  };
  schedule();
});
onBeforeUnmount(()=>cleanup());
</script>
<template>
  <div ref="stage" data-scene="ナビ万華鏡2D" class="navigation-scenery ナビ万華鏡2D" tabindex="0" role="img" :data-pattern="表情名" aria-label="ナビ万華鏡2D。色ガラスが鏡に反射して変化します。ポインターでガラスを動かし、クリック・Spaceで次の模様へ。">
    <canvas ref="canvas" aria-hidden="true"></canvas>
    <div class="万華鏡案内" aria-hidden="true"><span>{{表情名}}</span><small>ポインターで色ガラスを動かす · クリック / Spaceで次の模様</small></div>
  </div>
</template>
<style src="./ナビ風景.css"></style>
<style scoped>
.万華鏡案内{position:absolute;left:0;right:0;bottom:0;padding:28px 12px 10px;pointer-events:none;text-align:center;background:linear-gradient(transparent,#010208bc);text-shadow:0 1px 5px #000}
.万華鏡案内 span{display:block;color:#e6e5f2b8;font-size:11px;letter-spacing:.22em;margin-bottom:5px}
.万華鏡案内 small{position:static;display:block;color:#bdd5df9c;font-size:10px}
</style>
