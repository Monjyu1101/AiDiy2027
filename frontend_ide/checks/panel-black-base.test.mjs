// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('通常窓と別パネルのnative基本背景は黒、専用の透明窓は維持する',()=>{
 const desktop=read('../desktop.cjs'),panels=read('../デスクトップ/panel-windows.cjs');
 assert.match(desktop,/backgroundColor:'#000'/);
 assert.match(desktop,/kind==='cpu'\?\{transparent:true,backgroundColor:'#00000000'/);
 assert.match(panels,/backgroundColor:route\?'#00000000':'#000'/);
 assert.match(read('../../backend_diag/diag/起動/electron-main.cjs'),/transparent:true,hasShadow:false,backgroundColor:'#00000000'/);
});
test('外枠はタイトル同色を維持し、別パネルの表示ベースは黒',()=>{
 for(const path of ['../src/components/共通表示/タイトルバー配色.css','../../backend_diag/diag/ui/components/共通表示/タイトルバー配色.css']){
  const css=read(path);assert.match(css,/--aidiy-panel-border: var\(--aidiy-titlebar-background\);/);assert.match(css,/--aidiy-titlebar-background: #30343a;/);
 }
 assert.match(read('../src/components/開発スペース/Naviパネル.vue'),/\.navigation-window\{border:1px solid var\(--aidiy-titlebar-background\)/);
 const style=read('../src/style.css');
 assert.match(style,/\.native-panel-window\{display:flex;flex-direction:column;background:#000\}/);
 assert.match(style,/\.routes-window \.explorer-routes,\.routes-window \.explorer-routes.explorer-collapsed\{[^}]*background:#000;/);
 assert.match(style,/\.route-window-document,[^}]+background:transparent!important/);
});
