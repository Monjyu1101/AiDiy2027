// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');
const assert=require('node:assert/strict');
const {Macメニューを設定}=require('../scripts/MacOS-Menu.cjs');

test('Mac の全7アプリはアプリ名と閉じるだけを表示し、native編集操作を保持する',()=>{
 for(const 名前 of ['AiDiy 診断','AiDiy Console','AiDiy Code','AiDiy Live','AiDiy IDE','AiDiy Avatar','AiDiy Discord']){
  let menu,dock,icon,closed=0,childClosed=0;
  const app={dock:{setMenu(value){dock=value;},setIcon(value){icon=value;}}};
  const Menu={buildFromTemplate:items=>items,setApplicationMenu(value){menu=value;}};
  Macメニューを設定({app,Menu,名前,閉じる:()=>closed++,icon:'/fixture/icon.png',platform:'darwin'});
  assert.equal(menu.length,1);assert.equal(menu[0].label,名前);
  const visible=menu[0].submenu.filter(item=>item.visible!==false);
  assert.equal(visible.length,1);assert.equal(visible[0].label,'閉じる');
  visible[0].click();dock[0].click();assert.equal(closed,2);assert.equal(icon,'/fixture/icon.png');
  const windowClose=menu[0].submenu.find(item=>item.accelerator==='Command+W');
  windowClose.click(null,{isDestroyed:()=>false,close(){childClosed++;}});
  assert.equal(childClosed,1);assert.equal(closed,2,'子窓の⌘Wでアプリ全体を閉じない');
  windowClose.click(null);assert.equal(closed,3);
  const roles=menu[0].submenu.filter(item=>item.role);
  assert.deepEqual(roles.map(item=>item.role),['undo','redo','cut','copy','paste','pasteAndMatchStyle','selectAll']);
  assert.ok(roles.every(item=>item.visible===false&&item.acceleratorWorksWhenHidden));
  assert.equal(roles.find(item=>item.role==='copy').accelerator,'Command+C');
 }
});

test('Windows / Linux のメニュー、アプリ終了、キー入力には介入しない',()=>{
 for(const platform of ['win32','linux'])Macメニューを設定({platform,app:{},閉じる(){assert.fail('閉じない');}});
});
