// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
test('LD state synchronizes native collapse without recursive IPC and cleans subscription',()=>{
 const source=read('components/共通表示/パネル折り畳み.js').replace(/^import .*;$/m,'').replace('export function','function');
 let listener,cleanup,stopped=0,calls=0;
 const context={ref:value=>({value}),onBeforeUnmount:fn=>cleanup=fn,window:{aidiyWindow:{onPanelCollapseState:fn=>{listener=fn;return()=>stopped++;},collapsePanel:()=>calls++}}};
 const panel=vm.runInNewContext(source+';usePanelCollapse({desktop:true})',context);
 listener({name:'other-window',collapsed:true,hidden:true});assert.equal(panel.panelCollapsed.value,false);
 listener({collapsed:true,hidden:false,busy:true});assert.equal(panel.panelCollapsed.value,true);assert.equal(panel.panelBusy.value,true);assert.equal(panel.panelHidden.value,false);
 listener({collapsed:true,hidden:true,busy:false});assert.equal(panel.panelHidden.value,true);assert.equal(panel.panelBusy.value,false);
 listener({collapsed:false,hidden:false,busy:false});assert.equal(panel.panelCollapsed.value,false);assert.equal(panel.panelHidden.value,false);assert.equal(calls,0);
 cleanup();assert.equal(stopped,1);
});
test('detached title forwards only its own restored state without toggling another window',()=>{
 const source=read('components/ファイル閲覧/別窓タイトル.js');
 const body=source.slice(source.indexOf('onPanelCollapseState: callback =>'),source.indexOf('    beginWindowMove:'));
 let listener,received=[];const stop=()=>{};
 const api=vm.runInNewContext('({'+body+'})',{owner:{aidiyWindow:{onPanelCollapseState:fn=>{listener=fn;return stop;}}},child:{name:'viewer-1'}});
 assert.equal(api.onPanelCollapseState(v=>received.push(v)),stop);
 listener({name:'viewer-2',collapsed:true,hidden:true,busy:false});assert.equal(received.length,0);
 listener({name:'viewer-1',collapsed:true,hidden:true,busy:false});assert.deepEqual(JSON.parse(JSON.stringify(received)),[{collapsed:true,hidden:true,busy:false}]);
});
test('route capture preserves expansion and post-placement restore waits for route sizing',async()=>{
 const source=read('components/ファイル閲覧/ファイル一覧.vue');
 const capture=source.slice(source.indexOf('function captureLayout(){'),source.indexOf('async function restoreLayout(saved){'));
 const restore=source.slice(source.indexOf('async function restoreFoldState(saved){'),source.indexOf('defineExpose({captureLayout'));
 const calls=[],ctx={detached:{value:false},routeDetached:{value:true},routeListOpen:{value:true},routeClosed:{value:false},routeDisposed:false,routeMotionState:{value:{phase:'open'}},routeElement:{value:{ownerDocument:{defaultView:{name:'routes-old'}}}},nextTick:async()=>calls.push('tick'),routeMotion:{set:async v=>{calls.push(v);}}};
 const api=vm.runInNewContext(capture+restore+';({captureLayout,restoreFoldState})',ctx);
 assert.equal(api.captureLayout().routesExpanded,true);
 for(const phase of ['preparing','opening','closing']){ctx.routeMotionState.value.phase=phase;assert.throws(()=>api.captureLayout(),/開閉が終わって/);}
 ctx.routeMotionState.value.phase='closed';assert.equal(api.captureLayout().routesExpanded,true);
 await api.restoreFoldState({routesName:'routes-old',routesExpanded:false});assert.equal(ctx.routeListOpen.value,false);assert.deepEqual(calls,['tick',false]);
 await api.restoreFoldState({routesName:'routes-old',routesExpanded:true});assert.equal(ctx.routeListOpen.value,true);assert.deepEqual(calls.slice(2),['tick',true]);
 await api.restoreFoldState({routesName:'routes-old'});assert.equal(ctx.routeListOpen.value,false,'legacy layouts default to collapsed routes');
});
