<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
defineOptions({name:'ナビ水面波紋3D'});
import {ref,onMounted,onBeforeUnmount} from 'vue';
import * as THREE from 'three';
import {ナビ水面波紋3D状態を作成} from './ナビ水面波紋3D.js';
import {navigationKeyActive,bindNavigationKeys} from './ナビ入力.js';
const emit=defineEmits(['unsupported']);
const stage=ref(),canvas=ref(),ready=ref(false);
let cleanup=()=>{};
onMounted(()=>{
  const el=stage.value,surface=canvas.value,ripples=ナビ水面波紋3D状態を作成();
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas:surface,antialias:true,powerPreference:'low-power'});}
  catch{emit('unsupported');return;}
  renderer.debug.onShaderError=()=>{throw new Error('水面のシェーダーを初期化できませんでした');};
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-8,8,6,-6,.1,60);
  scene.name='ナビ水面波紋3D';camera.position.set(0,10,12);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const extent=new THREE.Vector2(18,30),waves=Array.from({length:32},()=>new THREE.Vector4(0,0,-1,0));
  const uniforms={time:{value:0},extent:{value:extent},waves:{value:waves},waveCount:{value:0}};
  const geometry=new THREE.PlaneGeometry(1,1,256,192);
  const material=new THREE.ShaderMaterial({uniforms,side:THREE.DoubleSide,
    vertexShader:`
      uniform float time;uniform vec2 extent;uniform vec4 waves[32];uniform int waveCount;
      varying vec3 vWorld;varying vec3 vNormal;varying float vHeight;
      void main(){
        vec2 p=position.xy*extent;
        float a=p.x*.68+time*.28,b=p.y*.72-time*.21;
        float height=.024*sin(a)*cos(b);
        vec2 slope=vec2(.01632*cos(a)*cos(b),-.01728*sin(a)*sin(b));
        for(int i=0;i<32;i++){
          if(i>=waveCount)break;
          vec2 delta=p-(waves[i].xy-.5)*extent;float d=length(delta),age=waves[i].z;
          float front=d-age*1.65;
          float envelope=exp(-front*front*1.15)*exp(-age*.38)*smoothstep(0.,.18,age);
          float wave=sin(front*8.4);
          height+=wave*envelope*.16;
          float derivative=(8.4*cos(front*8.4)-2.3*front*wave)*envelope*.16;
          slope+=delta/max(d,.001)*derivative;
        }
        vWorld=vec3(p.x,height,p.y);vNormal=normalize(vec3(-slope.x,1.,-slope.y));vHeight=height;
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
      }`,
    fragmentShader:`
      uniform float time;uniform vec2 extent;uniform vec4 waves[32];uniform int waveCount;
      varying vec3 vWorld;varying vec3 vNormal;varying float vHeight;
      // 法線は画素ごとに解析的に求める。細い反射が三角形の境界でギザギザにならない。
      vec3 surfaceNormal(vec2 p){
        float a=p.x*.68+time*.28,b=p.y*.72-time*.21;
        vec2 slope=vec2(.01632*cos(a)*cos(b),-.01728*sin(a)*sin(b));
        for(int i=0;i<32;i++){
          if(i>=waveCount)break;
          vec2 delta=p-(waves[i].xy-.5)*extent;float d=length(delta),age=waves[i].z;
          float front=d-age*1.65;
          float envelope=exp(-front*front*1.15)*exp(-age*.38)*smoothstep(0.,.18,age);
          float derivative=(8.4*cos(front*8.4)-2.3*front*sin(front*8.4))*envelope*.16;
          slope+=delta/max(d,.001)*derivative;
        }
        return normalize(vec3(-slope.x,1.,-slope.y));
      }
      vec3 environment(vec3 r){
        float horizon=pow(1.-abs(r.y),3.);
        vec3 color=mix(vec3(.012,.042,.075),vec3(.10,.20,.27),horizon);
        // 広い光源の映り込み。水面の傾きで帯が屈折し、輪郭を明るくする。
        float silver=exp(-pow((r.x+.28)*3.7,2.)-pow((r.z+.38)*7.,2.));
        float teal=exp(-pow((r.x-.55)*4.,2.)-pow((r.z+.35)*3.8,2.));
        float blue=exp(-pow((r.x+.7)*5.,2.)-pow((r.z-.15)*3.,2.));
        return color+silver*vec3(.68,.84,.9)+teal*vec3(.015,.32,.30)+blue*vec3(.025,.09,.28);
      }
      void main(){
        vec3 n=surfaceNormal(vWorld.xz),eye=normalize(cameraPosition-vWorld),r=reflect(-eye,n);
        float fresnel=.045+.955*pow(1.-max(dot(n,eye),0.),4.);
        vec3 deep=vec3(.008,.035,.060);
        float depthGlow=exp(-length(vWorld.xz-vec2(-2.,-4.))*.14);
        deep+=vec3(.006,.045,.055)*depthGlow;
        vec3 col=mix(deep,environment(r),.44+fresnel*.48);
        vec3 light=normalize(vec3(-.3,1.,-.4)),halfVector=normalize(light+eye);
        float specular=pow(max(dot(n,halfVector),0.),180.);
        col+=vec3(.7,.85,.9)*specular*.9;
        // 透過光はごく弱く。頂点変位と同じ法線から反射を求める。
        col+=vec3(.015,.045,.045)*max(0.,vHeight);
        col*=1.-smoothstep(8.,23.,length(vWorld.xz))*.48;
        col=vec3(1.)-exp(-col*1.5);gl_FragColor=vec4(col,1.);
        #include <colorspace_fragment>
      }`,
  });
  const water=new THREE.Mesh(geometry,material);water.frustumCulled=false;scene.add(water);
  const raycaster=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),hit=new THREE.Vector3();
  function screenPoint(x,y){
    raycaster.setFromCamera(new THREE.Vector2(x*2-1,1-y*2),camera);
    if(!raycaster.ray.intersectPlane(plane,hit))return null;
    return {x:THREE.MathUtils.clamp(hit.x/extent.x+.5,0,1),y:THREE.MathUtils.clamp(hit.z/extent.y+.5,0,1)};
  }
  const randomPoint=()=>screenPoint(.12+Math.random()*.76,.15+Math.random()*.7);
  let pointer=null,pending=false,hover=false,nextDrop=0,nextHover=0,time=0,last=0,raf=0,frameOwner,disposed=false,observer,observedDoc;
  let width=0,height=0,dpr=0;
  const leave=()=>{pointer=null;pending=false;hover=false;};
  const point=event=>{const r=el.getBoundingClientRect();return r.width&&r.height?screenPoint((event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height):null;};
  const move=event=>{pointer=event.pointerType==='touch'?null:point(event);pending=!!pointer;};
  const enter=event=>{hover=true;move(event);};
  const click=event=>{if(event.button===0&&!event.defaultPrevented){const p=point(event);if(p)ripples.add(p);}};
  const keydown=event=>{
    if(event.code!=='Space'||event.repeat||event.altKey||event.ctrlKey||event.metaKey||!navigationKeyActive(event,el,hover))return;
    event.preventDefault();ripples.add(randomPoint());
  };
  function schedule(){if(disposed||raf||el.ownerDocument.hidden)return;frameOwner=el.ownerDocument.defaultView;raf=frameOwner.requestAnimationFrame(frame);}
  function stop(){if(raf)frameOwner?.cancelAnimationFrame(raf);raf=0;last=0;}
  function visibility(){stop();leave();schedule();}
  function moved(doc){
    stop();observedDoc?.removeEventListener('visibilitychange',visibility);observer?.disconnect();
    observedDoc=doc;doc.addEventListener('visibilitychange',visibility);
    observer=new doc.defaultView.ResizeObserver(()=>{last=0;schedule();});observer.observe(el);schedule();
  }
  const unbind=bindNavigationKeys(el,{keydown,blur:leave,moved});
  function fail(event){event?.preventDefault();cleanup();emit('unsupported');}
  function frame(now){
    raf=0;if(disposed)return;
    const doc=el.ownerDocument,r=el.getBoundingClientRect();
    if(doc.hidden||!r.width||!r.height){last=0;return;}
    if(last&&now-last<32){schedule();return;}
    const dt=last?Math.min(.05,(now-last)/1000):0;last=now;time+=dt;
    try{
      const ratio=Math.min(doc.defaultView.devicePixelRatio||1,1.5);
      if(width!==r.width||height!==r.height||dpr!==ratio){
        width=r.width;height=r.height;dpr=ratio;renderer.setPixelRatio(dpr);renderer.setSize(Math.floor(width),Math.floor(height),false);
        const aspect=width/height;camera.left=-6*aspect;camera.right=6*aspect;camera.updateProjectionMatrix();extent.x=Math.max(7,14*aspect);
        pointer=null;pending=false;
      }
      if(!ready.value){
        for(const [x,y,age] of [[.3,.4,.7],[.65,.63,1.5],[.55,.2,2.4]]){const p=ripples.add(screenPoint(x,y));p.age=age;}
      }
      ripples.step(dt);nextDrop-=dt;nextHover-=dt;
      if(pending&&nextHover<=0){ripples.add(pointer);pending=false;nextHover=.12;nextDrop=1.1;}
      else if(nextDrop<=0){ripples.add(pointer||randomPoint());nextDrop=1.2+Math.random()*1.6;}
      uniforms.time.value=time;uniforms.waveCount.value=ripples.points.length;
      ripples.points.forEach((p,i)=>waves[i].set(p.x,p.y,p.age,0));
      renderer.render(scene,camera);ready.value=true;
    }catch{fail();return;}
    schedule();
  }
  el.addEventListener('pointerenter',enter);el.addEventListener('pointermove',move);el.addEventListener('pointerleave',leave);el.addEventListener('pointercancel',leave);el.addEventListener('click',click);
  surface.addEventListener('webglcontextlost',fail);
  cleanup=()=>{
    if(disposed)return;disposed=true;stop();unbind();observer?.disconnect();observedDoc?.removeEventListener('visibilitychange',visibility);
    el.removeEventListener('pointerenter',enter);el.removeEventListener('pointermove',move);el.removeEventListener('pointerleave',leave);el.removeEventListener('pointercancel',leave);el.removeEventListener('click',click);surface.removeEventListener('webglcontextlost',fail);
    ripples.points.length=0;geometry.dispose();material.dispose();scene.clear();renderer.dispose();renderer.forceContextLoss();
  };
});
onBeforeUnmount(()=>cleanup());
</script>
<template>
  <div ref="stage" data-scene="ナビ水面波紋3D" class="ナビ水面波紋3D" :class="{ready}" tabindex="0" role="img" aria-label="ナビ水面波紋3D。ポインター付近に波紋が広がります。クリックでその位置に、スペースキーでランダムな位置に波紋を追加。">
    <canvas ref="canvas" aria-hidden="true"></canvas>
    <div class="navigation-water-shade" aria-hidden="true"></div>
    <small aria-hidden="true">ポインターで波紋 <span>·</span> クリック / スペースで追加</small>
  </div>
</template>
<style>
.ナビ水面波紋3D{position:absolute;inset:0;overflow:hidden;background:#000;outline:none}
.ナビ水面波紋3D canvas{display:block;width:100%;height:100%}
.ナビ水面波紋3D:focus-visible{box-shadow:inset 0 0 0 2px #8de8e0}
.navigation-water-shade{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 40%,transparent 30%,#0005 100%)}
.ナビ水面波紋3D small{position:absolute;left:8px;right:8px;bottom:9px;text-align:center;color:#a0b8c7;font:10px/1.5 sans-serif;letter-spacing:.07em;text-shadow:0 1px 6px #000;pointer-events:none}
.ナビ水面波紋3D small span{padding:0 8px;color:#618e9c}
</style>
