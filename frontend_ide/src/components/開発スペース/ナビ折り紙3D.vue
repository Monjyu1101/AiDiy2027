<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,shallowRef,computed,onMounted,onBeforeUnmount} from 'vue';
import * as THREE from 'three';
import {bindNavigationKeys,navigationKeyActive} from './ナビ入力.js';
import {折り紙を選ぶ,折り途中,折線回転,再生状態を作る,再生を進める} from './ナビ折り紙3D.js';
defineOptions({name:'ナビ折り紙3D'});
const emit=defineEmits(['unsupported']);
const work=shallowRef(折り紙を選ぶ());
let steps=work.value.steps;
const stage=ref(),canvas=ref(),index=ref(0),phase=ref('align'),playing=ref(true),ready=ref(false),progress=ref(0);
const current=computed(()=>work.value.steps[index.value]);
const phaseLabel=computed(()=>({align:'見やすい向きへ',guide:current.value.op?'折り筋を確かめる':'紙を眺める',fold:current.value.reverse?'開き戻す':'ゆっくり折る',hold:current.value.finished?'できあがり':'形を確かめる',turn:'次の向きへ'})[phase.value]);
let runtime=再生状態を作る(steps),cleanup=()=>{},redraw=()=>{};
function sync(){index.value=runtime.index;phase.value=runtime.phase;progress.value=(runtime.index+(runtime.phase==='fold'?runtime.elapsed/3.8:runtime.phase==='hold'||runtime.phase==='turn'?1:0))/steps.length;}
function jump(n){
  const next=Math.max(0,Math.min(steps.length-1,n));runtime=再生状態を作る(steps,next);
  // 明示的な前後操作でも必ず折る前から。再生中だけ角度合わせ・折りを続ける。
  sync();redraw();
}
function toggle(){playing.value=!playing.value;}
onMounted(()=>{
  const el=stage.value;
  playing.value=!el.ownerDocument.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas:canvas.value,antialias:true,alpha:true,powerPreference:'low-power'});}
  catch{emit('unsupported');return;}
  renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();scene.name='ナビ折り紙3D';
  const camera=new THREE.OrthographicCamera(-1.5,1.5,1.5,-1.5,.1,30);
  scene.add(new THREE.HemisphereLight(0xf3e8d7,0x536676,2.2));
  const key=new THREE.DirectionalLight(0xffedd7,3.2);key.position.set(-2.5,3,5);key.castShadow=true;
  key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-2,right:2,top:2,bottom:-2,near:.1,far:15});key.shadow.bias=-.0003;key.shadow.normalBias=.008;scene.add(key);
  const fill=new THREE.DirectionalLight(0xa8ccdf,1.8);fill.position.set(3,1,-4);scene.add(fill);
  // 細い繊維だけを描く自前の紙肌。参照サイトの画像・図版は使用しない。
  const textureCanvas=el.ownerDocument.createElement('canvas');textureCanvas.width=textureCanvas.height=256;
  const ctx=textureCanvas.getContext('2d');ctx.fillStyle='#e8e5dd';ctx.fillRect(0,0,256,256);
  let seed=7;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<1800;i++){ctx.strokeStyle=`rgba(85,70,50,${.02+random()*.055})`;ctx.beginPath();const x=random()*256,y=random()*256;ctx.moveTo(x,y);ctx.lineTo(x+random()*4,y+random()*1.3);ctx.stroke();}
  const texture=new THREE.CanvasTexture(textureCanvas);texture.colorSpace=THREE.SRGBColorSpace;
  const front=new THREE.MeshStandardMaterial({color:0xf5ead6,map:texture,roughness:.97,metalness:0,side:THREE.FrontSide});
  const back=new THREE.MeshStandardMaterial({color:0xc76b4d,map:texture,roughness:.93,metalness:0,side:THREE.BackSide});
  const paper=new THREE.Group();scene.add(paper);
  let meshes=[],loaded=-1,disposed=false,raf=0,owner,last=0,width=0,height=0,pixelRatio=0,hover=false,failed=false,paperThickness=.0025;
  const gold=0xe5b66d;
  const crease=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:gold,dashSize:.035,gapSize:.025,transparent:true,opacity:.9,depthTest:false}));
  const arc=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:gold,dashSize:.018,gapSize:.018,transparent:true,opacity:.42,depthTest:false}));
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.018,12,8),new THREE.MeshBasicMaterial({color:gold,depthTest:false}));
  const arrow=new THREE.Mesh(new THREE.ConeGeometry(.028,.075,12),new THREE.MeshBasicMaterial({color:gold,transparent:true,opacity:.8,depthTest:false}));
  for(const object of [crease,arc,marker,arrow]){object.renderOrder=100;scene.add(object);}
  const disposePaper=()=>{for(const m of meshes){m.geometry.dispose();m.edge.geometry.dispose();m.edge.material.dispose();}meshes=[];paper.clear();};
  function setup(){
    disposePaper();loaded=runtime.index;const step=steps[loaded],faces=step.op?step.op.parts:step.faces;
    // 層が増えても厚い板の束に見せない。重なり順を保ち、紙全体の表示厚を制限する。
    paperThickness=Math.min(.0025,.018/Math.max(1,...faces.flatMap(f=>[f.layer,f.endLayer??f.layer])));
    back.color.setHex(work.value.id==='crane'?0x729da7:0xc76b4d);
    for(const face of faces){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array((face.points.length-2)*9),3));
      const uv=[];for(let i=1;i<face.points.length-1;i++)for(const p of [face.points[0],face.points[i],face.points[i+1]])uv.push((p[0]+1)/2,(p[1]+1)/2);
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      const f=new THREE.Mesh(geometry,front),b=new THREE.Mesh(geometry,back);f.castShadow=b.castShadow=true;f.receiveShadow=b.receiveShadow=true;
      const edge=new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(face.points.length*3),3)),new THREE.LineBasicMaterial({color:0x776751,transparent:true,opacity:.32}));
      paper.add(f,b,edge);meshes.push({geometry,edge,moving:face.moving});
    }
    if(step.op){
      const op=step.op;
      crease.geometry.dispose();crease.geometry=new THREE.BufferGeometry().setFromPoints(op.hinge.map(p=>new THREE.Vector3(p[0],p[1],.045)));crease.computeLineDistances();
      const tipAt=t=>op.tipAt?op.tipAt(t):折線回転(op.tip,op.a,op.b,op.angle*t);
      const path=[];for(let i=0;i<=48;i++)path.push(new THREE.Vector3(...tipAt(i/48)));
      arc.geometry.dispose();arc.geometry=new THREE.BufferGeometry().setFromPoints(path);arc.computeLineDistances();
      const t=step.reverse?.28:.72,position=new THREE.Vector3(...tipAt(t));
      const tangent=new THREE.Vector3(...tipAt(t+(step.reverse?-.01:.01))).sub(position).normalize();
      arrow.position.copy(position);arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),tangent);
    }
  }
  let centerY=0,halfView=1.32,fitKey='',targetHalf=1.32;
  function fitPaper(step,aspect,center){
    const key=runtime.index+':'+aspect.toFixed(3);
    if(fitKey===key)return;fitKey=key;
    const poses=step.op?[0,.25,.5,.75,1].flatMap(t=>折り途中(step.op,t)):step.faces;
    const yaw=step.view,elevation=step.elevation;
    const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const up=new THREE.Vector3(-Math.sin(yaw)*Math.sin(elevation),Math.cos(elevation),-Math.cos(yaw)*Math.sin(elevation));
    let x=0,y=0;
    for(const face of poses)for(const p of face.points){const v=new THREE.Vector3(p[0],p[1]-center,p[2]);x=Math.max(x,Math.abs(v.dot(right)));y=Math.max(y,Math.abs(v.dot(up)));}
    // 折る途中で画角を変えないよう、動作全体が収まる大きさを先に決める。
    targetHalf=Math.max(.42,y*1.23,x/aspect*1.23);
  }
  function draw(dt=0){
    if(loaded!==runtime.index)setup();
    const step=steps[runtime.index],faces=step.op?折り途中(step.op,runtime.amount,paperThickness):step.faces.map(f=>({...f,points:f.points.map(p=>[p[0],p[1],p[2]+f.layer*paperThickness])}));
    const guiding=runtime.phase==='guide',folding=runtime.phase==='fold';
    faces.forEach((face,i)=>{
      const {geometry,edge,moving}=meshes[i],positions=geometry.attributes.position.array;let cursor=0;
      for(let j=1;j<face.points.length-1;j++)for(const p of [face.points[0],face.points[j],face.points[j+1]])for(const n of p)positions[cursor++]=n;
      geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();
      edge.geometry.attributes.position.array.set(face.points.flat());edge.geometry.attributes.position.needsUpdate=true;edge.geometry.computeBoundingSphere();
      edge.material.color.setHex(moving&&(guiding||folding)?gold:0x766756);edge.material.opacity=moving&&guiding?.7:.3;
    });
    crease.visible=!!step.op&&(guiding||folding);arc.visible=arrow.visible=!!step.op&&guiding;marker.visible=!!step.op&&(guiding||folding);
    if(step.op)marker.position.set(...(step.op.tipAt?step.op.tipAt(runtime.amount):折線回転(step.op.tip,step.op.a,step.op.b,step.op.angle*runtime.amount)));
    const desired=step.center??(runtime.index===0?0:runtime.index<5?-.28:-.35);
    centerY+=(desired-centerY)*(dt?1-Math.exp(-dt*2):1);
    const aspect=width/Math.max(1,height);fitPaper(step,aspect,desired);
    halfView+=(targetHalf-halfView)*(dt?1-Math.exp(-dt*2.4):1);
    camera.left=-halfView*aspect;camera.right=halfView*aspect;camera.top=halfView;camera.bottom=-halfView;camera.updateProjectionMatrix();
    const radius=5,e=runtime.elevation,y=runtime.yaw;
    camera.position.set(Math.sin(y)*Math.cos(e)*radius,centerY+Math.sin(e)*radius,Math.cos(y)*Math.cos(e)*radius);camera.lookAt(0,centerY,0);
    renderer.render(scene,camera);ready.value=true;
  }
  redraw=()=>draw();
  function frame(now){
    if(disposed||failed)return;
    const dt=last?Math.min(.05,(now-last)/1000):0;last=now;
    const doc=el.ownerDocument,rect=canvas.value.getBoundingClientRect();
    if(!doc.hidden&&rect.width>0&&rect.height>0){
      const w=Math.floor(rect.width),h=Math.floor(rect.height),dpr=Math.min(doc.defaultView.devicePixelRatio||1,1.5);
      if(w!==width||h!==height||dpr!==pixelRatio){width=w;height=h;pixelRatio=dpr;renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);
        const aspect=w/h,half=Math.max(1.32,1.35/aspect);camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();}
      if(playing.value){
        const previous=runtime.index;再生を進める(runtime,steps,dt);
        if(previous===steps.length-1&&runtime.index===0){
          work.value=折り紙を選ぶ();steps=work.value.steps;runtime=再生状態を作る(steps);loaded=-1;fitKey='';
        }
      }
      sync();draw(dt);
    }
    schedule();
  }
  function schedule(){owner=el.ownerDocument.defaultView;raf=owner.requestAnimationFrame(frame);}
  const enter=()=>hover=true,leave=()=>hover=false;
  el.addEventListener('pointerenter',enter);el.addEventListener('pointerleave',leave);
  const unbind=bindNavigationKeys(el,{keydown:event=>{
    if(!navigationKeyActive(event,el,hover)||event.repeat)return;
    if(event.code==='Space'){event.preventDefault();toggle();}
    else if(event.code==='ArrowLeft'){event.preventDefault();jump(index.value-1);}
    else if(event.code==='ArrowRight'){event.preventDefault();jump(index.value+1);}
  },blur:()=>{hover=false;},moved:()=>{if(raf){owner?.cancelAnimationFrame(raf);last=0;schedule();}}});
  const contextLost=event=>{event.preventDefault();failed=true;owner?.cancelAnimationFrame(raf);emit('unsupported');};
  canvas.value.addEventListener('webglcontextlost',contextLost);
  schedule();
  cleanup=()=>{
    disposed=true;redraw=()=>{};owner?.cancelAnimationFrame(raf);unbind();el.removeEventListener('pointerenter',enter);el.removeEventListener('pointerleave',leave);
    canvas.value?.removeEventListener('webglcontextlost',contextLost);disposePaper();
    for(const object of [crease,arc,marker,arrow]){object.geometry.dispose();object.material.dispose();}
    front.dispose();back.dispose();texture.dispose();key.shadow.map?.dispose();renderer.dispose();renderer.forceContextLoss();
  };
});
onBeforeUnmount(()=>cleanup());
</script>
<template>
  <section ref="stage" class="ナビ折り紙3D" :class="{ready}" data-scene="ナビ折り紙3D" :data-work="work.id" :data-step="index" :data-phase="phase" tabindex="0" :aria-label="`折り紙の${work.name}。一枚の紙を回して見やすい向きに止め、順に折ります。スペースで一時停止、左右キーで前後の手順。`">
    <header class="origami-heading"><span>折り紙 <i></i> <strong>{{work.name}}</strong></span><span class="origami-count">{{String(index+1).padStart(2,'0')}} <small>/ {{steps.length}}</small></span></header>
    <div class="origami-viewport"><canvas ref="canvas" aria-hidden="true"></canvas></div>
    <footer class="origami-caption">
      <div class="origami-phase"><i :class="{paused:!playing}"></i>{{playing?phaseLabel:'一時停止'}}</div>
      <h3>{{current.title}}</h3><p>{{current.note}}</p>
      <nav aria-label="折り紙の再生操作">
        <button type="button" title="最初から" aria-label="最初から" @click="jump(0)"><svg viewBox="0 0 24 24"><path d="M5 8a8 8 0 1 1-1 7M5 3v5h5"/></svg></button>
        <button type="button" :disabled="index===0" title="ひとつ前" aria-label="ひとつ前の手順" @click="jump(index-1)"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button>
        <button type="button" class="origami-play" :title="playing?'一時停止':'再生'" :aria-label="playing?'一時停止':'再生'" @click="toggle"><svg v-if="playing" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg><svg v-else viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg></button>
        <button type="button" :disabled="index===steps.length-1" title="次へ" aria-label="次の手順" @click="jump(index+1)"><svg viewBox="0 0 24 24"><path d="m10 6 6 6-6 6"/></svg></button>
      </nav>
    </footer>
    <div class="origami-progress" aria-hidden="true"><span :style="{transform:`scaleX(${progress})`}"></span></div>
  </section>
</template>
<style>
.ナビ折り紙3D{position:absolute;inset:0;display:grid;grid-template-rows:48px minmax(80px,1fr) auto;overflow:hidden;background:radial-gradient(ellipse at 50% 36%,#263034 0%,#141b1f 42%,#0b1013 85%);color:#eee7db;font:12px/1.5 system-ui,'Yu Gothic UI',sans-serif;outline:none;min-width:0;isolation:isolate}
.ナビ折り紙3D:focus-visible{box-shadow:inset 0 0 0 1px #c9b58c}
.ナビ折り紙3D .origami-heading{display:flex;justify-content:space-between;align-items:center;padding:0 24px;color:#9da6a7;font-size:11px;letter-spacing:.16em;font-weight:400;pointer-events:none}
.origami-heading>span:first-child{display:flex;align-items:center;gap:12px}.origami-heading i{height:10px;width:1px;background:#657071}.origami-heading strong{font-size:14px;font-weight:500;color:#e9dec9}.origami-count{font-variant-numeric:tabular-nums;color:#d9c9ac;letter-spacing:.08em}.origami-count small{color:#6d7a7d;font-size:10px}
.origami-viewport{position:relative;min-height:0;min-width:0}.ナビ折り紙3D canvas{display:block;width:100%;height:100%}
.ナビ折り紙3D .origami-caption{text-align:center;padding:8px 20px 14px;background:linear-gradient(transparent,#0b101355);pointer-events:none}
.origami-phase{display:flex;align-items:center;justify-content:center;gap:6px;color:#a49374;font-size:10px;letter-spacing:.12em;min-height:17px}.origami-phase i{width:4px;height:4px;border-radius:50%;background:#d8b47c}.origami-phase i.paused{background:#738080}
.ナビ折り紙3D h3{margin:7px 0 4px;font-size:clamp(15px,2.6vw,20px);line-height:1.5;font-weight:500;letter-spacing:.06em;color:#eee7db}.ナビ折り紙3D p{margin:0;color:#94a1a5;font-size:11px;line-height:1.7;min-height:19px}
.ナビ折り紙3D nav{display:flex;gap:8px;justify-content:center;align-items:center;margin-top:13px;pointer-events:auto}
.ナビ折り紙3D nav button{display:grid;place-items:center;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:50%;background:transparent;color:#859397;cursor:pointer;box-shadow:none}
.ナビ折り紙3D nav button:hover:enabled{background:#ffffff0a;color:#e7d6b9}.ナビ折り紙3D nav button:focus-visible{outline:1px solid #d8b47c;outline-offset:3px}.ナビ折り紙3D nav button:disabled{opacity:.25;cursor:default}
.ナビ折り紙3D nav .origami-play{width:38px;height:38px;border-color:#cdb68c55;color:#e4d2af;background:#d8b47c08;margin:0 3px}.ナビ折り紙3D nav svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.origami-progress{position:absolute;left:0;right:0;bottom:0;height:2px;background:#a4937410}.origami-progress span{display:block;height:100%;width:100%;background:#bda276;transform-origin:left;transition:transform .15s linear}
@media(max-height:390px){.ナビ折り紙3D{grid-template-rows:30px minmax(60px,1fr) auto}.ナビ折り紙3D .origami-caption{padding:0 12px 6px}.ナビ折り紙3D h3{font-size:14px;margin:2px 0}.ナビ折り紙3D p{font-size:10px}.ナビ折り紙3D nav{margin-top:4px}.ナビ折り紙3D nav .origami-play{width:30px;height:30px}.origami-phase{font-size:9px}}
</style>
