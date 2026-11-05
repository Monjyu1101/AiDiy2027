<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref, onMounted, onBeforeUnmount} from 'vue';
import {navigationKeyActive, bindNavigationKeys} from './ナビ入力.js';
import {createRipples} from './ナビ風景.js';
const props = defineProps({kind: {type:String, required:true}});
const emit = defineEmits(['unsupported']);
const stage = ref(), canvas = ref();
const labels = {aquarium:'ナビアクアリウム', kaleidoscope:'ナビ万華鏡', water:'ナビ水面。スペースキーでランダムな位置に波紋を追加'};
let cleanup = () => {};
onMounted(() => {
  const el = stage.value, surface = canvas.value;
  let ctx;
  try { ctx = surface.getContext('2d'); } catch { /* 非対応なら開始表示へ戻す */ }
  if (!ctx) { emit('unsupported'); return; }
  const ripples = createRipples(); ripples.add();
  const fish = Array.from({length:18}, () => ({x:Math.random(), y:.12+Math.random()*.72, size:7+Math.random()*13, speed:.015+Math.random()*.025, dir:Math.random()<.5?-1:1, hue:165+Math.random()*150, phase:Math.random()*6.28}));
  let hover=false, time=0, nextDrop=0, raf=0, frameOwner, last=0, disposed=false;
  const enter=()=>{hover=true;}, leave=()=>{hover=false;};
  const keydown=event=>{
    if(props.kind!=='water'||event.code!=='Space'||event.repeat||event.altKey||event.ctrlKey||event.metaKey||!navigationKeyActive(event,el,hover))return;
    event.preventDefault();ripples.add();
  };
  const unbind=bindNavigationKeys(el,{keydown,blur:()=>{hover=false;},moved:()=>{
    // 元窓が非表示でRAFが止まっていても移動先で描画を再開する。
    if(raf){frameOwner?.cancelAnimationFrame(raf);last=0;schedule();}
  }});
  el.addEventListener('pointerenter',enter);el.addEventListener('pointerleave',leave);
  function drawWater(w,h) {
    for(const point of ripples.points){
      for(let ring=0;ring<4;ring++){
        const age=point.age-ring*.3;if(age<0)continue;
        const radius=age*Math.min(w,h)*.10+2;
        ctx.strokeStyle=`rgba(105,210,238,${Math.max(0,1-age/7)*.55})`;
        ctx.lineWidth=ring===0?1.5:1;
        ctx.beginPath();ctx.ellipse(point.x*w,point.y*h,radius,radius*.55,0,0,Math.PI*2);ctx.stroke();
      }
    }
  }
  function drawAquarium(w,h) {
    // 黒い水槽に水草、泡、ゆっくり泳ぐ魚を重ねる。
    ctx.strokeStyle='#134b43';ctx.lineWidth=2;
    for(let i=0;i<17;i++){
      const x=(i+.5)*w/17, length=25+(i%5)*14;
      ctx.beginPath();ctx.moveTo(x,h);ctx.bezierCurveTo(x+12,h-length*.4,x-14+Math.sin(time+i)*8,h-length*.7,x+Math.sin(time*.5+i)*9,h-length);ctx.stroke();
    }
    ctx.strokeStyle='#295c70';ctx.lineWidth=1;
    for(let i=0;i<16;i++){ctx.beginPath();ctx.arc(((i*.137)%1)*w+Math.sin(time+i)*4,h-((time*12+i*47)%(h+10)),2+i%3,0,Math.PI*2);ctx.stroke();}
    for(const f of fish){
      const x=((f.x+time*f.speed*f.dir)%1+1)%1*w,y=f.y*h+Math.sin(time*.8+f.phase)*9;
      ctx.save();ctx.translate(x,y);ctx.scale(f.dir,1);ctx.fillStyle=`hsl(${f.hue} 65% 62%)`;ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=7;
      ctx.beginPath();ctx.ellipse(0,0,f.size,f.size*.42,0,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.moveTo(-f.size*.7,0);ctx.lineTo(-f.size*1.6,-f.size*.45);ctx.lineTo(-f.size*1.6,f.size*.45);ctx.closePath();ctx.fill();
      ctx.shadowBlur=0;ctx.fillStyle='#08171b';ctx.beginPath();ctx.arc(f.size*.55,-f.size*.09,1.6,0,Math.PI*2);ctx.fill();ctx.restore();
    }
  }
  function drawKaleidoscope(w,h) {
    const radius=Math.min(w,h)*.46;
    ctx.save();ctx.translate(w/2,h/2);ctx.rotate(time*.035);
    for(let sector=0;sector<12;sector++){
      ctx.save();ctx.rotate(sector*Math.PI/6);ctx.scale(1,sector%2?-1:1);
      for(let j=0;j<7;j++){
        const r=radius*(.18+j*.11), angle=.12+Math.sin(time*.18+j)*.09;
        ctx.fillStyle=`hsla(${(j*43+time*8)%360} 78% 61% / .65)`;ctx.strokeStyle=`hsla(${(j*43+time*8+40)%360} 90% 78% / .8)`;
        ctx.beginPath();ctx.moveTo(r,0);ctx.lineTo(r*.75,Math.sin(angle)*r);ctx.lineTo(r*.5,0);ctx.lineTo(r*.75,-Math.sin(angle)*r);ctx.closePath();ctx.fill();ctx.stroke();
      }ctx.restore();
    }ctx.restore();
  }
  function schedule(){frameOwner=el.ownerDocument.defaultView;raf=frameOwner.requestAnimationFrame(frame);}
  function frame(now){
    if(disposed)return;
    const dt=last?Math.min(.05,(now-last)/1000):0;last=now;
    const doc=el.ownerDocument, owner=doc.defaultView, rect=el.getBoundingClientRect();
    if(!doc.hidden&&rect.width>0&&rect.height>0){
      const reduced=owner.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const pace=reduced?.15:1;
      time+=dt*pace;ripples.step(dt*pace);nextDrop-=dt*pace;
      if(nextDrop<=0){ripples.add();nextDrop=.8+Math.random()*1.8;}
      const w=Math.floor(rect.width),h=Math.floor(rect.height),dpr=Math.min(owner.devicePixelRatio||1,2);
      if(surface.width!==Math.round(w*dpr)||surface.height!==Math.round(h*dpr)){surface.width=Math.round(w*dpr);surface.height=Math.round(h*dpr);}
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
      if(props.kind==='water')drawWater(w,h);else if(props.kind==='aquarium')drawAquarium(w,h);else drawKaleidoscope(w,h);
    }
    schedule();
  }
  schedule();
  cleanup=()=>{disposed=true;frameOwner?.cancelAnimationFrame(raf);unbind();el.removeEventListener('pointerenter',enter);el.removeEventListener('pointerleave',leave);ripples.points.length=0;surface.width=surface.height=0;};
});
onBeforeUnmount(()=>cleanup());
</script>
<template>
  <div ref="stage" class="navigation-scenery" :class="'navigation-'+kind" tabindex="0" role="img" :aria-label="labels[kind]">
    <canvas ref="canvas" aria-hidden="true"></canvas>
    <small v-if="kind==='water'" aria-hidden="true">スペースキーで波紋を追加</small>
  </div>
</template>
<style>
.navigation-scenery{position:absolute;inset:0;overflow:hidden;background:#000;outline:none}
.navigation-scenery canvas{display:block;width:100%;height:100%}
.navigation-scenery:focus-visible{box-shadow:inset 0 0 0 2px #8de8e0}
.navigation-scenery small{position:absolute;left:0;right:0;bottom:6px;text-align:center;color:#6f95a8;font-size:10px;pointer-events:none;text-shadow:0 0 4px #000}
</style>
