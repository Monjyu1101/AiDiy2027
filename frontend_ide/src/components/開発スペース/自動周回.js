// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

export const MANUAL_PAUSE_MS = 60_000;
import {cameraPosition, turnToTarget} from '../開発スペース/ワープ視点.js';
import {orbitLevelRoll} from '../開発スペース/軌道案内.js';
const TAU = Math.PI * 2;
const LIFT=Math.tan(Math.PI/36),RADIAL_SCALE=Math.hypot(1,LIFT);
const ROLL_OVERSHOOT=.15,SMALL_TURN=Math.PI/60;
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const unit = v => { const length = Math.hypot(...v); return v.map(x => x / length); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const direction = view => [Math.sin(view.yaw)*Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw)*Math.cos(view.pitch)];
const nearAngle = (angle, reference) => reference + Math.atan2(Math.sin(angle-reference), Math.cos(angle-reference));
// 角速度を直線的に加速・減速する。3度未満の微調整には速度の山を付けない。
export const orbitTurnProgress = (t,delta) => {
  const x=Math.max(0,Math.min(1,t));
  return Math.abs(delta)<SMALL_TURN ? x : x<.5 ? 2*x*x : 1-2*(1-x)*(1-x);
};
// ロドリゲスの回転公式: 単位ベクトル axis の周りに angle だけ回す
const rotate = (v, axis, angle) => { const c = Math.cos(angle), s = Math.sin(angle), k = cross(axis, v), d = dot(axis, v); return v.map((x,i) => x*c + k[i]*s + axis[i]*d*(1-c)); };

// 遠点を起点にしたケプラー方程式 M = E + e sin(E)。軌道形状を求め、進行速度は別に調整する。
function eccentricAnomaly(mean, eccentricity) {
  let angle = mean,low=0,high=TAU;
  for (let i=0;i<48;i++) {
    const error=angle+eccentricity*Math.sin(angle)-mean;
    if(Math.abs(error)<1e-12)break;
    if(error>0)high=angle;else low=angle;
    const next=angle-error/(1+eccentricity*Math.cos(angle));
    angle=next>low&&next<high?next:(low+high)/2;
  }
  return angle;
}

// Euler角の±π境界と手動で上下反転した視点でも、直前に近い表現を選ぶ。
function angles(vector, reference) {
  const yaw = Math.atan2(vector[0], vector[2]), pitch = Math.asin(Math.max(-1, Math.min(1, vector[1])));
  return [[yaw, pitch], [yaw + Math.PI, Math.PI - pitch]]
    .map(([y,p]) => ({yaw:nearAngle(y,reference.yaw),pitch:nearAngle(p,reference.pitch)}))
    .sort((a,b) => Math.hypot(a.yaw-reference.yaw,a.pitch-reference.pitch)-Math.hypot(b.yaw-reference.yaw,b.pitch-reference.pitch))[0];
}

/** 中心を焦点とする楕円。遠点だけで次の反対側への接近角・軌道面を更新する。 */
export function createAutoOrbit(random = Math.random) {
  let leg = null, pausedUntil = -Infinity, start = null, elapsed = 0, path = null;
  let phase='idle',phaseTime=0,fromRoll=0;
  let folderNext=true;
  const between = (a,b) => a + (b-a)*random();
  function next(farDirection, distance, previousTangent, previousLeg, nearLimit = Infinity) {
    const horizontal = Math.hypot(farDirection[0],farDirection[2]) > 0.01
      ? unit(cross([0,1,0],farDirection)) : [1,0,0];
    const tangent = previousTangent
      ? unit(previousTangent.map((x,i)=>x-dot(previousTangent,farDirection)*farDirection[i])) : horizontal;
    // 初回は自然な軌道面を選び、次の面は船体位置を固定した視線軸回転で決める。
    const normal = unit(cross(farDirection,tangent)), tilt = previousLeg?0:between(-0.32,0.32);
    // 最接近を全景の約1/4まで縮め、半径1500の星々の内側を通過する。
    // 開始時に近点より近くにいた時は、近点をその内側へ取り直して、まず近づく区間を残す。
    const near = Math.min(distance*between(0.18,0.26), nearLimit), duration = between(48,64);
    // 次の楕円でも面積速度を引き継ぎ、遠点で急停止・急加速させない。
    const area = (distance+near)/2*Math.sqrt(distance*near);
    const previousArea = previousLeg && (previousLeg.referenceArea ?? (previousLeg.far+previousLeg.near)/2*Math.sqrt(previousLeg.far*previousLeg.near));
    return {u:farDirection,v:unit(tangent.map((x,i)=>x*Math.cos(tilt)+normal[i]*Math.sin(tilt))),entryTangent:tangent,
      far:distance,near,referenceArea:area,duration:previousLeg?previousLeg.duration*area/previousArea:duration,drift:between(-0.22,0.22),time:0};
  }
  function reset() { leg = null; start = null; elapsed = 0; path = null; phase='idle';phaseTime=0;fromRoll=0; }
  const normal=target=>unit(cross(target.u,target.v)).map(x=>x*(target.liftSign||1));
  function eyeAt(target,time) {
    const ground=position(target,time),height=Math.hypot(...ground)*(target.lift??LIFT),n=normal(target);
    return ground.map((x,i)=>-x+n[i]*height);
  }
  function alignEye(eye) {
    const toward=unit(eyeAt(leg,leg.time)),to=unit(eye),axis=cross(toward,to),sin=Math.hypot(...axis);
    if(sin>1e-9){
      const angle=Math.atan2(sin,dot(toward,to)),k=axis.map(x=>x/sin);
      for(const key of ['u','v','entryTangent'])leg[key]=rotate(leg[key],k,angle);
    }
  }
  // 軌道上の位置（中心からのベクトル）。時刻 time の位置を、step と同じ式で求める。
  function position(target, time) {
    const progress = time/target.duration;
    const a = (target.far+target.near)/2, e = (target.far-target.near)/(target.far+target.near);
    const phase = eccentricAnomaly(TAU*progress,e);
    const x = a*(Math.cos(phase)+e), y = a*Math.sqrt(1-e*e)*Math.sin(phase);
    // 軌道のランダムな向き変更は演出として別に補間し、遠点での接線を保つ。
    const drift = target.drift*(progress-Math.sin(TAU*progress)/TAU);
    // 軌道面は一周の間固定する。次の面への変更は遠点で機体を水平にしてから行う。
    const tangent = target.v;
    const dx = x*Math.cos(drift)-y*Math.sin(drift), dy = x*Math.sin(drift)+y*Math.cos(drift);
    return target.u.map((value,i)=>value*dx+tangent[i]*dy);
  }
  // 航行と同じ式で実座標を採り、軌道が決まった時だけ線を作り直す。
  function planPath() {
    path=Object.freeze(Array.from({length:385},(_,index)=>{
      const point=position(leg,leg.duration*index/384);
      return Object.freeze({x:-point[0],y:-point[1],z:-point[2]});
    }));
  }
  // 遠点の船体を固定したまま、フォルダ内の点を通る楕円を解析的に求める。
  function passFolder(folder,heldEye) {
    const axis=unit(heldEye),center=[folder.x,folder.y,folder.z],radius=Math.max(1,folder.R||160);
    // 一つのフォルダでも通過位置と進入側が固定されないよう、内部で少し振る。
    const offset=normal(leg),spread=between(-.3,.3)*radius,point=center.map((x,i)=>x+offset[i]*spread);
    let distance=Math.hypot(...point);
    if(distance<1){point[0]+=radius*.3;distance=Math.hypot(...point);}
    let toward=unit(point),cosine=dot(axis,toward);
    if(cosine>1-1e-8){for(let i=0;i<3;i++)point[i]+=leg.v[i]*radius*.3;distance=Math.hypot(...point);toward=unit(point);cosine=dot(axis,toward);}
    if(distance>=Math.hypot(...heldEye))return false;
    // 真反対にある小さな銀河にも届くよう、必要な場合だけ見下ろし高さを下げる。
    const angle=Math.acos(Math.max(-1,Math.min(1,cosine)));
    leg.lift=Math.min(LIFT,Math.tan((Math.PI-angle)/2)*.9);
    const scale=Math.hypot(1,leg.lift),far=Math.hypot(...heldEye)/scale,r=distance/scale;
    const cosTrue=Math.max(-1,Math.min(1,cosine*scale*scale-leg.lift*leg.lift));
    const e=Math.min(1-1e-10,Math.max(1e-10,(far-r)/(far-r*cosTrue)));
    // 通過用に楕円を細くしても周期の基準面積は保ち、交互選択で速度を累積変化させない。
    leg.far=far;leg.near=far*(1-e)/(1+e);leg.drift=0;
    alignEye(heldEye);
    const a=(far+leg.near)/2;
    let anomaly=Math.acos(Math.max(-1,Math.min(1,(r/a-1)/e)));
    if(random()<.5)anomaly=TAU-anomaly;
    const time=(anomaly+e*Math.sin(anomaly))/TAU*leg.duration;
    const from=unit(eyeAt(leg,time));
    const fromPlane=from.map((x,i)=>x-dot(from,axis)*axis[i]),toPlane=toward.map((x,i)=>x-cosine*axis[i]);
    const turn=Math.atan2(dot(axis,cross(fromPlane,toPlane)),dot(fromPlane,toPlane));
    for(const key of ['u','v','entryTangent'])leg[key]=rotate(leg[key],axis,turn);
    leg.folderPath=folder.path;
    return true;
  }
  // 再開時に遠ざからないよう、今の距離と同じ半径になる「近づいていく側」の地点から飛行を始める。
  // 船体の実位置と開始地点が重なるよう軌道を回し、出発前の旋回と移動を分ける。
  function begin(view, overview) {
    const eye=cameraPosition(view), radius=Math.hypot(eye.x,eye.y,eye.z);
    // 船の実位置から軌道を始める。注視点の座標を原点へ補間しない。
    const from=radius>1e-6?[-eye.x/radius,-eye.y/radius,-eye.z/radius]:direction(view);
    const groundRadius=radius/RADIAL_SCALE,far=Math.max(overview*1.15,radius*1.001)/RADIAL_SCALE;
    leg = next(from, far, null, null, Math.max(1,groundRadius*0.6));
    const up=[-Math.sin(view.yaw)*Math.sin(view.pitch),Math.cos(view.pitch),-Math.cos(view.yaw)*Math.sin(view.pitch)];
    leg.liftSign=dot(normal(leg),up)>=0?1:-1;
    const a = (leg.far+leg.near)/2, e = (leg.far-leg.near)/(leg.far+leg.near);
    // r = a(1 + e·cos E) を逆算して、現在の実座標と同じ半径から始める。
    const anomaly = Math.acos(Math.max(-1, Math.min(1, (Math.min(groundRadius, leg.far)/a - 1)/e)));
    leg.time = (anomaly + e*Math.sin(anomaly))/TAU*leg.duration;
    alignEye([eye.x,eye.y,eye.z]);
    planPath();
  }
  return {
    reset,
    resume() { pausedUntil = -Infinity; reset(); },
    interact(now) { pausedUntil = now + MANUAL_PAUSE_MS; reset(); },
    get pausedUntil() { return pausedUntil; },
    get path() { return path; },
    get phase() { return phase; },
    get target() { return leg?.folderPath??null; },
    get visibility() { return phase==='flying'?1:phase==='hiding'?Math.max(0,1-phaseTime/1.2):phase==='revealing'?Math.min(1,phaseTime/1.2):0; },
    step(now, dt, view, overview, blocked = false, folders = []) {
      if (blocked || now < pausedUntil) { reset(); return null; }
      const stepTime=Math.max(0,Math.min(dt,.25));
      if (!leg) { start = {...view}; begin(view, overview); phase='centering'; }
      // 再開時はその場で星系の中心へ向き直し、航行中も中心を見続ける。
      if(phase==='centering') {
        elapsed+=stepTime;
        const centered=turnToTarget(start,{x:0,y:0,z:0},Math.min(1,elapsed/1.1));
        if(elapsed>=1.1){phase='aligning';phaseTime=0;fromRoll=view.roll||0;}
        return {...centered,roll:view.roll||0};
      }
      const pose=()=>{const eye=eyeAt(leg,leg.time);return {...angles(unit(eye.map(x=>-x)),view),dist:Math.hypot(...eye),tx:0,ty:0,tz:0,roll:view.roll||0};};
      if(phase==='planning') {
        const heldEye=eyeAt(leg,leg.duration),liftSign=leg.liftSign;
        const farDirection=unit(position(leg,leg.duration));
        const tangent=leg.u.map((x,i)=>-x*Math.sin(leg.drift)+leg.v[i]*Math.cos(leg.drift));
        leg=next(farDirection,Math.hypot(...heldEye)/RADIAL_SCALE,tangent,leg);leg.liftSign=liftSign;alignEye(heldEye);
        const candidates=folders.filter(folder=>[folder.x,folder.y,folder.z].every(Number.isFinite)&&Math.hypot(folder.x,folder.y,folder.z)+(folder.R||160)<Math.hypot(...heldEye));
        let targeted=false;
        if(candidates.length){
          if(folderNext)targeted=passFolder(candidates[Math.min(candidates.length-1,Math.floor(random()*candidates.length))],heldEye);
          folderNext=!folderNext;
        }
        if(!targeted){
          // 視線軸の全周から選び、最短方向へ姿勢を合わせる。90度の上限は設けない。
          const turn=(random()<.5?-1:1)*between(0,Math.PI),axis=unit(heldEye.map(x=>-x));
          for(const key of ['u','v','entryTangent'])leg[key]=rotate(leg[key],axis,turn);
        }
        planPath();
        phase='aligning';phaseTime=0;fromRoll=view.roll||0;
        return pose();
      }
      if(phase==='hiding') {
        phaseTime+=stepTime;
        if(phaseTime>=1.2){phase='planning';phaseTime=0;path=null;}
        return pose();
      }
      if(phase==='aligning') {
        phaseTime+=stepTime;
        const centered=pose(),target=orbitLevelRoll(normal(leg),{...centered,roll:fromRoll});
        // 実際の角度変化の15%だけ行き過ぎ、同じ量を一度戻して静止する。
        const delta=target-fromRoll,overshoot=delta*ROLL_OVERSHOOT;
        centered.roll=phaseTime<2.7
          ?fromRoll+(delta+overshoot)*orbitTurnProgress(phaseTime/2.7,delta+overshoot)
          :target+overshoot*(1-orbitTurnProgress((phaseTime-2.7)/.9,overshoot));
        if(phaseTime>=3.6){centered.roll=target;phase='revealing';phaseTime=0;}
        return centered;
      }
      if(phase==='revealing') {
        phaseTime+=stepTime;
        if(phaseTime>=1.2){phase='flying';phaseTime=0;}
        return pose();
      }
      const seconds = Math.max(0, Math.min(dt,0.25)) / 3 * Math.hypot(1,leg.lift??LIFT);
      const eccentricity = (leg.far-leg.near)/(leg.far+leg.near);
      const currentPhase = eccentricAnomaly(TAU*leg.time/leg.duration,eccentricity);
      // 速度差を圧縮して加速感を残す。遠点は1/3速、近点は従来の1/6速でも、
      // 接近中の実速度は単調に増え、近点直前で減速へ転じない。
      const radius = (leg.far+leg.near)/2 * (1+eccentricity*Math.cos(currentPhase));
      const inverseA = 2/(leg.far+leg.near);
      const speedRatio = Math.sqrt((2/radius-inverseA)/(2/leg.far-inverseA));
      const nearSpeed = Math.pow(speedRatio,-Math.log(2)/Math.log(leg.far/leg.near));
      leg.time += seconds * nearSpeed;
      if (leg.time >= leg.duration) {
        leg.time=leg.duration;phase='hiding';phaseTime=0;
      }
      const centered=pose();
      centered.roll=orbitLevelRoll(normal(leg),centered);
      return centered;
    },
  };
}
