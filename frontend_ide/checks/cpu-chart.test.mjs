// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {chartSeries,placeLabels,chartRight,labelRight,labelMaxWidth,labelGap} from '../src/components/システム監視/使用率グラフ.js';
import {createRequire} from 'node:module';
const {windowBounds,windowMinimumSize}=createRequire(import.meta.url)('../デスクトップ/window-layout.cjs');
test('unknown samples create gaps instead of zero load',()=>{
 const [cpu,gpu,ram]=chartSeries([{cpu:40,gpu:null,ram:55},{cpu:null,gpu:null,ram:56},{cpu:60,gpu:null,ram:57}]);
 assert.equal(cpu.line.match(/M/g).length,2);assert.equal(gpu.value,null);assert.equal(gpu.line,'');assert.equal(ram.value,57);assert.match(cpu.area,/Z/);
});
test('values must be finite percentages and history is bounded',()=>{
 for(const value of [null,undefined,'50',NaN,Infinity,-1,101])assert.equal(chartSeries([{cpu:value}])[0].value,null);
 const cpu=chartSeries(Array.from({length:100},()=>({cpu:0})))[0];assert.equal(cpu.value,0);assert.equal(cpu.line.match(/L/g).length,59);assert.match(cpu.line,/^M22.00/);
});
test('labels stay at newest point and separate ties within graph',()=>{
 const series=chartSeries([{cpu:50,gpu:50,ram:50}]);for(const item of series)assert.match(item.line,/M202.00 52.00/);
 for(const value of [0,50,100,null]){const labels=placeLabels(chartSeries([{cpu:value,gpu:value,ram:value}]));assert.ok(labels[0].labelY>=14);assert.ok(labels[2].labelY<=92);assert.ok(labels[1].labelY-labels[0].labelY>=14);assert.ok(labels[2].labelY-labels[1].labelY>=14);}
});
test('small CPU window fits work area including small/negative displays',()=>{
 for(const area of [{x:0,y:0,width:1920,height:1080},{x:-800,y:100,width:320,height:200}]){const b=windowBounds('cpu',area);assert.ok(b.width<=240&&b.height<=160);assert.ok(b.x>=area.x&&b.y>=area.y);assert.ok(b.x+b.width<=area.x+area.width);assert.ok(b.y+b.height<=area.y+area.height);const min=windowMinimumSize('cpu',b);assert.ok(min.minWidth<=b.width&&min.minHeight<=b.height);}
});

test('CPU initial dimensions are 240 by 160 with readable minimum size',()=>{
 const b=windowBounds('cpu',{x:0,y:0,width:1920,height:1080});
 assert.equal(b.width,240);assert.equal(b.height,160);
 assert.deepEqual(windowMinimumSize('cpu',b),{minWidth:240,minHeight:150});
});

test('CPU uses a fixed offset from the work area bottom right and fits small displays',()=>{
 for(const area of [{x:0,y:0,width:1920,height:1080},{x:-1920,y:40,width:1920,height:1040}]){
  const b=windowBounds('cpu',area);
  assert.equal(b.x+b.width,area.x+area.width-8);
  assert.equal(area.y+area.height-(b.y+b.height),8+270+8);
 }
 for(const area of [{x:0,y:0,width:280,height:180},{x:-300,y:-200,width:180,height:120}]){
  const b=windowBounds('cpu',area);assert.equal(b.y,area.y+8);
  assert.ok(b.x>=area.x&&b.x+b.width<=area.x+area.width);
  assert.ok(b.y+b.height<=area.y+area.height);
 }
});

test('graph expands only into spare space, leaving labels outside at every viewport size',()=>{
 const samples=Array.from({length:60},(_,i)=>({cpu:i,gpu:i===30?null:100-i,ram:50}));
 for(const item of chartSeries(samples)){
  const points=[...item.line.matchAll(/[ML]([0-9.]+) ([0-9.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
  assert.equal(points[0][0],22);assert.equal(points.at(-1)[0],chartRight);
  for(const [width,height] of [[240,160],[240,150],[480,300],[180,120]]){
   const scaleX=(width-4)/264,scaleY=(height-2)/100;
   assert.equal(points.at(-1)[0]*scaleX,chartRight*scaleX);
   assert.ok(points.every(([x,y])=>x*scaleX>=0&&x*scaleX<width&&y*scaleY>=0&&y*scaleY<height));
   assert.ok((points.at(-1)[0]-points[0][0])*scaleX>170*scaleX,'previous reserved label column is now graph');
  }
 }
 assert.equal(chartSeries(samples)[1].line.match(/M/g).length,2);
 assert.equal(chartSeries([...samples,{cpu:0,gpu:null,ram:100}])[1].value,null);
});

test('label column and graph do not overlap, including 100 percent and unavailable GPU',()=>{
 assert.equal(chartRight,202);assert.equal(labelRight,262);assert.ok(chartRight>192);
 for(const value of [0,9,10,99,100,null]){
  const all=chartSeries([{cpu:value,gpu:value,ram:value}]);
  const labels=placeLabels(all.filter(item=>item.key!=='gpu'||item.value!==null));
  for(const [width,height] of [[240,160],[240,150],[480,300],[180,120]]){
   const sx=(width-4)/264,sy=(height-2)/100;
   for(const item of labels){
    const text=item.key.toUpperCase()+' '+(item.value===null?'—':Math.round(item.value)+'%');
    const textWidth=text.length*6.6;
    assert.ok(textWidth<=labelMaxWidth);
    assert.ok((labelRight-(labelMaxWidth+textWidth)/2-chartRight)*sx>=labelGap*sx);
    assert.ok(labelRight*sx<width);
   }
   for(let i=1;i<labels.length;i++)assert.ok((labels[i].labelY-labels[i-1].labelY)*sy>11*sy);
  }
  if(value===null)assert.equal(labels.some(item=>item.key==='gpu'),false);
 }
});
