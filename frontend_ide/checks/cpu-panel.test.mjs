// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {chartSeries,placeLabels} from '../src/components/システム監視/使用率グラフ.js';
const source=readFileSync(new URL('../src/components/システム監視/CPUパネル.vue',import.meta.url),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\n/gm,'');
function fixture(){
 let mount,unmount,id=0,calls=0,fetcher=async()=>({ok:true,json:async()=>({timestamp:1,cpu:35,gpu:null,ram:62})});
 const timers=new Map(),events=new Map(),document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const context={ref:value=>({value}),computed:fn=>({get value(){return fn();}}),chartSeries,placeLabels,defineProps(){},defineEmits:()=>()=>{},onMounted:fn=>mount=fn,onBeforeUnmount:fn=>unmount=fn,document,AbortController,Date,fetch:(...args)=>{calls++;return fetcher(...args);},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source+';globalThis.state={samples,error,ready,series};globalThis.poll=poll;',context);
 return {context,timers,events,document,mount:()=>mount(),unmount:()=>unmount(),setFetch:fn=>fetcher=fn,calls:()=>calls,async hidden(value){document.hidden=value;events.get('visibilitychange')();await tick();}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('CPU panel keeps 60 samples, reports unavailable and failed requests, recovers',async()=>{
 const f=fixture();f.mount();await tick();assert.equal(f.calls(),1);assert.equal(f.context.state.ready.value,true);assert.equal(f.context.state.series.value[1].value,null);
 for(let i=0;i<65;i++)await f.context.poll();assert.equal(f.context.state.samples.value.length,60);
 f.setFetch(async()=>{throw Error('offline');});await f.context.poll();assert.equal(f.context.state.ready.value,false);assert.equal(f.context.state.series.value[0].value,null);assert.match(f.context.state.error.value,/再試行/);
 f.setFetch(async()=>({ok:true,json:async()=>null}));await f.context.poll();assert.equal(f.context.state.ready.value,false);
 f.setFetch(async()=>({ok:true,json:async()=>({timestamp:2,cpu:0,gpu:0,ram:45})}));await f.context.poll();assert.equal(f.context.state.ready.value,true);assert.equal(f.context.state.series.value[1].value,0);f.unmount();assert.equal(f.timers.size,0);assert.equal(f.events.size,0);
});
test('CPU panel stops hidden polling, resets history on resume, aborts in-flight disposal',async()=>{
 const f=fixture();f.mount();await tick();await f.hidden(true);const count=f.calls();await f.context.poll();assert.equal(f.calls(),count);assert.equal(f.timers.size,0);
 await f.hidden(false);assert.equal(f.calls(),count+1);assert.equal(f.context.state.samples.value.length,1);
 let signal,finish;f.setFetch((url,options)=>{signal=options.signal;return new Promise(r=>finish=r);});const pending=f.context.poll();await f.context.poll();assert.equal(f.calls(),count+2);
 f.unmount();assert.equal(signal.aborted,true);finish({ok:true,json:async()=>({timestamp:3,cpu:80,gpu:50,ram:60})});await pending;assert.equal(f.context.state.samples.value.length,1);assert.equal(f.timers.size,0);
});
