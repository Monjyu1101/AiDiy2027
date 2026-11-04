// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {browserMode,desktopBinary,openDesktop,closeDesktop} from '../起動/desktop.mjs';
import miniWindow from '../起動/ミニ表示.cjs';
import microWindow from '../起動/マイクロ表示.cjs';
import resizeEffect from '../起動/サイズ切替.cjs';
import normalSize from '../起動/通常窓サイズ.cjs';
import closeWindow from '../起動/終了確認.cjs';
import macMenu from '../起動/MacOS-Menu.cjs';
import windowPins from '../../frontend_ide/デスクトップ/最前面ピン.cjs';
const url='http://127.0.0.1:1234/#token='+'a'.repeat(43);
function childFixture(){const child=new EventEmitter();child.stderr=new EventEmitter();child.send=()=>{};child.kill=()=>{};return child;}
async function mainFixture({sizeEffects=resizeEffect,opening,load,toolsOpen=false,primary=true,platform='win32',startStatus={終了時停止あり:false},confirmClose=async()=>({response:1}),selectFolder=async()=>({canceled:true,filePaths:[]})}={}){
 const source=await readFile(new URL('../起動/electron-main.cjs',import.meta.url),'utf8');
 const moves=[],iconMenus=[];
 const stdin=Readable.from([]),proc=new EventEmitter(),app=new EventEmitter(),policy={},sent=[],exits=[],handlers={},scripts=[],openings=[],dialogs=[];
 Object.assign(proc,{stdin,pid:42,platform,connected:true,send:(message,callback)=>{sent.push(message);callback?.();}});
 let options,win,loaded;app.whenReady=async()=>{};
 app.getPath=name=>{assert.equal(name,'appData');return '/fixture/appData';};
 app.setPath=(name,value)=>{assert.equal(name,'userData');app.userData=value;};
 app.requestSingleInstanceLock=()=>{assert.equal(app.userData,path.join('/fixture/appData','aidiy_diag'));return primary;};
 app.restored=0;app.focused=0;app.quit=()=>{app.quitting=true;};app.exit=code=>exits.push(code);
 app.setName=name=>{app.name=name;};app.dock={setMenu(menu){app.dock.menu=menu;},setIcon(icon){app.dock.icon=icon;}};
 const Menu={buildFromTemplate:items=>items,setApplicationMenu(menu){app.menu=menu;}};
 const session={fromPartition(name){assert.ok(!name.startsWith('persist:'));return {setPermissionRequestHandler(fn){policy.permission=fn;},setPermissionCheckHandler(fn){policy.check=fn;},webRequest:{onBeforeRequest(fn){policy.request=fn;}}};}};
 class Window extends EventEmitter {constructor(value){super();options=value;win=this;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.isDestroyed=()=>false;this.webContents.send=(channel,state)=>{this.pinMessage={channel,state};};this.webContents.executeJavaScript=async script=>{scripts.push(script);};this.webContents.setWindowOpenHandler=fn=>{policy.window=fn;};}isDestroyed(){return !!this.destroyed;}isVisible(){return false;}isMinimized(){return !!this.minimized;}isMaximized(){return !!this.maximized;}maximize(){this.maximized=true;}unmaximize(){this.maximized=false;}minimize(){this.minimized=true;}close(){const event={preventDefault(){this.prevented=true;}};this.emit('close',event);if(!event.prevented)this.closed=true;}getBounds(){return {...this.getNormalBounds()};}getNormalBounds(){return this.bounds||{x:150,y:100,width:options.width,height:options.height};}getMinimumSize(){return this.minimum||[420,320];}isResizable(){return this.resizable!==false;}setResizable(value){this.resizable=value;}setIgnoreMouseEvents(){}isMaximizable(){return true;}setMinimumSize(...value){this.minimum=value;}setMaximizable(value){this.maximizable=value;}setBounds(value){this.bounds=value;}isAlwaysOnTop(){return !!this.top;}setAlwaysOnTop(value){this.top=value;}setMenuBarVisibility(){}show(){this.shown=true;}async loadURL(value){loaded=value;this.webContents.emit('did-start-loading');await load?.();}}
 vm.runInNewContext(source,{__dirname:'/fixture',require:id=>id==='node:path'?path:id==='../ui/src/components/導入状況/公式サイト.json'?{python:'https://www.python.org/'}:id==='./アイコンメニュー.cjs'?{アイコンメニューを作成:parent=>{const menu={parent,calls:[],open(items,send){this.calls.push({items,send});}};iconMenus.push(menu);return menu;}}:id==='./MacOS-Menu.cjs'?{...macMenu,Macメニューを設定:options=>macMenu.Macメニューを設定({...options,platform})}:id==='../../frontend_ide/デスクトップ/長押し窓移動.cjs'?{attachNativeWindowMove:(window,screen,kind)=>moves.push({window,screen,kind})}:id==='../../frontend_ide/デスクトップ/最前面ピン.cjs'?windowPins:id==='./ポート接続.cjs'?{checkPort:async port=>{assert.equal(port,8095);return toolsOpen;}}:id==='./マイクロ表示.cjs'?microWindow:id==='./ミニ表示.cjs'?miniWindow:id==='./サイズ切替.cjs'?sizeEffects:id==='./標準タイトル操作.cjs'?{標準タイトル操作を取り付け:()=>({cancel(){}})}:id==='./通常窓サイズ.cjs'?{通常窓サイズを作成:(window,screen)=>normalSize.通常窓サイズを作成(window,screen,platform)}:id==='./終了確認.cjs'?{...closeWindow,起動状態を読む:async()=>structuredClone(startStatus)}:id==='../../frontend_ide/host/scripts/window-opening.cjs'?{拡大表示:async(Constructor,window,options)=>{openings.push({Constructor,window,options});if(opening)return opening(window);window.show();return true;}}:({app,BrowserWindow:Window,session,Menu,shell:{openExternal:async target=>openings.push({external:target})},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:28,width:1920,height:1052}}),getDisplayMatching:()=>({workArea:{x:0,y:28,width:1920,height:1052}})},dialog:{showOpenDialog:selectFolder,showMessageBox:(parent,options)=>{dialogs.push({parent,options});return confirmClose();}},ipcMain:{handle:(name,fn)=>handlers[name]=fn}}),process:proc,URL,setTimeout:()=>({unref(){}}),clearTimeout(){}});
 return {stdin,proc,app,policy,sent,exits,handlers,scripts,openings,dialogs,moves,iconMenus,get options(){return options;},get win(){return win;},get loaded(){return loaded;}};
}
test('desktop default; explicit browser, Codespaces, headless remain Node-only',()=>{
 assert.equal(browserMode({}, {DISPLAY:':1'},'linux'),false);assert.equal(browserMode({}, {},'win32'),false);
 for(const [options,env] of [[{browser:true},{}],[{noOpen:true},{}],[{},{CODESPACES:'true'}],[{},{}]])assert.equal(browserMode(options,env,'linux'),true);
});
test('Diag separates its profile from Avatar before locking on every OS',async()=>{
 for(const platform of ['win32','darwin','linux']){
  const f=await mainFixture({platform});
  assert.equal(f.app.userData,path.join('/fixture/appData','aidiy_diag'));
  assert.notEqual(path.basename(f.app.userData),'Electron');
 }
});
test('desktop binary requires matching installed package and dist',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'diag-electron-'));const folder=path.join(root,'node_modules/electron');
 try {await mkdir(path.join(folder,'dist'),{recursive:true});await writeFile(path.join(folder,'package.json'),JSON.stringify({version:'1.2.3'}));await writeFile(path.join(folder,'dist/version'),'1.2.3');await writeFile(path.join(folder,'path.txt'),'electron');await writeFile(path.join(folder,'dist/electron'),'fixture',{mode:0o755});assert.equal(await desktopBinary(root,'linux'),path.join(folder,'dist/electron'));await writeFile(path.join(folder,'dist/version'),'9.9.9');await assert.rejects(desktopBinary(root,'linux'));}finally{await rm(root,{recursive:true,force:true});}
});
test('desktop auth travels IPC only after readiness, never stdin/argv/env',()=>{
 let call,payload,sends=0;const child=childFixture();child.send=value=>{payload=value;sends++;};
 openDesktop('/fixture/electron',url,()=>{},(...args)=>{call=args;return child;});
 assert.equal(payload,undefined);assert.ok(!JSON.stringify(call).includes('#token='));assert.deepEqual(call[2].stdio,['ignore','ignore','pipe','ipc']);assert.equal(call[2].shell,false);assert.equal(call[2].windowsHide,false);assert.equal(call[2].env.ELECTRON_RUN_AS_NODE,undefined);
 child.emit('message',{type:'diag-ready'});assert.equal(payload.url,url);child.emit('message',{type:'diag-ready'});assert.equal(sends,1);child.emit('message',{type:'diag-shown'});child.emit('exit',0,null);
});
test('Windows EOF stdin no longer exits; IPC starts a secure Electron window',async()=>{
 const f=await mainFixture();f.stdin.resume();await once(f.stdin,'end');assert.deepEqual(f.exits,[]);assert.equal(f.sent[0].type,'diag-ready');assert.equal(f.options,undefined);
 f.proc.emit('message',{type:'diag-start',url});await new Promise(r=>setImmediate(r));
 assert.equal(f.moves.length,1);assert.equal(f.moves[0].window.webContents,f.win.webContents);assert.deepEqual(f.moves[0].window.getBounds(),f.win.getBounds());assert.equal(f.moves[0].kind,'diag');
 assert.equal(f.options.webPreferences.nodeIntegration,false);assert.equal(f.options.webPreferences.contextIsolation,true);assert.equal(f.options.webPreferences.sandbox,true);assert.equal(f.loaded,url);
 const {policy,win}=f;assert.equal(policy.check(),false);policy.permission(null,'camera',allowed=>assert.equal(allowed,false));assert.equal(policy.window().action,'deny');
 let blocked=false;win.webContents.emit('will-navigate',{preventDefault(){blocked=true;}});assert.ok(blocked);policy.request({url:'https://outside.test/'},value=>assert.equal(value.cancel,true));
 assert.equal(f.openings.length,1);assert.equal(win.shown,true);assert.equal(f.sent.at(-1).type,'diag-shown');
 f.proc.emit('disconnect');assert.equal(f.app.quitting,true);
});

test('Tools 8095 open starts mini at primary work-area top-left before show, while closed/unknown use normal',async()=>{
 for(const toolsOpen of [true,false,null]){
  const f=await mainFixture({toolsOpen,opening:window=>{
   if(toolsOpen===true){assert.equal(window.bounds.width,330);assert.equal(window.bounds.height,134);assert.equal(window.bounds.x,8);assert.equal(window.bounds.y,36);assert.equal(window.top,false);}
   else assert.equal(window.bounds,undefined);
   window.show();return true;
  }});
  f.proc.emit('message',{type:'diag-start',url});await new Promise(r=>setImmediate(r));
  assert.equal(JSON.stringify(f.options.webPreferences.additionalArguments),JSON.stringify(toolsOpen===true?['--aidiy-diag-initial-mini']:[]));
  // 通常表示はミニの左上角より48px内側から始める。
  assert.equal(f.options.x,48);assert.equal(f.options.y,76);
  assert.equal(f.win.shown,true);assert.equal(f.sent.at(-1).type,'diag-shown');
  if(toolsOpen===true){const event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};f.handlers['diag:window'](event,'startMini',false);assert.equal(f.win.bounds.width,800);assert.equal(f.win.bounds.x,8);assert.equal(f.win.top,false);}
 }
});
test('initial mini accepts renderer height during loading and later reload restores the normal window',async()=>{
 let loaded;
 const f=await mainFixture({toolsOpen:true,load:()=>new Promise(resolve=>loaded=resolve)});
 f.proc.emit('message',{type:'diag-start',url});await new Promise(resolve=>setImmediate(resolve));
 const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
 assert.deepEqual(f.win.getBounds(),{x:8,y:36,width:330,height:134});assert.equal(f.openings.length,0);
 assert.equal(control({...event,senderFrame:{}},'resizeMini',200),false);assert.equal(control({...event,sender:{}},'resizeMini',200),false);
 assert.equal(control(event,'resizeMini',186),true);assert.equal(f.win.bounds.height,186);
 loaded();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.win.bounds.height,186,'loadURL完了後に初回の測定高さを上書きしない');assert.equal(f.openings.length,1);assert.equal(f.win.shown,true);
 f.win.webContents.emit('did-start-loading');
 assert.deepEqual(f.win.getBounds(),{x:8,y:36,width:800,height:600});assert.deepEqual(f.win.minimum,[420,320]);assert.equal(f.win.top,false);
 assert.equal(control(event,'resizeMini',200),false);assert.equal(f.win.bounds.height,600);
 f.win.webContents.emit('did-start-loading');assert.equal(f.win.bounds.height,600,'初回ミニを再読込で復活させない');
});
test('normal startup ignores measured mini heights before and after loading',async()=>{
 let loaded;
 const f=await mainFixture({load:()=>new Promise(resolve=>loaded=resolve)});
 f.proc.emit('message',{type:'diag-start',url});await new Promise(resolve=>setImmediate(resolve));
 const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
 assert.equal(control(event,'resizeMini',186),false);assert.equal(f.win.bounds,undefined);
 loaded();await new Promise(resolve=>setImmediate(resolve));assert.equal(control(event,'resizeMini',186),false);assert.equal(f.win.bounds,undefined);
});
test('mini height stays stable during opening and applies only the latest valid main-frame measurement',async()=>{
 let finish;
 const f=await mainFixture({toolsOpen:true,opening:()=>new Promise(resolve=>finish=resolve)});
 f.proc.emit('message',{type:'diag-start',url});await new Promise(resolve=>setImmediate(resolve));
 const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
 for(const height of [186,200,186]){assert.equal(control(event,'resizeMini',height),true);assert.equal(f.win.bounds.height,134);}
 assert.equal(control(event,'resizeMini',361),false);assert.equal(control(event,'resizeMini','200'),false);assert.equal(control({...event,senderFrame:{}},'resizeMini',200),false);
 finish(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.win.bounds.height,186);assert.deepEqual(f.win.minimum,[330,186]);
 control(event,'startMini',false);assert.deepEqual(f.win.getBounds(),{x:8,y:36,width:800,height:600});
});
test('leaving mini during opening discards a queued height rather than changing normal bounds',async()=>{
 for(const exit of ['restore','reload']){
  let finish;
  const f=await mainFixture({toolsOpen:true,opening:()=>new Promise(resolve=>finish=resolve)});
  f.proc.emit('message',{type:'diag-start',url});await new Promise(resolve=>setImmediate(resolve));
  const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
  assert.equal(control(event,'resizeMini',200),true);
  if(exit==='restore')control(event,'startMini',false);else f.win.webContents.emit('did-start-loading');
  assert.equal(control(event,'resizeMini',186),false);
  finish(true);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.win.getBounds(),{x:8,y:36,width:800,height:600});assert.deepEqual(f.win.minimum,[420,320]);assert.equal(f.win.top,false);
 }
});
test('Mac has a minimal named menu and Dock close keeps the running-process confirmation',async()=>{
 let answer=1;
 const f=await mainFixture({platform:'darwin',startStatus:{終了時停止あり:true},confirmClose:async()=>({response:answer})});
 assert.equal(f.app.name,'AiDiy 診断');f.proc.emit('message',{type:'diag-start',url});await new Promise(r=>setImmediate(r));
 assert.equal(f.app.menu.length,1);assert.equal(f.app.menu[0].label,'AiDiy 診断');
 assert.equal(f.app.menu[0].submenu.filter(item=>item.visible!==false).length,1);assert.equal(f.app.menu[0].submenu[0].label,'閉じる');
 assert.equal(f.app.menu[0].submenu[0].accelerator,'Command+Q');assert.match(f.app.dock.icon,/AiDiy_diag\.png$/);
 f.app.dock.menu[0].click();await new Promise(r=>setImmediate(r));assert.equal(f.dialogs.length,1);assert.equal(f.win.closed,undefined);
 answer=0;f.app.menu[0].submenu[0].click();await new Promise(r=>setImmediate(r));assert.equal(f.dialogs.length,2);assert.equal(f.win.closed,true);
});
test('Mac native clipboard shortcuts remain available without an Edit menu and Cmd+W confirms closing',async()=>{
 const f=await mainFixture({platform:'darwin',startStatus:{終了時停止あり:true}});f.proc.emit('message',{type:'diag-start',url});await new Promise(r=>setImmediate(r));
 const edit=f.app.menu[0].submenu.filter(item=>item.role);
 assert.deepEqual(edit.map(item=>item.role),['undo','redo','cut','copy','paste','pasteAndMatchStyle','selectAll']);
 assert.ok(edit.every(item=>item.visible===false&&item.acceleratorWorksWhenHidden));
 assert.equal(f.win.webContents.listenerCount('before-input-event'),0,'IME・Console・エディタのキー入力は横取りしない');assert.equal(f.dialogs.length,0);
 f.app.menu[0].submenu.find(item=>item.accelerator==='Command+W').click(null,f.win);await new Promise(r=>setImmediate(r));
 assert.equal(f.dialogs.length,1);assert.equal(f.win.closed,undefined);
 const other=await mainFixture();other.proc.emit('message',{type:'diag-start',url});await new Promise(r=>setImmediate(r));assert.equal(other.app.menu,undefined);assert.equal(other.app.dock.icon,undefined);
});
test('Electron invalid message / URL and page failure emit fixed secret-free causes',async()=>{
 for(const [message,code] of [[{type:'other',url},'IPC'],[{type:'diag-start',url:'https://private.test/SECRET'},'URL'],[{type:'diag-start',url:'x'.repeat(4097)},'IPC']]){
  const f=await mainFixture();f.proc.emit('message',message);await new Promise(r=>setImmediate(r));assert.equal(f.sent.at(-1).code,code);assert.deepEqual(f.exits,[1]);assert.ok(!JSON.stringify(f.sent).includes('SECRET'));
 }
 const f=await mainFixture();f.proc.emit('message',{type:'diag-start',url});await new Promise(r=>setImmediate(r));f.win.webContents.emit('did-fail-load',{},-2,'SECRET',url,true);assert.equal(f.sent.at(-1).code,'LOAD');assert.deepEqual(f.exits,[1]);
});
test('unexpected exit is failure; normal disconnect/exit and intentional close stay quiet',()=>{
 const original=process.exitCode,originalError=console.error;const errors=[];console.error=value=>errors.push(value);
 try {for(const mode of ['failure','normal','closing']) {
  const child=childFixture();let closes=0;openDesktop('/fixture',url,()=>closes++,()=>child);process.exitCode=0;
  if(mode==='normal'){child.emit('message',{type:'diag-ready'});child.emit('message',{type:'diag-shown'});child.emit('disconnect');}
  if(mode==='closing')child.diagClosing=true;
  child.emit('exit',mode==='normal'?0:7,null);assert.equal(process.exitCode,mode==='failure'?1:0);assert.equal(closes,1);
 }assert.equal(errors.length,1);assert.match(errors[0],/exit=7/);}finally{process.exitCode=original;console.error=originalError;}
});
test('second instance focuses the existing window and exits quietly without receiving the URL',async()=>{
 const second=await mainFixture({primary:false});
 assert.equal(JSON.stringify(second.sent),JSON.stringify([{type:'diag-existing'}]));assert.deepEqual(second.exits,[0]);
 const first=await mainFixture();first.proc.emit('message',{type:'diag-start',url});await new Promise(r=>setImmediate(r));
 Object.assign(first.win,{isMinimized:()=>true,restore(){this.restored=true;},focus(){this.focused=true;}});
 first.app.emit('second-instance');assert.equal(first.win.restored,true);assert.equal(first.win.shown,true);assert.equal(first.win.focused,true);
 const original=process.exitCode,originalError=console.error;const errors=[];console.error=value=>errors.push(value);
 try{
  const child=childFixture();const starts=[];child.send=value=>starts.push(value);let closes=0,existing=0;process.exitCode=0;
  openDesktop('/fixture',url,()=>closes++,()=>child,10,()=>{},()=>existing++);
  child.emit('message',{type:'diag-existing'});await new Promise(r=>setTimeout(r,25));
  assert.equal(existing,1);assert.equal(child.diagClosing,undefined,'期限切れで停止しない');
  child.emit('exit',0,null);assert.equal(closes,1);assert.equal(process.exitCode,0);assert.deepEqual(errors,[]);assert.deepEqual(starts,[]);
 }finally{process.exitCode=original;console.error=originalError;}
});
test('startup timeout and send errors stop children once; stderr secrets never escape',async()=>{
 const original=process.exitCode,originalError=console.error;const errors=[];console.error=value=>errors.push(value);
 try {for(const mode of ['timeout','send']){
  const child=childFixture();let closes=0;openDesktop('/fixture',url,()=>closes++,()=>child,10);
  child.stderr.emit('data','SECRET '+url+' error while loading shared libraries');
  if(mode==='send'){child.send=(_value,callback)=>callback(Error('SECRET'));child.emit('message',{type:'diag-ready'});}
  await new Promise(r=>setTimeout(r,25));assert.equal(child.diagClosing,true);assert.equal(closes,1);child.emit('exit',1,null);assert.equal(closes,1);
 }assert.equal(errors.length,2);assert.ok(!errors.join('').includes('SECRET'));assert.ok(!errors.join('').includes('#token'));}finally{process.exitCode=original;console.error=originalError;}
});
test('real child-process IPC readiness and secret transport smoke',{timeout:10000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'diag-ipc-'));let child;
 try{
  const file=path.join(root,'child.cjs');await writeFile(file,`process.send({type:'diag-ready'});process.once('message',m=>{if(m.type!=='diag-start'||!m.url.includes('#token=')||JSON.stringify(process.argv).includes('#token=')||JSON.stringify(process.env).includes('#token='))process.exit(1);process.send({type:'diag-shown'},()=>process.exit(0));});`);
  let done;const closed=new Promise(resolve=>done=resolve);
  child=openDesktop('/fixture',url,done,(_exe,_args,options)=>spawn(process.execPath,[file],{...options,windowsHide:true}));await closed;assert.equal(child.exitCode,0);
 }finally{if(child?.exitCode===null)child.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
});
test('desktop teardown escalates after bounded grace period',async()=>{
 const signals=[],child=childFixture();child.kill=signal=>signals.push(signal);closeDesktop(child,15);await new Promise(r=>setTimeout(r,35));assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.equal(child.diagClosing,true);
});

test('spawn errors expose only allowlisted OS code and finish once',()=>{
 const original=process.exitCode,originalError=console.error;const errors=[];console.error=value=>errors.push(value);
 try{const child=childFixture();let closes=0;openDesktop('/fixture',url,()=>closes++,()=>child);child.emit('error',Object.assign(Error('SECRET'),{code:'ENOENT'}));child.emit('exit',1,null);assert.equal(closes,1);assert.equal(errors.length,1);assert.match(errors[0],/ENOENT/);assert.ok(!errors[0].includes('SECRET'));}
 finally{process.exitCode=original;console.error=originalError;}
});
test('mixed-case Windows Node bootstrap environment cannot change Electron mode',()=>{
 const names=['electron_run_as_node','Node_Options','node_path'],saved=names.map(name=>process.env[name]);
 try{for(const name of names)process.env[name]='untrusted';let options;const child=childFixture();openDesktop('/fixture',url,()=>{},(_exe,_args,value)=>{options=value;return child;});for(const name of names)assert.equal(options.env[name],undefined);child.diagClosing=true;child.emit('exit',0,null);}
 finally{names.forEach((name,index)=>{if(saved[index]===undefined)delete process.env[name];else process.env[name]=saved[index];});}
});

test('frameless controls are fixed, main-frame-only and preserve sandbox',async()=>{
 const f=await mainFixture();f.proc.emit('message',{type:'diag-start',url});await new Promise(r=>setImmediate(r));
 assert.equal(f.options.frame,false);assert.equal(f.options.webPreferences.preload,path.join('/fixture','preload.cjs'));
 const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
 control({...event,senderFrame:{}},'close');assert.equal(f.win.closed,undefined);
 control({...event,sender:{}},'close');assert.equal(f.win.closed,undefined);
 assert.equal(control({...event,senderFrame:{}},'startMini',true),false);
 assert.equal(control(event,'startMini',{width:100}),false);
 control(event,'openFile');assert.equal(f.win.closed,undefined);
 control(event,'minimize');assert.equal(f.win.minimized,true);f.win.minimized=false;await control(event,'maximize');assert.equal(control(event,'isMaximized'),true);await control(event,'maximize');assert.equal(control(event,'isMaximized'),false);control(event,'close');await new Promise(resolve=>setImmediate(resolve));assert.equal(f.win.closed,true);assert.equal(f.dialogs.length,0);
 const exposed={};vm.runInNewContext(await readFile(new URL('../起動/preload.cjs',import.meta.url),'utf8'),{process:{argv:[]},require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed[name]=api},ipcRenderer:{invoke:(...args)=>args}})});
 assert.deepEqual(Object.keys(exposed.aidiyWindow).sort(),['beginDisplay','beginMicroMove','close','customNormalTitle','endMicroMove','expandMicro','finishDisplay','finishMini','getPinState','initialMini','isMaximized','maximize','minimize','moveMicro','onMicroMenu','onPinState','resizeMicroLabel','resizeMini','selectProject','showMicroMenu','startMicro','startMini','togglePin']);assert.deepEqual(Array.from(exposed.aidiyWindow.close()),['diag:window','close']);
 assert.equal(exposed.aidiyWindow.initialMini,false);
 assert.deepEqual(Array.from(exposed.aidiyWindow.selectProject()),['diag:window','selectProject']);
 assert.deepEqual(Array.from(exposed.aidiyWindow.finishMini()),['diag:window','finishMini']);assert.deepEqual(Array.from(exposed.aidiyWindow.startMini(true)),['diag:window','startMini',true]);assert.equal(await exposed.aidiyWindow.startMini({width:100}),false);
 assert.deepEqual(Array.from(exposed.aidiyWindow.resizeMini(186)),['diag:window','resizeMini',186]);
 for(const height of [undefined,null,false,'134',{},[],NaN,Infinity,-Infinity,79,361,134.5])assert.equal(await exposed.aidiyWindow.resizeMini(height),false);
 for(const height of [80,360])assert.deepEqual(Array.from(exposed.aidiyWindow.resizeMini(height)),['diag:window','resizeMini',height]);
 for(const height of [undefined,null,false,'18',{},[],NaN,Infinity,17,4097,18.5])assert.equal(await exposed.aidiyWindow.resizeMicroLabel(height),false);
 for(const height of [18,4096])assert.deepEqual(Array.from(exposed.aidiyWindow.resizeMicroLabel(height)),['diag:window','resizeMicroLabel',height]);
});

test('native mini height IPC stays main-frame-only, bounded and cannot resize normal windows',async()=>{
 const f=await mainFixture();f.proc.emit('message',{type:'diag-start',url});await new Promise(resolve=>setImmediate(resolve));
 const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
 const original=f.win.getBounds();assert.equal(control(event,'resizeMini',134),false);assert.deepEqual(f.win.getBounds(),original);
 assert.equal(control(event,'startMini',true),true);
 for(const height of [undefined,null,false,true,'134',{},[],NaN,Infinity,-Infinity,0,79,361,134.5])assert.equal(control(event,'resizeMini',height),false);
 assert.equal(control({...event,senderFrame:{}},'resizeMini',200),false);assert.equal(control({...event,sender:{}},'resizeMini',200),false);assert.equal(f.win.bounds.height,134);
 for(const height of [134,186,200,134]){assert.equal(control(event,'resizeMini',height),true);assert.equal(f.win.bounds.height,height);assert.equal(f.win.bounds.width,330);assert.equal(control(event,'startMini',true),true);}
 assert.equal(control(event,'startMini',false),true);assert.deepEqual(f.win.getBounds(),original);assert.deepEqual(f.win.minimum,[420,320]);assert.equal(f.win.top,false);
 assert.equal(control(event,'resizeMini',186),false);assert.deepEqual(f.win.getBounds(),original);
});

test('project picker is main-frame-only, one at a time and cancel leaves no path',async()=>{
 let resolve,calls=0;const f=await mainFixture({selectFolder:async(parent,options)=>{calls++;assert.equal(parent,f.win);assert.equal(JSON.stringify(options.properties),JSON.stringify(['openDirectory']));return new Promise(done=>resolve=done);}});
 f.proc.emit('message',{type:'diag-start',url});await new Promise(r=>setImmediate(r));
 const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
 assert.equal(control({...event,senderFrame:{}},'selectProject'),false);assert.equal(calls,0);
 const selected=control(event,'selectProject');assert.equal(control(event,'selectProject'),null);assert.equal(calls,1);
 resolve({canceled:false,filePaths:['C:/日本語 空白']});assert.equal(await selected,'C:/日本語 空白');
 const canceled=control(event,'selectProject');resolve({canceled:true,filePaths:[]});assert.equal(await canceled,null);
});

const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('closing a running Diag confirms from both native window close and the titlebar button',async()=>{
 let response=1;const f=await mainFixture({startStatus:{終了時停止あり:true},confirmClose:async()=>({response})});
 f.proc.emit('message',{type:'diag-start',url});await flush();f.win.close();await flush();
 assert.equal(f.win.closed,undefined);assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0].parent,f.win);assert.equal(f.dialogs[0].options.cancelId,1);
 response=0;f.handlers['diag:window']({sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame},'close');await flush();
 assert.equal(f.win.closed,true);assert.equal(f.dialogs.length,2);
});
test('Diag waits for load and shared expansion before revealing content and reporting shown',async()=>{
 let loaded,expanded;const f=await mainFixture({load:()=>new Promise(resolve=>loaded=resolve),opening:window=>new Promise(resolve=>expanded=()=>{window.show();resolve(true);})});
 f.proc.emit('message',{type:'diag-start',url});await flush();
 f.win.emit('ready-to-show');assert.equal(f.win.shown,undefined);assert.equal(f.openings.length,0);
 loaded();await flush();assert.equal(f.openings.length,1);assert.equal(f.openings[0].window,f.win);assert.equal(f.openings[0].options.background,'#080b10');assert.equal(f.options.transparent,true);assert.equal(f.options.backgroundColor,'#00000000');
 assert.match(f.scripts[0],/classList.add\('desktop-opening','desktop-window'\)/);assert.equal(f.sent.some(m=>m.type==='diag-shown'),false);
 expanded();await flush();assert.match(f.scripts.at(-1),/classList.remove\('desktop-opening'\)/);assert.equal(f.sent.filter(m=>m.type==='diag-shown').length,1);
 f.win.emit('ready-to-show');assert.equal(f.openings.length,1);
});
test('closed window or renderer failure during expansion never reports shown',async()=>{
 for(const failure of ['closed','renderer']){
  let finish;const f=await mainFixture({opening:()=>new Promise(resolve=>finish=resolve)});
  f.proc.emit('message',{type:'diag-start',url});await flush();
  if(failure==='closed')f.win.destroyed=true;else f.win.webContents.emit('render-process-gone');
  finish(failure!=='closed');await flush();assert.equal(f.sent.some(m=>m.type==='diag-shown'),false);assert.equal(f.scripts.length,1);
 }
});
test('load failure skips expansion and content fade is desktop-only without an OS-motion override',async()=>{
 const f=await mainFixture({load:async()=>{throw Error('SECRET');}});f.proc.emit('message',{type:'diag-start',url});await flush();assert.equal(f.openings.length,0);assert.equal(f.sent.at(-1).code,'LOAD');
 const css=await readFile(new URL('../ui/src/style.css',import.meta.url),'utf8');
 assert.match(css,/\.desktop-window #app\{animation:startup-fade-in \.45s ease-out both\}/);
 assert.match(css,/\.desktop-opening #app\{opacity:0;animation:none\}/);
 assert.doesNotMatch(css,/prefers-reduced-motion/);
});

test('Diag pin is default OFF, main-frame-only and survives normal/mini transitions',async()=>{
 const f=await mainFixture();f.proc.emit('message',{type:'diag-start',url});await flush();
 const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
 assert.deepEqual(control(event,'getPinState'),{pinned:false,locked:false});assert.equal(f.win.top,false);
 for(const denied of [{...event,senderFrame:{}},{...event,sender:{}}]){
  assert.equal(control(denied,'togglePin'),false);assert.equal(control(denied,'getPinState'),false);
 }
 assert.equal(f.win.top,false);assert.deepEqual(control(event,'togglePin'),{pinned:true,locked:false});assert.equal(f.win.top,true);
 assert.equal(f.win.pinMessage.channel,'diag:pin-state');assert.deepEqual(f.win.pinMessage.state,{pinned:true,locked:false});
 control(event,'startMini',true);assert.equal(f.win.top,true);control(event,'togglePin');assert.equal(f.win.top,false);
 control(event,'startMini',false);assert.equal(f.win.top,false);
 control(event,'startMini',true);control(event,'togglePin');control(event,'startMini',false);assert.equal(f.win.top,true);
 f.win.destroyed=true;assert.equal(control(event,'togglePin'),false);
});

test('Diag preload pin subscriptions validate payloads and return an exact unsubscriber',async()=>{
 const ipc=new EventEmitter(),exposed={},calls=[];ipc.invoke=(...args)=>{calls.push(args);return Promise.resolve({pinned:false,locked:false});};
 vm.runInNewContext(await readFile(new URL('../起動/preload.cjs',import.meta.url),'utf8'),{process:{argv:[]},require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed[name]=api},ipcRenderer:ipc})});
 const received=[],api=exposed.aidiyWindow,cancel=api.onPinState(value=>received.push(value));
 for(const value of [null,{},true,{pinned:'true',locked:false},{pinned:true}])ipc.emit('diag:pin-state',{},value);
 assert.equal(received.length,0);ipc.emit('diag:pin-state',{}, {pinned:true,locked:false,extra:'ignored'});
 assert.equal(JSON.stringify(received),JSON.stringify([{pinned:true,locked:false}]));cancel();assert.equal(ipc.listenerCount('diag:pin-state'),0);
 api.onPinState(null)();await api.getPinState();await api.togglePin();
 assert.deepEqual(calls,[['diag:window','getPinState'],['diag:window','togglePin']]);
});

test('icon-menu IPC requires the main frame and icon mode, bounds its payload and forwards selections',async()=>{
 const f=await mainFixture();f.proc.emit('message',{type:'diag-start',url});await flush();
 assert.equal(f.iconMenus.length,1);assert.equal(f.iconMenus[0].parent,f.win);
 const menu=f.iconMenus[0],control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
 const items=[{key:'app:browser',label:'Browser'},{key:'cli:aidiy_hermes',label:'Hermes'}];
 assert.equal(control(event,'microMenu',items),false);assert.equal(menu.calls.length,0);
 assert.equal(control(event,'startMicro',true),true);
 try{
  for(const denied of [{...event,sender:{}},{...event,senderFrame:{}}])assert.equal(control(denied,'microMenu',items),false);
  for(const value of [undefined,null,{},Array(33).fill(items[0]),[null],[{key:'app:../file',label:'bad'}],[{key:'app:browser',label:4}],[{key:'app:browser',label:'x'.repeat(101)}]])assert.equal(control(event,'microMenu',value),false);
  assert.equal(menu.calls.length,0);
  assert.equal(control(event,'microMenu',items),true);assert.equal(menu.calls.length,1);assert.deepEqual(menu.calls[0].items,items);
  const action={type:'launch',key:'app:browser'};menu.calls[0].send(action);
  assert.deepEqual(f.win.pinMessage,{channel:'diag:micro-menu',state:action});
 }finally{control(event,'startMicro',false);}
 assert.equal(control(event,'microMenu',items),false);
});

test('Diag preload icon-menu subscriptions filter actions and unsubscribe without exposing arbitrary IPC',async()=>{
 const ipc=new EventEmitter(),exposed={},calls=[];ipc.invoke=(...args)=>{calls.push(args);return Promise.resolve(true);};
 vm.runInNewContext(await readFile(new URL('../起動/preload.cjs',import.meta.url),'utf8'),{process:{argv:[]},require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed[name]=api},ipcRenderer:ipc})});
 const api=exposed.aidiyWindow,items=[{key:'app:browser',label:'Browser'}],received=[];
 for(const value of [null,{},'app:browser'])assert.equal(await api.showMicroMenu(value),false);
 assert.equal(calls.length,0);assert.equal(await api.showMicroMenu(items),true);assert.deepEqual(calls,[['diag:window','microMenu',items]]);
 const unsubscribe=api.onMicroMenu(action=>received.push(action));
 for(const value of [null,{},'close','dismiss','arbitrary',{type:'launch',key:7},{type:'other',key:'app:browser'}])ipc.emit('diag:micro-menu',{},value);
 assert.equal(received.length,0);
 for(const value of ['mini','normal',{type:'launch',key:'app:browser',extra:'ignored'}])ipc.emit('diag:micro-menu',{},value);
 assert.equal(JSON.stringify(received),JSON.stringify(['mini','normal',{type:'launch',key:'app:browser'}]));
 unsubscribe();assert.equal(ipc.listenerCount('diag:micro-menu'),0);ipc.emit('diag:micro-menu',{},'mini');assert.equal(received.length,3);
 api.onMicroMenu(null)();assert.equal(ipc.listenerCount('diag:micro-menu'),0);
});

test('全表示経路は準備完了前にnative寸法を変更せず、遅れた高さとmicro展開を競合させない',async()=>{
 for(const [source,target] of [['normal','mini'],['normal','micro'],['mini','normal'],['mini','micro'],['micro','normal'],['micro','mini'],['normal','maximize'],['maximized','normal']]){
  let release,active=false,preparing=false;
  const effect={get active(){return active;},get preparing(){return preparing;},準備(){active=preparing=true;return new Promise(resolve=>release=()=>{preparing=false;resolve(true);});},async 完了(){active=preparing=false;return true;},中止(){active=preparing=false;}};
  const f=await mainFixture({sizeEffects:{画面サイズ演出を作成:()=>effect}});
  f.proc.emit('message',{type:'diag-start',url});await flush();
  const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
  if(source==='mini')control(event,'startMini',true);
  if(source==='micro')control(event,'startMicro',true);
  if(source==='maximized')f.win.maximize();
  const changes=[];
  for(const method of ['setBounds','setMinimumSize','maximize','unmaximize','setResizable']){
   const original=f.win[method].bind(f.win);f.win[method]=(...args)=>{assert.equal(preparing,false,method+' during preparation');changes.push(method);return original(...args);};
  }
  const square=target==='maximize'||source==='maximized';
  const pending=control(event,square?'maximize':'beginDisplay',target);
  assert.equal(preparing,true);assert.deepEqual(changes,[]);
  if(source==='mini'){
   assert.equal(control(event,'resizeMini',222),true);assert.notEqual(f.win.getBounds().height,222);
  }
  assert.equal(control(event,'expandMicro',{expanded:true,count:13}),false);
  assert.equal(control(event,'resizeMicroLabel',170),!square);
  assert.deepEqual(changes,[]);
  release();assert.equal(await pending,true);
  if(!square){
   if(source==='micro')control(event,'startMicro',false);
   if(source==='mini'||target==='mini')await control(event,'startMini',target==='mini');
   if(target==='micro')control(event,'startMicro',true);
   if(target==='mini'){assert.equal(control(event,'resizeMini',186),true);assert.equal(f.win.getBounds().height,186);}
   await control(event,'finishDisplay');
  }
  assert.ok(changes.length>0);assert.equal(effect.active,false);
  if(target==='mini')assert.equal(f.win.getBounds().height,186,'最新の完成高さを古い予約値で戻さない');
  if(target==='micro'){assert.equal(f.win.getBounds().height,290);control(event,'startMicro',false);}
 }
});

test('稼働サービスありで終了確認後に実窓を破棄しても、通常・ミニ両表示の後始末が完走',async()=>{
 for(const toolsOpen of [false,true]){
  const f=await mainFixture({toolsOpen,startStatus:{終了時停止あり:true},confirmClose:async()=>({response:0})});
  f.proc.emit('message',{type:'diag-start',url});await flush();
  const win=f.win,contents=win.webContents;
  Object.defineProperty(win,'webContents',{get(){if(win.destroyed)throw new TypeError('Object has been destroyed');return contents;}});
  let cleaned=false;
  win.once('closed',()=>{cleaned=true;});
  win.close=()=>{
   const event={preventDefault(){this.prevented=true;}};win.emit('close',event);
   if(!event.prevented){win.closed=true;win.destroyed=true;win.emit('closed');}
  };
  f.handlers['diag:window']({sender:contents,senderFrame:contents.mainFrame},'close');await flush();
  assert.equal(f.dialogs.length,1);assert.match(f.dialogs[0].options.detail,/システム起動.*停止.*アプリ起動.*動作を続け/);
  assert.equal(win.closed,true);assert.equal(cleaned,true);
  assert.equal(contents.listenerCount('before-mouse-event'),0);
  f.app.emit('window-all-closed');assert.equal(f.app.quitting,true);
 }
});


test('micro label height IPC is main-frame-only and cannot resize normal or expanded windows',async()=>{
 const f=await mainFixture();f.proc.emit('message',{type:'diag-start',url});await new Promise(resolve=>setImmediate(resolve));
 const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
 assert.equal(control(event,'resizeMicroLabel',90),false);assert.equal(control(event,'startMicro',true),true);
 assert.equal(control({...event,senderFrame:{}},'resizeMicroLabel',90),false);
 assert.equal(control({...event,sender:{}},'resizeMicroLabel',90),false);
 for(const value of [17,4097,Infinity,NaN,'90',90.5])assert.equal(control(event,'resizeMicroLabel',value),false);
 assert.equal(control(event,'resizeMicroLabel',90),true);assert.equal(f.win.bounds.width,128);assert.equal(f.win.bounds.height,210);
 assert.equal(control(event,'expandMicro',{expanded:true,count:13}),true);assert.equal(control(event,'resizeMicroLabel',18),false);
 assert.equal(control(event,'expandMicro',{expanded:false,count:13}),true);assert.equal(f.win.bounds.height,210);
 assert.equal(control(event,'resizeMicroLabel',18),true);assert.equal(f.win.bounds.height,138);
 control(event,'startMicro',false);
});

test('公式Webは固定URLだけを既定ブラウザで開き、任意URLやElectron新規窓を拒否する',async()=>{
 const f=await mainFixture();f.proc.emit('message',{type:'diag-start',url});await new Promise(r=>setImmediate(r));
 for(const target of ['https://www.python.org/','https://example.com/','file:///tmp/a','javascript:alert(1)','https://www.python.org/?secret=a'])assert.equal(f.policy.window({url:target}).action,'deny');
 assert.deepEqual(f.openings.filter(item=>item.external).map(item=>item.external),['https://www.python.org/']);
});

test('標準最大化の準備中は連打をまとめ、再読込・最小化・終了・表示切替で遅い最大化を取り消す',async()=>{
 for(const action of ['reload','minimize','close','beginDisplay','startMini','startMicro']){
  let release,active=false,applied=0;
  const effect={get active(){return active;},get preparing(){return active;},準備(){active=true;return new Promise(resolve=>release=()=>resolve(true));},async 完了(){active=false;return true;},中止(){active=false;}};
  const f=await mainFixture({sizeEffects:{画面サイズ演出を作成:()=>effect}});f.proc.emit('message',{type:'diag-start',url});await flush();
  const control=f.handlers['diag:window'],event={sender:f.win.webContents,senderFrame:f.win.webContents.mainFrame};
  const pending=control(event,'maximize'),complete=release;
  assert.equal(control(event,'maximize'),false,'準備中の二度押しは新しい最大化を作らない');
  // 現在窓に対する実際のsetBoundsだけ数える（先行操作の変更は含めない）。
  if(action==='reload')f.win.webContents.emit('did-start-loading');
  else if(action==='beginDisplay')void control(event,action,'mini');
  else if(['startMini','startMicro'].includes(action))await control(event,action,true);
  else control(event,action);
  const snapshot=f.win.getBounds(),original=f.win.setBounds.bind(f.win);f.win.setBounds=(...args)=>{applied++;return original(...args);};
  complete();assert.equal(await pending,false,action);assert.equal(applied,0,action);assert.deepEqual(f.win.getBounds(),snapshot,action);
  // 合成表示効果だけを片付ける。実サービス・ユーザー窓は存在しない。
  effect.中止();
 }
});
test('preload標準タイトル能力はWindowsだけに固定公開し汎用IPCを増やさない',async()=>{
 for(const platform of ['win32','linux','darwin']){
  const exposed={};vm.runInNewContext(await readFile(new URL('../起動/preload.cjs',import.meta.url),'utf8'),{process:{argv:[],platform},require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed[name]=api},ipcRenderer:{invoke:()=>{throw Error('capability must not invoke IPC');}}})});
  assert.equal(exposed.aidiyWindow.customNormalTitle,platform==='win32');assert.equal(Object.isFrozen(exposed.aidiyWindow),true);
 }
});
