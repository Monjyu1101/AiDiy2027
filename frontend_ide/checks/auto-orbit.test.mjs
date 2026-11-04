// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAutoOrbit,MANUAL_PAUSE_MS,orbitTurnProgress} from '../src/components/開発スペース/自動周回.js';
import {cameraPosition} from '../src/components/開発スペース/ワープ視点.js';
const radius=v=>Math.hypot(...Object.values(cameraPosition(v)));
const home = () => ({yaw:.6,pitch:.35,dist:4600,tx:0,ty:0,tz:0});
const direction = v => [Math.sin(v.yaw)*Math.cos(v.pitch),Math.sin(v.pitch),Math.cos(v.yaw)*Math.cos(v.pitch)];
test('彗星飛行は星々の内側を通り、常に星系の中心へ視線を向ける',()=>{
 const orbit=createAutoOrbit(()=>.5);let view=home(),closest=Infinity,farthest=0,near;
 for(let i=0;i<1000;i++){
  view=orbit.step(i*250,.25,view,4600);
  if(radius(view)<closest){closest=radius(view);near={...view};}farthest=Math.max(farthest,radius(view));
  const eye=Object.values(cameraPosition(view));
  assert.ok(direction(view).reduce((sum,x,j)=>sum-x*eye[j]/radius(view),0)>1-1e-10,'接近・通過・離脱の全区間で中心を見る');
  assert.ok(Object.values(view).every(Number.isFinite));
 }
 assert.ok(Math.abs(closest-4600*1.15*.22)<1);
 assert.ok(closest<1500,'最接近時は星々の分布半径の内側に入る');
 assert.ok(Math.abs(farthest-4600*1.15)<1);
 // 開始は今の距離から近づく側の途中（遠点そのものではない）なので、最接近は開始の向きのほぼ反対側を通る
 assert.ok(Object.values(cameraPosition(near)).reduce((s,n,i)=>s+n*Object.values(cameraPosition(home()))[i],0)/radius(near)/radius(home())<0);
});
test('遠点でだけ次の軌道を決め、再接近方向と傾きを変えても位置が連続する',()=>{
 let seed=321,calls=0;const orbit=createAutoOrbit(()=>{calls++;seed=(seed*1664525+1013904223)>>>0;return seed/2**32;});
 let view=home(),turns=0;
 for(let i=0;i<6400;i++){
  const before={...view},count=calls;view=orbit.step(i*250,.25,view,4600);
  if(i>1&&calls!==count){turns++;assert.ok(Math.abs(radius(view)-radius(before))<1);assert.ok(Math.hypot(view.yaw-before.yaw,view.pitch-before.pitch)<.04);}
  assert.ok(direction(view).reduce((sum,x,j)=>sum-x*Object.values(cameraPosition(view))[j]/radius(view),0)>1-1e-10,'軌道面が変わっても中心を見続ける');
  assert.ok(Object.values(view).every(Number.isFinite));
 }
 assert.ok(turns>=3);
 assert.ok(Math.hypot(view.yaw-home().yaw,view.pitch-home().pitch)>.1);
});
test('通常速度は従来の1/3、最接近速度はさらに1/2へ滑らかに落とす',()=>{
 const orbit=createAutoOrbit(()=>.5);let view=home(),previous,nearSpeed,farSpeed,closest=Infinity,farthest=0,previousSpeed,previousDistance,previousPhase;
 const dt=.02;
 for(let i=0;i<250/dt;i++){
  view=orbit.step(i*dt*1000,dt,view,4600);
  const point=Object.values(cameraPosition(view)), distance=radius(view);
  if(previous&&i*dt>16&&orbit.phase==='flying'&&previousPhase==='flying'){
   const speed=Math.hypot(...point.map((n,j)=>n-previous[j]))/dt;
   if(previousSpeed!==undefined&&distance<previousDistance&&distance>4600*1.15*.22+1){
    assert.ok(speed>=previousSpeed*.9999,'接近中に減速へ転じず、最接近まで加速する');
   }
   previousSpeed=speed;previousDistance=distance;
   if(distance<closest){closest=distance;nearSpeed=speed;}
   if(distance>farthest){farthest=distance;farSpeed=speed;}
  }
  previous=point;
  previousPhase=orbit.phase;
 }
 const far=4600*1.15,near=far*.22,e=(far-near)/(far+near),b=Math.sqrt(far*near);
 const oldFarSpeed=b*2*Math.PI/(56*(1+e)),oldNearSpeed=b*2*Math.PI/(56*(1-e));
 assert.ok(Math.abs(farSpeed/oldFarSpeed-1/3)<.001);
 assert.ok(Math.abs(nearSpeed/oldNearSpeed-1/6)<.001);
});
test('手動操作の最終時刻から1分停止し、再開は現在の視点から滑らかに始まる',()=>{
 const orbit=createAutoOrbit(()=>.5);let view=home();
 orbit.step(0,.25,view,4600);orbit.interact(2000);orbit.interact(5000);
 view={...view,tx:500,ty:-200,dist:2000,yaw:8,pitch:4};
 assert.equal(orbit.step(5000+MANUAL_PAUSE_MS-1,.25,view,4600),null);
 const resumed=orbit.step(5000+MANUAL_PAUSE_MS,.016,view,4600);
 assert.ok(Math.abs(resumed.dist-view.dist)<1);
 assert.ok(Math.abs(resumed.yaw-view.yaw)<.01);
 assert.ok(Math.abs(resumed.pitch-view.pitch)<.01);
 for(const key of ['x','y','z'])assert.ok(Math.abs(cameraPosition(resumed)[key]-cameraPosition(view)[key])<1e-8,'再開直後は位置固定の旋回');
 let centered=resumed;
 for(let i=1;i<=6;i++)centered=orbit.step(5000+MANUAL_PAUSE_MS+i*250,.25,centered,4600);
 assert.ok(direction(centered).reduce((sum,x,j)=>sum-x*Object.values(cameraPosition(centered))[j]/radius(centered),0)>1-1e-10,'手動で別方向を見ていても再開後は中心へ戻す');
});
test('開始・再開直後は遠ざからず、今の距離から近づく向きで最接近まで進む',()=>{
 // 全景と同じ距離・近寄って見ていた距離・遠点より遠い距離・近点より近い距離から始める
 for(const dist of [4600,2000,8000,600]){
  // 近点付近は最も速いので、細かい刻み（20ms）で追う
  const orbit=createAutoOrbit(()=>.5);let view={...home(),dist},previous=dist,closest=dist;
  for(let i=0;i<20000;i++){
   view=orbit.step(i*20,.02,view,4600);
   if(radius(view)>previous+1e-6)break; // 遠ざかり始めた＝最接近を過ぎた
   closest=previous=radius(view);
  }
  assert.ok(closest<dist*.9,`距離${dist}から始めても、まず近づく（最接近 ${Math.round(closest)}）`);
  assert.ok(closest<Math.min(dist,Math.max(4600*1.15,dist*1.001)*.22)+1,`距離${dist}から最接近まで遠ざからずに進む`);
 }
});
test('選択・ドラッグ・ワープ・非表示で停止し、解除しても経過時間分を一気に飛ばない',()=>{
 const orbit=createAutoOrbit(()=>.6),view=home();
 assert.equal(orbit.step(1000,.25,view,4600,true),null);
 assert.equal(orbit.step(180000,.25,view,4600,true),null);
 const resumed=orbit.step(180001,.016,view,4600);
 assert.ok(Math.hypot(resumed.yaw-view.yaw,resumed.pitch-view.pitch)<.001);
 assert.ok(Math.abs(resumed.dist-view.dist)<1);
});

test('計算済み軌道線は船の真下を通り、次の軌道でだけ更新する',()=>{
 let calls=0;const orbit=createAutoOrbit(()=>{calls++;return .6;});let view=home(),previousPath=null,changes=0;
 const segmentDistance=(p,a,b)=>{
  const ab=['x','y','z'].map(k=>b[k]-a[k]),ap=['x','y','z'].map(k=>p[k]-a[k]);
  const t=Math.max(0,Math.min(1,ap.reduce((sum,x,i)=>sum+x*ab[i],0)/ab.reduce((sum,x)=>sum+x*x,0)));
  return Math.hypot(...ap.map((x,i)=>x-t*ab[i]));
 };
 assert.equal(orbit.path,null);
 for(let i=0;i<1600;i++){
  const previousCalls=calls;view=orbit.step(i*250,.25,view,4600);
  const points=orbit.path;
  if(!points){assert.equal(orbit.phase,'planning');previousPath=null;continue;}
  assert.equal(points.length,385);
  if(calls===previousCalls)assert.equal(points,previousPath,'毎フレームは軌道を再計算しない');
  else {assert.notEqual(points,previousPath);changes++;}
  assert.ok(points.every(p=>Object.values(p).every(Number.isFinite)));
  const eye=cameraPosition(view);
  const a=points[0],b=points[96],raw=[a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x];
  const normal=raw.map(x=>x/Math.hypot(...raw)),height=eye.x*normal[0]+eye.y*normal[1]+eye.z*normal[2];
  const ground={x:eye.x-normal[0]*height,y:eye.y-normal[1]*height,z:eye.z-normal[2]*height};
  const distance=Math.min(...points.slice(1).map((p,j)=>segmentDistance(ground,points[j],p)));
  assert.ok(distance<5,`船の真下と軌道線の誤差を抑える: ${distance}`);
  assert.ok(Math.abs(Math.abs(height)/radius(view)-Math.sin(Math.PI/36))<1e-7,'船は5度見下ろす高さで軌道の上を飛ぶ');
  previousPath=points;
 }
 assert.ok(changes>=2,'次の軌道も計算される');
 orbit.interact(500000);assert.equal(orbit.path,null,'手動操作後に古い軌道を残さない');
 orbit.resume();orbit.step(500001,.25,view,4600);assert.ok(orbit.path);
 orbit.step(500002,.25,view,4600,true);assert.equal(orbit.path,null,'プレビューやワープ中は消す');
});

test('遠点で消去、再計算、位置固定の機体回転、表示の順に次の軌道へ切り替える',()=>{
 let seed=77,calls=0;const orbit=createAutoOrbit(()=>{calls++;seed=(seed*1664525+1013904223)>>>0;return seed/2**32;});
 let view={...home(),roll:.8},lastPhase='idle',events=[],farEye=null,aligned=false,rolls=[];
 for(let i=0;i<4000;i++){
  const count=calls,before=view,phase=orbit.phase;
  view=orbit.step(i*250,.25,view,4600);
  if(i&&calls!==count)assert.equal(phase,'planning','線を消し終えてから再計算する');
  if(orbit.phase!==lastPhase){
   if(orbit.phase==='hiding'&&!farEye)farEye=cameraPosition(view);
   if(farEye)events.push(orbit.phase);
   lastPhase=orbit.phase;
  }
  if(['centering','aligning','planning'].includes(orbit.phase))assert.equal(orbit.visibility,0);
  if(farEye&&(phase==='aligning'||orbit.phase==='aligning'))rolls.push(view.roll);
  if(farEye&&orbit.phase!=='flying'){
   const eye=cameraPosition(view);
   assert.ok(Math.hypot(eye.x-farEye.x,eye.y-farEye.y,eye.z-farEye.z)<1e-7,'切替中は遠点から移動しない');
   if(phase==='aligning'&&Math.abs(view.roll-before.roll)>1e-4)aligned=true;
  }
  if(farEye&&orbit.phase==='flying'){
   assert.deepEqual(events,['hiding','planning','aligning','revealing','flying']);
   assert.ok(aligned,'次の軌道に合わせて機体を回す');
   assert.ok(rolls.length>=15,'3.6秒かけてゆっくり回す');
   const delta=view.roll-rolls[0],sign=Math.sign(delta),progress=rolls.map(roll=>(roll-rolls[0])*sign);
   const peak=Math.max(...progress),peakIndex=progress.indexOf(peak);
   assert.ok(peak>Math.abs(delta)+1e-5,'目標角度を少し通り過ぎる');
   assert.ok(peak-Math.abs(delta)<=Math.abs(delta)*.15+1e-8,'行き過ぎは実際の回転量の15%以内');
   assert.ok(peak-Math.abs(delta)>Math.abs(delta)*.14,'大きな回転でも3度に頭打ちさせない');
   assert.ok(progress.slice(0,peakIndex+1).every((p,i,a)=>!i||p>=a[i-1]),'目標方向へ滑らかに回転');
   assert.ok(progress.slice(peakIndex).every((p,i,a)=>!i||p<=a[i-1]),'行き過ぎた後は一度だけ戻す');
   assert.equal(rolls.at(-1),view.roll,'水平に戻ってから線を表示し、姿勢を保つ');
   const [a,,,,,,,,b]=orbit.path;
   const normal=[a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x];
   const right=normal[0]*Math.cos(view.yaw)-normal[2]*Math.sin(view.yaw);
   const up=normal[1]*Math.cos(view.pitch)-(normal[0]*Math.sin(view.yaw)+normal[2]*Math.cos(view.yaw))*Math.sin(view.pitch);
   assert.ok(Math.abs(right*Math.cos(view.roll)+up*Math.sin(view.roll))/Math.hypot(...normal)<1e-8,'機体から見た次の軌道面が水平');
   orbit.interact(i*250);assert.equal(orbit.phase,'idle');assert.equal(orbit.path,null);
   return;
  }
 }
 assert.fail('一周して次の軌道へ切り替わる');
});

// 次の軌道だけを固定乱数で選ぶ。初回の自然な姿勢合わせとは分けて計測する。
function controlledOrbitChange(side,magnitude,initial=home()) {
 let calls=0,samples=null,now=0,view={...initial};
 const orbit=createAutoOrbit(()=>{calls++;return samples?.length?samples.shift():.5;});
 const advance=dt=>{now+=dt*1000;const next=orbit.step(now,dt,view,4600);if(next)view=next;return next;};
 for(let i=0;i<10000&&orbit.phase!=='planning';i++)advance(.25);
 assert.equal(orbit.phase,'planning','遠点で新しい軌道の計算待ちになる');
 // 近点距離・周期・面内のドリフト、回転方向、回転量の順に固定する。
 samples=[.5,.5,.5,side,magnitude];
 return {orbit,advance,get view(){return view;},set view(value){view=value;},get calls(){return calls;},get now(){return now;}};
}
const eyeDistance=(a,b)=>Math.hypot(...['x','y','z'].map(key=>cameraPosition(a)[key]-cameraPosition(b)[key]));

test('大きな角度は角速度が線形に増減し、微調整は一定速度で進む',()=>{
 const step=.01,delta=Math.PI;
 const speeds=Array.from({length:100},(_,i)=>(orbitTurnProgress((i+1)*step,delta)-orbitTurnProgress(i*step,delta))/step);
 for(let i=1;i<49;i++)assert.ok(Math.abs(speeds[i]-speeds[i-1]-.04)<1e-10);
 for(let i=51;i<100;i++)assert.ok(Math.abs(speeds[i]-speeds[i-1]+.04)<1e-10);
 for(const sign of [-1,1])for(const t of [0,.1,.25,.5,.75,.9,1])assert.equal(orbitTurnProgress(t,sign*Math.PI/180),t);
});

test('フォルダが一つでもランダムと通過を交互に選び、実船体が銀河内を通る',()=>{
 for(const kind of ['斜め','遠点側','反対側','中央']){
  let seed=87,view=home(),now=0,folders=[];
  const orbit=createAutoOrbit(()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;});
  const advance=dt=>{now+=dt*1000;view=orbit.step(now,dt,view,4600,false,folders);};
  for(let i=0;i<10000&&orbit.phase!=='planning';i++)advance(.25);
  const eye=cameraPosition(view),distance=radius(view),sign=kind==='反対側'?-1:1;
  const point=kind==='斜め'?{x:850,y:-340,z:600}:kind==='中央'?{x:0,y:0,z:0}:Object.fromEntries(['x','y','z'].map(key=>[key,sign*eye[key]*1200/distance]));
  const folder={...point,path:'唯一のフォルダ',R:160};folders=[folder];
  for(let cycle=0;cycle<4;cycle++){
   assert.equal(orbit.phase,'planning');const before={...view};advance(0);
   assert.equal(orbit.target,cycle%2===0?folder.path:null,kind+' 2回に1回だけ通過を指定');
   assert.ok(eyeDistance(before,view)<1e-7,'経路の再計算で船を飛ばさない');
   let nearest=Infinity,finished=false;
   for(let i=0;i<100000;i++){
    advance(.02);const p=cameraPosition(view);
    assert.ok(Object.values(view).every(Number.isFinite));
    nearest=Math.min(nearest,Math.hypot(p.x-folder.x,p.y-folder.y,p.z-folder.z));
    if(orbit.phase==='planning'){finished=true;break;}
   }
   assert.ok(finished,'一周して次の再計算へ進む');
   if(cycle%2===0)assert.ok(nearest<folder.R,kind+' 通過距離 '+nearest);
  }
 }
});

for(const [label,side,sign] of [['左',.1,-1],['右',.9,1]]) {
 for(const magnitude of [.001,.2,.5,.999]) {
  test(`遠点の${label}回転は0〜180度の指定乱数に従い、行き過ぎと戻りは実角度の15%: ${magnitude}`,()=>{
   const run=controlledOrbitChange(side,magnitude),from={...run.view};
   const expected=sign*(180*magnitude)*Math.PI/180;
   run.advance(0);
   const calls=run.calls,path=run.orbit.path;
   assert.equal(run.orbit.phase,'aligning');
   assert.equal(run.view.roll,from.roll,'再計算の瞬間は姿勢を変えない');
   assert.ok(eyeDistance(run.view,from)<1e-8,'新しい軌道面へ回しても船体位置を固定する');
   const samples=[0];
   for(let i=0;i<370;i++){
    const before=run.view;
    run.advance(.01);
    samples.push((run.view.roll-from.roll)*sign);
    assert.equal(run.calls,calls,'回転中に乱数を取り直さない');
    assert.equal(run.orbit.path,path,'回転中に軌道線を作り直さない');
    assert.ok(eyeDistance(run.view,from)<1e-8,'行き過ぎと戻りでも船体は静止する');
    assert.ok(Math.abs(run.view.yaw-from.yaw)<1e-9&&Math.abs(run.view.pitch-from.pitch)<1e-9,'中心への視線を固定する');
    assert.ok(Math.abs(run.view.roll-before.roll)<.03,'微小な時間刻みに連続した姿勢を返す');
    if(run.orbit.phase==='aligning')assert.equal(run.orbit.visibility,0);
   }
   const delta=run.view.roll-from.roll,peak=Math.max(...samples),peakIndex=samples.indexOf(peak);
   assert.ok(Math.abs(delta-expected)<1e-9,`実際の回転は${expected*180/Math.PI}度（実測 ${delta*180/Math.PI}度）`);
   assert.ok(Math.abs(delta)>=0&&Math.abs(delta)<=Math.PI+1e-9,'左右とも絶対量は0〜180度');
   assert.ok(Math.abs(peak-Math.abs(delta)*1.15)<1e-9,'行き過ぎは小角度でも大角度でも15%');
   assert.ok(samples.slice(0,peakIndex+1).every((p,i,a)=>!i||p>=a[i-1]-1e-12),'行き過ぎまでは一方向へ回る');
   assert.ok(samples.slice(peakIndex).every((p,i,a)=>!i||p<=a[i-1]+1e-12),'一度だけ戻して静止する');
   const settled=run.view.roll;
   while(run.orbit.phase==='revealing'){
    run.advance(.1);
    assert.equal(run.view.roll,settled,'表示が戻る間に姿勢が跳ねない');
    assert.equal(run.calls,calls,'表示復帰中も乱数を取り直さない');
   }
   const [a,,,,,,,,b]=path,normal=[a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x];
   const right=normal[0]*Math.cos(run.view.yaw)-normal[2]*Math.sin(run.view.yaw);
   const up=normal[1]*Math.cos(run.view.pitch)-(normal[0]*Math.sin(run.view.yaw)+normal[2]*Math.cos(run.view.yaw))*Math.sin(run.view.pitch);
   assert.ok(Math.abs(right*Math.cos(settled)+up*Math.sin(settled))/Math.hypot(...normal)<1e-9,'新しい実軌道面に水平を合わせて終わる');
   run.advance(.001);
   assert.ok(Math.abs(run.view.roll-settled)<.001,'飛行再開の先頭フレームにも姿勢の段差がない');
   assert.equal(run.calls,calls);
  });
 }
}

test('±π境界や何周分も累積したロールでも、指定した90度だけで軌道を変える',()=>{
 for(const [side,sign] of [[.1,-1],[.9,1]]){
  const run=controlledOrbitChange(side,.5,{...home(),pitch:-sign*.35});
  // 同じ実姿勢を上下反転したEuler表現へ変え、±πの手前を開始位置にする。
  run.view={...run.view,yaw:run.view.yaw+Math.PI,pitch:Math.PI-run.view.pitch,roll:run.view.roll+sign*Math.PI};
  const from=run.view.roll;
  assert.ok(Math.abs(from)<Math.PI&&Math.abs(from)>Math.PI*.9);
  run.advance(0);
  for(let i=0;i<20;i++)run.advance(.2);
  assert.ok(Math.abs(run.view.roll-from-sign*Math.PI/2)<1e-9,'境界で反対回りや一周回転を選ばない');
  assert.ok(Math.abs(run.view.roll)>Math.PI,'角度表現を±πへ強制的に折り返さない');
  for(const wraps of [-4,4]){
   const repeated=controlledOrbitChange(side,.5);
   repeated.view={...repeated.view,roll:repeated.view.roll+wraps*Math.PI*2};
   const original=repeated.view.roll;
   repeated.advance(0);for(let i=0;i<20;i++)repeated.advance(.2);
   assert.ok(Math.abs(repeated.view.roll-original-sign*Math.PI/2)<1e-9,'累積ロールは現在値に近い連続した表現で保持する');
  }
 }
});

test('固定seedは複数周の軌道変更を再現し、遠点以外では乱数を消費しない',()=>{
 const create=()=>{let seed=981,calls=0;const orbit=createAutoOrbit(()=>{calls++;seed=(seed*1664525+1013904223)>>>0;return seed/2**32;});return{orbit,get calls(){return calls;},view:home()};};
 const runs=[create(),create()];let changes=0;
 for(let i=0;i<5000;i++){
  for(const run of runs){
   const phase=run.orbit.phase,calls=run.calls;
   if(phase==='planning')run.turnStart=run.view.roll;
   run.view=run.orbit.step(i*250,.25,run.view,4600);
   if(calls!==run.calls){assert.ok(phase==='idle'||phase==='planning');if(run===runs[0]&&phase==='planning')changes++;}
   if(phase==='aligning'&&run.orbit.phase==='revealing'&&run.turnStart!==undefined){
    const delta=Math.abs(run.view.roll-run.turnStart);
    assert.ok(delta>=0&&delta<=Math.PI+1e-9,'何周後でも実際の変更角は0〜180度に収まる');
   }
  }
  assert.deepEqual(runs[0].view,runs[1].view);
  assert.equal(runs[0].calls,runs[1].calls);
  assert.equal(runs[0].orbit.phase,runs[1].orbit.phase);
 }
 assert.ok(changes>=3,'複数周の変更を比較する');
});

test('回転・行き過ぎ・戻り中の中断と連続再開でも、古い角度や軌道を引き継がない',()=>{
 for(const interruption of [.2,2.7,3.2]){
  const run=controlledOrbitChange(.9,1);run.advance(0);
  for(let elapsed=0;elapsed<interruption-1e-9;elapsed+=.1)run.advance(.1);
  const oldPath=run.orbit.path,calls=run.calls;
  run.orbit.interact(run.now);
  assert.equal(run.orbit.phase,'idle');assert.equal(run.orbit.path,null);
  assert.equal(run.advance(.25),null);assert.equal(run.calls,calls,'停止中には新しい軌道を選ばない');
  for(let attempt=0;attempt<3;attempt++){
   const initial={yaw:8+attempt,pitch:4-attempt*.4,roll:-7-attempt,dist:2000+attempt*500,tx:400-attempt*50,ty:-150,tz:70};
   run.view={...initial};run.orbit.resume();
   const fresh=createAutoOrbit(()=>.5);let expected={...initial};
   for(let i=0;i<45;i++){
    const dt=i===0?0:.1;
    const actual=run.advance(dt);expected=fresh.step(run.now,dt,expected,4600);
    assert.deepEqual(actual,expected,'再開は最新視点だけから計算し、途中の古い目標へ戻らない');
    assert.ok(Object.values(actual).every(Number.isFinite));
    if(i<2)assert.ok(eyeDistance(actual,initial)<1e-8,'再開直後は新しい船体位置で旋回する');
   }
   assert.notEqual(run.orbit.path,oldPath);
   assert.equal(run.orbit.step(run.now,.25,run.view,4600,true),null);
   assert.equal(run.orbit.path,null);assert.equal(run.orbit.phase,'idle');
  }
 }
});
