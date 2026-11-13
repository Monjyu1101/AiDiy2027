// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {起動モーション} from '../diag/ui/components/アプリ起動/起動モーション.mjs';
import {アプリ状態を作成} from '../diag/ui/components/アプリ起動/アプリ状態.mjs';
import {CLI状態を作成} from '../diag/ui/components/アプリ起動/CLI状態.mjs';
import {readFile} from 'node:fs/promises';
function fixture(){
 const classes=new Set();const runs=[];const icon={parentElement:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}},animate:(frames,options)=>{let finish;const animation={frames,options,cancelled:false,cancel(){this.cancelled=true;},finished:new Promise(resolve=>finish=resolve),finish:()=>finish()};runs.push(animation);return animation;}};
 return {runs,classes,button:{disabled:false,querySelector:selector=>selector==='.launch-trace'?icon:null}};
}
test('accepted light traces the frame clockwise twice, repeated request restarts it, and event target is captured',async()=>{
 const f=fixture(),event={currentTarget:f.button},start=起動モーション(event);event.currentTarget=null;
 start();assert.equal(f.runs[0].frames[0]['--launch-spin'],'0deg');assert.equal(f.runs[0].frames.at(-1)['--launch-spin'],'720deg');assert.equal(f.runs[0].options.iterations,1);
 start();assert.equal(f.classes.has('launch-active'),true);assert.equal(f.runs.length,2);assert.equal(f.runs[0].cancelled,true);f.runs[0].finish();await Promise.resolve();
 assert.equal(f.classes.has('launch-active'),true);start();assert.equal(f.runs[1].cancelled,true);f.runs[2].finish();await Promise.resolve();
 assert.equal(f.classes.has('launch-active'),false);start();assert.equal(f.runs[2].cancelled,false);
});
test('one continuous accelerating pass fades at the ends without intermediate speed resets',()=>{
 const f=fixture();起動モーション({currentTarget:f.button})();const {frames,options}=f.runs[0];
 assert.equal(options.duration,1800);
 assert.equal(options.easing,'cubic-bezier(0.333333,0,0.666667,0.333333)');
 assert.equal(frames[0].opacity,0);assert.equal(frames.at(-1).opacity,0);
 assert.deepEqual(frames.slice(1,-1).map(frame=>frame.opacity),[1,1]);
 for(const frame of frames){assert.ok(Math.abs(parseFloat(frame['--launch-spin'])-720*frame.offset)<1e-9);assert.equal(frame.easing,undefined);}
 // この Bézier は x≈t、y≈t²。等しい時間区間ごとの移動量が増え続ける。
 const bezier=(t,p1,p2)=>3*(1-t)**2*t*p1+3*(1-t)*t*t*p2+t**3;
 let previousDistance=0,previousProgress=0;
 for(let i=1;i<=10;i++){
  const t=i/10;assert.ok(Math.abs(bezier(t,.333333,.666667)-t)<.000001);
  const progress=bezier(t,0,.333333),distance=progress-previousProgress;
  assert.ok(distance>previousDistance);previousDistance=distance;previousProgress=progress;
 }
});
test('accepted callback still animates if its own pending UI disables the button',()=>{
 const f=fixture(),start=起動モーション({currentTarget:f.button});f.button.disabled=true;start();assert.equal(f.runs.length,1);
});
test('disabled/missing targets and unsupported animation are safe; reduced motion still shows the light',()=>{
 const f=fixture();f.button.disabled=true;起動モーション({currentTarget:f.button})();assert.equal(f.runs.length,0);
 f.button.disabled=false;const previous=globalThis.matchMedia;
 try{globalThis.matchMedia=()=>({matches:true});起動モーション({currentTarget:f.button})();assert.equal(f.runs.length,1,'Windows のアニメーション効果オフでも光を回す');}finally{if(previous)globalThis.matchMedia=previous;else delete globalThis.matchMedia;}
 assert.doesNotThrow(()=>起動モーション()());assert.doesNotThrow(()=>起動モーション({currentTarget:{querySelector:()=>({})}})());
 assert.doesNotThrow(()=>起動モーション({currentTarget:{querySelector(){throw Error('detached');}}})());
});
test('app accepted request animates before response, blocked duplicate does not, failure can retry',async()=>{
 let release,animated=0,calls=0;const state=アプリ状態を作成({api:()=>{calls++;return new Promise(resolve=>release=resolve);}}),options={開始時:()=>animated++};
 await state.起動('code',options);assert.equal(animated,0);state.フォルダ.value='/project';
 const one=state.起動('code',options);assert.equal(animated,1);assert.equal(calls,1);
 await state.起動('code',options);assert.equal(animated,1);release({});await one;
 const two=state.起動('code',options);assert.equal(animated,2);release({});await two;
});
test('CLI guards and declined confirmation never animate; accepted editor and CLI do',async()=>{
 const app=アプリ状態を作成({api:async()=>({})});app.フォルダ.value='/project';let count=0,accept=false;
 const state=CLI状態を作成({アプリ:app,確認:async()=>accept,api:async()=>({})});
 state.項目.value=[{id:'codex',名前:'Codex',利用可能:true},{id:'vscode',種類:'editor',利用可能:true},{id:'missing',利用可能:false}];
 const options={開始時:()=>count++};await state.起動('missing',options);await state.起動('codex',options);assert.equal(count,0);
 await state.起動('codex',{...options,確認省略:true});await state.起動('vscode',options);assert.equal(count,2);
 app.選択中.value=true;await state.起動('codex',{...options,確認省略:true});assert.equal(count,2);
});
test('all normal mini and micro launch surfaces share the accepted-action callback',async()=>{
 for(const name of ['アプリ起動パネル','ミニアプリ起動','ミニCLI起動','マイクロランチャー']){
  const source=await readFile(new URL(`../diag/ui/components/アプリ起動/${name}.vue`,import.meta.url),'utf8');assert.match(source,/import \{起動モーション\}/);assert.match(source,/開始時/);assert.match(source,/\$event/);
 }
});

test('stationary fixed-size icon has a vivid comet ring starting from the bottom and no obsolete flip layers',async()=>{
 const css=await readFile(new URL('../diag/ui/components/アプリ起動/起動モーション.css',import.meta.url),'utf8');
 assert.match(css,/@property --launch-spin\{syntax:'<angle>'/);assert.match(css,/conic-gradient\(from calc\(180deg \+ var\(--launch-spin\)\)/);
 assert.match(css,/#ffffff 357deg,transparent 360deg/);assert.match(css,/content-box exclude/);assert.match(css,/drop-shadow/);
 assert.match(css,/opacity:0/);assert.match(css,/pointer-events:none/);assert.doesNotMatch(css,/stroke-dasharray/);
 assert.doesNotMatch(css,/rotate|transform|backface|#808080|launch-card/);
 assert.match(css,/width:40px;height:40px/);assert.match(css,/width:72px;height:72px/);
 for(const name of ['アプリ起動パネル','ミニアプリ起動','ミニCLI起動','マイクロランチャー']){
  const source=await readFile(new URL(`../diag/ui/components/アプリ起動/${name}.vue`,import.meta.url),'utf8');
  assert.match(source,/import '\.\/起動モーション.css'/);assert.match(source,/<span class="launch-trace"><\/span>/);
  assert.doesNotMatch(source,/<svg class="launch-trace"/);
  assert.doesNotMatch(source,/launch-card-back|launch-card-40|launch-card-72/);
 }
});
