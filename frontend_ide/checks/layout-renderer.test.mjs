// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');
function fixture(){
  const source=app.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\s*$/gm,'');
  const calls=[],context={ref:value=>({value}),reactive:value=>value,computed:get=>({get value(){return get();}}),provide(){},onMounted(){},onBeforeUnmount(){},nextTick:async()=>{},defineProps:()=>({config:{kind:'ide'}}),location:{hash:''},window:{aidiyWindow:{layout:async action=>{calls.push(action);return{ok:true,count:0,saved:true};}}},createDraftTargetRegistry:()=>({}),AbortController,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval};
  vm.createContext(context);
  vm.runInContext(source+'\nglobalThis.api={state,layoutState,layoutBusy,desktopLaunchItems,layoutRequest,navigationRefs,navigationWindows,spaceView,update,refreshLayout,runLayout,error,canEnterAll,toggleAllDisplays};',context);
  const api=context.api;api.update({active:true,mode:'online',startedAt:1,project:{path:'/project'}});
  return{api,calls,context};
}
test('online menu: Load first only with a saved layout at zero windows, Save last only at three or more windows',()=>{
  const {api}=fixture(),layoutItems=()=>api.desktopLaunchItems.value.filter(item=>item.key.startsWith('layout-'));
  assert.equal(layoutItems().length,0,'no saved file hides Load');
  api.layoutState.value={count:0,saved:true};
  const load=api.desktopLaunchItems.value[0];
  assert.equal(load.text,'Load');assert.equal(load.shortLabel,'Ld');assert.equal(load.arrow,'⬇︎');assert.equal(load.ariaLabel,'Load');assert.equal(load.disabled,false);
  for(const count of [1,2]){api.layoutState.value={count,saved:true};assert.equal(layoutItems().length,0);}
  for(const count of [3,4]){
    api.layoutState.value={count,saved:true};const save=api.desktopLaunchItems.value.at(-1);
    assert.equal(save.text,'Save');assert.equal(save.shortLabel,'Sv');assert.equal(save.arrow,'⬆︎');assert.equal(save.ariaLabel,'Save');
    assert.ok(!api.desktopLaunchItems.value.some(item=>item.text==='Load'));
  }
  api.state.value.mode='offline';assert.equal(layoutItems().length,0);
});
test('capture records DOM names and view state only, never Navi conversations or autopilot',async()=>{
  const {api}=fixture();
  api.navigationRefs.set('navi-1',{captureLayout:()=>({name:'old-navi'})});
  api.navigationRefs.set('closed',{captureLayout:()=>({name:''})});
  api.spaceView.value={captureLayout:()=>({explorer:{explorerName:'old-explorer',routesName:''},viewers:[]})};
  const snapshot=JSON.parse(JSON.stringify(await api.layoutRequest({action:'capture'})));
  assert.deepEqual(snapshot,{version:1,viewMode:'3d',navigation:[{name:'old-navi'}],space:{explorer:{explorerName:'old-explorer',routesName:''},viewers:[]}});
});
test('restore waits for DOM windows and maps old names to new names',async()=>{
  const {api,context}=fixture();let ready=false;
  api.spaceView.value={restoreLayout:async()=>[{previousName:'old-viewer',name:'new-viewer'}]};
  context.nextTick=async()=>{for(const id of api.navigationWindows.value)api.navigationRefs.set(id,{layoutReady:async()=>{await Promise.resolve();ready=true;},captureLayout:()=>({name:'new-navi'})});};
  const result=await api.layoutRequest({action:'restore',payload:{version:1,viewMode:'2d',navigation:[{name:'old-navi'}],space:{}}});
  assert.equal(ready,true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{panels:[{previousName:'old-viewer',name:'new-viewer'},{previousName:'old-navi',name:'new-navi'}]});
});
test('restore refuses stale sessions after asynchronous work and unsupported snapshots',async()=>{
  const {api}=fixture();api.spaceView.value={restoreLayout:async()=>{api.update({active:false});return[];}};
  await assert.rejects(api.layoutRequest({action:'restore',payload:{version:1}}),/利用状態が変わりました/);
  api.update({active:true,mode:'online',startedAt:2,project:{path:'/project'}});
  await assert.rejects(api.layoutRequest({action:'restore',payload:{version:9}}),/形式/);
});

test('VR is disabled during layout work and stale operation failure cannot overwrite new session',async()=>{
  const {api,context}=fixture();api.layoutBusy.value=true;
  assert.equal(api.canEnterAll.value,false);await api.toggleAllDisplays();
  api.layoutBusy.value=false;let finish;
  context.window.aidiyWindow.layout=()=>new Promise(resolve=>finish=resolve);
  const pending=api.runLayout('load');api.update({active:false});api.error.value='new-session';
  finish({ok:false,error:'stale failure'});await pending;assert.equal(api.error.value,'new-session');
});
test('restoring a detached viewer reuses an existing inline preview with the same path',async()=>{
  const source=readFileSync(new URL('../src/components/開発スペース/開発スペース.vue',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function restoreLayout(saved){'),source.indexOf('defineExpose({prepareAll,captureLayout,restoreLayout});'));
  const entry={file:{path:'same.txt',name:'same.txt'},detached:false},viewers={value:[entry]};let pins=0;
  const result=await vm.runInNewContext(fn+';restoreLayout({viewers:[{name:"old",file:{path:"same.txt",name:"same.txt"}}]})',{
    scan:{value:{root:'/project'}},disposed:false,explorer:{value:{restoreLayout:async()=>[]}},viewerSessions:viewers,nextTick:async()=>{},viewerRefs:new Map([['same.txt',{pin:async()=>{pins++;return true;},captureLayout:()=>({name:'new'})}]]),Date,setTimeout,
  });
  assert.equal(viewers.value.length,1);assert.equal(viewers.value[0],entry);assert.equal(pins,1);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),[{previousName:'old',name:'new'}]);
});

test('native-only layout does not wait for file scanning',async()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/開発スペース.vue',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function restoreLayout(saved){'),source.indexOf('defineExpose({prepareAll,captureLayout,restoreLayout});'));
 const result=await vm.runInNewContext(fn+';restoreLayout({explorer:{},viewers:[]})',{});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),[]);
});
