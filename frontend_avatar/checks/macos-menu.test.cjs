// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// build:electron の出力を検証。ネットワーク・音声・実GUIは起動しない。
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {readFileSync,existsSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const filename=path.join(__dirname,'../dist-electron/main.js'),load=createRequire(filename);

async function fixture(platform){
 const app=new EventEmitter();let ready,menu,quit=0,icon;const appIds=[];
 Object.assign(app,{setName(value){app.name=value;},setAppUserModelId(value){appIds.push(value);},setPath(){},getAppPath:()=>path.dirname(filename),requestSingleInstanceLock:()=>true,whenReady:()=>({then(callback){ready=callback;}}),quit(){quit++;},dock:{setMenu(value){app.dock.menu=value;},setIcon(value){icon=value;}}});
 const stop=new Error('fixture: stop before display/media initialization');
 const Menu={buildFromTemplate:items=>items,setApplicationMenu(value){menu=value;}};
 const electron={app,Menu,ipcMain:{on(){}},session:{defaultSession:{setDisplayMediaRequestHandler(){throw stop;}}}};
 vm.runInNewContext(readFileSync(filename,'utf8'),{__dirname:path.dirname(filename),exports:{},process:{platform,env:{}},console,URL,
  require:id=>id==='node:fs'?{mkdirSync(){}}:id==='electron'?electron:id.endsWith('project-storage.cjs') ? {...load(id),preparePrivateDirectory(){}} : id.endsWith('window-opening.cjs')?{拡大表示:async()=>true}:load(id)});
 await assert.rejects(ready(),error=>error===stop);
 return{app,menu,icon,appIds,quits:()=>quit};
}
test('Avatar の実行出力はMacの名前・最小メニュー・Dockを設定し、閉じるは全ウィンドウ終了へ渡す',async()=>{
 const f=await fixture('darwin');assert.equal(f.app.name,'AiDiy Avatar');assert.equal(f.menu[0].label,'AiDiy Avatar');assert.equal(f.icon,path.resolve(__dirname,'../public/icons/AiDiy_avatar.png'));assert.equal(existsSync(f.icon),true);
 f.menu[0].submenu[0].click();f.app.dock.menu[0].click();assert.equal(f.quits(),2);
 assert.equal(f.menu[0].submenu.filter(item=>item.visible!==false).length,1);
});
test('Avatar の Windows / Linux はMac専用メニューを設定しない',async()=>{
 for(const platform of ['win32','linux']){const f=await fixture(platform);assert.equal(f.menu,undefined);assert.equal(f.icon,undefined);assert.equal(f.quits(),0);}
});

test('Avatar Windowsタスクバー識別は窓初期化前に既存AppUserModelIdを維持',async()=>{
 const f=await fixture('win32');assert.deepEqual(f.appIds,['AiDiy.frontend_avatar']);
 for(const platform of ['darwin','linux'])assert.deepEqual((await fixture(platform)).appIds,[]);
});
