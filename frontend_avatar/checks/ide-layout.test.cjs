// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict');
const {sanitizeSnapshot,createLayoutController,fitsWorkAreas}=require('../electron/IDE窓配置.cjs');
const bounds={x:20,y:30,width:500,height:500};
function window(role,visible=true){return{role,visible,bounds:{...bounds},isVisible(){return this.visible;},isDestroyed:()=>false,getBounds(){return this.bounds;},setBounds(value){this.bounds=value;}};}
test('geometry allowlist excludes credentials, hidden windows and transient dialogs',()=>{
 const windows=[window('core'),window('chat',false),window('settings')];
 const controller=createLayoutController({windows:()=>windows,roleOf:w=>w.role});
 assert.deepEqual(controller.capture(),{windows:[{role:'core',bounds}]});
 assert.deepEqual(sanitizeSnapshot({token:'secret',windows:[{role:'core',bounds:{...bounds,session:'secret'},token:'secret'}]}),{windows:[{role:'core',bounds}]});
 for(const value of [{windows:[{role:'settings',bounds}]},{windows:[{role:'core',bounds:{...bounds,x:NaN}}]},{windows:[{role:'core',bounds:{...bounds,width:0}}]},{windows:[{role:'core',bounds},{role:'core',bounds}]},{windows:Array(13).fill({role:'core',bounds})}])assert.equal(sanitizeSnapshot(value),null);
});
test('restore uses current display, falls back to initial placement if partly offscreen, and supports negative monitors',()=>{
 const core=window('core'),windows=[core];
 const initial={x:40,y:40,width:520,height:620};
 const screen={getAllDisplays:()=>[{workArea:{x:-1000,y:0,width:1000,height:900}},{workArea:{x:0,y:0,width:1000,height:900}}]};
 const controller=createLayoutController({windows:()=>windows,roleOf:w=>w.role,screen,initialBoundsOf:()=>initial});
 assert.equal(controller.restore({windows:[{role:'core',bounds:{...bounds,x:800}}]}),true);
 assert.deepEqual(core.bounds,initial);
 controller.restore({windows:[{role:'core',bounds:{...bounds,x:-900}}]});assert.equal(core.bounds.x,-900);
 controller.restore({windows:[{role:'chat',bounds}]});const chat=window('chat');chat.bounds={...initial};windows.push(chat);controller.apply(chat);assert.deepEqual(chat.bounds,bounds);
 chat.bounds.x=77;controller.apply(chat);assert.equal(chat.bounds.x,77,'saved placement applies once, not on every show');
 assert.equal(controller.restore({windows:[{role:'core',bounds:{...bounds,x:Infinity}}]}),false);
});

test('saved bounds may span adjacent negative monitors but not display gaps or taskbar holes',()=>{
 const target={x:-200,y:100,width:500,height:500};
 const left={x:-1000,y:0,width:1000,height:900},right={x:0,y:0,width:1000,height:900};
 assert.equal(fitsWorkAreas(target,[left,right]),true);
 assert.equal(fitsWorkAreas(target,[right,left]),true);
 assert.equal(fitsWorkAreas(target,[left,{...right,x:1}]),false);
 assert.equal(fitsWorkAreas(target,[{...left,height:599},right]),false);
 assert.equal(fitsWorkAreas(target,[]),false);
 const core=window('core'),initial={x:40,y:40,width:520,height:620};
 let areas=[left,right];
 const controller=createLayoutController({windows:()=>[core],roleOf:w=>w.role,screen:{getAllDisplays:()=>areas.map(workArea=>({workArea}))},initialBoundsOf:()=>initial});
 controller.restore({windows:[{role:'core',bounds:target}]});assert.deepEqual(core.bounds,target);
 areas=[left,{...right,x:20}];
 controller.restore({windows:[{role:'core',bounds:target}]});assert.deepEqual(core.bounds,initial);
});
