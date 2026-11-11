// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createSystemMetrics} from '../aidiy_cpu/metrics.mjs';
import {chartSeries,placeLabels,chartRight,labelRight} from '../src/components/システム監視/使用率グラフ.js';
const source=readFileSync(new URL('../src/components/システム監視/CPUパネル.vue',import.meta.url),'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?\n/gm,'');
function fixture(){
 let now=0,mount,unmount,id=0,calls=0,fetcher=async()=>({ok:true,json:async()=>({timestamp:1,cpu:35,gpu:null,ram:62})});
 const timers=new Map(),events=new Map(),document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const context={ref:value=>({value}),computed:fn=>({get value(){return fn();}}),chartSeries,placeLabels,chartRight,labelRight,defineProps(){},defineEmits:()=>()=>{},onMounted:fn=>mount=fn,onBeforeUnmount:fn=>unmount=fn,document,AbortController,Date,performance:{now:()=>now},fetch:(...args)=>{calls++;return fetcher(...args);},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source+';globalThis.state={samples,error,ready,series,labels};globalThis.poll=poll;',context);
 return {context,timers,events,document,setTime:value=>now=value,elapse:ms=>now+=ms,mount:()=>mount(),unmount:()=>unmount(),setFetch:fn=>fetcher=fn,calls:()=>calls,async hidden(value){document.hidden=value;events.get('visibilitychange')();await tick();}};
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

test('GPU floating label hides on missing values and errors, then returns including zero percent',async()=>{
 const f=fixture(),state=f.context.state;const gpu=()=>state.labels.value.find(item=>item.key==='gpu');
 const otherLabels=()=>Array.from(state.labels.value,item=>item.key).filter(key=>key!=='gpu').sort();
 assert.equal(gpu(),undefined);f.mount();await tick();assert.equal(gpu(),undefined);
 assert.deepEqual(otherLabels(),['cpu','ram']);
 for(const value of [72,null,0,undefined,NaN,101,-1,'30',30]){
  f.setFetch(async()=>({ok:true,json:async()=>({timestamp:2,cpu:35,gpu:value,ram:62})}));await f.context.poll();
  const valid=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
  assert.equal(gpu()?.value,valid?value:undefined);assert.deepEqual(otherLabels(),['cpu','ram']);
 }
 f.setFetch(async()=>{throw Error('offline');});await f.context.poll();assert.equal(gpu(),undefined);
 assert.deepEqual(otherLabels(),['cpu','ram']);
 f.setFetch(async()=>({ok:true,json:async()=>({timestamp:3,cpu:35,gpu:0,ram:62})}));await f.context.poll();assert.equal(gpu().value,0);
 f.unmount();
});

test('CPU uses a compact dedicated title with window controls and no connection monitoring',()=>{
 const panel=readFileSync(new URL('../src/components/システム監視/CPUパネル.vue',import.meta.url),'utf8');
 assert.doesNotMatch(panel,/StatusBar|connection-bar|connection-label|clockPulse/);
 assert.match(panel,/<WindowActions v-if="desktop" \/>/);
 assert.match(panel,/cpu-title\.desktop\{-webkit-app-region:drag\}/);
 assert.match(panel,/\.cpu-title\{[^}]*height:22px/);
 assert.match(panel,/fetch\('\/api\/system-metrics'/);
});

test('compact title overlays only on hover or keyboard focus, preserving graph size',()=>{
 const panel=readFileSync(new URL('../src/components/システム監視/CPUパネル.vue',import.meta.url),'utf8');
 assert.match(panel,/tabindex="0" data-aidiy-window-move-surface/);
 assert.match(panel,/\.cpu-title\{position:absolute;[^}]*opacity:0;pointer-events:none/);
 assert.match(panel,/\.cpu-panel:hover>\.cpu-title,\.cpu-panel:focus-within>\.cpu-title\{opacity:1;pointer-events:auto\}/);
});

test('CPU is graph-only with compact percent margin and Diag-sized right inset',()=>{
 const panel=readFileSync(new URL('../src/components/システム監視/CPUパネル.vue',import.meta.url),'utf8');
 assert.doesNotMatch(panel,/<footer|cpu-caption|GPU 未取得|GPU 最大負荷|ホスト全体 ·/);
 assert.match(panel,/viewBox="0 0 264 100"/);
 assert.match(panel,/<text :x="labelRight-labelMaxWidth\/2" :y="item\.labelY\+\.5" text-anchor="middle" dominant-baseline="central"/);
 assert.match(panel,/right:8px;bottom:/);
});


for(const [release,expected] of [['10.0.26100',64],['10.0.22631',92]])test(`Windows取得値(${release})はJSONからグラフ・数値まで縮小せず届く`,async()=>{
 let now=0,busy=100,idle=100;
 const metrics=createSystemMetrics({platform:'win32',windowsCpuMetrics:{read:()=>({cpu:{time:64,utility:92},measuredAt:now,sampleIntervalMs:1000}),close(){}},now:()=>now,system:{release:()=>release,cpus:()=>[{times:{user:busy,idle}}],totalmem:()=>1000,freemem:()=>250},run:async()=>({stdout:JSON.stringify({cpu:{Name:'_Total',PercentProcessorTime:64,PercentProcessorUtility:92},gpu:[{Name:'pid_1_luid_0x00000000_0x0000abcd_phys_0_eng_0_engtype_3D',UtilizationPercentage:40}]})})});
 const f=fixture();
 try{
  await metrics.sample();await tick();now+=1000;busy+=3;idle+=97;
  const api=JSON.parse(JSON.stringify(await metrics.sample()));
  assert.equal(api.cpu,expected);assert.ok(Math.abs(api.cpuDetails.osTimes-3)<1e-8);
  f.setFetch(async()=>({ok:true,json:async()=>api}));await f.context.poll();
  const cpu=f.context.state.series.value.find(item=>item.key==='cpu');
  const label=f.context.state.labels.value.find(item=>item.key==='cpu');
  assert.equal(cpu.value,expected);assert.equal(label.value,expected);assert.equal('CPU '+Math.round(label.value)+'%',`CPU ${expected}%`);assert.equal(cpu.y,94-expected*.84);
 }finally{metrics.close();f.unmount();}
});


test('CPU panelは応答時間を次の1秒に足さず、遅延後の連発をしない',async()=>{
 const f=fixture();f.setFetch(async()=>{f.elapse(200);return{ok:true,json:async()=>({timestamp:1,cpu:100})};});
 f.mount();await tick();assert.equal([...f.timers.values()][0].ms,800);
 f.setTime(1000);await f.context.poll();assert.equal([...f.timers.values()][0].ms,800);
 f.setFetch(async()=>{f.elapse(2300);return{ok:true,json:async()=>({timestamp:3,cpu:100})};});
 f.setTime(2000);await f.context.poll();assert.equal([...f.timers.values()][0].ms,700);f.unmount();
});
for(const duration of [200,500])test(`CPU panelは${duration}ms採取の100%を縮小・平均化せず維持`,async()=>{
 const f=fixture();f.setFetch(async()=>({ok:true,json:async()=>({timestamp:1,cpu:100,cpuDetails:{windowsSampleIntervalMs:duration}})}));
 f.mount();await tick();for(let i=0;i<3;i++){await f.context.poll();assert.equal(f.context.state.labels.value.find(item=>item.key==='cpu').value,100);}f.unmount();
});


for(const failure of [false,true])test(`hide/show後の旧${failure?'失敗':'成功'}応答を新しい履歴へ混ぜない`,async()=>{
 const f=fixture();let finish;
 f.setFetch(()=>new Promise((resolve,reject)=>finish=failure?()=>reject(Error('old')):()=>resolve({ok:true,json:async()=>({timestamp:1,cpu:99})})));
 f.mount();await tick();await f.hidden(true);await f.hidden(false);finish();await tick();
 assert.equal(f.context.state.samples.value.length,0);assert.equal(f.context.state.error.value,'');assert.equal([...f.timers.values()][0].ms,0);
 f.setFetch(async()=>({ok:true,json:async()=>({timestamp:2,cpu:42})}));await f.context.poll();
 assert.equal(f.context.state.samples.value.length,1);assert.equal(f.context.state.samples.value[0].cpu,42);f.unmount();
});
