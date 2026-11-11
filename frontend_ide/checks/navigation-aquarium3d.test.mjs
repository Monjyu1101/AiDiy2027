// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ナビアクアリウム3D状態を作成} from '../src/components/開発スペース/ナビアクアリウム3D状態.js';

test('3D水槽: 魚の大小差と3種類・24匹を保ち、元サイズの半分にする',()=>{
  for(const sample of [0,.5,1]){
    const a=ナビアクアリウム3D状態を作成(()=>sample);
    assert.equal(a.fish.length,24);
    assert.deepEqual([...new Set(a.fish.map(f=>f.species))],[0,1,2]);
    assert.ok(a.fish.every(f=>Math.abs(f.size-(.65+sample*.5)*.5)<1e-12));
    a.clear();
  }
});

test('3D水槽: 餌は水面から落ち、連打上限・寿命・不正入力を守る',()=>{
  const a=ナビアクアリウム3D状態を作成(()=>.5);a.fish.length=0;
  a.feed(2);assert.equal(a.food.length,4);assert.ok(a.food.every(p=>p.x===2&&p.y===4.85&&p.z===0));
  a.step(.05);assert.ok(a.food.every(p=>p.y<4.85));
  a.feed(NaN);a.feed(Infinity);assert.equal(a.food.length,4);
  for(let i=0;i<100;i++)a.feed(100);assert.equal(a.food.length,64);assert.ok(a.food.every(p=>p.x<=7));
  for(let i=0;i<400;i++)a.step(.05);assert.equal(a.food.length,0);
});
test('3D水槽: 奥行きの違う餌へ泳ぎ、食後の待機は個体ごとの実時間15秒',()=>{
  let now=0;const a=ナビアクアリウム3D状態を作成(()=>.5,()=>now);a.fish.splice(1);
  const f=a.fish[0];Object.assign(f,{x:0,y:0,z:2,vx:0,vy:0,vz:0});
  a.food.push({x:0,y:0,z:0,age:0,speed:0,drift:0});a.step(.05);assert.ok(f.vz<0);
  f.z=0;a.step(.05);assert.equal(a.food.length,0);assert.equal(f.foodReadyAt,15000);
  const nearby=()=>a.food.push({x:f.x,y:f.y,z:f.z,age:0,speed:0,drift:0});
  nearby();now=14999;a.step(.05);assert.equal(a.food.length,1);
  Object.assign(a.food[0],{x:f.x,y:f.y,z:f.z});now=15000;a.step(.05);assert.equal(a.food.length,0);assert.equal(f.foodReadyAt,30000);
});
test('3D水槽: 見えている位置で回避を優先し、満腹でも逃げる',()=>{
  const a=ナビアクアリウム3D状態を作成(()=>.5);a.fish.splice(1);const f=a.fish[0];
  Object.assign(f,{x:.3,y:0,z:2,vx:0,vy:0,vz:0,foodReadyAt:Infinity});
  a.setPointer({x:0,y:0});a.food.push({x:0,y:0,z:2,age:0,speed:0,drift:0});
  a.step(.05);assert.ok(f.x>.3);assert.equal(a.food.length,1);
  a.setPointer(null);const count=a.bubbles.length;a.step(.05);assert.equal(a.bubbles.length,count);
});
test('3D水槽: ホバー泡は静止中も発生し、移動連打で増えず、離脱後に消える',()=>{
  const a=ナビアクアリウム3D状態を作成(()=>.5);a.fish.length=0;a.setPointer({x:1,y:-2});a.step(.05);
  assert.equal(a.bubbles.length,1);const b=a.bubbles[0];a.step(.05);assert.ok(b.y>-2);
  for(let i=0;i<50;i++)a.setPointer({x:2,y:1});a.step(.05);assert.equal(a.bubbles.length,1);
  for(let i=0;i<14;i++)a.step(.05);assert.ok(a.bubbles.some(b=>Math.abs(b.x-2)<.04));
  for(let i=0;i<100;i++){a.setPointer(null);a.setPointer({x:0,y:-4});a.step(.01);}assert.ok(a.bubbles.length<=32);
  a.setPointer({x:NaN,y:0});for(let i=0;i<170;i++)a.step(.05);assert.equal(a.bubbles.length,0);
});
test('3D水槽: 狭い窓・長時間遊泳・ゼロ時間・破棄で位置や個数が壊れない',()=>{
  let seed=123;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  const a=ナビアクアリウム3D状態を作成(random);a.resize(3);
  const before=JSON.stringify(a.fish);a.step(NaN);a.step(-1);a.step(0);a.resize(Infinity);assert.equal(JSON.stringify(a.fish),before);
  for(let i=0;i<3000;i++){if(i%100===0)a.feed(0);a.step(.05);}
  assert.equal(a.fish.length,24);
  for(const f of a.fish){assert.ok(Number.isFinite(f.x+f.y+f.z+f.vx+f.vy+f.vz));assert.ok(Math.abs(f.x)<=1.15&&f.y>=-3.5&&f.y<=4.65&&Math.abs(f.z)<=3);}
  a.clear();assert.equal(a.fish.length+a.food.length+a.bubbles.length,0);
});
