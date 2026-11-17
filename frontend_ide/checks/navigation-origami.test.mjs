// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import {ref,computed} from 'vue';
import {折り紙作品,折り紙を選ぶ,折り紙の次の手順,兜手順,兜図形,兜の口を開く} from '../src/components/開発スペース/ナビ折り紙3D.js';
const dir=new URL('../src/components/開発スペース/',import.meta.url);
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
const area=poly=>{let sum=0;for(let i=1;i<poly.length-1;i++){const a=poly[i].map((n,j)=>n-poly[0][j]),b=poly[i+1].map((n,j)=>n-poly[0][j]);sum+=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;}return sum;};
test('正式名の変更後に旧ファイル・登録・表示名が残らない',()=>{
 assert.ok(existsSync(new URL('ナビ折り紙3D.vue',dir)));assert.ok(!existsSync(new URL('ナビ折り鶴3D.vue',dir)));
 for(const file of ['ナビ待機画面一覧.js','ナビ風景.js','Naviパネル.vue','ナビ折り紙3D.vue']){
  const source=readFileSync(new URL(file,dir),'utf8');assert.ok(source.includes('ナビ折り紙3D'));assert.ok(!source.includes('ナビ折り鶴3D'));
 }
});
test('2種をランダム選択し、作品完了時に次の作品の最初へ戻る',()=>{
 assert.deepEqual(折り紙作品.map(w=>w.id),['crane','kabuto']);
 assert.equal(折り紙を選ぶ(()=>0).id,'crane');assert.equal(折り紙を選ぶ(()=>.99).id,'kabuto');
 for(const w of 折り紙作品){
  assert.deepEqual(折り紙の次の手順(w,0,()=>.9),{work:w,step:1});
  assert.equal(折り紙の次の手順(w,w.手順.length-1,()=>.1).work.id,'crane');
  assert.equal(折り紙の次の手順(w,w.手順.length-1,()=>.9).work.id,'kabuto');
  assert.equal(折り紙の次の手順(w,w.手順.length-1,()=>.9).step,0);
 }
});
test('兜14段階: 左右別、手前1枚、帯だけ、後ろへ折る方式を明記',()=>{
 assert.equal(兜手順.length,14);assert.equal(new Set(兜手順.map(s=>s.型)).size,14);
 assert.match(兜手順.find(s=>s.型==='brim').説明,/手前1枚だけ/);
 assert.match(兜手順.find(s=>s.型==='band').確認,/三角全体ではなく/);
 assert.match(兜手順.find(s=>s.型==='back').確認,/内側へ差し込まず/);
});
test('兜の全工程で紙の総面積を維持し、有限座標・バッファ上限を守る',()=>{
 for(let i=0;i<兜手順.length;i++)for(const t of [0,.1,.25,.5,.75,.9,1]){
  const m=兜図形(i,t);let total=0;
  for(const p of m.polygons){for(const v of p.points){assert.equal(v.length,3);assert.ok(v.every(Number.isFinite));assert.ok(v.every(n=>Math.abs(n)<5));}total+=area(p.points);}
  assert.ok(Math.abs(total-8)<1e-8,`${i},${t}: ${total}`);
  assert.ok(m.polygons.reduce((n,p)=>n+(p.points.length-2)*3,0)<4096);
 }
});
test('兜の口は頂部・左右の合わせ目を共有したまま開き、各半面の辺長を変えない',()=>{
 const a=[0,0,0],l=[-1,-1,0],r=[1,-1,0],f=[0,-1,0];
 for(const t of [0,.1,.5,1]){
  for(const seam of [a,l,r])assert.ok(distance(兜の口を開く(seam,t,false),兜の口を開く(seam,t,true))<1e-12);
  for(const back of [false,true])for(const [p,q]of [[a,l],[a,r],[a,f],[l,f],[r,f]])assert.ok(Math.abs(distance(p,q)-distance(兜の口を開く(p,t,back),兜の口を開く(q,t,back)))<1e-9);
 }
 assert.ok(兜の口を開く(f,1,false)[2]>0);assert.ok(兜の口を開く(f,1,true)[2]<0);
});
test('作品切替は手順をリセットし、一時停止状態を維持。短い兜へ切り替えても範囲外にしない',()=>{
 const source=readFileSync(new URL('ナビ折り紙3D.vue',dir),'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\n/gm,'');
 const api=vm.runInNewContext(source+';({step,selected,playing,steps,current,chooseWork,go,replay,reducedMotion})',{ref,computed,折り紙作品,折り紙を選ぶ:()=>折り紙作品[0],折り紙の次の手順,defineOptions(){},defineEmits:()=>()=>{},onMounted(){},onBeforeUnmount(){}});
 api.go(31);assert.equal(api.playing.value,false);api.chooseWork('kabuto');assert.equal(api.step.value,0);assert.equal(api.steps.value.length,14);assert.equal(api.playing.value,false);
 api.go(999);assert.equal(api.step.value,13);assert.equal(api.current.value.型,'done');
 api.replay();assert.equal(api.playing.value,true);api.chooseWork('crane');assert.equal(api.playing.value,true);assert.equal(api.step.value,0);
 api.reducedMotion.value=true;api.chooseWork('kabuto');assert.equal(api.playing.value,false);
});
