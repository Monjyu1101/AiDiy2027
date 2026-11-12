// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
for(const kind of ['explorer','panel-viewer','panel-navigation'])test(kind+': detached title opens expanded, routes collapse/drag to its own window, and hides all content',async()=>{
 let render;
 const classes=new Set(),calls=[];
 const host={classList:{add:v=>classes.add(v),remove:(...v)=>v.forEach(x=>classes.delete(x)),toggle:(v,yes)=>yes?classes.add(v):classes.delete(v)},prepend(){}};
 const child={name:'owned-panel',document:{createElement:()=>({remove(){}})}};
 const owner={document:{querySelector:()=>null},MutationObserver:class {observe(){} disconnect(){}},aidiyWindow:{collapsePanel:(...args)=>calls.push(['collapse',...args]),beginWindowMove:(...args)=>calls.push(['begin',...args]),moveWindow:(...args)=>calls.push(['move',...args]),endWindowMove:(...args)=>calls.push(['end',...args])}};
 const context={createApp:options=>{render=options.render;return{mount(){},unmount(){}}},reactive:x=>x,h:(component,props,slots)=>({component,props,slots}),StatusBar:'status',PanelToggle:'toggle',WindowActions:'actions',createPanelWindowApi:()=>({})};
 const source=read('src/components/ファイル閲覧/別窓タイトル.js').replace(/^import .*;$/gm,'').replace('export function','function');
 vm.runInNewContext(source+'\nthis.mount=mountPanelTitle;',context);
 const cleanup=context.mount(host,child,owner,'Viewer',kind);
 assert.ok(classes.has('ai-component'));assert.equal(render().props.hideConnectionBar,false);
 const toggle=render().slots.leading();assert.equal(toggle.props.collapsed,false);assert.equal(toggle.props.windowContext,child);
 await toggle.props.windowApi.collapsePanel(true);toggle.props.windowApi.beginWindowMove();toggle.props.windowApi.moveWindow('token');toggle.props.windowApi.endWindowMove('token');
 assert.deepEqual(calls,[['collapse',true,'owned-panel'],['begin','owned-panel'],['move','token','owned-panel'],['end','token','owned-panel']]);
 toggle.props.onToggle();assert.equal(render().slots.leading().props.collapsed,true);
 toggle.props.onHidden(true);assert.ok(classes.has('native-panel-collapsed'));assert.equal(render().props.hideConnectionBar,true);
 toggle.props.onHidden(false);assert.ok(!classes.has('native-panel-collapsed'));assert.equal(render().props.hideConnectionBar,false);
 cleanup();assert.ok(!classes.has('ai-component'));
});
test('Explorer embedded burger is preserved, native detached title uses toggle and Viewer keeps DOM',()=>{
 assert.match(read('src/components/ファイル閲覧/ファイル一覧.vue'),/v-if="!allDisplays&&!?\(detached&&nativePanels\)"/);
 const viewer=read('src/components/ファイル閲覧/閲覧ウィンドウ.vue');
 assert.match(viewer,/class="development-app viewer-window ai-component"/);
 assert.match(viewer,/:hide-connection-bar="panelHidden"/);
 assert.match(viewer,/<PanelToggle[^>]*@hidden="panelHidden=\$event"/);
 assert.doesNotMatch(viewer,/v-if="!panel(?:Hidden|Collapsed)"/);
 const css=read('src/style.css');assert.match(css,/\.native-panel-collapsed \.connection-bar/);assert.match(css,/\.viewer-window.panel-collapsed > :not\(\.panel-brand\)\{display:none!important\}/);
});
test('native Explorer removes its duplicate heading and moves tree tools to the search row',()=>{
 const source=read('src/components/ファイル閲覧/ファイル一覧.vue');
 const header=source.match(/<header v-if="!\(detached&&nativePanels\)">([\s\S]*?)<\/header>/)?.[1];
 assert.ok(header);assert.match(header,/explorer-burger/);
 assert.doesNotMatch(header,/explorer-collapse|explorer-refresh/);
 const row=source.match(/<div class="explorer-search-row">([\s\S]*?)<\/div><\/div>/)?.[1];
 assert.ok(row);assert.match(row,/検索方法/);assert.match(row,/explorer-content-tools/);assert.match(row,/explorer-collapse/);assert.match(row,/explorer-refresh/);
 assert.match(source,/\.explorer-content-tools\{[^}]*margin-left:auto/);
 assert.equal((source.match(/class="explorer-collapse"/g)||[]).length,1);
 assert.equal((source.match(/class="explorer-refresh"/g)||[]).length,1);
});
test('Explorer title reports live connection state rather than a second window label',()=>{
 const source=read('src/components/ファイル閲覧/別窓タイトル.js');
 assert.match(source,/status: kind === 'explorer' \? \(state.connected \? '接続済' : '未接続'\)/);
 assert.match(source,/state.connected = !!source\?\.classList.contains\('online'\)/);
});
