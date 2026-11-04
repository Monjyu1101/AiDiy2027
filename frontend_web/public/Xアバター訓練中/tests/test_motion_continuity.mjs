// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
/**
 * Actual-source world-space motion intent regression for Xアバター訓練中/index.html.
 * 実行: node frontend_web/public/Xアバター訓練中/tests/test_motion_continuity.mjs
 * 前提: frontend_avatar の npm 依存関係をインストール済みであること。
 * ブラウザー描画や見た目の自然さを確認するテストではない。
 * No production animation/navigation code is copied into this harness.
 * Source scripts are executed unchanged except removal of ES import declarations;
 * appended closure probes inspect state. DOM, GPU renderer, RAF/Clock, and file
 * transport are mocked. GLTFLoader, VRM/VRMA plugins, AnimationMixer, scene graph,
 * humanoid mapping, and vrm.update are real, using the page's pinned versions.
 * This is NOT browser, network/CDN, texture/shader, or visual-quality verification.
 * Interrupted mixed motion sequences at 24/30/60/120 fps plus irregular frame intervals.
 * Raw (visible skin-driving) and normalized bones are both measured.
 * MOTION_QA_OUTPUT saves per-sequence gzipped raw/skinned trajectories and metrics.
 * MOTION_QA_SOURCE / MOTION_QA_MOTION_ROOT permit preserved baseline inputs.
 * 出力は既定で標準出力のみ。MOTION_QA_OUTPUTで軌跡、MOTION_QA_REPORTでJSONを保存。
 * 55連続切替ケースと240/600fpsの伸び切り近傍の膝速度・加速度回帰を検査する。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';

// インストール済みの frontend_avatar 依存関係を利用する。追加の依存関係は不要。
// 別の検証環境を使う場合だけ MOTION_QA_MODULES=/path/to/node_modules を指定する。
const pageDir = path.resolve(process.env.MOTION_QA_PAGE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const sourceDir = process.env.MOTION_QA_SOURCE || pageDir;
const motionRoot = process.env.MOTION_QA_MOTION_ROOT || path.join(pageDir,'vrma');
const outDir = process.env.MOTION_QA_OUTPUT ? path.resolve(process.env.MOTION_QA_OUTPUT) : null;
if(outDir)fs.mkdirSync(outDir,{recursive:true});
const repo = path.resolve(pageDir, '../../..');
const moduleRoot = process.env.MOTION_QA_MODULES || path.join(repo, 'frontend_avatar/node_modules');
const importModule = relative => import(pathToFileURL(path.join(moduleRoot, relative)).href);
const RealThree = await importModule('three/build/three.module.js');
const {GLTFLoader: RealGLTFLoader} = await importModule('three/examples/jsm/loaders/GLTFLoader.js');
const {VRMHumanBoneList, VRMLoaderPlugin, VRMUtils} = await importModule('@pixiv/three-vrm/lib/three-vrm.module.js');
const {VRMAnimationLoaderPlugin, createVRMAnimationClip} = await importModule('@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js');

const html = fs.readFileSync(path.join(sourceDir, 'index.html'),'utf8');
const motionSource = fs.readFileSync(path.join(sourceDir, 'motions.js'),'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.filter(m=>/type="module"/.test(m[1])).length,1,'test covers exactly one actual module script');
const moduleSource = scripts.find(m=>/type="module"/.test(m[1]))?.[2];
assert(moduleSource, 'actual module script exists');
const navigationSource = scripts.filter(m=>!m[1].includes('src=') && !m[1].includes('type=')).map(m=>m[2]).join('\n');
const importMap = JSON.parse(scripts.find(m => /type="importmap"/.test(m[1]))[2]).imports;
const dependencyVersions = {};
for (const name of ['three', '@pixiv/three-vrm', '@pixiv/three-vrm-animation']) {
  const expected = importMap[name].match(/@([^/]+)\/(?:build|lib)\//)[1];
  const installed = JSON.parse(fs.readFileSync(path.join(moduleRoot, name, 'package.json'), 'utf8')).version;
  assert.equal(installed, expected, `${name}: ページの importmap と同じバージョンが必要です`);
  dependencyVersions[name] = installed;
}
const sha256 = text=>crypto.createHash('sha256').update(text).digest('hex');
const report = { label: process.env.MOTION_QA_LABEL || 'working-tree',dependencyVersions, timestamp: new Date().toISOString(), kind:'actual-source headless Node regression; NOT browser or visual QA', sourceHashes: {indexHtml:sha256(html),motionsJs:sha256(motionSource),testScript:sha256(fs.readFileSync(fileURLToPath(import.meta.url))),generator:sha256(fs.readFileSync(path.join(motionRoot,'generate.py'))),model:sha256(fs.readFileSync(path.join(pageDir,'../Xビデオ/_vrm/VRM_AiDiy.vrm')))}, clips:[], tests:[], limitations:['DOM, WebGLRenderer, requestAnimationFrame, Clock, and URL transport are mocked','Real VRM geometry, humanoid mapping and update run, but textures are intentionally skipped','No browser rendering, keyboard focus, screenshots, shader/material, CDN, HTTP MIME, or CORS validation','Finite poses and transition invariants do not establish natural-looking motion or palm direction'], errors:[] };
let modelGltf=null;
let fakeDelta=0;
let nextRaf=null;
let renderCount=0;
let frameProbe=null;
const loads=[];
const gates=new Map();
const failures=new Map();
class MockElement {
  constructor(id=''){this.id=id;this.textContent='';this.children=[];this.listeners=new Map();this.attrs={};this.disabled=false;this.classList={toggle:(name,force)=>{this[name]=force;}};this.parentElement={clientWidth:540,clientHeight:720};this.contentWindow={};}
  addEventListener(name,fn){const l=this.listeners.get(name)||[];l.push(fn);this.listeners.set(name,l);}
  append(x){this.children.push(x);}
  setAttribute(k,v){this.attrs[k]=v;}
  dispatch(name,event={}){for(const fn of this.listeners.get(name)||[])fn(event);}
  click(){if(!this.disabled)this.dispatch('click');}
}
const ids=['avatarCanvas','sceneFrame','sceneIndex','loadStatus','firstBtn','prevBtn','nextBtn','lastBtn','pageLabel'];
const elements=Object.fromEntries(ids.map(id=>[id,new MockElement(id)]));
const document=new MockElement('document');
document.getElementById=id=>elements[id]??(()=>{throw new Error('unmocked element '+id);})();
document.createElement=tag=>new MockElement(tag);
class FileGLTFLoader extends RealGLTFLoader {
  constructor(...args){super(...args);this.register(()=>({name:'QA_no_textures',loadTexture:()=>Promise.resolve(null)}));}
  load(url,onLoad,_progress,onError){
    const absolute=url.startsWith('vrma/') ? path.join(motionRoot,path.basename(decodeURIComponent(url))) : path.resolve(pageDir,decodeURIComponent(url));
    loads.push({url,absolute});
    const go=()=>{
      if(failures.has(url)){const e=failures.get(url);failures.delete(url);onError(e);return;}
      try {const data=fs.readFileSync(absolute);this.parse(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'',result=>{if(result.userData.vrm)modelGltf=result;onLoad(result);},onError);}catch(e){onError(e);}
    };
    if(gates.has(url))gates.get(url).push(go);else queueMicrotask(go);
    return this;
  }
}
const THREE={...RealThree,Clock:class{getDelta(){return fakeDelta;}},WebGLRenderer:class{setPixelRatio(){}setClearColor(){}setSize(){}render(scene,camera){scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);renderCount++;}}};
const logs=[];
const context=vm.createContext({THREE,GLTFLoader:FileGLTFLoader,VRMHumanBoneList,VRMLoaderPlugin,VRMUtils,VRMAnimationLoaderPlugin,createVRMAnimationClip,document,URLSearchParams,location:{search:'?scene=999',origin:'https://qa.invalid'},history:{replaceState(_s,_t,url){this.url=url;}},devicePixelRatio:1,ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){this.fn();}},requestAnimationFrame:fn=>{nextRaf=fn;return renderCount;},console:{log:()=>{},warn:(...x)=>logs.push(['warn',...x.map(String)]),error:(...x)=>logs.push(['error',...x.map(String)])}});
context.window=context;
const windowListeners=new Map();
context.addEventListener=(name,callback)=>{const list=windowListeners.get(name)||[];list.push(callback);windowListeners.set(name,list);};
globalThis.self=globalThis;
vm.runInContext(motionSource+'\n'+navigationSource,context,{filename:'actual-navigation.js'});
// Import binding substitution is the only change to the animation source.
const source=moduleSource.replace(/^\s*import[^\n]*;\s*$/gm,'');
const qa=await vm.runInContext(`(async()=>{${source}\nreturn {showMotion,tick,capturePose,read:()=>({bones,vrm,mixer,currentAction,activeTracks,transition,ending,finishPending,requestId,motionCache,transitionSeconds,scene,camera,container,footContact,motionNumber}),navShow:show,scenes};})()`,context,{filename:'actual-page-module.js'});
assert(qa.read().vrm,'actual page initialized VRM');
const scenes=Array.from(qa.scenes);
const candidates=scenes.filter(s=>s.file&&s.number!=='00');
assert.equal(candidates.length,20);

const selectedNames=['hips','spine','chest','upperChest','neck','head','leftEye','rightEye','leftShoulder','rightShoulder','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand','leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg','leftFoot','rightFoot','leftToes','rightToes'];
const records=new Map();
const V=()=>new RealThree.Vector3();
const Q=()=>new RealThree.Quaternion();
const round=x=>Math.round(x*1e7)/1e7;
function pose(){
  const state=qa.read();state.scene.updateMatrixWorld(true);
  const result={};
  for(const kind of ['raw','normalized']){
    result[kind]={};
    for(const name of selectedNames){
      const node=kind==='raw' ? state.vrm.humanoid.getRawBoneNode(name) : state.vrm.humanoid.getNormalizedBoneNode(name);
      if(node) result[kind][name]={p:node.getWorldPosition(V()).toArray(),q:node.getWorldQuaternion(Q()).toArray()};
    }
  }
  return result;
}
function step(dt=1/60){fakeDelta=dt;const fn=nextRaf;assert(fn);nextRaf=null;fn();}
function advance(seconds){for(let i=0;i<Math.ceil(seconds*60);i++)step();}
const dist=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
function direction(q,restQ,worldRestAxis){return new RealThree.Vector3(...worldRestAxis).applyQuaternion(Q().fromArray(restQ).invert()).applyQuaternion(Q().fromArray(q)).toArray();}
function angles(fwd){return {yaw:Math.atan2(-fwd[0],-fwd[2])*180/Math.PI,pitch:Math.asin(Math.max(-1,Math.min(1,fwd[1])))*180/Math.PI};}

const {gzipSync} = await import('node:zlib');
report.kind = 'Actual-page mixed interrupted-sequence stress; raw/skinned trajectories; no browser';
report.limitations.push('Skinned trajectories sample at least four vertices per primitive; they do not establish whole-surface collision freedom or aesthetics','Jerk is a finite-difference diagnostic, not a visual-quality pass/fail threshold','Reference 00 and free left foot in 12 intentionally have no planted-foot assertion');
const selectors=new Map(scenes.map(s=>[s.number,s]));
const radToDeg=180/Math.PI;
function maxMetric(target,name,value,where){if(!target[name]||value>target[name].value)target[name]={value,...where};}
const meshSamples=[];
qa.read().vrm.scene.traverse(mesh=>{
 if(!mesh.isSkinnedMesh)return;
 const attr=mesh.geometry.attributes.position;
 // Uniform samples plus coordinate extrema touch each primitive, including hair and shoes.
 const indices=new Set([0,Math.floor(attr.count/3),Math.floor(attr.count/2),attr.count-1]);
 for(let axis=0;axis<3;axis++){
  let low=0,high=0;
  for(let i=1;i<attr.count;i++){if(attr.array[i*3+axis]<attr.array[low*3+axis])low=i;if(attr.array[i*3+axis]>attr.array[high*3+axis])high=i;}
  indices.add(low);indices.add(high);
 }
 for(const i of indices)meshSamples.push({mesh,i,key:`${mesh.name}/${i}`});
});
report.skinSampleCatalog=meshSamples.map(s=>({mesh:s.mesh.name,vertex:s.i}));
function snapshot(){
 const p=pose();
 for(const m of new Set(meshSamples.map(s=>s.mesh)))m.skeleton.update();
 const skin=meshSamples.map(({mesh,i})=>mesh.localToWorld(mesh.getVertexPosition(i,V())).toArray());
 const knees={};
 for(const side of ['left','right']){
  const hip=V().fromArray(p.raw[side+'UpperLeg'].p),knee=V().fromArray(p.raw[side+'LowerLeg'].p),foot=V().fromArray(p.raw[side+'Foot'].p);
  const axis=foot.clone().sub(hip).normalize(),bend=knee.clone().sub(hip);bend.addScaledVector(axis,-bend.dot(axis));
  const height=bend.length();
  knees[side]={heightMm:height*1000,bend:height>1e-10?bend.divideScalar(height).toArray():null};
 }
 return {...p,skin,knees};
}
const clipChecks=new Map();
function checkSource(result,where){
 const s=qa.read(),source=s.footContact.sourcePose;
 assert(source,'uncorrected source is captured');
 const action=s.currentAction;
 if(action){
  let checks=clipChecks.get(action.getClip());
  if(!checks){checks=action.getClip().tracks.map(track=>{const p=RealThree.PropertyBinding.parseTrackName(track.name),node=RealThree.PropertyBinding.findNode(s.vrm.scene,p.nodeName),index=s.bones.findIndex(b=>b.node===node);return {index,property:p.propertyName,interpolant:track.createInterpolant()};}).filter(c=>c.index>=0);clipChecks.set(action.getClip(),checks);}
  for(const c of checks){const actual=source[c.index],expected=c.interpolant.evaluate(action.time),name=s.bones[c.index].name;
   if(c.property==='quaternion'){const error=actual.rotation.clone().normalize().angleTo(Q().fromArray(expected).normalize())*radToDeg;maxMetric(result,'maxSourceRotationErrorDegrees',error,{...where,bone:name});}
   if(c.property==='position'){const error=actual.position.distanceTo(V().fromArray(expected))*1000;maxMetric(result,'maxSourcePositionErrorMm',error,{...where,bone:name});}
  }
 }
 for(let i=0;i<s.bones.length;i++){
  const b=s.bones[i],a=source[i];
  if(!s.activeTracks.rotation.has(b.name))maxMetric(result,'maxUntrackedRotationErrorDegrees',a.rotation.clone().normalize().angleTo((s.ending?b.idleRotation:b.restRotation).clone().normalize())*radToDeg,{...where,bone:b.name});
  if(!s.activeTracks.translation.has(b.name))maxMetric(result,'maxUntrackedPositionErrorMm',a.position.distanceTo(b.restPosition)*1000,{...where,bone:b.name});
 }
}
function expectedContact(){
 const s=qa.read();
 if(s.motionNumber==='00')return [];
 const blend=s.transition?Math.min(1,s.transition.elapsed/s.transitionSeconds):1,eased=blend*blend*(3-2*blend);
 return s.footContact.legs.map((leg,index)=>{
  if(s.motionNumber==='12'&&leg.side==='left')return null;
  const from=s.transition?.feet[index];
  return {side:leg.side,position:from?from.position.clone().lerp(leg.anchor,eased):leg.anchor.clone(),rotation:from?from.rotation.clone().slerp(leg.rotation,eased):leg.rotation.clone()};
 }).filter(Boolean);
}
const catalog=[
 {name:'crouch_weight_reverse',start:'08',warm:3.5,requests:[['13',.20],['08',.15],['13',.08],['08',.04],['13',.20],['08',.12],['999',.25],['08',.18],['13',1.3]]},
 {name:'free_foot_reverse',start:'12',warm:3.5,requests:[['08',.20],['12',.18],['13',.12],['12',.07],['999',.04],['12',.08],['08',.2],['12',1.3]]},
 {name:'reference_mix',start:'00',warm:3.5,requests:[['08',.03],['00',.07],['12',.19],['13',.23],['999',.11],['00',.09],['12',.31],['05',.1],['00',1.3]]},
 {name:'repeated_free_foot',start:'12',warm:3.5,requests:[['12',.01],['12',.03],['12',.08],['12',.2],['12',.4],['12',.8],['12',.2],['999',1.3]]},
 {name:'arms_lowerbody_mix',start:'05',warm:3.5,requests:[['08',.15],['01',.15],['13',.15],['02',.15],['12',.15],['04',.15],['00',.15],['06',.15],['10',.15],['999',.15],['05',1.3]]},
 {name:'exit_restart_repeat',start:'13',warm:3.5,requests:[['999',.10],['999',.10],['08',.10],['999',.10],['12',.10],['999',.10],['00',.10],['999',.10],['01',.10],['999',1.3]]},
 {name:'same_tick_requests',start:'12',warm:3.5,requests:[['08',0],['13',0],['12',0],['00',0],['999',0],['05',0],['12',0],['08',.25],['13',0],['999',0],['12',1.3]]},
 {name:'natural_exit_interrupted',start:'08',warm:8.2,requests:[['12',.10],['999',.10],['13',.10],['00',.10],['999',.10],['05',.10],['08',1.3]]},
];
function rng(seed){return ()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};}
for(const seed of [0x412,0x821,0xc013]){
 const random=rng(seed),numbers=['00','08','12','13','999','01','02','04','05','06','10'],durations=[0,1/120,1/60,.04,.08,.15,.3,.7];
 catalog.push({name:`seed_${seed.toString(16)}`,seed,start:'12',warm:3.5,requests:Array.from({length:60},()=>[numbers[Math.floor(random()*numbers.length)],durations[Math.floor(random()*durations.length)]])});
}
report.sequenceCatalog=catalog;
const profiles=[{name:'24fps',dt:()=>1/24},{name:'30fps',dt:()=>1/30},{name:'60fps',dt:()=>1/60},{name:'120fps',dt:()=>1/120},{name:'irregular',dt:i=>[1/120,1/60,1/30,.1,.25,.016][i%6]}];
// dt>.1 is intentionally clamped by the actual page; schedules below use simulation time.
report.clockScope='Schedules use actual simulation delta=min(inputDelta,.1). irregular includes 250ms input gaps to exercise page clamp. No catch-up duration claim.';
const canonicalReset=async()=>{await qa.showMotion(selectors.get('999'));advance(1.4);};
await canonicalReset();const canonical=snapshot();
const manifest=[];for(const selected of scenes.filter(s=>s.file)){await qa.showMotion(selected);manifest.push({number:selected.number,sha256:sha256(fs.readFileSync(path.join(motionRoot,path.basename(selected.file))))});}
report.assetManifest=manifest;
let totalRequests=0,totalSamples=0;
for(const profile of profiles)for(const seq of catalog){
 const result={name:`${profile.name}/${seq.name}`,pass:true,requests:[],frames:0,kneeFlipCandidates:[],checks:{},profile:profile.name,sequence:seq.name};
 const traces=[];let t=0,frameIndex=0,previous=null,velocities=null,accelerations=null,lastDt=null,previousMidDt=null;
 await canonicalReset();
 const stateInfo=()=>({t,frame:frameIndex,motion:qa.read().motionNumber,transition:!!qa.read().transition});
 const observe=(dt,isZero=false)=>{
  const p=snapshot(),where=stateInfo();
  checkSource(result,where);
  for(const target of expectedContact()){
   const node=p.normalized[target.side+'Foot'];
   maxMetric(result,'maxContactPositionErrorMm',dist(node.p,target.position.toArray())*1000,{...where,bone:target.side+'Foot'});
   maxMetric(result,'maxContactRotationErrorDegrees',Q().fromArray(node.q).normalize().angleTo(target.rotation.clone().normalize())*radToDeg,{...where,bone:target.side+'Foot'});
  }
  for(const kind of ['raw','normalized'])for(const [bone,v]of Object.entries(p[kind])){assert([...v.p,...v.q].every(Number.isFinite),`${kind}/${bone} finite`);assert(Math.abs(Q().fromArray(v.q).length()-1)<1e-5,`${kind}/${bone} normalized`);}
  assert(p.skin.every(v=>v.every(Number.isFinite)),'skinned positions finite');
  if(previous&&!isZero){
   const points={},prevPoints={};
   for(const [bone,v]of Object.entries(p.raw)){if(bone.endsWith('Eye'))continue;points['raw/'+bone]=v.p;prevPoints['raw/'+bone]=previous.raw[bone].p;maxMetric(result,'maxRawRotationStepDegrees',Q().fromArray(v.q).normalize().angleTo(Q().fromArray(previous.raw[bone].q).normalize())*radToDeg,{...where,bone,dt});}
   p.skin.forEach((v,i)=>{points['skin/'+i]=v;prevPoints['skin/'+i]=previous.skin[i];});
   const nextV={},nextA={};
   for(const key of Object.keys(points)){
    const displacement=sub(points[key],prevPoints[key]),stepMm=Math.hypot(...displacement)*1000;
    maxMetric(result,key.startsWith('raw')?'maxRawPositionStepMm':'maxSkinPositionStepMm',stepMm,{...where,point:key,dt});
    const velocity=displacement.map(x=>x/dt);nextV[key]=velocity;
    maxMetric(result,'maxSpeedMmPerSecond',Math.hypot(...velocity)*1000,{...where,point:key,dt});
    if(velocities&&lastDt){const midDt=(dt+lastDt)/2,a=sub(velocity,velocities[key]).map(x=>x/midDt);nextA[key]=a;maxMetric(result,'maxAccelerationMmPerSecondSquared',Math.hypot(...a)*1000,{...where,point:key,dt});if(accelerations&&previousMidDt)maxMetric(result,'maxJerkMmPerSecondCubed',Math.hypot(...sub(a,accelerations[key]))/((midDt+previousMidDt)/2)*1000,{...where,point:key,dt});}
   }
   for(const side of ['left','right']){const a=previous.knees[side],b=p.knees[side];if(a.heightMm>2&&b.heightMm>2){const angle=Math.acos(Math.min(1,Math.max(-1,V().fromArray(a.bend).dot(V().fromArray(b.bend)))))*radToDeg;maxMetric(result,'maxNondegenerateKneePlaneStepDegrees',angle,{...where,side,dt,heightMm:b.heightMm,previousHeightMm:a.heightMm});if(angle>90)result.kneeFlipCandidates.push({...where,side,angle,dt,heightMm:b.heightMm,previousHeightMm:a.heightMm});}}
   accelerations=Object.keys(nextA).length?nextA:null;velocities=nextV;previousMidDt=lastDt?(dt+lastDt)/2:null;lastDt=dt;
  }
  if(!isZero){previous=p;if(outDir)traces.push({t,dt,motion:qa.read().motionNumber,transition:qa.read().transition?.elapsed??null,raw:p.raw,skin:p.skin,knees:p.knees});result.frames++;}
  return p;
 };
 const runFor=seconds=>{let remaining=seconds;while(remaining>1e-9){const requested=profile.dt(frameIndex),dt=Math.min(.1,requested,remaining);step(Math.min(requested,remaining));t+=dt;remaining-=dt;frameIndex++;observe(dt);}};
 const request=async number=>{
  const before=snapshot(),wasTransition=!!qa.read().transition;
  await qa.showMotion(selectors.get(number));step(0);const after=observe(0,true),where={...stateInfo(),from:result.requests.at(-1)?.number||'999',to:number,interrupted:wasTransition};
  for(const [bone,p]of Object.entries(before.raw)){if(bone.endsWith('Eye'))continue;maxMetric(result,'maxZeroRawPositionMm',dist(p.p,after.raw[bone].p)*1000,{...where,bone});maxMetric(result,'maxZeroRawRotationDegrees',Q().fromArray(p.q).normalize().angleTo(Q().fromArray(after.raw[bone].q).normalize())*radToDeg,{...where,bone});}
  before.skin.forEach((p,i)=>maxMetric(result,'maxZeroSkinPositionMm',dist(p,after.skin[i])*1000,{...where,point:meshSamples[i].key}));
  result.requests.push({number,t,interrupted:wasTransition});totalRequests++;
 };
 try{
  previous=snapshot();await request(seq.start);runFor(seq.warm);
  for(const [number,duration]of seq.requests){await request(number);runFor(duration);}
  await request('999');runFor(1.4);
  const final=snapshot();
  for(const [bone,v]of Object.entries(final.raw)){if(bone.endsWith('Eye'))continue;maxMetric(result,'maxFinalRawPositionErrorMm',dist(v.p,canonical.raw[bone].p)*1000,{bone});maxMetric(result,'maxFinalRawRotationErrorDegrees',Q().fromArray(v.q).normalize().angleTo(Q().fromArray(canonical.raw[bone].q).normalize())*radToDeg,{bone});}
  const s=qa.read();assert.equal(s.currentAction,null);assert.equal(s.transition,null);assert.equal(s.ending,true);
  for(const [metric,limit]of Object.entries({maxSourceRotationErrorDegrees:.01,maxSourcePositionErrorMm:.001,maxUntrackedRotationErrorDegrees:.01,maxUntrackedPositionErrorMm:.001,maxContactPositionErrorMm:.001,maxContactRotationErrorDegrees:.001,maxZeroRawPositionMm:.001,maxZeroRawRotationDegrees:.001,maxZeroSkinPositionMm:.001,maxFinalRawPositionErrorMm:.001,maxFinalRawRotationErrorDegrees:.001})){
   const value=result[metric]?.value||0;result.checks[metric]={value,limit,pass:value<limit};if(value>=limit)result.pass=false;
  }
  result.checks.noNondegenerateKneePlaneFlips={pass:result.kneeFlipCandidates.length===0,count:result.kneeFlipCandidates.length};if(result.kneeFlipCandidates.length)result.pass=false;
 }catch(e){result.pass=false;result.error=e.stack;}
 const filename=`${profile.name}-${seq.name}-trajectory.json.gz`;
 if(outDir){fs.writeFileSync(path.join(outDir,filename),gzipSync(JSON.stringify({name:result.name,skinSampleCatalog:report.skinSampleCatalog,requests:result.requests,frames:traces})));result.trajectory=filename;}
 report.tests.push(result);totalSamples+=result.frames;
 report.summary={cases:report.tests.length,passed:report.tests.filter(t=>t.pass).length,failed:report.tests.filter(t=>!t.pass).length,requests:totalRequests,frames:totalSamples,renderedFrames:renderCount,skinSamplesPerFrame:meshSamples.length};
 if(outDir)fs.writeFileSync(path.join(outDir,'metrics.json'),JSON.stringify(report,null,2));
 console.log(result.pass?'PASS':'FAIL',result.name,'frames',result.frames,'zeroSkinMm',result.maxZeroSkinPositionMm?.value,'contactMm',result.maxContactPositionErrorMm?.value,'sourceDeg',result.maxSourceRotationErrorDegrees?.value,'kneeFlips',result.kneeFlipCandidates.length);
}

// 伸び切りの sqrt 特異点は位置・1フレーム角度の上限だけでは見逃す。
// 同じ要求時刻を240/600fpsで再現し、13の終盤で膝が0度へ潰れず、
// 速度・加速度が細分化とともに発散しないことを検査する。
// 閾値はこの再現ケースの回帰用であり、見た目の自然さ全般の判定ではない。
const kneeSequences=[
 {name:'simple_crouch_to_weight',warm:3.5,requests:[['13',1.6]]},
 catalog.find(s=>s.name==='crouch_weight_reverse'),
];
const rateResults=[];
for(const fps of [240,600])for(const sequence of kneeSequences){
 await canonicalReset();await qa.showMotion(selectors.get('08'));
 let t=0;const frames=[],requests=[];
 const record=()=>{
  const p=pose(),legs={};
  for(const side of ['left','right']){
   const hip=V().fromArray(p.raw[side+'UpperLeg'].p),knee=V().fromArray(p.raw[side+'LowerLeg'].p),foot=V().fromArray(p.raw[side+'Foot'].p);
   const u=hip.clone().sub(knee).normalize(),v=foot.clone().sub(knee).normalize();
   legs[side]={flexion:180-Math.acos(RealThree.MathUtils.clamp(u.dot(v),-1,1))*radToDeg,knee:knee.toArray()};
  }
  frames.push({t,legs});
 };
 const runFor=seconds=>{let remaining=seconds;while(remaining>1e-9){const dt=Math.min(1/fps,remaining);step(dt);t+=dt;remaining-=dt;if(t>=sequence.warm)record();}};
 runFor(sequence.warm);
 for(const [number,seconds]of sequence.requests){await qa.showMotion(selectors.get(number));step(0);requests.push({number,t});runFor(seconds);}
 const last13=requests.at(-1).t;
 const result={name:`${fps}fps/${sequence.name}/near-straight knee derivative`,fps,sequence:sequence.name,pass:true,kind:'near-straight-rate-probe',frames:frames.length,sides:{}};
 for(const side of ['left','right']){
  const metrics={minFlexionDegrees:Infinity,maxSpeedDegreesPerSecond:0,maxAccelerationDegreesPerSecondSquared:0};let previousVelocity=null,previousDelta=null;
  for(let i=1;i<frames.length;i++){
   const prev=frames[i-1],frame=frames[i],dt=frame.t-prev.t,velocity=(frame.legs[side].flexion-prev.legs[side].flexion)/dt;
   if(frame.t>=last13+.6&&frame.legs[side].flexion<6){
    metrics.minFlexionDegrees=Math.min(metrics.minFlexionDegrees,frame.legs[side].flexion);
    if(Math.abs(velocity)>metrics.maxSpeedDegreesPerSecond){metrics.maxSpeedDegreesPerSecond=Math.abs(velocity);metrics.speedAtSeconds=frame.t;}
    if(previousVelocity!==null){const acceleration=Math.abs(velocity-previousVelocity)/((dt+previousDelta)/2);if(acceleration>metrics.maxAccelerationDegreesPerSecondSquared){metrics.maxAccelerationDegreesPerSecondSquared=acceleration;metrics.accelerationAtSeconds=frame.t;}}
   }
   previousVelocity=velocity;previousDelta=dt;
  }
  // 両脚のうち13で伸び切りに近づく脚を評価。他方は常に6度以上の場合がある。
  if(metrics.minFlexionDegrees===Infinity){metrics.nearStraightSamples=false;result.sides[side]=metrics;continue;}
  metrics.nearStraightSamples=true;metrics.pass=metrics.minFlexionDegrees>1&&metrics.maxSpeedDegreesPerSecond<100&&metrics.maxAccelerationDegreesPerSecondSquared<8000;
  result.sides[side]=metrics;if(!metrics.pass)result.pass=false;
 }
 if(!Object.values(result.sides).some(s=>s.nearStraightSamples)){result.pass=false;result.error='13 near-straight region was not exercised';}
 rateResults.push(result);report.tests.push(result);
 if(outDir)fs.writeFileSync(path.join(outDir,`${fps}fps-${sequence.name}-knee-probe.json.gz`),gzipSync(JSON.stringify({fps,sequence,requests,frames})));
 console.log(result.pass?'PASS':'FAIL',result.name,JSON.stringify(result.sides));
}
for(const sequence of kneeSequences){
 const coarse=rateResults.find(r=>r.sequence===sequence.name&&r.fps===240),fine=rateResults.find(r=>r.sequence===sequence.name&&r.fps===600);
 const result={name:`${sequence.name}/knee derivatives converge at 240→600fps`,kind:'rate-convergence',pass:true,sides:{}};
 for(const side of ['left','right']){
  if(!coarse.sides[side].nearStraightSamples||!fine.sides[side].nearStraightSamples)continue;
  const speedRatio=fine.sides[side].maxSpeedDegreesPerSecond/Math.max(1e-6,coarse.sides[side].maxSpeedDegreesPerSecond),accelerationRatio=fine.sides[side].maxAccelerationDegreesPerSecondSquared/Math.max(1e-6,coarse.sides[side].maxAccelerationDegreesPerSecondSquared);
  result.sides[side]={speedRatio,accelerationRatio};if(speedRatio>=1.3||accelerationRatio>=1.5)result.pass=false;
 }
 report.tests.push(result);console.log(result.pass?'PASS':'FAIL',result.name,JSON.stringify(result.sides));
}
report.summary={cases:report.tests.length,passed:report.tests.filter(t=>t.pass).length,failed:report.tests.filter(t=>!t.pass).length,sequenceCases:profiles.length*catalog.length,sequenceRequests:totalRequests,sequenceSampledFrames:totalSamples,kneeProbeSampledFrames:rateResults.reduce((n,r)=>n+r.frames,0),renderedHeadlessFrames:renderCount,skinSamplesPerSequenceFrame:meshSamples.length};
if(outDir)fs.writeFileSync(path.join(outDir,'metrics.json'),JSON.stringify(report,null,2));
if(process.env.MOTION_QA_REPORT)fs.writeFileSync(process.env.MOTION_QA_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary));
if(report.summary.failed)process.exitCode=1;
