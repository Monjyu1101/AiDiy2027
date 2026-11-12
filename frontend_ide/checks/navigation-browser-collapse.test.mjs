// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('Navi単独とBrowser通常窓は共通タイトル切替、本文は破棄しない',()=>{
 for(const name of ['開発スペース/Naviパネル.vue','ブラウザ/ブラウザパネル.vue']){
  const source=read('src/components/'+name);
  assert.match(source,/import PanelToggle from/);if(name.startsWith('ブラウザ/')){assert.match(source,/<PanelToggle[^>]*@hidden="setPanelHidden"/);assert.match(source,/function setPanelHidden\(hidden\)\{panelHidden.value=hidden;if\(hidden\)closeTabInfo\(\)/);}else assert.match(source,/<PanelToggle[^>]*@hidden="panelHidden=\$event"/);
  assert.match(source,/'panel-collapsed':/);assert.doesNotMatch(source,/v-if="!panelCollapsed"/);
 }
 const browser=read('src/components/ブラウザ/ブラウザパネル.vue');assert.match(browser,/<PanelToggle v-if="!headerOnly"/);
});
test('Navi・Explorer・Viewer別窓は対象窓名を指定して切替を付ける',()=>{
 const source=read('src/components/ファイル閲覧/別窓タイトル.js');
 assert.match(source,/collapsePanel\(value, child.name\)/);assert.match(source,/windowContext: child/);
 assert.match(source,/collapsible \? \{ leading:/);
 assert.match(source,/\['panel-navigation', 'explorer', 'panel-viewer'\]\.includes\(kind\)/);
 assert.match(read('src/components/開発スペース/Naviパネル.vue'),/navigation-window-collapsed > :not\(\.panel-window-title\)/);
});
test('Browser別Viewは接続復帰しても閉状態を維持し、表示寸法変更とは排他',()=>{
 const source=read('デスクトップ/ブラウザ.cjs');
 assert.match(source,/tab.view.setVisible\(tab===entry.active&&entry.available&&!entry.panelCollapsed&&!tab.pageLoadFailed\)/);
 assert.match(source,/function canCollapse[^\n]*isSettled/);
 assert.match(source,/entry.sizing.setPanelCollapsed\(collapsed\)/);
 assert.match(source,/if\(entry.panelCollapsed&&name==='fullscreen'\)/);
});
