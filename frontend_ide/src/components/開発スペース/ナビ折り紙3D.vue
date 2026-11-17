<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref, computed, onMounted, onBeforeUnmount} from 'vue';
import * as THREE from 'three';
import {折り紙作品, 折り紙を選ぶ, 折り紙の次の手順} from './ナビ折り紙3D.js';
import {navigationKeyActive, bindNavigationKeys} from './ナビ入力.js';
defineOptions({name:'ナビ折り紙3D'});
const emit=defineEmits(['unsupported']);
const stage=ref(), canvas=ref(), step=ref(0), playing=ref(true), rotating=ref(true), progress=ref(0);
const selected=ref(折り紙を選ぶ().id),reducedMotion=ref(false);
const work=computed(()=>折り紙作品.find(item=>item.id===selected.value));
const steps=computed(()=>work.value.手順);
const current=computed(()=>steps.value[step.value]);
let cleanup=()=>{}, elapsed=0, yaw=0, pitch=.12;
const DURATION=14, FOLD_START=3, FOLD_DURATION=6;
function go(index){step.value=Math.max(0,Math.min(steps.value.length-1,index));elapsed=0;progress.value=0;playing.value=false;yaw=0;pitch=.12;}
function chooseWork(id){const resume=playing.value;selected.value=id;go(0);playing.value=resume&&!reducedMotion.value;}
function replay(){elapsed=0;progress.value=0;playing.value=true;}
function front(){yaw=0;pitch=0;rotating.value=false;}
onMounted(()=>{
 const el=stage.value;
 let renderer;
 try{renderer=new THREE.WebGLRenderer({canvas:canvas.value,antialias:true,powerPreference:'low-power'});}catch{emit('unsupported');return;}
 const motion=el.ownerDocument.defaultView.matchMedia?.('(prefers-reduced-motion: reduce)');
 if(motion?.matches){reducedMotion.value=true;playing.value=false;rotating.value=false;}
 renderer.setPixelRatio(Math.min(el.ownerDocument.defaultView.devicePixelRatio||1,1.5));
 renderer.setClearColor(0x04080e,1);
 const scene=new THREE.Scene(), paper=new THREE.Group();scene.add(paper);scene.name='ナビ折り紙3D';
 const camera=new THREE.PerspectiveCamera(36,1,.1,40);camera.position.set(0,.28,6.8);camera.lookAt(0,.28,0);
 const makeGeometry=()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(4096*3),3).setUsage(THREE.DynamicDrawUsage));return g;};
 const bodyGeometry=makeGeometry(),activeGeometry=makeGeometry(),edgeGeometry=makeGeometry(),creaseGeometry=makeGeometry();
 const frontMaterial=new THREE.MeshBasicMaterial({color:0x65bbce,side:THREE.FrontSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
 const backMaterial=new THREE.MeshBasicMaterial({color:0xf2efe4,side:THREE.BackSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
 const activeMaterial=new THREE.MeshBasicMaterial({color:0xf3c76a,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
 const edgeMaterial=new THREE.LineBasicMaterial({color:0x183d50});
 const creaseMaterial=new THREE.LineDashedMaterial({color:0xecf8ff,dashSize:.055,gapSize:.04,depthTest:false,transparent:true,opacity:.8});
 for(const [g,m]of [[bodyGeometry,frontMaterial],[bodyGeometry,backMaterial],[activeGeometry,activeMaterial]]) {const mesh=new THREE.Mesh(g,m);mesh.frustumCulled=false;paper.add(mesh);}
 const edges=new THREE.LineSegments(edgeGeometry,edgeMaterial),creases=new THREE.LineSegments(creaseGeometry,creaseMaterial);
 edges.frustumCulled=false;creases.frustumCulled=false;creases.renderOrder=2;paper.add(edges,creases);
 let disposed=false,raf=0,owner=el.ownerDocument.defaultView,lastDraw=0,lastVisible=0,drag=null,width=0,height=0,drawnStep=-1,drawnProgress=-1,drawnWork='';
 const fill=(geometry,values)=>{const a=geometry.attributes.position;a.array.set(values);a.needsUpdate=true;geometry.setDrawRange(0,values.length/3);};
 const drawPaper=()=>{
  const model=work.value.図形(step.value,progress.value),body=[],active=[],edge=[],crease=[];
  for(const polygon of model.polygons){
   const target=polygon.active?active:body,pts=polygon.points;
   for(let i=1;i<pts.length-1;i++)target.push(...pts[0],...pts[i],...pts[i+1]);
   for(let i=0;i<pts.length;i++)edge.push(...pts[i],...pts[(i+1)%pts.length]);
  }
  for(const [a,b]of model.creases)crease.push(...a,...b);
  fill(bodyGeometry,body);fill(activeGeometry,active);fill(edgeGeometry,edge);fill(creaseGeometry,crease);creases.computeLineDistances();
 };
 const keydown=event=>{
  if(event.repeat||!navigationKeyActive(event,el))return;
  if(event.code==='Space'){event.preventDefault();playing.value=!playing.value;}
  else if(event.code==='ArrowRight'){event.preventDefault();go(step.value+1);}
  else if(event.code==='ArrowLeft'){event.preventDefault();go(step.value-1);}
 };
 const unbind=bindNavigationKeys(el,{keydown,moved(){const next=el.ownerDocument.defaultView;if(next!==owner){owner.cancelAnimationFrame(raf);owner=next;lastVisible=0;raf=owner.requestAnimationFrame(tick);}}});
 const down=e=>{if(e.button!==0)return;el.focus({preventScroll:true});drag={x:e.clientX,y:e.clientY};rotating.value=false;canvas.value.setPointerCapture(e.pointerId);};
 const move=e=>{if(!drag)return;yaw+=(e.clientX-drag.x)*.008;pitch=Math.max(-1.2,Math.min(1.2,pitch+(e.clientY-drag.y)*.008));drag={x:e.clientX,y:e.clientY};};
 const up=()=>{drag=null;};
 canvas.value.addEventListener('pointerdown',down);canvas.value.addEventListener('pointermove',move);canvas.value.addEventListener('pointerup',up);canvas.value.addEventListener('pointercancel',up);
 const lost=e=>{e.preventDefault();playing.value=false;emit('unsupported');};canvas.value.addEventListener('webglcontextlost',lost);
 function tick(now){
  if(disposed)return;
  const rect=canvas.value.getBoundingClientRect(),visible=!el.ownerDocument.hidden&&rect.width>0&&rect.height>0;
  if(visible&&now-lastDraw>=1000/30){
   lastDraw=now;
   // 非表示中は進めず、復帰しても学習中の段階を飛ばさない。
   const dt=lastVisible?Math.min((now-lastVisible)/1000,.1):0;
   if(playing.value){elapsed+=dt;
    if(elapsed>=DURATION){const next=折り紙の次の手順(work.value,step.value);selected.value=next.work.id;step.value=next.step;if(next.step===0){yaw=0;pitch=.12;}elapsed=0;}
    progress.value=Math.max(0,Math.min(1,(elapsed-FOLD_START)/FOLD_DURATION));
   }
   lastVisible=now;
   if(rotating.value&&!drag)yaw+=.0035;
   paper.rotation.set(pitch,step.value===steps.value.length-1?yaw:Math.sin(yaw)*.38,0);
   // 手動回転は360度。自動説明中は正面±22度にとどめ、左右・表裏を見失わせない。
   if(!rotating.value)paper.rotation.y=yaw;
   if(width!==rect.width||height!==rect.height||drawnStep!==step.value||drawnWork!==selected.value){width=rect.width;height=rect.height;renderer.setSize(width,height,false);camera.aspect=width/height;const view=work.value.視点(step.value);camera.position.z=Math.max(view.distance,view.width/camera.aspect);camera.position.y=view.y;camera.lookAt(0,camera.position.y,0);camera.updateProjectionMatrix();}
   if(drawnWork!==selected.value||drawnStep!==step.value||drawnProgress!==progress.value){drawPaper();drawnWork=selected.value;drawnStep=step.value;drawnProgress=progress.value;}renderer.render(scene,camera);
  }else if(!visible){lastVisible=0;}
  owner=el.ownerDocument.defaultView;raf=owner.requestAnimationFrame(tick);
 }
 raf=owner.requestAnimationFrame(tick);
 cleanup=()=>{disposed=true;owner.cancelAnimationFrame(raf);unbind();const c=canvas.value;c?.removeEventListener('pointerdown',down);c?.removeEventListener('pointermove',move);c?.removeEventListener('pointerup',up);c?.removeEventListener('pointercancel',up);c?.removeEventListener('webglcontextlost',lost);for(const g of [bodyGeometry,activeGeometry,edgeGeometry,creaseGeometry])g.dispose();for(const m of [frontMaterial,backMaterial,activeMaterial,edgeMaterial,creaseMaterial])m.dispose();renderer.dispose();renderer.forceContextLoss();};
});
onBeforeUnmount(()=>cleanup());
</script>
<template>
 <section ref="stage" class="ナビ折り紙3D" data-scene="ナビ折り紙3D" tabindex="0" aria-label="折り鶴と兜の折り方。左右キーで手順、スペースで再生と停止。">
  <header><span>{{work.名前}}をつくる</span><small>{{current.章}} · {{step+1}} / {{steps.length}}</small></header>
  <div class="crane-view"><canvas ref="canvas" aria-hidden="true"></canvas><div class="crane-legend">水色：表　白：裏　<span>金色：動かす紙</span><br>破線：折り筋 · 層のすき間を広げた立体模式図</div><div class="crane-view-controls"><button type="button" @click="rotating=!rotating" :aria-pressed="rotating">{{rotating?'回転を止める':'回転する'}}</button><button type="button" @click="front">正面</button></div></div>
  <div class="crane-lesson"><label class="crane-step-select">作品 <select :value="selected" @change="chooseWork($event.target.value)" aria-label="折り紙の作品を選ぶ"><option v-for="item in 折り紙作品" :key="item.id" :value="item.id">{{item.名前}}</option></select><span>自動では2種をランダム再生</span></label>
   <label class="crane-step-select">手順 <select :value="step" @change="go(Number($event.target.value))" aria-label="折り紙の手順を選ぶ"><option v-for="(item,index) in steps" :key="item.型" :value="index">{{index+1}}. {{item.題}}</option></select></label><h3>{{step+1}}. {{current.題}}</h3><p>{{current.説明}}</p><p class="crane-check">確認：{{current.確認}}</p>
   <label class="crane-progress">折る動き <input type="range" min="0" max="1" step="0.01" v-model.number="progress" @input="playing=false;elapsed=FOLD_START+progress*FOLD_DURATION" aria-label="この手順の折る動き" /></label>
   <nav aria-label="折り紙の手順"><button type="button" :disabled="step===0" @click="go(step-1)">前へ</button><button type="button" @click="playing=!playing">{{playing?'一時停止':'再生'}}</button><button type="button" @click="replay">もう一度</button><button type="button" :disabled="step===steps.length-1" @click="go(step+1)">次へ</button><button type="button" @click="go(0)">最初から</button></nav>
   <small>ドラッグで角度を確認 · 手元で折るときは一時停止</small>
  </div>
 </section>
</template>
<style scoped>
.ナビ折り紙3D{position:absolute;inset:0;display:flex;flex-direction:column;overflow:auto;background:#04080e;color:#dcebf2;font:12px/1.5 system-ui,sans-serif;outline:none;min-width:0}
.ナビ折り紙3D:focus-visible{box-shadow:inset 0 0 0 2px #65bbce}
header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px;padding:9px 14px;border-bottom:1px solid #183442}header>span{font-weight:600;letter-spacing:.12em}small{color:#91a8b6;font-size:10px}
.crane-view{position:relative;flex:1 0 170px;min-height:170px;overflow:hidden}.crane-view canvas{width:100%;height:100%;position:absolute;inset:0;display:block;touch-action:none;cursor:grab}.crane-view canvas:active{cursor:grabbing}
.crane-legend{position:absolute;top:8px;left:12px;font-size:10px;color:#91a8b6;pointer-events:none}.crane-legend span{color:#f3c76a}.crane-view-controls{position:absolute;bottom:7px;right:10px;display:flex;gap:5px}
.crane-lesson{flex:0 0 auto;padding:10px 14px 12px;background:#0c1620;border-top:1px solid #23404e;box-sizing:border-box}.crane-lesson h3{font-size:14px;margin:0 0 6px;color:#f2f7fa}.crane-lesson p{margin:4px 0;max-width:76ch}.crane-check{color:#f3d698;font-size:11px}.crane-progress{display:flex;align-items:center;gap:10px;font-size:10px;color:#91a8b6;margin:7px 0}.crane-progress input{flex:1;min-width:30px;accent-color:#65bbce}
.crane-step-select{display:flex;gap:8px;align-items:center;margin-bottom:7px;color:#91a8b6;font-size:10px}.crane-step-select select{flex:1;min-width:0;max-width:100%;background:#10232e;color:#dcebf2;border:1px solid #315365;border-radius:4px;padding:4px;font:inherit;font-size:11px}
nav{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}button{font:inherit;font-size:11px;color:#dcebf2;background:#10232e;border:1px solid #315365;border-radius:4px;padding:4px 9px;cursor:pointer}button:hover{background:#1e3a48}button:disabled{opacity:.35;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #f3c76a;outline-offset:2px}
@media(max-height:380px){.crane-view{flex-basis:130px;min-height:130px}.crane-lesson{padding:7px 10px}.crane-legend{font-size:9px}}
</style>
