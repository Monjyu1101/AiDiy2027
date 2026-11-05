// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createKaleidoscope} from '../src/components/開発スペース/ナビ万華鏡.js';

// Canvasの変換を実行して描画位置まで検証する。ブラウザーや乱数は不要。
function capture(scene,w=400,h=320,time=0,dpr=1) {
  let matrix=[dpr,0,0,dpr,0,0], path=[];
  const stack=[], shapes=[];
  const transform=(x,y)=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
  const ctx={
    fillStyle:'#000',strokeStyle:'#000',lineWidth:1,
    save(){stack.push({matrix:matrix.slice(),fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth});},
    restore(){const state=stack.pop();matrix=state.matrix;this.fillStyle=state.fillStyle;this.strokeStyle=state.strokeStyle;this.lineWidth=state.lineWidth;},
    translate(x,y){const [e,f]=transform(x,y);matrix[4]=e;matrix[5]=f;},
    rotate(angle){const [a,b,c,d]=matrix,cos=Math.cos(angle),sin=Math.sin(angle);matrix[0]=a*cos+c*sin;matrix[1]=b*cos+d*sin;matrix[2]=c*cos-a*sin;matrix[3]=d*cos-b*sin;},
    scale(x,y){matrix[0]*=x;matrix[1]*=x;matrix[2]*=y;matrix[3]*=y;},
    beginPath(){path=[];},moveTo(x,y){path.push(transform(x,y));},lineTo(x,y){path.push(transform(x,y));},
    closePath(){},fill(){},stroke(){shapes.push({path,fill:this.fillStyle,stroke:this.strokeStyle,lineWidth:this.lineWidth});},
  };
  scene.draw(ctx,w,h,time);
  assert.equal(stack.length,0,'Canvasの保存状態を残さない');
  assert.deepEqual(matrix,[dpr,0,0,dpr,0,0]);
  return shapes;
}
function point(w,h,time,sector,j) {
  const radius=Math.min(w,h)*.46*(.18+j*.11)*.75, angle=time*.035+sector*Math.PI/6;
  return {x:.5+Math.cos(angle)*radius/w,y:.5+Math.sin(angle)*radius/h};
}
const center=shape=>shape.path.reduce((p,v)=>({x:p.x+v[0]/4,y:p.y+v[1]/4}),{x:0,y:0});

test('通常は12方向・7段の模様と自動変化を維持し、Canvas状態を復元する',()=>{
  const scene=createKaleidoscope(), initial=capture(scene);
  assert.equal(initial.length,84);
  assert.ok(initial.every(shape=>shape.lineWidth===1&&shape.path.length===4));
  assert.notDeepEqual(capture(scene,400,320,1),initial);
});

test('ポインター直下の模様を強め、遠い鏡像の形と色は変更しない',()=>{
  const scene=createKaleidoscope(), baseline=capture(scene), index=5;
  scene.setPointer(point(400,320,0,0,index));
  const hovered=capture(scene);
  assert.equal(hovered[index].lineWidth,2.4);
  assert.notDeepEqual(hovered[index].path,baseline[index].path);
  assert.notEqual(hovered[index].fill,baseline[index].fill);
  assert.notEqual(hovered[index].stroke,baseline[index].stroke);
  assert.deepEqual(hovered[6*7+index],baseline[6*7+index]);
  assert.ok(hovered.filter(shape=>shape.lineWidth>1).length<42,'画面全体ではなく近傍だけを変化させる');
});

test('近い模様ほど強く変わり、回転後の上下左右と縦横比でも場所を取り違えない',()=>{
  for(const [w,h,time,sector] of [[400,320,37,0],[400,320,37,3],[220,600,19,6],[900,180,92,9]]){
    const scene=createKaleidoscope(), pointer=point(w,h,time,sector,5);
    const baseline=capture(scene,w,h,time);
    scene.setPointer(pointer);
    const hovered=capture(scene,w,h,time), target=sector*7+5;
    assert.ok(Math.abs(hovered[target].lineWidth-2.4)<1e-12);
    assert.notEqual(hovered[target].fill,baseline[target].fill);
    const ordered=baseline.map((shape,index)=>{
      const p=center(shape);
      return {distance:Math.hypot(p.x-pointer.x*w,p.y-pointer.y*h),width:hovered[index].lineWidth};
    }).sort((a,b)=>a.distance-b.distance);
    for(let i=1;i<ordered.length;i++)assert.ok(ordered[i-1].width+1e-12>=ordered[i].width);
    assert.deepEqual(hovered[((sector+6)%12)*7+5],baseline[((sector+6)%12)*7+5]);
  }
});

test('ポインターを止めても近傍は変化し、移動先へ優先位置を切り替える',()=>{
  const scene=createKaleidoscope();scene.setPointer(point(400,320,0,0,5));
  const first=capture(scene), later=capture(scene,400,320,.4);
  assert.notEqual(later[5].fill,first[5].fill);
  assert.notDeepEqual(later[5].path,first[5].path);
  scene.setPointer(point(400,320,0,6,5));
  const moved=capture(scene), baseline=capture(createKaleidoscope());
  assert.deepEqual(moved[5],baseline[5]);
  assert.equal(moved[6*7+5].lineWidth,2.4);
});

test('離脱・blur・キャンセル用の解除で通常描画へ戻り、再入場できる',()=>{
  const scene=createKaleidoscope(), pointer=point(400,320,12,2,4);
  scene.setPointer(pointer);const hovered=capture(scene,400,320,12);
  scene.setPointer(null);
  assert.deepEqual(capture(scene,400,320,12),capture(createKaleidoscope(),400,320,12));
  scene.setPointer(pointer);assert.deepEqual(capture(scene,400,320,12),hovered);
});

test('正規化座標はコピーして保持し、リサイズと高DPIでも同じ位置が反応する',()=>{
  const scene=createKaleidoscope(), pointer=point(400,320,0,3,5);
  scene.setPointer(pointer);pointer.x=0;pointer.y=0;
  const normal=capture(scene), resized=capture(scene,800,640), retina=capture(scene,400,320,0,2);
  for(let i=0;i<normal.length;i++){
    assert.equal(resized[i].lineWidth,normal[i].lineWidth);
    assert.equal(retina[i].lineWidth,normal[i].lineWidth);
    assert.deepEqual(resized[i].path,retina[i].path);
    assert.deepEqual(retina[i].path,normal[i].path.map(p=>p.map(v=>v*2)));
  }
});

test('黒い余白では不要に全模様を変えず、不正な座標では解除する',()=>{
  const scene=createKaleidoscope(), baseline=capture(scene);
  for(const pointer of [{x:0,y:0},{x:-3,y:9},{x:NaN,y:.5},{x:.5,y:Infinity},{}]){
    scene.setPointer(point(400,320,0,0,5));
    scene.setPointer(pointer);assert.deepEqual(capture(scene),baseline);
  }
});

test('非表示や不正なサイズでは描画しない',()=>{
  const scene=createKaleidoscope();
  for(const [w,h,time] of [[0,320,0],[400,0,0],[-1,300,0],[Infinity,300,0],[400,NaN,0],[400,320,NaN]]){
    assert.deepEqual(capture(scene,w,h,time),[]);
  }
});
