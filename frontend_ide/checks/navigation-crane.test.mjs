// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse,compileScript,compileTemplate,compileStyle} from '@vue/compiler-sfc';
import {折り鶴手順,折り鶴図形,折線回転,四角基本形} from '../src/components/開発スペース/ナビ折り紙3D.js';
import {NAVIGATION_SCENES,NAVIGATION_RANDOM_SCENES} from '../src/components/開発スペース/ナビ風景.js';
test('準備から完成まで32段階。表裏の花弁折りと中割りの予備折りを省略しない',()=>{
 assert.equal(折り鶴手順.length,32);
 assert.equal(new Set(折り鶴手順.map(s=>s.型)).size,32);
 for(const s of 折り鶴手順)for(const key of ['章','題','説明','確認','型'])assert.ok(s[key]);
 const kinds=折り鶴手順.map(s=>s.型);
 for(const [a,b]of [['unfold','petalOpen'],['petalOpen','petalClose'],['backUnfold','backOpen'],['backOpen','backClose'],['neckCrease','neck'],['tailCrease','tail'],['head','wings']])assert.ok(kinds.indexOf(a)<kinds.indexOf(b));
 assert.equal(kinds.at(-1),'done');
});
test('全段階の途中/完了に有限な面と折り筋があり、描画バッファの上限を超えない',()=>{
 for(let i=0;i<折り鶴手順.length;i++)for(const t of [0,.1,.25,.5,.75,.9,1]){
  const model=折り鶴図形(i,t);assert.ok(model.polygons.length>0);
  assert.ok(model.polygons.reduce((n,p)=>n+(p.points.length-2)*3,0)<4096);
  for(const poly of model.polygons){assert.ok(poly.points.length>=3);for(const v of poly.points){assert.equal(v.length,3);assert.ok(v.every(Number.isFinite),`${i},${t}`);assert.ok(v.every(n=>Math.abs(n)<5));}}
  for(const line of model.creases)assert.equal(line.length,2);
 }
});
test('単純折りの折線軸と紙の辺の長さを維持する',()=>{
 const a=[0,-1,0],b=[0,1,0],p=[1,0,0],q=[1,1,0];
 for(const angle of [0,.5,Math.PI/2,Math.PI]){
  const r=折線回転(p,a,b,angle),s=折線回転(q,a,b,angle);
  assert.ok(Math.abs(Math.hypot(...r)-1)<1e-10);
  assert.ok(Math.abs(Math.hypot(...r.map((n,i)=>n-s[i]))-1)<1e-10);
  assert.deepEqual(折線回転(a,a,b,angle),a);
 }
});
test('待機画面メニューと通常のランダム選択の両方に登録',()=>{
 assert.ok(NAVIGATION_SCENES.includes('ナビ折り紙3D'));assert.ok(NAVIGATION_RANDOM_SCENES.includes('ナビ折り紙3D'));
});
test('Vue script・template・styleコンパイル、停止/復帰・破棄・学習操作の契約',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ折り紙3D.vue',import.meta.url),'utf8');
 const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
 const script=compileScript(descriptor,{id:'crane'});
 assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:'ナビ折り紙3D.vue',id:'crane',compilerOptions:{bindingMetadata:script.bindings}}).errors,[]);
 assert.deepEqual(compileStyle({source:descriptor.styles[0].content,id:'crane',scoped:true}).errors,[]);
 for(const text of ['prefers-reduced-motion','el.ownerDocument.hidden','renderer.dispose()','renderer.forceContextLoss()','owner.cancelAnimationFrame','unbind()','pointercancel','ArrowRight','ArrowLeft','もう一度','最初から','正面','type="range"'])assert.ok(source.includes(text),text);
});

test('花弁・細くする折り・首尾・頭・翼は面の辺長をアニメーション中も変えない',()=>{
 const lengths=model=>model.polygons.map(p=>p.points.map((a,i)=>{const b=p.points[(i+1)%p.points.length];return Math.hypot(...a.map((n,j)=>n-b[j]));}));
 for(const kind of ['top','backTop','unfold','backUnfold','petalOpen','petalClose','backOpen','backClose','narrow','backNarrow','neck','tail','head','wings']){
  const index=折り鶴手順.findIndex(s=>s.型===kind), start=lengths(折り鶴図形(index,0));
  for(const t of [.1,.25,.5,.75,1]){
   const now=lengths(折り鶴図形(index,t));assert.equal(now.length,start.length,kind);
   for(let i=0;i<now.length;i++)for(let j=0;j<now[i].length;j++)assert.ok(Math.abs(now[i][j]-start[i][j])<1e-9,`${kind},${t},${i},${j}`);
  }
 }
});

test('花弁の開く終端と閉じる始端が同じ立体状態になる',()=>{
 for(const [a,b]of [['petalOpen','petalClose'],['backOpen','backClose']]){
  const model=(kind,t)=>折り鶴図形(折り鶴手順.findIndex(s=>s.型===kind),t).polygons;
  assert.deepEqual(model(a,1),model(b,0));
 }
});

test('四角基本形の8三角面は全辺長一定で、集める→平らにする間も同じ頂点を引き継ぐ',()=>{
 const lengths=panels=>panels.map(p=>p.map((a,i)=>Math.hypot(...a.map((n,j)=>n-p[(i+1)%3][j]))));
 const original=lengths(四角基本形(0));
 for(const phase of [0,1])for(const t of [0,.1,.25,.5,.75,.99,1]){
  const now=lengths(phase?四角基本形(1,t):四角基本形(t));
  for(let i=0;i<8;i++)for(let j=0;j<3;j++)assert.ok(Math.abs(now[i][j]-original[i][j])<1e-9);
 }
 assert.deepEqual(四角基本形(1),四角基本形(1,0));
 const final=四角基本形(1,1).flat();
 for(const p of final)assert.ok(Math.abs(p[2])<1e-9);
 assert.ok(final.some(p=>Math.abs(p[0]-1)<1e-9&&Math.abs(p[1])<1e-9));
 assert.ok(final.some(p=>Math.abs(p[0]+1)<1e-9&&Math.abs(p[1])<1e-9));
});
