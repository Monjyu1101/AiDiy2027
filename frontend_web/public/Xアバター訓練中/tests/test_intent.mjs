// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
/**
 * Actual-source world-space motion intent regression for Xアバター訓練中/index.html.
 * 実行: node frontend_web/public/Xアバター訓練中/tests/test_intent.mjs
 * 前提: frontend_avatar の npm 依存関係をインストール済みであること。
 * ブラウザー描画や見た目の自然さを確認するテストではない。
 * No production animation/navigation code is copied into this harness.
 * Source scripts are executed unchanged except removal of ES import declarations;
 * appended closure probes inspect state. DOM, GPU renderer, RAF/Clock, and file
 * transport are mocked. GLTFLoader, VRM/VRMA plugins, AnimationMixer, scene graph,
 * humanoid mapping, and vrm.update are real, using the page's pinned versions.
 * This is NOT browser, network/CDN, texture/shader, or visual-quality verification.
 * Samples all 20 candidates continuously at 60 fps through entry, playback and exit.
 * Raw (visible skin-driving) and normalized bones are both measured.
 * MOTION_QA_OUTPUT saves per-motion gzipped trajectories and compact metrics.
 * MOTION_QA_SOURCE / MOTION_QA_MOTION_ROOT permit preserved baseline inputs.
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
const qa=await vm.runInContext(`(async()=>{${source}\nreturn {showMotion,tick,capturePose,read:()=>({bones,vrm,mixer,currentAction,activeTracks,transition,ending,finishPending,requestId,motionCache,transitionSeconds,scene,camera,container}),navShow:show,scenes};})()`,context,{filename:'actual-page-module.js'});
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
      if(node) result[kind][name]={p:node.getWorldPosition(V()).toArray().map(round),q:node.getWorldQuaternion(Q()).toArray().map(round)};
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
function stats(frames,neutral,kind){
 const s={};const data=frames.map(f=>f[kind]);
 for(const name of ['leftFoot','rightFoot','leftToes','rightToes','hips','chest','head']){
  if(!neutral[kind][name])continue;
  const points=data.map(f=>f[name].p),base=neutral[kind][name].p;
  const axes=[0,1,2].map(a=>points.map(p=>p[a]));
  s[name]={maxNeutralDisplacementMm:1000*Math.max(...points.map(p=>dist(p,base))),maxNeutralRotationDegrees:Math.max(...data.map(f=>Q().fromArray(f[name].q).normalize().angleTo(Q().fromArray(neutral[kind][name].q).normalize())*180/Math.PI)),xyzRangeMm:axes.map(v=>1000*(Math.max(...v)-Math.min(...v))),maxFrameDisplacementMm:1000*Math.max(...points.slice(1).map((p,i)=>dist(p,points[i]))),minYmm:1000*Math.min(...axes[1]),maxYmm:1000*Math.max(...axes[1])};
 }
 const torso=data.map(f=>sub(f.chest.p,f.hips.p));
 s.chestRelativeHipsRangeMm=[0,1,2].map(a=>1000*(Math.max(...torso.map(p=>p[a]))-Math.min(...torso.map(p=>p[a]))));
 for(const name of ['hips','chest','head']){
  const fwd=data.map(f=>direction(f[name].q,neutral[kind][name].q,[0,0,-1]));
  const vals=fwd.map(angles);
  const up=data.map(f=>direction(f[name].q,neutral[kind][name].q,[0,1,0]));
  s[name].yawDegrees=[Math.min(...vals.map(v=>v.yaw)),Math.max(...vals.map(v=>v.yaw))];
  s[name].pitchDegrees=[Math.min(...vals.map(v=>v.pitch)),Math.max(...vals.map(v=>v.pitch))];
  s[name].rollDegrees=[Math.min(...up.map(v=>Math.atan2(v[0],v[1])*180/Math.PI)),Math.max(...up.map(v=>Math.atan2(v[0],v[1])*180/Math.PI))];
 }
 return s;
}
const sceneMeta=qa.read();
report.coordinates={containerMatrix:sceneMeta.container.matrix.toArray(),cameraPosition:sceneMeta.camera.position.toArray(),cameraWorld:sceneMeta.camera.matrixWorld.toArray(),scenePosition:sceneMeta.vrm.scene.position.toArray(),frontWorld:[0,0,-1],headDirectionConvention:'Rest-relative raw/normalized head orientation, facing -Z world. Positive yaw is avatar-left (-X); negative yaw is avatar-right (+X); positive pitch looks up. Negative roll tilts head toward avatar-left. Bone positions measured in page world, not model export space.'};
function exportFrame(number,t){
 const state=qa.read(); state.scene.updateMatrixWorld(true);
 const nodeMatrices={};
 for(const [object,association] of modelGltf.parser.associations)if(association.nodes!==undefined)nodeMatrices[association.nodes]=object.matrixWorld.toArray();
 const skinSamples=[]; state.vrm.scene.traverse(object=>{if(!object.isSkinnedMesh)return;object.skeleton.update();const count=object.geometry.attributes.position.count;const vertices=[];for(const i of [0,Math.floor(count/3),Math.floor(count/2),count-1])vertices.push({i,local:object.geometry.attributes.position.array.slice(i*3,i*3+3),world:object.localToWorld(object.getVertexPosition(i,V())).toArray()});skinSamples.push({name:object.name,count,vertices});});
 fs.writeFileSync(path.join(outDir,number+'_'+t.toFixed(2)+'.json'),JSON.stringify({label:number+' actual-page t='+t,nodeMatrices,bones:pose(),cameraWorld:state.camera.matrixWorld.toArray(),skinSamples}));
}
const only=(process.env.MOTION_QA_NUMBERS||'').split(',').filter(Boolean);
for(const selected of candidates.filter(s=>!only.length||only.includes(s.number))){
 await qa.showMotion(scenes.at(-1));advance(1.3);
 const neutral=pose();
 await qa.showMotion(selected);const action=qa.read().currentAction,clip=action.getClip();
 const frames=[{t:0,...pose()}];
 const exportFps=Number(process.env.MOTION_QA_EXPORT_FPS||0),exportStride=exportFps ? 60/exportFps : null;
 if(exportFps)assert(Number.isInteger(exportStride)&&exportStride>0,'MOTION_QA_EXPORT_FPS must divide 60');
 if(outDir&&exportFps)exportFrame(selected.number,0);
 for(let i=1;i<=Math.round((clip.duration+1.3)*60);i++){step();frames.push({t:round(i/60),...pose()});if(outDir&&((exportFps&&i%exportStride===0)||(!exportFps&&[72,210,378,480].includes(i)&&process.env.MOTION_QA_EXPORT_FRAMES)))exportFrame(selected.number,i/60);}
 const summary={number:selected.number,title:selected.title,file:selected.file,sha256:sha256(fs.readFileSync(path.join(motionRoot,path.basename(selected.file)))),duration:clip.duration,samples:frames.length,raw:stats(frames,neutral,'raw'),normalized:stats(frames,neutral,'normalized')};
 const neutralOffset={};for(const name of selectedNames){if(neutral.raw[name]&&neutral.normalized[name])neutralOffset[name]=dist(neutral.raw[name].p,neutral.normalized[name].p)*1000;}
 summary.neutralRawNormalizedOffsetMm=neutralOffset;
 report.clips.push(summary);
 const trajectory={number:selected.number,title:selected.title,neutral,frames};
 const {gzipSync}=await import('node:zlib');records.set(selected.number,trajectory);
 if(outDir)fs.writeFileSync(path.join(outDir,`${selected.number}-trajectories.json.gz`),gzipSync(JSON.stringify(trajectory)));
 if(outDir)fs.writeFileSync(path.join(outDir,'metrics.json'),JSON.stringify(report,null,2));
 console.log('SAMPLED',selected.number,frames.length,'frames');
}


function check(name,fn){try{const details=fn();report.tests.push({name,pass:true,...details});console.log('PASS',name);}catch(error){report.tests.push({name,pass:false,error:error.message});console.error('FAIL',name,error.message);}}
const get=n=>records.get(n);
const mm=v=>v*1000;
const deg=v=>v*180/Math.PI;
const rawFrames=n=>get(n).frames.map(frame=>({t:frame.t,...frame.raw}));
const neutral=n=>get(n).neutral.raw;
function headAngles(n){return rawFrames(n).map(f=>{const forward=direction(f.head.q,neutral(n).head.q,[0,0,-1]);const up=direction(f.head.q,neutral(n).head.q,[0,1,0]);return {t:f.t,...angles(forward),roll:deg(Math.atan2(up[0],up[1]))};});}
function maxBend(n,side){return Math.max(...rawFrames(n).map(f=>{const a=new RealThree.Vector3(...sub(f[side+'UpperLeg'].p,f[side+'LowerLeg'].p)).normalize();const b=new RealThree.Vector3(...sub(f[side+'Foot'].p,f[side+'LowerLeg'].p)).normalize();return 180-deg(Math.acos(Math.max(-1,Math.min(1,a.dot(b)))));}));}
for(const clip of report.clips){
 check(`${clip.number} continuous raw humanoid has no frame jumps`,()=>{
  const frames=get(clip.number).frames;let maxMm=0,maxDegrees=0;
  for(let i=1;i<frames.length;i++)for(const name of Object.keys(frames[i].raw)){
   if(name.endsWith('Eye'))continue;
   const a=frames[i-1].raw[name],b=frames[i].raw[name];
   maxMm=Math.max(maxMm,mm(dist(a.p,b.p)));
   maxDegrees=Math.max(maxDegrees,deg(Q().fromArray(a.q).normalize().angleTo(Q().fromArray(b.q).normalize())));
  }
  assert(maxMm<15,'raw joint frame displacement '+maxMm+'mm (limit15mm)');
  assert(maxDegrees<5,'raw joint frame rotation '+maxDegrees+'degrees (limit5deg)');
  return {maxFrameDisplacementMm:maxMm,maxFrameRotationDegrees:maxDegrees};
 });
 check(`${clip.number} planted raw ankle/toe contact throughout entry, clip and exit`,()=>{
  for(const name of ['leftFoot','rightFoot','leftToes','rightToes']){
   if(clip.number==='12'&&name.startsWith('left'))continue;
   assert(clip.raw[name].maxNeutralDisplacementMm<1,`${name}: ${clip.raw[name].maxNeutralDisplacementMm.toFixed(3)}mm drift (limit 1mm)`);
   assert(clip.raw[name].maxNeutralRotationDegrees<.1,`${name}: ${clip.raw[name].maxNeutralRotationDegrees.toFixed(6)}deg rotation (limit0.1deg)`);
  }
  return {limitMm:1,rotationLimitDegrees:.1,leftFootMm:clip.raw.leftFoot.maxNeutralDisplacementMm,rightFootMm:clip.raw.rightFoot.maxNeutralDisplacementMm,maxPlantedRotationDegrees:Math.max(...['leftFoot','rightFoot','leftToes','rightToes'].filter(n=>!(clip.number==='12'&&n.startsWith('left'))).map(n=>clip.raw[n].maxNeutralRotationDegrees))};
 });
 check(`${clip.number} raw humanoid returns to neutral and has bounded head rotation`,()=>{
  const record=get(clip.number),last=record.frames.at(-1).raw;
  for(const name of Object.keys(record.neutral.raw)){
   if(name.endsWith('Eye'))continue;
   assert(dist(last[name].p,record.neutral.raw[name].p)<.001,`${name} endpoint translation`);
   assert(deg(Q().fromArray(last[name].q).angleTo(Q().fromArray(record.neutral.raw[name].q)))<.15,`${name} endpoint rotation`);
  }
  const directions=headAngles(clip.number);
  assert(directions.every(a=>Math.abs(a.yaw)<85&&Math.abs(a.pitch)<60&&Math.abs(a.roll)<45),'head orientation outside idle-motion bounds');
  return {};
 });
}
function intent(n,title,fn){if(get(n))check(n+' '+title,()=>fn(report.clips.find(c=>c.number===n),rawFrames(n),headAngles(n)));}
intent('03','upper-body sway has two clear directions with stable pelvis',(c,f)=>{
 assert(c.raw.hips.maxNeutralDisplacementMm<1,'pelvis translates');
 assert(c.raw.hips.rollDegrees.every(v=>Math.abs(v)<.1),'pelvis rotates instead of isolated torso sway');
 assert(c.raw.chest.rollDegrees[0]<-2&&c.raw.chest.rollDegrees[1]>2,'chest rotations cancel or lack left/right sway');
 assert(c.raw.head.xyzRangeMm[0]>25,'head lateral travel too small for visible upper-body sway');
 return {chestRollDegrees:c.raw.chest.rollDegrees,headLateralRangeMm:c.raw.head.xyzRangeMm[0]};
});
intent('08','crouch lowers pelvis and bends both knees while face lifts',(c,f,h)=>{
 const lower=Math.min(...f.map(p=>mm(p.hips.p[1]-neutral('08').hips.p[1])));
 assert(lower<-15,'pelvis must lower by at least 15mm');
 const bends=['left','right'].map(s=>maxBend('08',s));assert(bends.every(v=>v>15),'both knees must flex more than 15 degrees');
 assert(Math.max(...h.map(p=>p.pitch))>1,'face should lift during crouch');
 return {pelvisLoweringMm:lower,kneeBendDegrees:bends};
});
intent('09','turns avatar-left then bends and lifts face toward screen',(c,f,h)=>{
 assert(c.raw.chest.yawDegrees[1]>15,'torso must turn avatar-left');
 assert(Math.max(...h.filter(a=>a.t>=.8&&a.t<=2.0).map(a=>a.yaw))>8,'initial head turn must be avatar-left');
 assert(Math.min(...f.map(p=>angles(direction(p.chest.q,neutral('09').chest.q,[0,0,-1])).pitch))<-10,'torso must lean forward');
 assert(Math.max(...h.filter(a=>a.t>=2.5&&a.t<=5).map(a=>a.pitch))>2,'face must lift toward screen after leaning');
 const eyes=p=>(p.leftEye.p[2]+p.rightEye.p[2])/2;
 const faceAdvanceMm=Math.max(...f.map(p=>mm(eyes(neutral('09'))-eyes(p))));
 assert(faceAdvanceMm>240,'face must visibly approach the fixed camera by at least240mm');
 assert(h.every(a=>a.pitch>-12&&a.pitch<20),'face must remain directed toward the screen throughout the approach');
 assert(c.raw.hips.maxNeutralDisplacementMm<1,'closer face must not come from sliding the whole avatar');
 return {chestYaw:c.raw.chest.yawDegrees,headPitch:c.raw.head.pitchDegrees,faceAdvanceMm};
});
intent('12','free left foot moves inward while right support stays planted',(c,f)=>{
 const inward=Math.max(...f.map(p=>mm(p.leftFoot.p[0]-neutral('12').leftFoot.p[0])));
 assert(inward>10,'left foot must move toward body midline');
 assert(c.raw.rightFoot.maxNeutralDisplacementMm<1,'right support foot must remain planted');
 let excursions=0,inside=false;for(const p of f){const now=mm(p.leftFoot.p[0]-neutral('12').leftFoot.p[0])>5;if(now&&!inside)excursions++;inside=now;}
 assert.equal(excursions,1,'free left foot must make exactly one inward excursion beyond5mm');
 assert(f.every(p=>p.leftFoot.p[0]<=p.hips.p[0]+1e-5),'free left foot must not cross the body midline');
 return {leftInwardMm:inward,inwardExcursions:excursions,midlineClearanceMm:Math.min(...f.map(p=>mm(p.hips.p[0]-p.leftFoot.p[0])))};
});
intent('13','pelvis shifts avatar-left with feet planted',(c,f)=>{
 const left=Math.max(...f.map(p=>mm(neutral('13').hips.p[0]-p.hips.p[0])));
 assert(left>15,'pelvis must move toward avatar-left (-X)');return {pelvisLeftMm:left};
});
intent('14','head turns avatar-right',(c,f,h)=>{assert(c.raw.head.yawDegrees[0]<-10,'right turn absent');assert(c.raw.head.yawDegrees[1]<5,'wrong-way left turn');return {yaw:c.raw.head.yawDegrees};});
intent('15','upper body looks back over avatar-left shoulder',(c)=>{assert(c.raw.chest.yawDegrees[1]>15,'chest turns wrong direction or too little');assert(c.raw.head.yawDegrees[1]>30,'head must turn clearly left');return {yaw:c.raw.head.yawDegrees};});
intent('16','head looks down',(c)=>{assert(c.raw.head.pitchDegrees[0]<-8,'downward pitch absent');assert(c.raw.head.pitchDegrees[1]<4,'unintended upward pitch');return {pitch:c.raw.head.pitchDegrees};});
intent('17','head looks up',(c)=>{assert(c.raw.head.pitchDegrees[1]>8,'upward pitch absent');assert(c.raw.head.pitchDegrees[0]>-4,'unintended downward pitch');return {pitch:c.raw.head.pitchDegrees};});
intent('18','one distinct downward nod and return',(c,f,h)=>{let count=0,down=false;for(const p of h){const now=p.pitch<-6;if(now&&!down)count++;down=now;}assert.equal(count,1,'nod must have exactly one downward excursion beyond6°');assert(c.raw.head.pitchDegrees[0]<-8,'nod too small');assert(c.raw.head.pitchDegrees[0]>-20,'small nod must stay under20deg downward pitch');assert(Math.abs(h.at(-1).pitch)<.5,'nod must return forward');return {downwardExcursions:count,pitch:c.raw.head.pitchDegrees};});
intent('19','head tilts avatar-left',(c,f,h)=>{assert(Math.min(...h.map(a=>a.roll))<-8,'head must tilt toward avatar-left (-X), not screen-left');assert(Math.max(...h.map(a=>a.roll))<2,'wrong-way right tilt');return {roll:c.raw.head.rollDegrees};});
intent('20','torso and head bow forward',(c)=>{assert(c.raw.chest.pitchDegrees[0]<-8,'torso does not bow');assert(c.raw.head.pitchDegrees[0]<-8,'head does not bow');return {chestPitch:c.raw.chest.pitchDegrees,headPitch:c.raw.head.pitchDegrees};});

// Foot-contact correction must remain continuous when requested mid-entry,
// mid-gesture and on exit, including transitions from the untouched reference.
if(!only.length){
 const name='108 reference/crouch/peering/free-foot/weight-shift/exit transitions preserve raw continuity and contact';
 try{
  const chosen=['00','08','09','12','13','999'].map(n=>scenes.find(s=>s.number===n));
  const canonical=neutral('01');
  let cases=0,maxZeroPositionMm=0,maxZeroRotationDegrees=0,maxFramePositionMm=0,maxFrameRotationDegrees=0,maxContactMm=0,maxContactRotationDegrees=0;
  const difference=(a,b)=>{let position=0,rotation=0;for(const name of Object.keys(a.raw)){if(name.endsWith('Eye'))continue;position=Math.max(position,mm(dist(a.raw[name].p,b.raw[name].p)));rotation=Math.max(rotation,deg(Q().fromArray(a.raw[name].q).normalize().angleTo(Q().fromArray(b.raw[name].q).normalize())));}return {position,rotation};};
  for(const from of chosen)for(const to of chosen)for(const phase of [.4,3.5,6.4]){
   await qa.showMotion(scenes.at(-1));advance(1.3);
   await qa.showMotion(from);advance(phase);
   const before=pose();await qa.showMotion(to);step(0);const zero=difference(before,pose());
   maxZeroPositionMm=Math.max(maxZeroPositionMm,zero.position);maxZeroRotationDegrees=Math.max(maxZeroRotationDegrees,zero.rotation);
   assert(zero.position<.001&&zero.rotation<.001,`${from.number}->${to.number}@${phase}s immediate raw jump`);
   let previous=pose();
   for(let i=0;i<78;i++){step();const next=pose(),d=difference(previous,next);maxFramePositionMm=Math.max(maxFramePositionMm,d.position);maxFrameRotationDegrees=Math.max(maxFrameRotationDegrees,d.rotation);assert(d.position<20&&d.rotation<5,`${from.number}->${to.number}@${phase}s frame jump`);previous=next;}
   if(to.number!=='00')for(const bone of ['leftFoot','rightFoot','leftToes','rightToes']){
    if(to.number==='12'&&bone.startsWith('left'))continue;
    const distanceMm=mm(dist(previous.raw[bone].p,canonical[bone].p));maxContactMm=Math.max(maxContactMm,distanceMm);
    assert(distanceMm<1,`${from.number}->${to.number}@${phase}s ${bone} planted drift${distanceMm}mm`);
    const rotationDegrees=deg(Q().fromArray(previous.raw[bone].q).normalize().angleTo(Q().fromArray(canonical[bone].q).normalize()));maxContactRotationDegrees=Math.max(maxContactRotationDegrees,rotationDegrees);
    assert(rotationDegrees<.1,`${from.number}->${to.number}@${phase}s ${bone} planted rotation${rotationDegrees}deg`);
   }
   cases++;
  }
  report.tests.push({name,pass:true,cases,maxZeroPositionMm,maxZeroRotationDegrees,maxFramePositionMm,maxFrameRotationDegrees,maxContactMm,maxContactRotationDegrees});console.log('PASS',name);
 }catch(error){report.tests.push({name,pass:false,error:error.message});console.error('FAIL',name,error.message);}
}
report.footContactScope='Ankle/toe world positions and raw foot/toe world orientations are anchored. This does not establish collision-free skinned sole vertices, shoe deformation, or intersection with an actual floor mesh.';
report.summary={passed:report.tests.filter(t=>t.pass).length,failed:report.tests.filter(t=>!t.pass).length,clips:report.clips.length,renderedHeadlessFrames:renderCount};
if(outDir)fs.writeFileSync(path.join(outDir,'metrics.json'),JSON.stringify(report,null,2));
if(process.env.MOTION_QA_REPORT)fs.writeFileSync(process.env.MOTION_QA_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary));
if(report.summary.failed)process.exitCode=1;
