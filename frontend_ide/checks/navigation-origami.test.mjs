// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {兜の手順を作る,折り鶴の手順を作る,折り紙を選ぶ,紙面積,折り途中,折線回転,再生状態を作る,再生を進める,角度差} from '../src/components/開発スペース/ナビ折り紙3D.js';
const steps=兜の手順を作る(),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('全工程で同じ一枚（面積2）を保持し、折りの途中も各辺長と折線上の位置を保つ',()=>{
  for(const s of steps){
    if(!s.op){near(s.faces.reduce((n,f)=>n+紙面積(f.points),0),2);continue;}
    const op=s.op;
    for(const t of [0,.1,.35,.5,.75,1]){
      const faces=折り途中(op,t);near(faces.reduce((n,f)=>n+紙面積(f.points),0),2);
      faces.forEach((f,i)=>f.points.forEach((p,j)=>{
        assert.ok(p.every(Number.isFinite));const k=(j+1)%f.points.length;
        near(Math.hypot(...p.map((v,n)=>v-f.points[k][n])),Math.hypot(...op.parts[i].points[j].map((v,n)=>v-op.parts[i].points[k][n])));
      }));
      for(const p of op.hinge)折線回転(p,op.a,op.b,op.angle*t).forEach((n,k)=>near(n,p[k]));
    }
  }
});
test('開き戻しは同じ操作を逆再生し、中心線と角飾りの予備折りを見せる',()=>{
  const returns=steps.filter(s=>s.reverse);assert.equal(returns.length,2);
  for(const s of returns){const i=steps.indexOf(s);assert.equal(s.op,steps[i-1].op);assert.deepEqual(折り途中(s.op,0).map(f=>f.points),s.op.parts.map(f=>f.points));}
});
test('下の手前と奥を別々に折り、角飾りを巻き込まない',()=>{
  for(const i of [12,13,14]){
    const moving=steps[i].op.parts.filter(f=>f.moving);assert.ok(moving.length);
    assert.ok(moving.every(f=>!f.tags.includes('left')&&!f.tags.includes('right')));
    assert.ok(moving.every(f=>f.tags.includes('front')===(i!==14)));
  }
});
test('経過時間だけでは折らない。視点到着後の静止と折線の予告を経て折り始める',()=>{
  const s=再生状態を作る(steps,14);s.yaw=0;s.elapsed=999;
  再生を進める(s,steps,100);assert.equal(s.phase,'align');assert.equal(s.amount,0);
  for(let n=0;n<2000&&s.phase==='align';n++){assert.equal(s.amount,0);再生を進める(s,steps,.02);}
  assert.equal(s.phase,'guide');assert.ok(Math.abs(角度差(s.yaw,steps[14].view))<.012);assert.ok(s.stable>=.65);
  const yaw=s.yaw;for(let n=0;n<79;n++)再生を進める(s,steps,.02);assert.equal(s.amount,0);
  while(s.phase!=='hold')再生を進める(s,steps,.02);
  assert.equal(s.yaw,yaw);near(s.amount,1);
});
test('全工程が停止せず完成へ進み、戻しは1から0へ、次の作品で最初へ戻る',()=>{
  const s=再生状態を作る(steps),seen=new Set();let finished=false;
  for(let i=0;i<30000;i++){
    const before=s.index;seen.add(before);if(before===steps.length-1)finished=true;
    再生を進める(s,steps,.05);assert.ok(s.amount>=0&&s.amount<=1);
    if(s.index!==before)near(s.amount,steps[s.index].reverse?1:0);
    if(finished&&s.index===0)break;
  }
  assert.equal(seen.size,steps.length);assert.equal(finished,true);assert.equal(s.index,0);
});
test('兜と折り鶴を同じ確率で選び、作品ごとに独立した手順を返す',()=>{
  assert.equal(折り紙を選ぶ(()=>0).id,'kabuto');assert.equal(折り紙を選ぶ(()=>.4999).id,'kabuto');
  assert.equal(折り紙を選ぶ(()=>.5).id,'crane');assert.equal(折り紙を選ぶ(()=>.9999).id,'crane');
  assert.notEqual(折り紙を選ぶ(()=>.7).steps,折り紙を選ぶ(()=>.7).steps);
});
test('折り鶴の袋・花弁を含む全工程で面積・辺長を保ち、連動中の共有頂点を離さない',()=>{
  for(const s of 折り鶴の手順を作る()){
    if(!s.op){near(s.faces.reduce((n,f)=>n+紙面積(f.points),0),2);continue;}
    for(const t of [0,.01,.1,.3,.5,.75,.99,1]){
      const faces=折り途中(s.op,t),vertices=new Map();near(faces.reduce((n,f)=>n+紙面積(f.points),0),2);
      faces.forEach((f,i)=>f.points.forEach((p,j)=>{
        assert.ok(p.every(Number.isFinite));const next=(j+1)%f.points.length,original=s.op.parts[i].points;
        near(Math.hypot(...p.map((v,k)=>v-f.points[next][k])),Math.hypot(...original[j].map((v,k)=>v-original[next][k])));
        if(s.op.sample){const key=f.keys[j];if(vertices.has(key))p.forEach((v,k)=>near(v,vertices.get(key)[k]));vertices.set(key,p);}
      }));
    }
  }
});
test('折り鶴は予備折りと戻しを経て、左右の首尾と前後の翼がある立体で完成する',()=>{
  const crane=折り鶴の手順を作る();assert.ok(crane.filter(s=>s.reverse).length>=8);
  const points=crane.at(-1).faces.flatMap(f=>f.points);
  assert.ok(points.some(p=>p[0]<-.4&&p[1]>.05));assert.ok(points.some(p=>p[0]>.45&&p[1]>.05));
  assert.ok(points.some(p=>p[2]>.35));assert.ok(points.some(p=>p[2]<-.35));
  const s=再生状態を作る(crane);let complete=false;
  for(let i=0;i<40000;i++){再生を進める(s,crane,.05);if(s.index===crane.length-1)complete=true;if(complete&&s.index===0)break;}
  assert.equal(complete,true);assert.equal(s.index,0);
});
