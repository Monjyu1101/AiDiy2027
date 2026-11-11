// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {ナビ万華鏡2D描画を作成} from '../src/components/開発スペース/ナビ万華鏡2D.js';
function canvas(){
 const surfaces=[],images=[],scales=[];let depth=0;
 const gradient={addColorStop(){}};
 const ctx={canvas:{ownerDocument:{createElement(){const surface={width:0,height:0,getContext:()=>context()};surfaces.push(surface);return surface;}}},
   save(){depth++;},restore(){depth--;assert.ok(depth>=0);},
   drawImage(...args){images.push(args);},scale(...args){scales.push(args);},
   createRadialGradient:()=>gradient,createLinearGradient:()=>gradient};
 function context(){return new Proxy(ctx,{get:(target,key)=>key in target?target[key]:(...args)=>{for(const n of args)if(typeof n==='number')assert.ok(Number.isFinite(n));}});}
 return {ctx:context(),surfaces,images,scales,get depth(){return depth;}};
}
test('描画時計の9秒で構図を切り替え、2.2秒で移行する（1/3速では実時間27秒・6.6秒）',()=>{
 const scene=ナビ万華鏡2D描画を作成(),c=canvas(),names=new Set(),mirrors=new Set();
 for(let i=0;i<6;i++){
   scene.draw(c.ctx,800,600,i*9);scene.draw(c.ctx,800,600,i*9+2.3);
   names.add(scene.state.name);mirrors.add(scene.state.mirrors);assert.equal(scene.state.transition,1);
 }
 assert.equal(names.size,6);assert.equal(mirrors.size,6);assert.equal(c.depth,0);
 assert.equal(c.surfaces.length,2,'経過時間でテクスチャを増やさない');
});
test('手動切替はクロスフェード中の連打をまとめ、次回自動切替をそこから数える',()=>{
 const scene=ナビ万華鏡2D描画を作成(),c=canvas();scene.draw(c.ctx,400,300,1);
 assert.equal(scene.next(1),true);assert.equal(scene.next(1.1),false);
 scene.draw(c.ctx,400,300,2.1);assert.ok(scene.state.transition>0&&scene.state.transition<1);
 scene.draw(c.ctx,400,300,3.3);assert.equal(scene.state.index,1);
 scene.draw(c.ctx,400,300,9.9);assert.equal(scene.state.index,1);
 scene.draw(c.ctx,400,300,10);assert.equal(scene.state.index,2);
});
test('鏡面を交互に反転し、ポインターは素材位置を変えるだけで拡大しない',()=>{
 const scene=ナビ万華鏡2D描画を作成(),c=canvas();scene.draw(c.ctx,800,500,1);
 const first=c.images.at(-1).slice(1);assert.equal(c.images.length,16);assert.equal(c.scales.filter(v=>v[0]===1&&v[1]===-1).length,8);
 scene.setPointer({x:.9,y:.1});scene.draw(c.ctx,800,500,1.1);
 const moved=c.images.at(-1).slice(1);assert.notDeepEqual(first.slice(0,2),moved.slice(0,2));assert.deepEqual(first.slice(2),moved.slice(2));
 assert.equal(c.depth,0);
});
test('座標をコピーして保持し、不正値と離脱で解除できる',()=>{
 const scene=ナビ万華鏡2D描画を作成(),point={x:.8,y:.2};scene.setPointer(point);point.x=0;
 assert.deepEqual(scene.state.pointer,{x:.8,y:.2});scene.setPointer({x:-1,y:2});assert.deepEqual(scene.state.pointer,{x:0,y:1});
 for(const p of [null,{}, {x:NaN,y:1},{x:1,y:Infinity}]){scene.setPointer(p);assert.equal(scene.state.pointer,null);}
});
test('非表示や不正寸法で資源を作らず、破棄後は描画と切替をしない',()=>{
 const scene=ナビ万華鏡2D描画を作成(),c=canvas();
 for(const [w,h,t]of [[0,400,0],[400,0,0],[-1,400,0],[Infinity,300,0],[400,NaN,0],[400,300,NaN]])scene.draw(c.ctx,w,h,t);
 assert.equal(c.surfaces.length,0);scene.draw(c.ctx,400,300,1);scene.dispose();
 assert.ok(c.surfaces.every(s=>s.width===0&&s.height===0));const count=c.images.length;
 scene.draw(c.ctx,400,300,10);assert.equal(c.images.length,count);assert.equal(scene.next(10),false);
});
