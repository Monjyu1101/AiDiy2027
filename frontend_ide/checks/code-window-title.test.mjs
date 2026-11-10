// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import layoutModule from '../デスクトップ/window-layout.cjs';
import avatarModule from '../デスクトップ/Avatar起動.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import taskWindowsModule from '../デスクトップ/task-windows.cjs';
import routerModule from '../デスクトップ/draft-router.cjs';
import panelModule from '../デスクトップ/panel-windows.cjs';
import navigationCodeWindowModule from '../デスクトップ/navigation-code-window.cjs';
import codeDragModule from '../デスクトップ/code-drag.cjs';
import browserModule from '../デスクトップ/ブラウザ.cjs';
import nativeMoveModule from '../デスクトップ/長押し窓移動.cjs';
import pinModule from '../デスクトップ/最前面ピン.cjs';
import placementModule from '../デスクトップ/VRパネル配置.cjs';
import stackingModule from '../デスクトップ/VRパネル前面.cjs';
import macMenuModule from '../host/scripts/MacOS-Menu.cjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function desktopFixture({platform='win32',kind='ide',active=true,response=1,env={}}={}){
 const reserved=new Set();let sharedStarts=0;
 const handlers=new Map(),state={active,mode:'online',startedAt:10,project:{path:'/project'}},created=[],dialogs=[];
 class Window extends EventEmitter{
  constructor(options){super();created.push(this);this.options=options;this.title=options.title;this.bounds=options;this.webContents=new EventEmitter();this.webContents.mainFrame={url:''};this.webContents.setWindowOpenHandler=()=>{};this.webContents.executeJavaScript=async()=>{};this.messages=[];this.webContents.send=(...args)=>this.messages.push(args);}
  isDestroyed(){return !!this.destroyed;}
  getBounds(){return this.bounds;}
  setBounds(bounds){this.bounds=bounds;}
  setAlwaysOnTop(value,level){this.top=value;this.topLevel=level;this.topCalls=(this.topCalls||0)+1;}
  isAlwaysOnTop(){return !!this.top;}
  setParentWindow(value){this.parent=value;}
  getParentWindow(){return this.parent||null;}
  setTitle(title){this.title=title;}
  getTitle(){return this.title;}
  async loadURL(url){this.loadedURL=url;this.webContents.mainFrame.url=url.split('#')[0];}
  destroy(){this.destroyed=true;this.emit('closed');}
  close(){const event={preventDefault(){this.prevented=true;}};this.emit('close',event);if(!event.prevented){this.destroy();if(created.every(window=>window.destroyed))app.emit('window-all-closed');}}
  isMinimized(){return false;}
  show(){}
  focus(){this.emit('focus');}
  moveTop(){this.raises=(this.raises||0)+1;}
 }
 const app=new EventEmitter();Object.assign(app,{setName(name){this.name=name;},getPath:()=>'/tmp',setPath(){},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),quit(){const event={preventDefault(){this.prevented=true;}};app.emit('before-quit',event);if(!event.prevented)app.quitComplete=true;},dock:{setMenu(value){this.menu=value;},setIcon(value){this.icon=value;}}});
 const Menu={buildFromTemplate:items=>items,setApplicationMenu(value){app.menu=value;}};
 const modules={
  electron:{app,BrowserWindow:Window,Menu,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on(){}},shell:{},clipboard:{},session:{defaultSession:{setPermissionCheckHandler(){},setPermissionRequestHandler(){}}},screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1920,height:1040}}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1920,height:1040}}),getCursorScreenPoint:()=>({})},dialog:{showMessageBox:async(_window,options)=>{dialogs.push(options);return{response};}}},
  './デスクトップ/Avatar起動.cjs':avatarModule,
  'node:path':{join:(...parts)=>parts.join('/'),resolve:(...parts)=>parts.join('/')},'node:fs':{mkdirSync(){},mkdtempSync:()=>'/tmp/console-fixture',rmSync(){}},
  './host/scripts/project-storage.cjs':{projectRoot:()=>'/project',programDataDirectory:(_project,program,_root,children=[])=>['/project/_AIDIY',program,...children].join('/'),preparePrivateDirectory(){}},
  './デスクトップ/タスクチーム起動.cjs':{taskTeamProfile:()=>'/tmp/test-task'},
  './デスクトップ/navigation-code-window.cjs':navigationCodeWindowModule,
  './デスクトップ/project-profile.cjs':{projectProfile:()=>'/tmp/test'},'./デスクトップ/window-layout.cjs':{windowBounds:(kind,...args)=>kind==='cpu'?layoutModule.windowBounds(kind,...args):({}),windowMinimumSize:(kind,...args)=>kind==='cpu'?layoutModule.windowMinimumSize(kind,...args):({})},'./デスクトップ/console-window-slot.cjs':{reserveConsoleSlot:async()=>{let slot=0;while(reserved.has(slot))slot++;reserved.add(slot);return{slot,close(){reserved.delete(slot);}};}},
  './host/scripts/window-opening.cjs':{拡大表示:async(_Window,window)=>{window.focus();return true;}},
  './host/scripts/MacOS-Menu.cjs':macMenuModule,
  './デスクトップ/task-windows.cjs':taskWindowsModule,
  './デスクトップ/draft-router.cjs':routerModule,'./デスクトップ/desktop-session.cjs':{readDevelopmentState:async()=>structuredClone(state)},
  // タイトル・寿命の試験から実共有サーバーや画像保存を起動しない。
  './デスクトップ/下書き共有.cjs':{createSharedDraftBridge:async()=>{sharedStarts++;return{close:async()=>{},viewerStatus:async()=>({ideRunning:false,viewerAvailable:false})};}},
  './デスクトップ/ブラウザ撮影.cjs':{saveBrowserCapture:()=>assert.fail('タイトル試験ではBrowser撮影を実行しない')},
  './デスクトップ/native-preview-actions.cjs':{createNativePreviewActions:()=>({invalidate(){}})},
  './デスクトップ/panel-windows.cjs':panelModule,'./デスクトップ/code-drag.cjs':codeDragModule,
  './デスクトップ/ブラウザ.cjs':browserModule,
  './デスクトップ/ブラウザ解析連携.cjs':{createBrowserAnalysisContext:()=>async()=>assert.fail('タイトル試験ではBrowser解析を開かない'),createBrowserSourceSelection:()=>async()=>assert.fail('タイトル試験ではBrowser解析ソースの選択を実行しない')},
  './デスクトップ/長押し窓移動.cjs':nativeMoveModule,
  './デスクトップ/最前面ピン.cjs':pinModule,
  './デスクトップ/VRパネル配置.cjs':placementModule,
  './デスクトップ/VRパネル前面.cjs':stackingModule,
  './デスクトップ/全画面横断.cjs':{createAllDisplays:({syncChildren})=>{let active=false;return{register(){},attachExitKey:()=>()=>{},leave:()=>false,isActive:()=>active,handle(event,action){if(action==='toggle')active=!active;const owner=[...api.windows.values()].find(record=>record.window.webContents===event.sender);syncChildren(owner);return{ok:true,active};}};}},
 };
 const source=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
 const proc=new EventEmitter();Object.assign(proc,{platform,env:{AIDIY_DEVELOPMENT_URL:'http://127.0.0.1:1234/',AIDIY_DEVELOPMENT_KIND:kind,...env},cwd:()=>'/project'});
 const api=vm.runInNewContext(`(()=>{${source}\nreturn {createWindow,windows,draftRouter};})()`,{require:id=>{if(!(id in modules))throw Error(id);return modules[id];},process:proc,__dirname:'/fixture',console,setInterval:()=>({unref(){}}),clearInterval(){}});
 await tick();const owner=[...api.windows.values()][0];
 return{...api,app,proc,dialogs,owner,handlers,sharedStarts:()=>sharedStarts,event:record=>({sender:record.window.webContents,senderFrame:record.window.webContents.mainFrame}),
  async code(){const window=await api.createWindow('code','http://127.0.0.1:5678/',undefined,owner,'online:10');const record=api.windows.get(window.webContents);api.draftRouter.register(record,{kind:'code',contextId:`context-${record.slot}`,projectPath:'/project',label:'Code'});return record;}};
}

test('Mac のConsole / Code / Live / IDEは名称と最小メニューを各起動入口から設定する',async()=>{
 for(const [kind,name] of [['console','Console'],['code','Code'],['live','Live'],['ide','IDE']]){
  const f=await desktopFixture({platform:'darwin',kind,active:false});assert.equal(f.app.name,'AiDiy '+name);assert.equal(f.app.menu[0].label,'AiDiy '+name);
  f.app.menu[0].submenu[0].click();await tick();await tick();assert.equal(f.owner.window.isDestroyed(),true);assert.equal(f.app.quitComplete,true);assert.equal(f.dialogs.length,0);
 }
});
test('Mac のDock終了はIDEの利用中確認を通り、親切断だけは既存の回収へ進む',async()=>{
 const f=await desktopFixture({platform:'darwin'}),child=await f.code();
 f.app.quit();await tick();assert.equal(f.dialogs.length,1);assert.equal(f.owner.window.isDestroyed(),false);assert.equal(child.window.isDestroyed(),false);assert.equal(f.app.quitComplete,undefined);
 const closeChild=f.app.menu[0].submenu.find(item=>item.accelerator==='Command+W');closeChild.click(null,child.window);await tick();assert.equal(child.window.isDestroyed(),true);assert.equal(f.owner.window.isDestroyed(),false);
 f.proc.emit('disconnect');await tick();await tick();assert.equal(f.owner.window.isDestroyed(),true);assert.equal(f.app.quitComplete,true);assert.equal(f.dialogs.length,1);
 const accepted=await desktopFixture({platform:'darwin',response:0});accepted.app.dock.menu[0].click();await tick();await tick();assert.equal(accepted.owner.window.isDestroyed(),true);assert.equal(accepted.app.quitComplete,true);
});

test('IDE Code番号: 実createWindowのslotをタイトル・限定IPC・連携先一覧で共有し、閉鎖後の再利用も一致する',async()=>{
 const f=await desktopFixture();const first=await f.code(),second=await f.code(),third=await f.code();
 const verify=async records=>{
  const snapshot=await f.draftRouter.list(f.owner);
  for(const record of records){const label=`Code ${record.slot+1}`;
   assert.equal(record.window.getTitle(),`AiDiy IDE / ${label}`);
   assert.equal(f.handlers.get('development:window')(f.event(record),'title'),`AiDiy IDE / ${label}`);
   assert.equal(snapshot.targets.find(target=>target.id===record.draftId).label,label);
  }
 };
 await verify([first,second,third]);assert.deepEqual([first.slot,second.slot,third.slot],[0,1,2]);
 second.window.destroy();const reopened=await f.code();assert.equal(reopened.slot,1);assert.notEqual(reopened.draftId,second.draftId);
 await verify([first,third,reopened]);
 first.window.destroy();third.window.destroy();reopened.window.destroy();const restarted=await f.code();assert.equal(restarted.slot,0);await verify([restarted]);
 assert.equal(f.handlers.get('development:window')({sender:{},senderFrame:{}},'title'),undefined);
 const standalone=await f.createWindow('code','http://127.0.0.1:6789/');assert.equal(standalone.getTitle(),'AiDiy Code');
});

test('IDE再フォーカスは子パネルのOFFを上書きせず、選択されたON窓だけが同じ層の手前へ移る',async()=>{
 const f=await desktopFixture(),child=await f.code(),other=await f.code(),standalone=await f.createWindow('code','http://127.0.0.1:6789/');
 const action=(record,command)=>f.handlers.get('development:window')(f.event(record),command);
 assert.equal(child.window.top,true);assert.equal(other.window.top,true);assert.equal(standalone.top,false);assert.equal(f.owner.window.top,false);
 assert.equal(child.window.topLevel,process.platform==='win32'?'normal':'floating');assert.equal(child.window.getParentWindow(),null,'ピンONでもOS上は独立');
 const bounds=child.window.getBounds();action(child,'toggle-pin');assert.equal(child.window.top,false);assert.equal(child.window.getParentWindow(),null);
 const raises=other.window.raises;f.owner.window.focus();child.window.focus();
 assert.equal(child.window.top,false);assert.equal(other.window.raises,raises);assert.equal(child.window.getBounds(),bounds);
 other.window.focus();assert.equal(other.window.raises,raises+1);
 assert.equal(action(child,'pin-state').pinned,false);
 assert.equal(action(child,'toggle-pin').pinned,true);assert.equal(child.window.getParentWindow(),null);child.window.focus();assert.ok(child.window.raises>0);
 assert.equal(f.handlers.get('development:window')({sender:{},senderFrame:{}},'toggle-pin'),undefined);
 assert.equal(f.handlers.get('development:window')({...f.event(child),senderFrame:{url:child.url}},'toggle-pin'),undefined);
});

test('VRは本体と既存・新規子窓のピンをロックし、終了後は各窓の元選択へ戻す',async()=>{
 const f=await desktopFixture(),off=await f.code(),on=await f.code();
 const action=(record,command)=>f.handlers.get('development:window')(f.event(record),command);
 action(off,'toggle-pin');f.handlers.get('development:all-displays')(f.event(f.owner),'toggle');
 for(const record of [f.owner,off,on]){assert.equal(action(record,'pin-state').locked,true);assert.equal(action(record,'toggle-pin').pinned,true);assert.equal(record.window.top,true);}
 const during=await f.code();assert.equal(action(during,'pin-state').locked,true);
 f.handlers.get('development:all-displays')(f.event(f.owner),'toggle');
 for(const record of [f.owner,off])assert.equal(action(record,'pin-state').pinned,false);
 for(const record of [on,during])assert.equal(action(record,'pin-state').pinned,true);
 for(const record of [f.owner,off,on,during])assert.equal(action(record,'pin-state').locked,false);
 assert.equal(action(on,'toggle-pin').pinned,false);
});

test('OS親子関係なしでもConsole / Code / Live / Viewerの起動元・個別終了・セッション終了を維持',async()=>{
 const f=await desktopFixture(),records=[];let closed=0;
 for(const kind of ['console','code','live','viewer']){
  const url=kind==='viewer'?'http://127.0.0.1:1234/#viewer=sample.txt':'http://127.0.0.1:5678/';
  const window=await f.createWindow(kind,url,{close:async()=>{closed++;}},f.owner,'online:10');
  const record=f.windows.get(window.webContents);records.push(record);
  assert.equal(window.options.parent,undefined);assert.notEqual(window.options.modal,true);
  assert.equal(window.getParentWindow(),null);assert.equal(record.owner,f.owner);assert.equal(record.linkKey,'online:10');
  assert.equal(window.top,true);assert.match(window.getTitle(),/^AiDiy IDE \/ /);
 }
 const counts=records.map(record=>record.window.raises);f.owner.window.focus();
 assert.deepEqual(records.map(record=>record.window.raises),counts,'本体を選んでも所属パネルは再前面化しない');
 records[0].window.close();assert.equal(f.owner.window.isDestroyed(),false);assert.equal(records[1].window.isDestroyed(),false);
 await f.handlers.get('development:end-session')(f.event(f.owner));
 for(const record of records){assert.equal(record.window.isDestroyed(),true);assert.equal(f.windows.has(record.window.webContents),false);}
 assert.equal(closed,4);assert.equal(f.owner.window.isDestroyed(),false);
 const next=await f.code();f.owner.window.destroy();assert.equal(next.window.isDestroyed(),true,'本体終了は所属窓を回収する');
});

test('preloadタイトル: 任意IPCを公開せずホストの同一ウィンドウタイトルだけを取得する',async()=>{
 let api;const calls=[];
 vm.runInNewContext(readFileSync(new URL('../デスクトップ/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld(_name,value){api=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve('AiDiy IDE / Code 2');}}})});
 assert.equal(await api.title(),'AiDiy IDE / Code 2');assert.deepEqual(calls,[['development:window','title']]);assert.equal(api.invoke,undefined);
});


test('IDE Console番号: 共有配置slot・タイトルIPC・閉鎖後の再利用が一致し、単独Consoleは従来タイトルを保つ',async()=>{
 const f=await desktopFixture();
 const create=async owner=>{const window=await f.createWindow('console','http://127.0.0.1:6789/',undefined,owner,'online:10');return f.windows.get(window.webContents);};
 const standalone=await create();assert.equal(standalone.slot,0);assert.equal(standalone.window.getTitle(),'AiDiy Console');
 const terms=await Promise.all([create(f.owner),create(f.owner),create(f.owner)]);
 assert.deepEqual(terms.map(record=>record.slot),[1,2,3]);
 const verify=record=>{
  const title=`AiDiy IDE / Console ${record.slot+1}`;
  assert.equal(record.window.getTitle(),title);
  assert.equal(f.handlers.get('development:window')(f.event(record),'title'),title);
  let prevented=false;record.window.title='shell title';record.window.webContents.emit('page-title-updated',{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(record.window.getTitle(),title);
 };
 terms.forEach(verify);
 terms[1].window.destroy();const reopened=await create(f.owner);assert.equal(reopened.slot,2);verify(reopened);
 standalone.window.destroy();const first=await create(f.owner);assert.equal(first.slot,0);verify(first);
 assert.equal(f.handlers.get('development:window')({...f.event(first),senderFrame:{url:first.url}},'title'),undefined);
 for(const record of [...terms,reopened,first])if(!record.window.isDestroyed())record.window.destroy();
 const restarted=await create(f.owner);assert.equal(restarted.slot,0);verify(restarted);
 restarted.window.destroy();
});


test('Task実host: ログイン後3枚は同格、要求を閉じても継続し他窓から再表示、3枚全閉で終了',async()=>{
 const f=await desktopFixture({kind:'task'});await tick();
 const records=()=>[...f.windows.values()];
 assert.equal(records().length,1);
 await f.handlers.get('development:task-session')(f.event(records()[0]),'set',{token:'test-token',expectedRevision:0});
 assert.equal(records().length,3);
 assert.deepEqual(records().map(r=>r.taskView).sort(),['detail','flow','request']);
 for(const r of records()){
  assert.equal(r.owner,undefined);assert.equal(r.server,undefined);assert.equal(r.window.getParentWindow(),null);
  assert.equal(r.window.options.width,520);assert.equal(r.window.options.height,620);
  assert.ok(r.window.getTitle().startsWith('AiDiy Task / '));assert.ok(!r.window.getTitle().includes('IDE'));
 }
 const request=records().find(r=>r.taskView==='request'),flow=records().find(r=>r.taskView==='flow');
 request.window.close();await tick();assert.equal(flow.window.isDestroyed(),false);assert.equal(f.app.quitComplete,undefined);
 const action=(record,type,payload)=>f.handlers.get('development:task-windows')(f.event(record),type,payload);
 assert.equal((await action(flow,'open',{view:'request'})).ok,true);assert.equal(records().length,3);
 await action(flow,'dialog',{kind:'request',編集タスク:null});assert.equal(records().length,4);
 const editor=records().find(r=>r.taskView==='dialog');
 for(const r of records())if(r.taskView!=='dialog')r.window.close();await tick();await tick();
 assert.equal(editor.window.isDestroyed(),true);assert.equal(f.app.quitComplete,true);assert.equal(f.windows.size,0);
});

test('Mac Task: CmdW closes one peer but application/Dock Quit closes all peers and editor',async()=>{
 const f=await desktopFixture({platform:'darwin',kind:'task'});await tick();
 const records=()=>[...f.windows.values()];
 await f.handlers.get('development:task-session')(f.event(records()[0]),'set',{token:'test-token',expectedRevision:0});
 const request=records().find(r=>r.taskView==='request'),flow=records().find(r=>r.taskView==='flow');
 const closeWindow=f.app.menu[0].submenu.find(item=>item.accelerator==='Command+W');
 closeWindow.click(null,request.window);await tick();assert.equal(records().length,2);assert.equal(f.app.quitComplete,undefined);
 await f.handlers.get('development:task-windows')(f.event(flow),'dialog',{kind:'request',編集タスク:null});
 f.app.dock.menu[0].click();await tick();await tick();assert.equal(records().length,0);assert.equal(f.app.quitComplete,true);assert.equal(f.dialogs.length,0);
 const second=await desktopFixture({platform:'darwin',kind:'task'});await tick();second.app.quit();await tick();await tick();
 assert.equal(second.windows.size,0);assert.equal(second.app.quitComplete,true);
});

 test('Task real host logout with closed primary restores login panel without quitting',async()=>{
 const f=await desktopFixture({kind:'task'});await tick();
 const records=()=>[...f.windows.values()];const primary=records()[0];
 const session=(record,value)=>f.handlers.get('development:task-session')(f.event(record),'set',value);
 await session(primary,{token:'test-token',expectedRevision:0});
 const flow=records().find(r=>r.taskView==='flow');primary.window.close();await tick();
 await session(flow,{token:'',expectedRevision:1});await tick();
 assert.deepEqual(records().map(r=>r.taskView),['request']);assert.equal(f.app.quitComplete,undefined);
 records()[0].window.close();await tick();await tick();assert.equal(f.app.quitComplete,true);
 });


test('CLI Console: native title and title IPC retain the selected display name after page title changes',async()=>{
 for(const name of ['Claude Code','Codex CLI','GitHub Copilot CLI','Antigravity CLI','Grok Build','OpenCode','Hermes']){
  const f=await desktopFixture({kind:'console',env:{AIDIY_DEVELOPMENT_CLI_WINDOW:'1',AIDIY_DEVELOPMENT_CLI_NAME:name}});
  const record=f.owner,title=`AiDiy Console / ${name}`;
  assert.equal(record.window.getTitle(),title);
  assert.equal(f.handlers.get('development:window')(f.event(record),'title'),title);
  record.window.title='CLI process title';record.window.webContents.emit('page-title-updated',{preventDefault(){}});
  assert.equal(record.window.getTitle(),title);
  record.window.destroy();
 }
 const ordinary=await desktopFixture({kind:'console',env:{AIDIY_DEVELOPMENT_CLI_NAME:'stale name'}});
 assert.equal(ordinary.owner.window.getTitle(),'AiDiy Console');ordinary.owner.window.destroy();
});


test('Console browser tab title uses launch metadata and leaves ordinary and linked titles unchanged',async()=>{
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'');
 for(const [config,title] of [
  [{kind:'console',cliName:'Hermes'},'AiDiy Console / Hermes'],
  [{kind:'console',cliName:'GitHub Copilot CLI'},'AiDiy Console / GitHub Copilot CLI'],
  [{kind:'console'},'AiDiy Console'],
  [{kind:'console',linked:true},'AiDiy IDE / Console'],
  [{kind:'code',cliName:'ignored'},'AiDiy Code'],
 ]){
  const document={documentElement:{style:{setProperty(){}}},getElementById:id=>id==='development-config'?{textContent:JSON.stringify(config)}:{}};
  const mounted=[];
  vm.runInNewContext(source,{document,devicePixelRatio:1,addEventListener(){},App:{},createApp:(_app,props)=>({provide(){return this;},mount(){mounted.push(props);}})});
  await tick();assert.equal(document.title,title);assert.equal(mounted.length,1);
 }
});

test('Navi native Cruise title survives page updates and restores without changing Code or IDE',async()=>{
 const f=await desktopFixture({kind:'navi'}),record=f.owner,change=f.handlers.get('development:navigation-cruise');
 assert.equal((await change(f.event(record),true)).ok,true);assert.equal(record.window.getTitle(),'AiDiy Navi Cruise');
 record.window.webContents.emit('page-title-updated',{preventDefault(){}},'AiDiy Navi');assert.equal(record.window.getTitle(),'AiDiy Navi Cruise');
 assert.equal((await change(f.event(record),false)).ok,true);assert.equal(record.window.getTitle(),'AiDiy Navi');
 record.window.webContents.emit('page-title-updated',{preventDefault(){}},'Navi Cruise');assert.equal(record.window.getTitle(),'AiDiy Navi');record.window.destroy();
 for(const kind of ['ide','code']){
  const other=await desktopFixture({kind});const normal=other.owner.window.getTitle();
  assert.equal((await other.handlers.get('development:navigation-cruise')(other.event(other.owner),true)).ok,false);
  assert.equal(other.owner.window.getTitle(),normal);other.owner.window.destroy();
 }
});

test('IDE起動案内: Code/Live未起動のIDEも検出用の共有登録を開始し、単独Codeは従来どおり遅延する',async()=>{
 const ide=await desktopFixture({kind:'ide',active:false});assert.equal(ide.windows.size,1);assert.equal(ide.sharedStarts(),1);
 const code=await desktopFixture({kind:'code'});assert.equal(code.sharedStarts(),0);
});

 test('CPU uses one IDE-owned small window and closes with the session',async()=>{
 const f=await desktopFixture(),open=f.handlers.get('development:open-app');
 const [a,b]=await Promise.all([open(f.event(f.owner),'cpu'),open(f.event(f.owner),'cpu')]);assert.equal(a.ok,true);assert.equal(b.ok,true);
 const cpu=[...f.windows.values()].filter(r=>r.kind==='cpu');assert.equal(cpu.length,1);assert.equal(cpu[0].window.title,'AiDiy IDE / CPU');assert.equal(cpu[0].owner,f.owner);assert.equal(cpu[0].window.options.width,240);assert.equal(cpu[0].window.options.height,160);assert.equal(cpu[0].window.loadedURL,'http://127.0.0.1:1234/#cpu');
 assert.equal((await open(f.event(f.owner),'cpu')).reused,true);
 const action=command=>f.handlers.get('development:window')(f.event(cpu[0]),command);
 const pinned=action('pin-state').pinned;assert.equal(action('toggle-pin').pinned,!pinned);assert.equal(action('toggle-pin').pinned,pinned);
 await f.handlers.get('development:end-session')(f.event(f.owner));assert.equal(cpu[0].window.isDestroyed(),true);
 });


test('standalone CPU has its own name, icon, small bounds and no IDE owner',async()=>{
 for(const platform of ['win32','darwin']){
  const f=await desktopFixture({kind:'cpu',platform}),r=f.owner;
  assert.equal(r.window.title,'AiDiy CPU');assert.equal(r.window.options.width,240);assert.equal(r.window.options.height,160);assert.equal(r.owner,undefined);assert.match(r.window.options.icon,/AiDiy_cpu.png$/);
  assert.equal(f.app.name,platform==='darwin'?'AiDiy CPU':'aidiy_cpu');r.window.destroy();
 }
});
