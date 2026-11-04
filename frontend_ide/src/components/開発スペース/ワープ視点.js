// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

const forward = ({yaw,pitch}) => ({x:Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:Math.cos(yaw)*Math.cos(pitch)});
const nearAngle = (angle,reference) => reference+Math.atan2(Math.sin(angle-reference),Math.cos(angle-reference));
const dot = (a,b) => a.x*b.x+a.y*b.y+a.z*b.z;
const rotate = (v,k,angle) => {
  const c=Math.cos(angle),s=Math.sin(angle),d=dot(k,v)*(1-c);
  return {x:v.x*c+(k.y*v.z-k.z*v.y)*s+k.x*d,
    y:v.y*c+(k.z*v.x-k.x*v.z)*s+k.y*d,z:v.z*c+(k.x*v.y-k.y*v.x)*s+k.z*d};
};
function cameraAxes(view) {
  const cy=Math.cos(view.yaw),sy=Math.sin(view.yaw),cp=Math.cos(view.pitch),sp=Math.sin(view.pitch);
  const cr=Math.cos(view.roll||0),sr=Math.sin(view.roll||0);
  return {right:{x:cy*cr-sy*sp*sr,y:cp*sr,z:-sy*cr-cy*sp*sr},
    up:{x:-cy*sr-sy*sp*cr,y:cp*cr,z:sy*sr-cy*sp*cr},forward:forward(view)};
}

// 同じ剛体回転を船体と視線に適用する。中心星の投影位置と周回距離は変えない。
function rotateOrbit(view,pivot,axis,angle) {
  if(Math.abs(angle)<1e-12)return {...view};
  const eye=cameraPosition(view),axes=cameraAxes(view);
  const facing=rotate(axes.forward,axis,angle),up=rotate(axes.up,axis,angle);
  const yaw=Math.hypot(facing.x,facing.z)<1e-10?view.yaw:Math.atan2(facing.x,facing.z);
  const pitch=Math.atan2(facing.y,Math.hypot(facing.x,facing.z));
  const next=[[yaw,pitch],[yaw+Math.PI,Math.PI-pitch]].map(([y,p])=>{
    const aim={...view,yaw:nearAngle(y,view.yaw),pitch:nearAngle(p,view.pitch),roll:0};
    const basis=cameraAxes(aim);
    aim.roll=nearAngle(Math.atan2(-dot(up,basis.right),dot(up,basis.up)),view.roll||0);
    return aim;
  }).sort((a,b)=>Math.hypot(a.yaw-view.yaw,a.pitch-view.pitch,a.roll-(view.roll||0))-
    Math.hypot(b.yaw-view.yaw,b.pitch-view.pitch,b.roll-(view.roll||0)))[0];
  const offset=rotate({x:eye.x-pivot.x,y:eye.y-pivot.y,z:eye.z-pivot.z},axis,angle);
  return cameraAt({x:pivot.x+offset.x,y:pivot.y+offset.y,z:pivot.z+offset.z},next);
}

export const WARP_APPROACH_WIDTH = 0.25;
export const WARP_PEAK_WIDTH = 0.5;

/** 中心の天体を画面幅の指定比率に収める距離。操縦席の見回しによる奥行きの減少も補正する。 */
export function framingDistance(diameter, width, focal, offsetX = 0, offsetY = 0, fraction = WARP_APPROACH_WIDTH) {
  return diameter * Math.hypot(focal, offsetX, offsetY) / (width * fraction);
}

/** 注視点と距離で表しているカメラの、実際の宇宙内の位置。 */
export function cameraPosition(view) {
  const direction=forward(view);
  return {x:view.tx-direction.x*view.dist,y:view.ty-direction.y*view.dist,z:view.tz-direction.z*view.dist};
}

/** 実座標と船首方向から、既存描画用の注視点表現を作る。 */
export function cameraAt(position, view) {
  const direction = forward(view);
  return {...view, tx:position.x+direction.x*view.dist, ty:position.y+direction.y*view.dist, tz:position.z+direction.z*view.dist};
}

/** 手動ドラッグ: 現在の画面の上下・左右を軸に、中心星の球をつかんで回す。 */
export function orbitAround(view, pivot, horizontal, vertical, look = (x,y,z) => [x,y,z]) {
  const angle=Math.hypot(horizontal,vertical);
  if(angle<1e-12)return {...view};
  const axes=cameraAxes(view),local=[look(1,0,0),look(0,1,0),look(0,0,1)]
    .map(v=>(-vertical*v[0]+horizontal*v[1])/angle);
  const axis=Object.fromEntries(['x','y','z'].map(key=>[key,
    axes.right[key]*local[0]+axes.up[key]*local[1]+axes.forward[key]*local[2]]));
  return rotateOrbit(view,pivot,axis,angle);
}

/** 手動周回の追従。Euler角を個別に補間せず、極やロール境界も最短の回転でつなぐ。 */
export function interpolateOrbit(from, to, pivot, amount) {
  const quaternion=view=>{
    const cy=Math.cos(view.yaw/2),sy=Math.sin(view.yaw/2),cp=Math.cos(view.pitch/2),sp=Math.sin(view.pitch/2);
    const cr=Math.cos((view.roll||0)/2),sr=Math.sin((view.roll||0)/2);
    return [-cy*sp*cr+sy*cp*sr,sy*cp*cr+cy*sp*sr,cy*cp*sr+sy*sp*cr,cy*cp*cr-sy*sp*sr];
  };
  const [x,y,z,w]=quaternion(to),[a,b,c,d]=quaternion(from);
  let delta=[-w*a+x*d-y*c+z*b,-w*b+x*c+y*d-z*a,-w*c-x*b+y*a+z*d,w*d+x*a+y*b+z*c];
  if(delta[3]<0)delta=delta.map(value=>-value);
  const length=Math.hypot(...delta.slice(0,3));
  if(length<1e-12)return {...from};
  return rotateOrbit(from,pivot,{x:delta[0]/length,y:delta[1]/length,z:delta[2]/length},
    2*Math.atan2(length,delta[3])*amount);
}

/** 注視点同士を補間すると旋回中に船が弧を描くため、実座標を補間する。 */
export function interpolateCamera(from, to, amount) {
  const a=cameraPosition(from), b=cameraPosition(to);
  const view={...from, yaw:from.yaw+(to.yaw-from.yaw)*amount, pitch:from.pitch+(to.pitch-from.pitch)*amount,
    dist:from.dist+(to.dist-from.dist)*amount};
  return cameraAt({x:a.x+(b.x-a.x)*amount,y:a.y+(b.y-a.y)*amount,z:a.z+(b.z-a.z)*amount},view);
}

/** パネルの空き領域へ視線だけを振る。投影面の平行移動や船体の移動はしない。 */
export function cockpitLook(x, y, focal) {
  const pitch=Math.atan2(y,focal), yaw=-Math.atan(x/focal*Math.cos(pitch));
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  return (x,y,z) => {
    const right=x*cy-z*sy, ahead=x*sy+z*cy;
    return [right,y*cp-ahead*sp,y*sp+ahead*cp];
  };
}

/** 船体の位置を固定して旋回する。旋回完了時だけ目的地基準へ表現を変え、その後は距離だけで前進できる。 */
export function turnToTarget(from,target,progress) {
  const eye=cameraPosition(from),dx=target.x-eye.x,dy=target.y-eye.y,dz=target.z-eye.z;
  const distance=Math.hypot(dx,dy,dz);
  if(distance<1e-6)return {...from};
  const yaw=Math.atan2(dx,dz),pitch=Math.atan2(dy,Math.hypot(dx,dz));
  // 上下反転している時も、最も近い角度表現で旋回し、境界で一周しない。
  const aim=[[yaw,pitch],[yaw+Math.PI,Math.PI-pitch]]
    .map(([y,p])=>({yaw:nearAngle(y,from.yaw),pitch:nearAngle(p,from.pitch)}))
    .sort((a,b)=>Math.hypot(a.yaw-from.yaw,a.pitch-from.pitch)-Math.hypot(b.yaw-from.yaw,b.pitch-from.pitch))[0];
  const t=Math.max(0,Math.min(1,progress)),ease=t*t*(3-2*t);
  const view={...from,yaw:from.yaw+(aim.yaw-from.yaw)*ease,pitch:from.pitch+(aim.pitch-from.pitch)*ease};
  const direction=forward(view);
  if(t===1)return {...view,tx:target.x,ty:target.y,tz:target.z,dist:distance};
  return {...view,tx:eye.x+direction.x*view.dist,ty:eye.y+direction.y*view.dist,tz:eye.z+direction.z*view.dist};
}
