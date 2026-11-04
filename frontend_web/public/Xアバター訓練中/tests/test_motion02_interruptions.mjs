// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
/** Actual-page motion 02 interruption regression. See README.md for scope and usage. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';

// インストール済みの frontend_avatar 依存関係を利用する。追加の依存関係は不要。
// 別の検証環境を使う場合だけ MOTION_QA_MODULES=/path/to/node_modules を指定する。
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPage = path.join(here,'..');
const pageDir = path.resolve(process.env.MOTION_QA_PAGE || defaultPage);
const sourceDir = process.env.MOTION_QA_SOURCE || pageDir;
const motionRoot = process.env.MOTION_QA_MOTION_ROOT || path.join(pageDir,'vrma');
const outDir = process.env.MOTION_QA_OUTPUT ? path.resolve(process.env.MOTION_QA_OUTPUT) : null;
if(outDir)fs.mkdirSync(outDir,{recursive:true});
const repo = path.resolve(pageDir, '../../..');
const moduleRoot = path.resolve(process.env.MOTION_QA_MODULES || path.join(repo, 'frontend_avatar/node_modules'));
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
const report = { label: process.env.MOTION_QA_LABEL || 'working-tree',dependencyVersions, timestamp: new Date().toISOString(), kind:'actual-source headless Node regression; NOT browser or visual QA', sourceHashes: {indexHtml:sha256(html),motionsJs:sha256(motionSource),testScript:sha256(fs.readFileSync(fileURLToPath(import.meta.url))),generator:sha256(fs.readFileSync(path.join(motionRoot,'generate.py'))),model:sha256(fs.readFileSync(path.join(pageDir,'../Xビデオ/_vrm/VRM_AiDiy.vrm')))}, clips:[], tests:[], limitations:['DOM, WebGLRenderer, requestAnimationFrame, Clock, and URL transport are mocked','GPU texture loading is skipped; embedded PNG alpha is decoded separately for geometry opacity','No browser rendering, keyboard focus, screenshots, shader/material, CDN, HTTP MIME, or CORS validation','Finite poses and transition invariants do not establish natural-looking motion or palm direction'], errors:[] };
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


import {createSleeveGeometry} from './sleeve_geometry.mjs';
report.sourceHashes.geometryHelper=sha256(fs.readFileSync(path.join(here,'sleeve_geometry.mjs')));
const geometry=createSleeveGeometry(fs.readFileSync(path.join(pageDir,'../Xビデオ/_vrm/VRM_AiDiy.vrm')),RealThree);
report.geometry=geometry.catalog;
report.kind='Actual-page motion 02 interrupted-transition regression with real skinned geometry and two-way opaque intersections';
report.limitations.push('Exact crossings are tested at sampled frames; no continuous-time collision, containment, coplanar-overlap, or rendered-appearance proof','Cuff and non-arm Body subsets are model-specific; sewn arm seams are excluded using documented weight thresholds','Novel exact contact pairs are diagnostic only; pass/fail measures new per-vertex physical skin intrusion depth over observed start/end/idle baselines','PNG alpha uses base-color bilinear sampling; no MToon shader, mip-map, or pixel-visibility verification');
const selectors=new Map(scenes.map(s=>[s.number,s]));
const V=()=>new RealThree.Vector3(),Q=()=>new RealThree.Quaternion();
const profiles=(process.env.MOTION_QA_PROFILES||'60fps').split(',').map(name=>({name,dt:name==='irregular'?i=>[1/120,1/60,1/30,.1,.25,.016][i%6]:()=>1/Number(name.replace('fps',''))}));
for(const p of profiles)assert(Number.isFinite(p.dt(0))&&p.dt(0)>0,'positive finite profile rate');
const warmTimes=(process.env.MOTION_QA_WARMS||'0.8,1.6,2.4,3.5,5.7,6.3,7.5').split(',').map(Number);
for(const w of warmTimes)assert(Number.isFinite(w)&&w>=0,'nonnegative warm time');
const sequenceCatalog=[];
for(const warm of warmTimes)for(const [start,target]of [['02','999'],['02','05'],['05','02']])sequenceCatalog.push({name:`${start}_to_${target}_at_${warm.toFixed(2)}`,start,warm,requests:[[target,1.5]]});
sequenceCatalog.push(
 {name:'02_repeated_peak',start:'02',warm:3.5,requests:[['02',.1],['02',.15],['02',.3],['02',.6],['999',1.5]]},
 {name:'02_05_reverse_peak',start:'02',warm:3.5,requests:[['05',.15],['02',.3],['05',.6],['02',.3],['999',1.5]]},
 {name:'05_02_reverse_peak',start:'05',warm:3.5,requests:[['02',.15],['05',.3],['02',.6],['05',.3],['02',1.5]]},
 {name:'02_idle_reverse_peak',start:'02',warm:3.5,requests:[['999',.15],['02',.3],['999',.6],['02',.3],['999',1.5]]},
 {name:'02_same_tick_requests',start:'02',warm:3.5,requests:[['05',0],['02',0],['999',0],['02',0],['05',.2],['02',1.5]]},
 // Both immediate labels are non-02 here; only inherited state can remember 02.
 {name:'02_inherited_clearance',start:'02',warm:3.5,requests:[['05',.2],['999',.2],['05',.2],['999',1.5]]}
);
const only=process.env.MOTION_QA_SEQUENCES?.split(',');
const sequences=sequenceCatalog.filter(s=>!only||only.includes(s.name));assert(sequences.length,'at least one selected sequence');
report.sequenceCatalog=sequences;
function step(dt=1/60){fakeDelta=dt;const fn=nextRaf;assert(fn,'actual RAF callback scheduled');nextRaf=null;fn();}
function advance(seconds){let t=0;while(t<seconds-1e-10){const dt=Math.min(1/60,seconds-t);step(dt);t+=dt;}}
const reset=async()=>{await qa.showMotion(selectors.get('999'));advance(1.5);};
const rawNodes=VRMHumanBoneList.map(name=>({name,node:qa.read().vrm.humanoid.getRawBoneNode(name)})).filter(x=>x.node&&!x.name.endsWith('Eye'));
const bodyMeshes=[];qa.read().vrm.scene.traverse(m=>{if(m.isSkinnedMesh&&m.name.startsWith('Body'))bodyMeshes.push(m);});
const originalLookup=new Map();
for(let i=0;i<geometry.rest.length/3;i++){const key=[...geometry.rest.slice(i*3,i*3+3),...geometry.uv.slice(i*2,i*2+2)].join(',');const list=originalLookup.get(key)||[];list.push(i);originalLookup.set(key,list);}
const realSkinSamples=[];
for(const mesh of bodyMeshes){const pos=mesh.geometry.attributes.position,uv=mesh.geometry.attributes.uv;for(const i of new Set([0,Math.floor(pos.count/3),Math.floor(pos.count/2),pos.count-1])){const key=[pos.getX(i),pos.getY(i),pos.getZ(i),uv.getX(i),uv.getY(i)].join(',');const original=originalLookup.get(key);assert(original?.length,`raw glTF index maps to optimized Three mesh ${mesh.name}/${i}`);realSkinSamples.push({mesh,i,original});}}
function snapshot(){const s=qa.read();s.scene.updateMatrixWorld(true);const nodeMatrices=new Map();for(const [object,a]of modelGltf.parser.associations)if(a.nodes!==undefined)nodeMatrices.set(a.nodes,object.matrixWorld);const skin=geometry.deform(nodeMatrices),raw=rawNodes.map(({node})=>({position:node.getWorldPosition(V()),rotation:node.getWorldQuaternion(Q())}));return {skin,raw};}
const max=(result,key,value,where={})=>{if(!result[key]||value>result[key].value)result[key]={value,...where};};
const clipChecks=new Map();
function checkSource(result,where){const s=qa.read(),source=s.footContact?.sourcePose;assert(source,'uncorrected source pose exists');if(s.currentAction){const action=s.currentAction;let checks=clipChecks.get(action.getClip());if(!checks){checks=action.getClip().tracks.map(track=>{const p=RealThree.PropertyBinding.parseTrackName(track.name),node=RealThree.PropertyBinding.findNode(s.vrm.scene,p.nodeName),index=s.bones.findIndex(b=>b.node===node);return {index,property:p.propertyName,interpolant:track.createInterpolant()};}).filter(c=>c.index>=0);clipChecks.set(action.getClip(),checks);}for(const c of checks){const actual=source[c.index],expected=c.interpolant.evaluate(action.time),bone=s.bones[c.index].name;if(c.property==='quaternion')max(result,'sourceRotationDeg',actual.rotation.clone().normalize().angleTo(Q().fromArray(expected).normalize())*180/Math.PI,{...where,bone});if(c.property==='position')max(result,'sourcePositionMm',actual.position.distanceTo(V().fromArray(expected))*1000,{...where,bone});}}
 for(let i=0;i<s.bones.length;i++){const b=s.bones[i],a=source[i];if(!s.activeTracks.rotation.has(b.name))max(result,'untrackedRotationDeg',a.rotation.clone().normalize().angleTo((s.ending?b.idleRotation:b.restRotation).clone().normalize())*180/Math.PI,{...where,bone:b.name});if(!s.activeTracks.translation.has(b.name))max(result,'untrackedPositionMm',a.position.distanceTo(b.restPosition)*1000,{...where,bone:b.name});}}
function checkFeet(result,where){const s=qa.read(),blend=s.transition?Math.min(1,s.transition.elapsed/s.transitionSeconds):1,eased=blend*blend*(3-2*blend);for(const [i,leg]of s.footContact.legs.entries()){const from=s.transition?.feet[i],position=from?from.position.clone().lerp(leg.anchor,eased):leg.anchor,rotation=from?from.rotation.clone().slerp(leg.rotation,eased):leg.rotation,node=s.vrm.humanoid.getNormalizedBoneNode(leg.side+'Foot');max(result,'footPositionMm',node.getWorldPosition(V()).distanceTo(position)*1000,{...where,side:leg.side});max(result,'footRotationDeg',node.getWorldQuaternion(Q()).normalize().angleTo(rotation.clone().normalize())*180/Math.PI,{...where,side:leg.side});}}
function compare(a,b,result,prefix,where){for(let i=0;i<a.raw.length;i++){max(result,prefix+'RawMm',a.raw[i].position.distanceTo(b.raw[i].position)*1000,{...where,bone:rawNodes[i].name});max(result,prefix+'RawDeg',a.raw[i].rotation.normalize().angleTo(b.raw[i].rotation.normalize())*180/Math.PI,{...where,bone:rawNodes[i].name});}for(let i=0;i<a.skin.length;i+=3)max(result,prefix+'SkinMm',Math.hypot(a.skin[i]-b.skin[i],a.skin[i+1]-b.skin[i+1],a.skin[i+2]-b.skin[i+2])*1000,{...where,vertex:i/3});}
function checkSkinAgreement(p,result,where){for(const mesh of bodyMeshes)mesh.skeleton.update();for(const {mesh,i,original}of realSkinSamples){const actual=mesh.localToWorld(mesh.getVertexPosition(i,V()));let distance=Infinity;for(const id of original)distance=Math.min(distance,actual.distanceTo(V().fromArray(p.skin,id*3)));max(result,'rawSkinAgreementMm',distance*1000,{...where,mesh:mesh.name,vertex:i});}}
function assertion(result,name,pass,evidence){result.assertions.push({name,pass,...evidence});if(!pass)result.pass=false;}
const limits={sourceRotationDeg:.01,sourcePositionMm:.001,untrackedRotationDeg:.01,untrackedPositionMm:.001,footPositionMm:.001,footRotationDeg:.001,zeroRawMm:.001,zeroRawDeg:.001,zeroSkinMm:.001,finalRawMm:.001,finalRawDeg:.001,finalSkinMm:.01,rawSkinAgreementMm:.001};
await reset();const canonical=snapshot(),idleAudit=geometry.audit(canonical.skin),idleDepth=geometry.interiorDepth(canonical.skin);report.preexistingIdle={opaqueIntersections:idleAudit.opaqueIntersections,materials:idleAudit.materials,hits:idleAudit.hits,depth:idleDepth};
report.assetManifest=['02','05'].map(number=>{const selected=selectors.get(number);return {number,file:selected.file,sha256:sha256(fs.readFileSync(path.join(motionRoot,path.basename(selected.file))))};});
console.log('GEOMETRY',JSON.stringify({...geometry.catalog,preexistingIdle:idleAudit.opaqueIntersections}));
let totalFrames=0;
for(const profile of profiles)for(const seq of sequences){
 const result={name:`${profile.name}/${seq.name}`,pass:true,assertions:[],requests:[],frames:0,collisionFrames:[],inheritanceChecks:0,inheritanceFailures:[],depthFrames:[],noTickRequests:0};let pendingNoTick=null;let time=0,frameIndex=0,expectedLineage=false,previous=null;
 await reset();await qa.showMotion(selectors.get(seq.start));advance(seq.warm);const start=snapshot(),startAudit=geometry.audit(start.skin),startDepth=geometry.interiorDepth(start.skin);result.start={motion:seq.start,warm:seq.warm,opaqueIntersections:startAudit.opaqueIntersections,materials:startAudit.materials,hits:startAudit.hits,depth:startDepth};
 const record=(dt,zero=false)=>{const s=qa.read(),where={time,frame:frameIndex,motion:s.motionNumber,dt},p=snapshot();checkSource(result,where);checkFeet(result,where);checkSkinAgreement(p,result,where);assert(p.skin.every(Number.isFinite),'all raw skinned Body vertices finite');for(const r of p.raw){assert([...r.position,...r.rotation].every(Number.isFinite),'raw bones finite');assert(Math.abs(r.rotation.length()-1)<1e-5,'raw world quaternion normalized');}
  if(previous&&!zero)compare(previous,p,result,'frame',where);if(!zero){previous=p;result.frames++;totalFrames++;const collision=geometry.audit(p.skin),depth=geometry.interiorDepth(p.skin);if(depth.interiorVertexCount)result.depthFrames.push({...where,...depth});if(collision.opaqueIntersections)result.collisionFrames.push({...where,transitionElapsed:s.transition?.elapsed??null,opaqueIntersections:collision.opaqueIntersections,materials:collision.materials,hits:collision.hits});}return p;
 };
 try{
  previous=start;
  for(const [target,duration]of seq.requests){const before=snapshot(),old=qa.read(),from=old.motionNumber,interrupted=!!old.transition;const freshNeutral=from==='999'&&!interrupted&&['leftUpperArm','rightUpperArm'].every(name=>{const i=rawNodes.findIndex(b=>b.name===name);return before.raw[i].rotation.clone().normalize().angleTo(canonical.raw[i].rotation.clone().normalize())<1e-4;});expectedLineage=from==='02'||(target==='02'&&!freshNeutral)||(interrupted&&expectedLineage);await qa.showMotion(selectors.get(target));const afterRequest=qa.read();
   if(expectedLineage){result.inheritanceChecks++;if(afterRequest.transition?.clearSleeves!==true)result.inheritanceFailures.push({time,from,target,interrupted,actual:afterRequest.transition?.clearSleeves??null});}
   if(duration===0){pendingNoTick??=before;result.noTickRequests++;compare(before,snapshot(),result,'zero',{time,from,target,interrupted,synchronous:true});}else{step(0);const after=record(0,true);compare(pendingNoTick??before,after,result,'zero',{time,from,target,interrupted,noTickBatch:!!pendingNoTick});pendingNoTick=null;}result.requests.push({time,from,target,duration,interrupted,expectedLineage});
   let elapsed=0;while(elapsed<duration-1e-10){const requested=Math.min(profile.dt(frameIndex),duration-elapsed),actual=Math.min(requested,.1);step(requested);elapsed+=actual;time+=actual;frameIndex++;record(actual);}
  }
  if(pendingNoTick){step(0);compare(pendingNoTick,record(0,true),result,'zero',{time,noTickBatch:true});pendingNoTick=null;}const end=snapshot(),endAudit=geometry.audit(end.skin),endDepth=geometry.interiorDepth(end.skin);result.end={motion:qa.read().motionNumber,opaqueIntersections:endAudit.opaqueIntersections,materials:endAudit.materials,hits:endAudit.hits,depth:endDepth};
  const preexisting=new Set([...idleAudit.hits,...startAudit.hits,...endAudit.hits].map(h=>h.key));let novelCount=0;for(const f of result.collisionFrames){f.novelHits=f.hits.filter(h=>!preexisting.has(h.key));novelCount+=f.novelHits.length;}
  result.collisionSummary={sampledFrames:result.frames,framesWithOpaqueCrossings:result.collisionFrames.length,framesWithNovelOpaqueCrossings:result.collisionFrames.filter(f=>f.novelHits.length).length,novelCrossingObservations:novelCount,maxOpaqueCrossings:Math.max(0,...result.collisionFrames.map(f=>f.opaqueIntersections)),endpointBaselinePairs:preexisting.size};
  const baselineDepth=new Map();for(const d of [idleDepth,startDepth,endDepth])for(const v of d.vertices)baselineDepth.set(v.vertex,Math.max(baselineDepth.get(v.vertex)??0,v.depthMm));
  const toleranceMm=Number(process.env.MOTION_QA_DEPTH_TOLERANCE_MM??0.5);assert(Number.isFinite(toleranceMm)&&toleranceMm>=0,'valid physical intrusion tolerance');let worstNew={excessDepthMm:0};
  for(const f of result.depthFrames)for(const v of f.vertices){const baselineMm=baselineDepth.get(v.vertex)??0,excessDepthMm=Math.max(0,v.depthMm-baselineMm);if(excessDepthMm>worstNew.excessDepthMm)worstNew={...v,time:f.time,motion:f.motion,baselineMm,excessDepthMm};}
  result.depthSummary={maxDepthMm:Math.max(0,...result.depthFrames.map(f=>f.maxDepthMm)),startMaxDepthMm:startDepth.maxDepthMm,endMaxDepthMm:endDepth.maxDepthMm,idleMaxDepthMm:idleDepth.maxDepthMm,framesWithInterior:result.depthFrames.length,worstNew,toleranceMm};
  assertion(result,'new opaque-cuff intrusion into full physical skin stays within endpoint depth envelope',worstNew.excessDepthMm<=toleranceMm,result.depthSummary);
  assertion(result,'true same-tick request batch preserves first displayed skin at first zero-delta frame',!seq.name.includes('same_tick')||result.noTickRequests>0&&(result.zeroSkinMm?.value??0)<.001,{noTickRequests:result.noTickRequests,maxSkinJumpMm:result.zeroSkinMm?.value??0});
  assertion(result,'02 clearance remains inherited through interrupted and same-tick requests',result.inheritanceChecks>0&&result.inheritanceFailures.length===0,{checks:result.inheritanceChecks,failures:result.inheritanceFailures});
  await reset();compare(canonical,snapshot(),result,'final',{});
  assertion(result,'final 999 reset releases action and transition',qa.read().currentAction===null&&qa.read().transition===null&&qa.read().ending===true,{});
  for(const [metric,limit]of Object.entries(limits))assertion(result,`${metric} remains within regression tolerance`,(result[metric]?.value??0)<limit,{metric,value:result[metric]?.value??0,limit,where:result[metric]});
  assertion(result,'actual raw skin matches independent original glTF matrix skinning',result.rawSkinAgreementMm?.value<.001,{samplesPerFrame:realSkinSamples.length,maxErrorMm:result.rawSkinAgreementMm?.value});
 }catch(error){result.pass=false;result.error=error.stack;}
 report.tests.push(result);report.summary={sequences:report.tests.length,passed:report.tests.filter(t=>t.pass).length,failed:report.tests.filter(t=>!t.pass).length,sampledFrames:totalFrames,preexistingIdleOpaqueCrossings:idleAudit.opaqueIntersections};
 if(outDir)fs.writeFileSync(path.join(outDir,'metrics.json'),JSON.stringify(report,null,2));
 console.log(result.pass?'PASS':'FAIL',result.name,JSON.stringify({frames:result.frames,startOpaque:result.start.opaqueIntersections,maxOpaque:result.collisionSummary?.maxOpaqueCrossings,novelFrames:result.collisionSummary?.framesWithNovelOpaqueCrossings,zeroSkinMm:result.zeroSkinMm?.value,skinAgreementMm:result.rawSkinAgreementMm?.value,maxDepthMm:result.depthSummary?.maxDepthMm,newDepthMm:result.depthSummary?.worstNew.excessDepthMm,failed:result.assertions.filter(x=>!x.pass).map(x=>x.name),error:result.error}));
}
if(process.env.MOTION_QA_REPORT)fs.writeFileSync(process.env.MOTION_QA_REPORT,JSON.stringify(report,null,2));
console.log('SUMMARY',JSON.stringify(report.summary));if(report.summary.failed)process.exitCode=1;
