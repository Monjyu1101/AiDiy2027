// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {ミニ高さを合わせる} from '../ui/src/components/ウィンドウ/ミニ高さ.mjs';
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function fixture(resize=()=>true,style){
 let height=99.2,observer;const calls=[],observed=[];
 const title={getBoundingClientRect:()=>({height:31})},bar={getBoundingClientRect:()=>({height:3})};
 const content={getBoundingClientRect:()=>({height}),closest:()=>({querySelector:selector=>selector==='.panel-brand'?title:bar})};
 class Observer{constructor(callback){this.callback=callback;observer=this;}observe(node){observed.push(node);}disconnect(){this.disconnected=true;}}
 const stop=ミニ高さを合わせる(content,{Observer,style,api:{resizeMini:value=>{calls.push(value);return resize(value);}}});
 return{calls,observed,content,stop,get observer(){return observer;},change(value){height=value;observer.callback();}};
}
test('外周1px枠の上下を含め、最下段をスクロールなしで表示する',async()=>{
 const f=fixture(()=>true,()=>({borderTopWidth:'1px',borderBottomWidth:'1px'}));
 await flush();assert.deepEqual(f.calls,[136]);f.stop();
});
test('ミニ高さは0件→CLIあり→エラー→0件に追従し、同じ寸法の通知では再リサイズしない',async()=>{
 const f=fixture();await flush();assert.deepEqual(f.calls,[134]);assert.equal(f.observed.length,3);
 f.change(151.2);f.change(151.2);await flush();assert.deepEqual(f.calls,[134,186]);
 f.change(165.2);await flush();assert.equal(f.calls.at(-1),200);
 f.change(99.2);await flush();assert.equal(f.calls.at(-1),134);
 f.change(99.2);await flush();assert.equal(f.calls.length,4);
 f.stop();assert.equal(f.observer.disconnected,true);f.change(151.2);await flush();assert.equal(f.calls.length,4);
});
test('寸法の上下限・不正値・待機中の破棄を安全に扱う',async()=>{
 const f=fixture();f.change(1000);await flush();assert.deepEqual(f.calls,[360]);
 f.change(1);await flush();assert.equal(f.calls.at(-1),80);
 f.change(NaN);await flush();assert.equal(f.calls.length,2);
 f.change(200);f.stop();await flush();assert.equal(f.calls.length,2);
 assert.doesNotThrow(()=>ミニ高さを合わせる(null)());
});
test('拒否・失敗した寸法は次の表示更新で再試行でき、通常WebではIPCを呼ばない',async()=>{
 let accepted=false;const f=fixture(()=>accepted);await flush();assert.deepEqual(f.calls,[134]);
 accepted=true;f.change(99.2);await flush();assert.deepEqual(f.calls,[134,134]);f.stop();
 let observed=false;const stop=ミニ高さを合わせる(f.content,{api:{},Observer:class{constructor(){observed=true;}}});stop();assert.equal(observed,false);
});
