// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {chartSeries,placeLabels} from '../src/components/システム監視/使用率グラフ.js';
import {createRequire} from 'node:module';
const {windowBounds,windowMinimumSize}=createRequire(import.meta.url)('../デスクトップ/window-layout.cjs');
test('unknown samples create gaps instead of zero load',()=>{
 const [cpu,gpu,ram]=chartSeries([{cpu:40,gpu:null,ram:55},{cpu:null,gpu:null,ram:56},{cpu:60,gpu:null,ram:57}]);
 assert.equal(cpu.line.match(/M/g).length,2);assert.equal(gpu.value,null);assert.equal(gpu.line,'');assert.equal(ram.value,57);assert.match(cpu.area,/Z/);
});
test('values must be finite percentages and history is bounded',()=>{
 for(const value of [null,undefined,'50',NaN,Infinity,-1,101])assert.equal(chartSeries([{cpu:value}])[0].value,null);
 const cpu=chartSeries(Array.from({length:100},()=>({cpu:0})))[0];assert.equal(cpu.value,0);assert.equal(cpu.line.match(/L/g).length,59);assert.match(cpu.line,/^M28.00/);
});
test('labels stay at newest point and separate ties within graph',()=>{
 const series=chartSeries([{cpu:50,gpu:50,ram:50}]);for(const item of series)assert.match(item.line,/M350.00 88.00/);
 for(const value of [0,50,100,null]){const labels=placeLabels(chartSeries([{cpu:value,gpu:value,ram:value}]));assert.ok(labels[0].labelY>=20);assert.ok(labels[2].labelY<=156);assert.ok(labels[1].labelY-labels[0].labelY>=18);assert.ok(labels[2].labelY-labels[1].labelY>=18);}
});
test('small CPU window fits work area including small/negative displays',()=>{
 for(const area of [{x:0,y:0,width:1920,height:1080},{x:-800,y:100,width:320,height:200}]){const b=windowBounds('cpu',area);assert.ok(b.width<=460&&b.height<=260);assert.ok(b.x>=area.x&&b.y>=area.y);assert.ok(b.x+b.width<=area.x+area.width);assert.ok(b.y+b.height<=area.y+area.height);const min=windowMinimumSize('cpu',b);assert.ok(min.minWidth<=b.width&&min.minHeight<=b.height);}
});
