// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
/**
 * Actual-source headless regression for Xアバター訓練中/index.html.
 * 実行: node frontend_web/public/Xアバター訓練中/tests/test_playback.mjs
 * 前提: frontend_avatar の npm 依存関係をインストール済みであること。
 * ブラウザー描画や見た目の自然さを確認するテストではない。
 * No production animation/navigation code is copied into this harness.
 * Source scripts are executed unchanged except removal of ES import declarations;
 * appended closure probes inspect state. DOM, GPU renderer, RAF/Clock, and file
 * transport are mocked. GLTFLoader, VRM/VRMA plugins, AnimationMixer, scene graph,
 * humanoid mapping, and vrm.update are real, using the page's pinned versions.
 * This is NOT browser, network/CDN, texture/shader, or visual-quality verification.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';

// インストール済みの frontend_avatar 依存関係を利用する。追加の依存関係は不要。
// 別の検証環境を使う場合だけ MOTION_QA_MODULES=/path/to/node_modules を指定する。
const pageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(pageDir, '../../..');
const moduleRoot = process.env.MOTION_QA_MODULES || path.join(repo, 'frontend_avatar/node_modules');
const importModule = relative => import(pathToFileURL(path.join(moduleRoot, relative)).href);
const RealThree = await importModule('three/build/three.module.js');
const {GLTFLoader: RealGLTFLoader} = await importModule('three/examples/jsm/loaders/GLTFLoader.js');
const {VRMHumanBoneList, VRMLoaderPlugin, VRMUtils} = await importModule('@pixiv/three-vrm/lib/three-vrm.module.js');
const {VRMAnimationLoaderPlugin, createVRMAnimationClip} = await importModule('@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js');

const html = fs.readFileSync(path.join(pageDir, 'index.html'),'utf8');
const motionSource = fs.readFileSync(path.join(pageDir, 'motions.js'),'utf8');
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
const report = { label: process.env.MOTION_QA_LABEL || 'working-tree',dependencyVersions, timestamp: new Date().toISOString(), kind:'actual-source headless Node regression; NOT browser or visual QA', sourceHashes: {indexHtml:sha256(html),motionsJs:sha256(motionSource),testScript:sha256(fs.readFileSync(fileURLToPath(import.meta.url))),generator:sha256(fs.readFileSync(path.join(pageDir,'vrma/generate.py'))),model:sha256(fs.readFileSync(path.join(pageDir,'../Xビデオ/_vrm/VRM_AiDiy.vrm')))}, clips:[], tests:[], limitations:['DOM, WebGLRenderer, requestAnimationFrame, Clock, and URL transport are mocked','Real VRM geometry, humanoid mapping and update run, but textures are intentionally skipped','No browser rendering, keyboard focus, screenshots, shader/material, CDN, HTTP MIME, or CORS validation','Finite poses and transition invariants do not establish natural-looking motion or palm direction'], errors:[] };
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
    const absolute=path.resolve(pageDir,decodeURIComponent(url));
    loads.push({url,absolute});
    const go=()=>{
      if(failures.has(url)){const e=failures.get(url);failures.delete(url);onError(e);return;}
      try {const data=fs.readFileSync(absolute);this.parse(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'',onLoad,onError);}catch(e){onError(e);}
    };
    if(gates.has(url))gates.get(url).push(go);else queueMicrotask(go);
    return this;
  }
}
const THREE={...RealThree,Clock:class{getDelta(){return fakeDelta;}},WebGLRenderer:class{setPixelRatio(){}setClearColor(){}setSize(){}render(){renderCount++;}}};
const logs=[];
const context=vm.createContext({THREE,GLTFLoader:FileGLTFLoader,VRMHumanBoneList,VRMLoaderPlugin,VRMUtils,VRMAnimationLoaderPlugin,createVRMAnimationClip,document,URLSearchParams,location:{search:'?scene=999',origin:'https://qa.invalid'},history:{replaceState(_s,_t,url){this.url=url;}},devicePixelRatio:1,ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){this.fn();}},requestAnimationFrame:fn=>{nextRaf=fn;return renderCount;},console:{log:()=>{},warn:(...x)=>logs.push(['warn',...x.map(String)]),error:(...x)=>logs.push(['error',...x.map(String)])}});
context.window=context;
const windowListeners=new Map();
context.addEventListener=(name,callback)=>{const list=windowListeners.get(name)||[];list.push(callback);windowListeners.set(name,list);};
globalThis.self=globalThis;
vm.runInContext(motionSource+'\n'+navigationSource,context,{filename:'actual-navigation.js'});
// Import binding substitution is the only change to the animation source.
const source=moduleSource.replace(/^\s*import[^\n]*;\s*$/gm,'');
const qa=await vm.runInContext(`(async()=>{${source}\nreturn {showMotion,tick,capturePose,read:()=>({bones,vrm,mixer,currentAction,activeTracks,transition,ending,finishPending,requestId,motionCache,transitionSeconds,footContact}),navShow:show,scenes};})()`,context,{filename:'actual-page-module.js'});
assert(qa.read().vrm,'actual page initialized VRM');
const scenes=Array.from(qa.scenes);
const candidates=scenes.filter(s=>s.file&&s.number!=='00');
assert.equal(candidates.length,20);
let finished=0;
let looped=0;
qa.read().mixer.addEventListener('finished',()=>finished++);
qa.read().mixer.addEventListener('loop',()=>looped++);
function step(dt=1/60){const before=frameProbe?qa.capturePose():null;fakeDelta=dt;const fn=nextRaf;assert(fn,'RAF scheduled');nextRaf=null;fn();finitePose();if(frameProbe){const diff=maxPoseDifference(before,qa.capturePose());frameProbe.frames++;if(diff.rotationDegrees>frameProbe.maxRotationDegrees)Object.assign(frameProbe,{maxRotationDegrees:diff.rotationDegrees,maxRotationBone:diff.maxRotationBone,frame:frameProbe.frames});frameProbe.maxPositionMetres=Math.max(frameProbe.maxPositionMetres,diff.positionMetres);}}
function advance(seconds,dt=1/60){const count=Math.ceil(seconds/dt);for(let i=0;i<count;i++)step(dt);}
function finitePose(){for(const {name,node} of qa.read().bones){for(const n of [...node.quaternion.toArray(),...node.position.toArray()])assert(Number.isFinite(n),name+' pose finite');assert(Math.abs(node.quaternion.length()-1)<1e-5,name+' quaternion normalized');}}
function maxPoseDifference(a,b){let rotation=0,position=0,bone='';for(let i=0;i<a.length;i++){const angle=a[i].rotation.clone().normalize().angleTo(b[i].rotation.clone().normalize())*180/Math.PI;const distance=a[i].position.distanceTo(b[i].position);if(angle>rotation){rotation=angle;bone=qa.read().bones[i].name;}position=Math.max(position,distance);}return {rotationDegrees:rotation,positionMetres:position,maxRotationBone:bone};}
function assertIdle(){const s=qa.read();assert.equal(s.currentAction,null);assert.equal(s.ending,true);assert.equal(s.transition,null);assert.equal(s.activeTracks.rotation.size,0);assert.equal(s.activeTracks.translation.size,0);for(const {name,node,idleRotation,restPosition} of s.bones){assert(node.quaternion.angleTo(idleRotation)<1e-6,name+' idle rotation');assert(node.position.distanceTo(restPosition)<1e-8,name+' idle position');}}
function assertClipPose(action, label) {
  let maxRotationDegrees = 0;
  let maxPositionMetres = 0;
  let maxBone = '';
  for (const track of action.getClip().tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    if (!['quaternion', 'position'].includes(parsed.propertyName)) continue;
    const node = THREE.PropertyBinding.findNode(qa.read().vrm.scene, parsed.nodeName);
    const sample = track.createInterpolant().evaluate(action.time);
    // 接地補正は脚をモデル寸法へ解き直すため、Mixerの未補正サンプルを比較する。
    // 表示後の接地・方向はtest_intent.mjsで実rawボーンから独立に確認する。
    const index = qa.read().bones.findIndex(bone => bone.node === node);
    const sourcePose = qa.read().footContact?.sourcePose?.[index];
    if (parsed.propertyName === 'quaternion') {
      const expected = new THREE.Quaternion().fromArray(sample).normalize();
      const degrees = (sourcePose?.rotation || node.quaternion).clone().normalize().angleTo(expected) * 180 / Math.PI;
      if (degrees > maxRotationDegrees) { maxRotationDegrees = degrees; maxBone = node.name; }
    } else {
      maxPositionMetres = Math.max(maxPositionMetres, (sourcePose?.position || node.position).distanceTo(new THREE.Vector3().fromArray(sample)));
    }
  }
  assert(maxRotationDegrees < .01, `${label}: settled track differs by ${maxRotationDegrees} degrees on ${maxBone}`);
  assert(maxPositionMetres < 1e-8, `${label}: settled position differs by ${maxPositionMetres} metres`);
  return {maxRotationDegrees, maxPositionMetres, maxBone};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,limit=1000){for(let i=0;i<limit;i++){if(predicate())return;await flush();}throw new Error('Async settling limit exceeded');}
function gate(url){assert(!gates.has(url));gates.set(url,[]);return ()=>{const callbacks=gates.get(url);gates.delete(url);for(const fn of callbacks)fn();};}
async function reset(){await qa.showMotion(scenes.at(-1));advance(1.2);assertIdle();}
async function test(name,fn){try{const details=await fn();report.tests.push({name,pass:true,...details});console.log('PASS',name);}catch(e){report.tests.push({name,pass:false,error:e.stack});console.error('FAIL',name,e.stack);}}

await test('all 20 generated VRMAs decode, run exactly once, finish at endpoint, return to idle and stay idle',async()=>{
  for(const selected of candidates){
    await reset();const beforeFinished=finished;const beforeLooped=looped;
    await qa.showMotion(selected);
    const state=qa.read();const action=state.currentAction;
    assert(action,'action created for '+selected.number);
    assert.equal(action.loop,THREE.LoopOnce);assert.equal(action.repetitions,1);assert(action.clampWhenFinished);
    const clip=action.getClip();assert(clip.duration>0);assert(clip.tracks.length>0);
    const hash=sha256(fs.readFileSync(path.join(pageDir,selected.file)));
    frameProbe={frames:0,maxRotationDegrees:0,maxPositionMetres:0,maxRotationBone:null};
    advance(clip.duration-1/60);
    assert.equal(qa.read().ending,false,selected.number+' must not finish early');
    step();
    if (!qa.read().ending) step(); // 浮動小数点丸めの1フレームだけ許容する。
    assert.equal(qa.read().ending,true,selected.number+' finishes by endpoint + frame');
    assert.equal(finished-beforeFinished,1,selected.number+' exactly one finish');
    assert.equal(looped-beforeLooped,0,selected.number+' no loop events');
    advance(1.2);assertIdle();
    const atIdle=qa.capturePose();advance(.5);assert(maxPoseDifference(atIdle,qa.capturePose()).rotationDegrees<1e-4);
    report.clips.push({number:selected.number,title:selected.title,file:selected.file,sha256:hash,duration:clip.duration,tracks:clip.tracks.length,passed:true,frameMetrics60fps:frameProbe});frameProbe=null;
  }
  for(const clip of report.clips)assert(clip.frameMetrics60fps.maxRotationDegrees<5,`${clip.number}: one-frame angular jump ${clip.frameMetrics60fps.maxRotationDegrees} degrees`);
  return {clips:20,endpointToleranceSeconds:2/60,maxFrameRotationDegrees:5};
});
await test('00 reference motion loads, runs once and exits',async()=>{await reset();const b=finished;await qa.showMotion(scenes[0]);const duration=qa.read().currentAction.getClip().duration;advance(duration+1.3);assertIdle();assert.equal(finished-b,1);return {duration};});
await test('same cached candidate can replay repeatedly before and after natural finish',async()=>{
  await reset();const selected=candidates[0];const beforeLoads=loads.filter(l=>l.url===selected.file).length;
  await qa.showMotion(selected);advance(2);const action=qa.read().currentAction;
  const visible=qa.capturePose();await qa.showMotion(selected);assert.equal(qa.read().currentAction,action);assert.equal(action.time,0);
  assert(maxPoseDifference(visible,qa.read().transition.from).rotationDegrees<1e-4,'replay transition captures displayed pose');
  step(0);assert(maxPoseDifference(visible,qa.capturePose()).rotationDegrees<1e-4,'zero-time replay stays at displayed pose');
  for(let i=0;i<3;i++){advance(action.getClip().duration+1.3);assertIdle();await qa.showMotion(selected);assert.equal(action.time,0);}
  assert.equal(loads.filter(l=>l.url===selected.file).length,beforeLoads,'cached replay does not load again');
  await reset();return {replays:4};
});
await test('rapid switching while loading ignores stale success and keeps newest selection',async()=>{
  await reset();const a=candidates[1],b=candidates[2];qa.read().motionCache.delete(a.file);qa.read().motionCache.delete(b.file);
  const releaseA=gate(a.file),releaseB=gate(b.file);
  const pa=qa.showMotion(a),pb=qa.showMotion(b);releaseB();await pb;
  const active=qa.read().currentAction;assert(active);const newestRequest=qa.read().requestId;
  releaseA();await pa;assert.equal(qa.read().currentAction,active);assert.equal(qa.read().requestId,newestRequest);assert.equal(elements.loadStatus.textContent,'');
  advance(active.getClip().duration+1.3);assertIdle();return {completionOrder:'B, then A; B remained active'};
});
await test('rapid same-candidate requests share load and only newest request starts',async()=>{
  await reset();const selected=candidates[3];qa.read().motionCache.delete(selected.file);const n=loads.length;const release=gate(selected.file);
  const p1=qa.showMotion(selected),p2=qa.showMotion(selected),p3=qa.showMotion(selected);assert.equal(loads.length-n,1);release();await Promise.all([p1,p2,p3]);
  assert(qa.read().currentAction);assert.equal(qa.read().currentAction.time,0);await reset();return {requests:3,loads:1};
});
await test('999 confirmation exit cancels active playback and pending motion load',async()=>{
  await qa.showMotion(candidates[4]);advance(2);const before=qa.capturePose();await qa.showMotion(scenes.at(-1));assert.equal(elements.loadStatus.textContent,'確認終了');assert(maxPoseDifference(before,qa.read().transition.from).rotationDegrees<1e-4);step(0);assert(maxPoseDifference(before,qa.capturePose()).rotationDegrees<1e-4);advance(1.2);assertIdle();
  const selected=candidates[5];qa.read().motionCache.delete(selected.file);const release=gate(selected.file);const pending=qa.showMotion(selected);await qa.showMotion(scenes.at(-1));release();await pending;advance(1.2);assertIdle();assert.equal(elements.loadStatus.textContent,'確認終了');return {activeExit:true,pendingExit:true};
});
await test('interrupted entry and interrupted exit start from exact displayed pose',async()=>{
  await reset();await qa.showMotion(candidates[0]);advance(.4);assert(qa.read().transition);const entry=qa.capturePose();await qa.showMotion(candidates[9]);assert(maxPoseDifference(entry,qa.read().transition.from).rotationDegrees<1e-4);step(0);const entryDiff=maxPoseDifference(entry,qa.capturePose());assert(entryDiff.rotationDegrees<1e-4);advance(1.5);
  await qa.showMotion(scenes.at(-1));advance(.4);assert(qa.read().transition);const exit=qa.capturePose();await qa.showMotion(candidates[5]);assert(maxPoseDifference(exit,qa.read().transition.from).rotationDegrees<1e-4);step(0);const exitDiff=maxPoseDifference(exit,qa.capturePose());assert(exitDiff.rotationDegrees<1e-4);advance(qa.read().currentAction.getClip().duration+1.3);assertIdle();return {entryDiff,exitDiff};
});
await test('natural endpoint return can be interrupted continuously',async()=>{
  await reset();await qa.showMotion(candidates[0]);advance(qa.read().currentAction.getClip().duration+.4);assert(qa.read().transition);assert(qa.read().ending);const before=qa.capturePose();await qa.showMotion(candidates[4]);step(0);const diff=maxPoseDifference(before,qa.capturePose());assert(diff.rotationDegrees<1e-4);await reset();return {difference:diff};
});
await test('actual navigation buttons and chips select boundaries and replay selected candidate',async()=>{
  elements.firstBtn.click();await until(()=>qa.read().currentAction!==null);assert.equal(elements.pageLabel.textContent.startsWith('00 /'),true);assert(elements.firstBtn.disabled);assert(elements.prevBtn.disabled);
  elements.sceneIndex.children[1].click();await until(()=>elements.loadStatus.textContent==='');const action=qa.read().currentAction;advance(2);elements.sceneIndex.children[1].click();await flush();assert.equal(qa.read().currentAction,action);assert.equal(action.time,0);
  elements.lastBtn.click();advance(1.2);assertIdle();assert(elements.nextBtn.disabled);assert(elements.lastBtn.disabled);assert.equal(elements.sceneFrame.src,'scene_999.html');assert.equal(context.history.url,'?scene=999');return {chips:elements.sceneIndex.children.length};
});
await test('failed motion load reports error and same candidate retries successfully',async()=>{
  await reset();const selected=candidates[6];qa.read().motionCache.delete(selected.file);failures.set(selected.file,new Error('QA injected read failure'));await qa.showMotion(selected);assert(elements.loadStatus.textContent.includes('QA injected read failure'));assert(!qa.read().motionCache.has(selected.file));await qa.showMotion(selected);assert(qa.read().currentAction);assert.equal(elements.loadStatus.textContent,'');await reset();return {failure:'intentional test-only injected loader failure'};
});
await test('stale loading failure cannot override newest success',async()=>{
  await reset();const a=candidates[7],b=candidates[8];qa.read().motionCache.delete(a.file);const release=gate(a.file);failures.set(a.file,new Error('QA injected stale failure'));const pending=qa.showMotion(a);await qa.showMotion(b);const action=qa.read().currentAction;release();await pending;assert.equal(qa.read().currentAction,action);assert.equal(elements.loadStatus.textContent,'');await reset();return {};
});
await test('reselecting a previously stale failed load retries on the first selection',async()=>{
  await reset();const a=candidates[10],b=candidates[11];qa.read().motionCache.delete(a.file);const release=gate(a.file);failures.set(a.file,new Error('QA injected stale retry failure'));const pending=qa.showMotion(a);await qa.showMotion(b);release();await pending;
  const beforeLoads=loads.filter(l=>l.url===a.file).length;await qa.showMotion(a);
  assert.equal(loads.filter(l=>l.url===a.file).length,beforeLoads+1,'the first reselect should retry the failed stale request');
  assert.equal(elements.loadStatus.textContent,'');assert(qa.read().currentAction);await reset();return {};
});
await test('constant target tracks settle correctly after switching from a crouch',async()=>{
  await reset();await qa.showMotion(candidates[7]);advance(3.5);await qa.showMotion(candidates[13]);advance(1.2);
  assert.equal(qa.read().transition,null);
  const measured = assertClipPose(qa.read().currentAction, '08 -> 14');
  await reset();return measured;
});
await test('high-rotation candidates switch pairwise during entry, hold and natural exit',async()=>{
  const selectedNumbers=['01','02','04','05','06','10'];
  const affected=candidates.filter(s=>selectedNumbers.includes(s.number));
  const phases=[.15,.55,1.05,3.5,8.25,8.75];
  let cases=0;let maxZeroTimeRotationDegrees=0;let maxZeroTimePositionMetres=0;let maxFirstFrameRotationDegrees=0;
  for(const from of affected)for(const to of affected)for(const phase of phases){
    await reset();await qa.showMotion(from);advance(phase);
    const pose=qa.capturePose();await qa.showMotion(to);
    const captured=maxPoseDifference(pose,qa.read().transition.from);
    assert(captured.rotationDegrees<1e-4 && captured.positionMetres<1e-9,`${from.number}->${to.number} at ${phase}s captures displayed pose`);
    step(0);const exact=maxPoseDifference(pose,qa.capturePose());
    assert(exact.rotationDegrees<1e-4 && exact.positionMetres<1e-9,`${from.number}->${to.number} at ${phase}s has no immediate snap`);
    maxZeroTimeRotationDegrees=Math.max(maxZeroTimeRotationDegrees,exact.rotationDegrees);maxZeroTimePositionMetres=Math.max(maxZeroTimePositionMetres,exact.positionMetres);
    step();const first=maxPoseDifference(pose,qa.capturePose());maxFirstFrameRotationDegrees=Math.max(maxFirstFrameRotationDegrees,first.rotationDegrees);
    assert(first.rotationDegrees<1,`${from.number}->${to.number} at ${phase}s first frame rotation under 1 degree`);
    assert(first.positionMetres<.001,`${from.number}->${to.number} at ${phase}s first frame translation under 1mm`);
    assert(qa.read().currentAction);assert(!qa.read().ending);
    advance(1.2);assert.equal(qa.read().transition,null);
    assertClipPose(qa.read().currentAction, `${from.number}->${to.number} at ${phase}s`);
    cases++;
  }
  await reset();return {candidates:selectedNumbers,phasesSeconds:phases,cases,maxZeroTimeRotationDegrees,maxZeroTimePositionMetres,maxFirstFrameRotationDegrees};
});
await test('30fps and stalled-frame updates preserve finite playback and endpoint return', async () => {
  const frameSteps = [1/30, .5];
  for (const delta of frameSteps) {
    await reset();await qa.showMotion(candidates[7]);
    const effectiveDelta = Math.min(delta,.1);
    for (let i=0;i<Math.ceil(9.5/effectiveDelta);i++) step(delta);
    assertIdle();
  }
  return {frameStepsSeconds:frameSteps,stalledFrameClampSeconds:.1};
});
await test('actual arrow and iframe message navigation respects origin/source guards', async () => {
  qa.navShow(0);await flush();let prevented=false;
  document.dispatch('keydown',{key:'ArrowRight',preventDefault(){prevented=true;}});
  await flush();assert(prevented);assert.equal(context.history.url,'?scene=01');
  const onMessage=windowListeners.get('message')[0];
  onMessage({origin:'https://untrusted.invalid',source:elements.sceneFrame.contentWindow,data:{type:'avatar-motion-page',direction:1}});
  assert.equal(context.history.url,'?scene=01');
  onMessage({origin:context.location.origin,source:{},data:{type:'avatar-motion-page',direction:1}});
  assert.equal(context.history.url,'?scene=01');
  onMessage({origin:context.location.origin,source:elements.sceneFrame.contentWindow,data:{type:'avatar-motion-page',direction:1}});
  await flush();assert.equal(context.history.url,'?scene=02');await reset();
  return {keyboardDispatch:true,wrongOriginIgnored:true,wrongSourceIgnored:true,validMessageAccepted:true};
});
await test('multiple requests without any tick preserve the visible 02/08 pose and foot anchors', async () => {
  const starts = ['02', '08'];
  const phases = [.4, 3.5, 8.65];
  const batches = [['05', '02', '999', '08', '14'], ['14', '999', '02', '05', '999']];
  const byNumber = new Map(scenes.map(selected => [selected.number, selected]));
  let cases = 0;
  let maxZeroTimeSkinMm = 0;
  let maxFirstFrameRotationDegrees = 0;
  const skinPose = () => {
    const vrm = qa.read().vrm;
    vrm.scene.updateMatrixWorld(true);
    const points = [];
    vrm.scene.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      mesh.skeleton.update();
      for (const i of [0, Math.floor(mesh.geometry.attributes.position.count / 2), mesh.geometry.attributes.position.count - 1]) {
        points.push(mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3())));
      }
    });
    return points;
  };
  for (const number of starts) for (const phase of phases) for (const batch of batches) {
    await reset();
    await qa.showMotion(byNumber.get(number));
    advance(phase);
    const visible = qa.capturePose();
    const skin = skinPose();
    const feet = qa.read().footContact.legs.map(leg => ({
      position: leg.foot.getWorldPosition(new THREE.Vector3()),
      rotation: leg.foot.getWorldQuaternion(new THREE.Quaternion()),
    }));
    // Intentionally do not call step(0) between requests: stopAllAction restores bindings synchronously.
    for (const target of batch) {
      await qa.showMotion(byNumber.get(target));
      const transition = qa.read().transition;
      const captured = maxPoseDifference(visible, transition.from);
      assert(captured.rotationDegrees < 1e-4 && captured.positionMetres < 1e-9,
        `${number} at ${phase}s, batch ${batch.join(' -> ')}: ${target} retains the displayed pose`);
      transition.feet.forEach((foot, i) => {
        assert(foot.position.distanceTo(feet[i].position) < 1e-9, `${number}: same-tick foot anchor remains displayed`);
        assert(foot.rotation.clone().normalize().angleTo(feet[i].rotation.clone().normalize()) < 1e-6,
          `${number}: same-tick foot orientation remains displayed`);
      });
    }
    step(0);
    const exact = maxPoseDifference(visible, qa.capturePose());
    assert(exact.rotationDegrees < 1e-4 && exact.positionMetres < 1e-9,
      `${number} at ${phase}s: first zero-time tick preserves the displayed pose`);
    skinPose().forEach((point, i) => { maxZeroTimeSkinMm = Math.max(maxZeroTimeSkinMm, point.distanceTo(skin[i]) * 1000); });
    assert(maxZeroTimeSkinMm < .001, 'same-tick requests do not move visible skin at zero time');
    step();
    const first = maxPoseDifference(visible, qa.capturePose());
    maxFirstFrameRotationDegrees = Math.max(maxFirstFrameRotationDegrees, first.rotationDegrees);
    assert(first.rotationDegrees < 1 && first.positionMetres < .001,
      `${number} at ${phase}s: first advancing tick remains continuous`);
    advance(1.2);
    assert.equal(qa.read().transition, null);
    if (qa.read().currentAction) assertClipPose(qa.read().currentAction, `${number} same-tick batch`);
    else assertIdle();
    cases++;
  }
  await reset();
  return {starts, phasesSeconds: phases, batches, cases, maxZeroTimeSkinMm, maxFirstFrameRotationDegrees};
});
report.consoleLogs=logs;
report.summary={passed:report.tests.filter(t=>t.pass).length,failed:report.tests.filter(t=>!t.pass).length,decodedCandidates:report.clips.length,renderedHeadlessFrames:renderCount,loadRequests:loads.length,finishedEvents:finished,loopEvents:looped};
console.log(JSON.stringify(report.summary));
if (process.env.MOTION_QA_REPORT) {
  fs.writeFileSync(process.env.MOTION_QA_REPORT,JSON.stringify(report,null,2));
  console.log('REPORT',process.env.MOTION_QA_REPORT);
}
if(report.summary.failed)process.exitCode=1;
