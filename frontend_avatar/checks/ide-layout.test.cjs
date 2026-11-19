// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict');
const {sanitizeSnapshot,createLayoutController,fitsWorkAreas,showInitialPanels,readInitialLayout}=require('../electron/IDE窓配置.cjs');
const bounds={x:20,y:30,width:500,height:500};
const motion={steps:20,stepDelay:0,duration:0,startAt:0};
function window(role,visible=true){return{role,visible,bounds:{...bounds},moves:[],isVisible(){return this.visible;},isDestroyed:()=>false,getBounds(){return this.bounds;},setBounds(value){this.moves.push(value);this.bounds=value;}};}
test('geometry allowlist excludes credentials, hidden windows and transient dialogs',()=>{
 const windows=[window('core'),window('chat',false),window('settings')];
 const controller=createLayoutController({windows:()=>windows,roleOf:w=>w.role});
 assert.deepEqual(controller.capture(),{windows:[{role:'core',bounds}],visiblePanels:[]});
 assert.deepEqual(sanitizeSnapshot({token:'secret',windows:[{role:'core',bounds:{...bounds,session:'secret'},token:'secret'}]}),{windows:[{role:'core',bounds}]});
 for(const value of [{windows:[{role:'settings',bounds}]},{windows:[{role:'core',bounds:{...bounds,x:NaN}}]},{windows:[{role:'core',bounds:{...bounds,width:0}}]},{windows:[{role:'core',bounds},{role:'core',bounds}]},{windows:Array(13).fill({role:'core',bounds})}])assert.equal(sanitizeSnapshot(value),null);
});
test('restore uses current display, falls back to initial placement if partly offscreen, and supports negative monitors',async()=>{
 const core=window('core'),windows=[core];
 const initial={x:40,y:40,width:520,height:620};
 const screen={getAllDisplays:()=>[{workArea:{x:-1000,y:0,width:1000,height:900}},{workArea:{x:0,y:0,width:1000,height:900}}]};
 const controller=createLayoutController({windows:()=>windows,roleOf:w=>w.role,screen,initialBoundsOf:()=>initial});
 assert.equal(await controller.restore({windows:[{role:'core',bounds:{...bounds,x:800}}]},motion),true);
 assert.deepEqual(core.bounds,initial);
 await controller.restore({windows:[{role:'core',bounds:{...bounds,x:-900}}]},motion);assert.equal(core.bounds.x,-900);
 assert.equal(await controller.restore({windows:[{role:'chat',bounds}]},motion),false,'a missing or hidden saved panel must not count as restored');
 assert.equal(await controller.restore({windows:[{role:'core',bounds:{...bounds,x:Infinity}}]},motion),false);
});

test('saved bounds may span adjacent negative monitors but not display gaps or taskbar holes',async()=>{
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
 await controller.restore({windows:[{role:'core',bounds:target}]},motion);assert.deepEqual(core.bounds,target);
 areas=[left,{...right,x:20}];
 await controller.restore({windows:[{role:'core',bounds:target}]},motion);assert.deepEqual(core.bounds,initial);
});

test('capture saves open panel state, not momentary OS visibility',()=>{
 const windows=[window('core'),window('chat',false),window('file'),window('code6',false),window('settings')];
 const controller=createLayoutController({windows:()=>windows,roleOf:w=>w.role,panelOpen:role=>['chat','code6'].includes(role)});
 assert.deepEqual(controller.capture(),{windows:['core','chat','code6'].map(role=>({role,bounds})),visiblePanels:['chat','code6']});
 for(const visiblePanels of [null,['core'],['settings'],['chat','chat'],Array(1),{chat:true}]){
  assert.equal(sanitizeSnapshot({windows:[],visiblePanels}),null);
 }
});

test('startup shows only the saved panels at their initial bounds; later glide moves them together',async()=>{
 const core=window('core'),chat=window('chat',false),code=window('code6',false),image=window('image',false);
 const windows=[core,chat,code,image],events=[];
 const target={x:220,y:230,width:700,height:700};
 const actions={
  show:async role=>{const win=windows.find(w=>w.role===role);assert.deepEqual(win.bounds,bounds);assert.equal(win.moves.length,0);win.visible=true;events.push(role);},
  isVisible:role=>windows.find(w=>w.role===role)?.visible===true,
 };
 const snapshot={windows:[{role:'image',bounds:target},{role:'core',bounds:target},{role:'chat',bounds:target}],
  visiblePanels:['chat','code6'],coreDisplay:'カレンダー'};
 assert.equal(await showInitialPanels(snapshot,actions),true);
 assert.deepEqual(events,['chat','code6']);
 assert.deepEqual(core.bounds,bounds);
 assert.deepEqual([...windows.filter(w=>w.visible).map(w=>w.role)],['core','chat','code6']);
 const controller=createLayoutController({windows:()=>windows,roleOf:w=>w.role,screen:{getAllDisplays:()=>[{workArea:{x:0,y:0,width:2000,height:1200}}]}});
 assert.equal(await controller.restore(snapshot,motion),true);
 for(const w of [core,chat]){
  assert.equal(w.moves.length,20);
  assert.deepEqual(w.moves[0],{x:30,y:40,width:510,height:510});
  assert.deepEqual(w.moves.at(-1),target);
 }
 assert.equal(code.moves.length,0,'panels without saved geometry remain at the initial position');
 assert.equal(image.moves.length,0,'explicitly closed panels are never moved');
 assert.equal(await showInitialPanels({windows:[{role:'image',bounds}]},actions),true,'old geometry-only saves still open the panel');
 assert.equal(await showInitialPanels({windows:[],visiblePanels:['file']},{...actions,show:async()=>{}}),false);
});

test('Avatar glide aborts before the next step after its IDE parent is lost',async()=>{
 const core=window('core'),target={...bounds,x:220};
 const controller=createLayoutController({windows:()=>[core],roleOf:w=>w.role,screen:{getAllDisplays:()=>[{workArea:{x:0,y:0,width:2000,height:1200}}]}});
 await assert.rejects(controller.restore({windows:[{role:'core',bounds:target}]},motion,()=>{if(core.moves.length===3)throw Error('closed');}),/closed/);
 assert.equal(core.moves.length,3);
 assert.notDeepEqual(core.bounds,target);
});

test('Sv captures and Ld forwards every Avatar core display choice, but no arbitrary text',async()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/components/AIコア.vue'),'utf8');
 const select=source.match(/<select :value="表示選択" @change="表示選択変更">[\s\S]*?<\/select>/)?.[0];
 assert.ok(select);
 const modes=[...select.matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(modes.length,9);
 assert.ok(modes.includes('カレンダー')&&modes.includes('カレンダーα'));
 const core=window('core');
 for(const coreDisplay of modes){
  const controller=createLayoutController({windows:()=>[core],roleOf:w=>w.role,coreDisplay:()=>coreDisplay});
  const saved=controller.capture();
  assert.equal(saved.coreDisplay,coreDisplay);
  assert.equal(readInitialLayout(JSON.stringify({...saved,token:'not-transferred'})).coreDisplay,coreDisplay);
  assert.equal(readInitialLayout(JSON.stringify({...saved,token:'not-transferred'})).token,undefined);
 }
 for(const coreDisplay of [null,'not-an-option',{type:'calendar'},''])assert.equal(sanitizeSnapshot({windows:[],coreDisplay}),null);
 assert.deepEqual(sanitizeSnapshot({windows:[],visiblePanels:[]}),{windows:[],visiblePanels:[]});
 assert.equal(readInitialLayout('{bad'),null);
 assert.equal(readInitialLayout(' '.repeat(4097)),null);
 assert.deepEqual(readInitialLayout(JSON.stringify({windows:[]})),{windows:[]});
 const main=require('node:fs').readFileSync(require('node:path').join(__dirname,'../electron/main.ts'),'utf8');
 const preload=require('node:fs').readFileSync(require('node:path').join(__dirname,'../electron/preload.ts'),'utf8');
 assert.match(main,/ideManagedAvatar && windowRoles.get\(window.id\) === 'core' \? \{ initialCoreDisplay: coreDisplay \}/);
 assert.match(preload,/initialCoreDisplay: metadata.initialCoreDisplay/);
 const refExpression=source.match(/^const 表示選択 = ref\((.*)\)$/m)[1];
 for(const value of modes)assert.equal(require('node:vm').runInNewContext(refExpression,{window:{desktopApi:{initialCoreDisplay:value}}}),value);
 assert.equal(require('node:vm').runInNewContext(refExpression,{window:{}}),'アバター');
 assert.equal(require('node:vm').runInNewContext(refExpression,{}),'アバター');
});
