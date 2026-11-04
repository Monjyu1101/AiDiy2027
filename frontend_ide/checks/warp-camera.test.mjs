// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraPosition,turnToTarget,cameraAt,interpolateCamera,cockpitLook,orbitAround,interpolateOrbit} from '../src/components/開発スペース/ワープ視点.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const target={x:1200,y:-600,z:350};
for(const pitch of [.35,Math.PI+0.2,-Math.PI*2-.4])test(`旋回中の船体位置を固定し、完了後の前進は目的地への直線になる: ${pitch}`,()=>{
  const from={tx:200,ty:100,tz:-80,dist:4000,yaw:Math.PI*2+0.6,pitch};
  const eye=cameraPosition(from);
  for(const t of [0,.1,.5,.9,1]){
    const view=turnToTarget(from,target,t),position=cameraPosition(view);
    for(const key of ['x','y','z'])near(position[key],eye[key]);
    if(t<1)near(view.dist,from.dist);
    assert.ok(Math.abs(view.yaw-from.yaw)<=Math.PI);
    assert.ok(Math.abs(view.pitch-from.pitch)<=Math.PI);
  }
  const facing=turnToTarget(from,target,1);
  near(facing.tx,target.x);near(facing.ty,target.y);near(facing.tz,target.z);
  // 実際の描画座標式でも、目的地が正面（横・縦とも0）にあることを確認。
  const dx=target.x-eye.x,dy=target.y-eye.y,dz=target.z-eye.z;
  near(dx*Math.cos(facing.yaw)-dz*Math.sin(facing.yaw),0);
  near(dy*Math.cos(facing.pitch)-(dx*Math.sin(facing.yaw)+dz*Math.cos(facing.yaw))*Math.sin(facing.pitch),0);
  const halfway=cameraPosition({...facing,dist:facing.dist/2});
  for(const key of ['x','y','z'])near(halfway[key],(eye[key]+target[key])/2);
});
test('目的地と船体が同位置でも有限値を維持する',()=>{
  const from={tx:0,ty:0,tz:0,dist:100,yaw:0,pitch:0};
  assert.deepEqual(turnToTarget(from,cameraPosition(from),1),from);
});

test('航行旋回の補間中も船体位置は固定され、ズームは船首方向の直線を進む',()=>{
  const from={tx:500,ty:-300,tz:200,dist:4000,yaw:7,pitch:3.5}, eye=cameraPosition(from);
  const rotated=cameraAt(eye,{...from,yaw:from.yaw+.5,pitch:from.pitch-.2});
  for(const t of [.01,.25,.5,1]) {
    const view=interpolateCamera(from,rotated,t);
    for(const key of ['x','y','z'])near(cameraPosition(view)[key],eye[key]);
  }
  const to={...rotated,dist:rotated.dist/2};
  const end=cameraPosition(to), midway=cameraPosition(interpolateCamera(rotated,to,.5));
  const delta=Object.keys(eye).map(key=>end[key]-eye[key]);
  const moved=Object.keys(eye).map(key=>midway[key]-eye[key]);
  near(Math.hypot(delta[1]*moved[2]-delta[2]*moved[1],delta[2]*moved[0]-delta[0]*moved[2],delta[0]*moved[1]-delta[1]*moved[0]),0);
});

test('パネルの中央調整は平行移動ではなく視線の回転で、角度と距離を保存する',()=>{
  for(const [x,y] of [[0,0],[-300,10],[160,-220]]) {
    const look=cockpitLook(x,y,800), ahead=look(0,0,1);
    near(ahead[0]/ahead[2]*800,x);near(-ahead[1]/ahead[2]*800,y);
    const a=[1,2,3], b=[-4,5,6], ar=look(...a),br=look(...b);
    near(Math.hypot(...ar),Math.hypot(...a));
    near(ar.reduce((sum,v,i)=>sum+v*br[i],0),a.reduce((sum,v,i)=>sum+v*b[i],0));
  }
});

test('ドラッグは中心星を周回し、その後の航行は回り込んだ船体位置から旋回する',()=>{
  const pivot={x:100,y:-200,z:300};
  const from={tx:100,ty:-200,tz:300,dist:2500,yaw:.6,pitch:.3};
  let view={...from};
  for(let i=0;i<20;i++) {
    view=orbitAround(view,pivot,.025,-.01);
    const eye=cameraPosition(view);
    near(Math.hypot(eye.x-pivot.x,eye.y-pivot.y,eye.z-pivot.z),2500);
    near(view.tx,pivot.x);near(view.ty,pivot.y);near(view.tz,pivot.z);
  }
  const departure=cameraPosition(view);
  assert.ok(Math.hypot(...['x','y','z'].map(key=>departure[key]-cameraPosition(from)[key]))>100);
  for(const progress of [0,.2,.5,1]) {
    const turned=turnToTarget(view,target,progress);
    for(const key of ['x','y','z'])near(cameraPosition(turned)[key],departure[key]);
  }
});

// space.js と同じ透視投影で確認する。カメラのyawの増減と、星が画面を動く方向は区別する。
function project(view,point,look=cockpitLook(0,0,800)) {
  const x=point.x-view.tx,y=point.y-view.ty,z=point.z-view.tz;
  const right=x*Math.cos(view.yaw)-z*Math.sin(view.yaw),ahead=x*Math.sin(view.yaw)+z*Math.cos(view.yaw);
  const up=y*Math.cos(view.pitch)-ahead*Math.sin(view.pitch),depth=y*Math.sin(view.pitch)+ahead*Math.cos(view.pitch)+view.dist;
  const roll=view.roll||0,[rx,ry,rz]=look(right*Math.cos(roll)+up*Math.sin(roll),-right*Math.sin(roll)+up*Math.cos(roll),depth);
  return [800*rx/rz,-800*ry/rz,rz];
}
const pivot={x:150,y:-230,z:80};
for(const pitch of [0,.8,Math.PI/2-1e-7,Math.PI/2,Math.PI/2+1e-7,Math.PI+.3,-Math.PI*2-.4]) {
  for(const roll of [0,Math.PI/2,Math.PI,-Math.PI/2,7.5]) {
    test(`球をつかむドラッグ: pitch=${pitch}, roll=${roll}でも前側の星が画面の指と同方向へ動く`,()=>{
      for(const yaw of [-7,0,2.4])for(const [ox,oy] of [[0,0],[-240,-180]])for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1]]){
        const from={tx:pivot.x,ty:pivot.y,tz:pivot.z,dist:2500,yaw,pitch,roll},eye=cameraPosition(from);
        const front=Object.fromEntries(['x','y','z'].map(key=>[key,pivot[key]+(eye[key]-pivot[key])*.3]));
        const look=cockpitLook(ox,oy,800),before=project(from,front,look),center=project(from,pivot,look);
        const end=orbitAround(from,pivot,dx*.06,-dy*.06,look);
        for(const amount of [.01,.2,.5,1]) {
          const view=interpolateOrbit(from,end,pivot,amount),screen=project(view,front,look),anchored=project(view,pivot,look),position=cameraPosition(view);
          if(dx)assert.ok((screen[0]-before[0])*dx>0,'前側の星の左右がドラッグと一致する');
          if(dy)assert.ok((screen[1]-before[1])*dy>0,'前側の星の上下がドラッグと一致する');
          for(let n=0;n<3;n++)near(anchored[n],center[n]);
          near(Math.hypot(position.x-pivot.x,position.y-pivot.y,position.z-pivot.z),2500);
          near(view.dist,from.dist);
          if(amount===1)for(let n=0;n<3;n++)near(screen[n],project(end,front,look)[n]);
        }
      }
    });
  }
}

test('周回は注視点と別の中心にも使え、連続・逆方向のドラッグとロール境界で中心や距離が漂わない',()=>{
  const from={tx:300,ty:20,tz:-40,dist:3000,yaw:6.2,pitch:1.4,roll:3.1};
  const look=cockpitLook(-220,100,800),center=project(from,pivot,look),start=cameraPosition(from);
  let view={...from};
  for(let n=0;n<120;n++){
    const end=orbitAround(view,pivot,-.06,.02,look);
    let eased={...view};
    for(let frame=0;frame<80;frame++)eased=interpolateOrbit(eased,end,pivot,.3);
    for(let i=0;i<3;i++)near(project(eased,pivot,look)[i],center[i]);
    const eye=cameraPosition(eased);
    near(Math.hypot(eye.x-pivot.x,eye.y-pivot.y,eye.z-pivot.z),Math.hypot(start.x-pivot.x,start.y-pivot.y,start.z-pivot.z));
    for(const key of ['x','y','z'])near(eye[key],cameraPosition(end)[key]);
    view=end;
  }
  for(let n=0;n<120;n++)view=orbitAround(view,pivot,.06,-.02,look);
  for(const key of ['x','y','z'])near(cameraPosition(view)[key],start[key]);
  for(const point of [pivot,target])for(let n=0;n<3;n++)near(project(view,point,look)[n],project(from,point,look)[n]);
});
