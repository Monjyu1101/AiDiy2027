// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import profiles from '../デスクトップ/project-profile.cjs';
import {startDevelopment} from '../server.mjs';
import {createCoreConnection} from '../viewer/core-connection.mjs';
const {projectIdentity,projectProfile}=profiles;
const require=createRequire(import.meta.url),desktopPath=fileURLToPath(new URL('../desktop.cjs',import.meta.url));
const desktopRequire=createRequire(desktopPath),desktopSource=readFileSync(desktopPath,'utf8');

function folders(t){
 const root=mkdtempSync(join(tmpdir(),'aidiy-project-instance-'));
 t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:3}));
 const one=join(root,'一番 空白','project'),two=join(root,'二番','project');
 mkdirSync(one,{recursive:true});mkdirSync(two,{recursive:true});
 return{root,one,two};
}

test('IDE識別: 完全パス・相対表記・末尾区切り・リンクを揃え、同名の別プロジェクトを分ける',t=>{
 const {root,one,two}=folders(t),alias=join(root,'alias');
 symlinkSync(one,alias,process.platform==='win32'?'junction':'dir');
 const expected=projectIdentity(one);
 assert.equal(projectIdentity(join(one,'..','project')+'/').key,expected.key);
 assert.deepEqual(projectIdentity(alias),expected);
 assert.equal(expected.path,realpathSync.native(one));
 assert.notEqual(projectIdentity(two).key,expected.key);
 assert.match(expected.key,/^[a-f0-9]{64}$/);
 assert.notEqual(projectProfile(root,one),projectProfile(root,two));
 writeFileSync(join(root,'file'),'not a folder');
 assert.throws(()=>projectIdentity(join(root,'file')),/作業フォルダ/);
 assert.throws(()=>projectIdentity(join(root,'missing')),/ENOENT/);
});

test('IDE識別: Windowsの大小文字・斜線・UNC・長いパスは同一、大小文字を区別する別実体は独立',()=>{
 const options={platform:'win32',realpath:path=>path,stat:()=>({isDirectory:()=>true,dev:7n,ino:25n})};
 const key=path=>projectIdentity(path,options).key;
 assert.equal(key('C:\\Work\\日本語 Project'),key('c:/work/日本語 project'));
 assert.equal(key('C:\\Work\\Project'),key('\\\\?\\C:\\Work\\Project'));
 assert.equal(key('\\\\server\\share\\Project'),key('\\\\?\\UNC\\SERVER\\SHARE\\project'));
 assert.notEqual(key('C:\\Work\\Project'),key('D:\\Work\\Project'));
 assert.notEqual(key('C:\\Work\\Project'),projectIdentity('c:\\work\\project',{...options,stat:()=>({isDirectory:()=>true,dev:7n,ino:26n})}).key);
 assert.notEqual(projectIdentity('/Work/Project',{...options,platform:'linux'}).key,projectIdentity('/Work/project',{...options,platform:'linux'}).key);
});

// Electron自体は起動せず、実desktop.cjsを各プロセスに相当する別コンテキストで実行する。
function desktop({project,cwd=project,kind='ide',url='http://127.0.0.1:12345/',appData,locks,newWindow=false}){
 const app=new EventEmitter(),process=new EventEmitter(),windows=[],messages=[],paths={appData,temp:appData},order=[];
 const ipcMain=new EventEmitter(),handlers=new Map();ipcMain.handle=(name,handler)=>handlers.set(name,handler);
 let ready=Promise.resolve();
 app.getPath=name=>paths[name];app.setPath=(name,path)=>{paths[name]=path;order.push(name);};app.setName=()=>{};
 app.requestSingleInstanceLock=()=>{
  order.push('lock');const existing=locks.get(paths.userData);
  if(existing){existing.emit('second-instance');return false;}
  locks.set(paths.userData,app);return true;
 };
 app.exit=code=>{app.exitCode=code;if(locks.get(paths.userData)===app)locks.delete(paths.userData);app.emit('quit');};
 app.quit=()=>{let prevented=false;app.emit('before-quit',{preventDefault(){prevented=true;}});if(!prevented)app.exit(0);};
 app.whenReady=()=>({then:callback=>ready=Promise.resolve().then(callback)});
 process.env={AIDIY_DEVELOPMENT_KIND:kind,AIDIY_DEVELOPMENT_URL:url,AIDIY_DEVELOPMENT_NEW_WINDOW:newWindow?'1':'0',...(project?{AIDIY_DEVELOPMENT_PROJECT:project}:{})};
 process.cwd=()=>cwd;process.send=(message,callback)=>{messages.push(message);callback?.();};
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};this.webContents.executeJavaScript=async()=>{};this.webContents.send=()=>{};windows.push(this);}
  setBounds(bounds){this.bounds=bounds;}getBounds(){return this.bounds;}
  isDestroyed(){return !!this.destroyed;}isMinimized(){return !!this.minimized;}
  minimize(){this.minimized=true;}restore(){this.minimized=false;this.restored=true;}
  show(){this.visible=true;}focus(){this.focused=true;this.focusCount=(this.focusCount||0)+1;}
  async loadURL(url){this.url=url;this.webContents.mainFrame.url=url;}setAlwaysOnTop(){}isAlwaysOnTop(){return false;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
 }
 const area={x:0,y:0,width:1920,height:1080};
 const electron={app,BrowserWindow:Window,ipcMain,shell:{},dialog:{},session:{defaultSession:{setPermissionCheckHandler(){},setPermissionRequestHandler(){}}},screen:Object.assign(new EventEmitter(),{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:area}),getDisplayMatching:()=>({workArea:area})})};
 const load=name=>name==='electron'?electron:name==='./host/scripts/window-opening.cjs'?{拡大表示:async(_type,window)=>{window.show();window.focus();return true;}}
  :name==='./デスクトップ/desktop-session.cjs'?{readDevelopmentState:async()=>({active:true,mode:'offline',startedAt:1,project:{path:project}})}:desktopRequire(name);
 vm.runInNewContext(`(function(require,__dirname,process){${desktopSource}\n})`,{console,setInterval,clearInterval,URL})(load,dirname(desktopPath),process);
 return{app,process,windows,messages,paths,order,ready:()=>ready,request:(name,window,...args)=>handlers.get(name)({sender:window.webContents,senderFrame:window.webContents.mainFrame},...args)};
}

test('IDE二重起動: 同一実体は元窓を復元・前面化し、別プロジェクトは独立、終了後は再起動できる',async t=>{
 const {root,one,two}=folders(t),locks=new Map(),appData=join(root,'profiles');mkdirSync(appData);
 const a=desktop({project:one,cwd:two,appData,locks});await a.ready();
 const b=desktop({project:two,cwd:one,url:'http://127.0.0.1:12346/',appData,locks});await b.ready();
 t.after(()=>{a.app.quit();b.app.quit();});
 assert.equal(a.windows.length,1);assert.equal(b.windows.length,1);assert.equal(locks.size,2);
 assert.notEqual(a.paths.userData,b.paths.userData);
 assert.equal(a.paths.userData,projectProfile(appData,one));
 assert.equal(a.paths.sessionData,a.paths.userData);assert.equal(b.paths.sessionData,b.paths.userData);
 assert.ok(a.order.indexOf('sessionData')<a.order.indexOf('lock'));
 a.windows[0].minimize();a.windows[0].focused=false;const original=a.windows[0].url;
 const duplicate=desktop({project:one+'/',cwd:two,url:'http://127.0.0.1:12347/',appData,locks});await duplicate.ready();
 assert.equal(duplicate.windows.length,0);assert.equal(duplicate.messages[0].existingWindow,true);assert.equal(duplicate.app.exitCode,0);
 assert.equal(a.windows[0].minimized,false);assert.equal(a.windows[0].focused,true);assert.equal(a.windows[0].url,original);
 assert.equal(b.windows[0].focusCount,1);assert.equal(locks.size,2);
 assert.equal((await a.request('development:open-viewer',a.windows[0],'one.txt')).ok,true);
 assert.equal((await b.request('development:open-viewer',b.windows[0],'two.txt')).ok,true);
 assert.equal(a.windows.length,2);assert.equal(b.windows.length,2);
 assert.equal((await b.request('development:open-viewer',a.windows[0],'one.txt')).ok,false);
 a.process.emit('disconnect');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(a.windows[0].destroyed,true);assert.equal(b.windows[0].destroyed,undefined);assert.equal(locks.size,1);
 assert.equal(a.windows[1].destroyed,true);assert.equal(b.windows[1].destroyed,undefined);
 const again=desktop({project:one,appData,locks});await again.ready();
 t.after(()=>again.app.quit());assert.equal(again.windows.length,1);assert.equal(again.paths.userData,a.paths.userData);
});

test('IDE同時起動: 最初の画面作成を待っている間も同じプロジェクトの追加窓を作らない',async t=>{
 const {root,one}=folders(t),locks=new Map(),appData=join(root,'profiles');mkdirSync(appData);
 const first=desktop({project:one,appData,locks}),second=desktop({project:one,appData,locks});
 await Promise.all([first.ready(),second.ready()]);t.after(()=>first.app.quit());
 assert.equal(first.windows.length,1);assert.equal(second.windows.length,0);assert.equal(second.messages[0].existingWindow,true);
 assert.equal(first.windows[0].visible,true);assert.equal(first.windows[0].focused,true);
});

test('Code / Liveの種別ごとの既存窓再利用を維持する',async t=>{
 const {root,one,two}=folders(t),locks=new Map(),appData=join(root,'profiles');mkdirSync(appData);
 for(const kind of ['code','live']){
  const first=desktop({project:one,kind,appData,locks});await first.ready();t.after(()=>first.app.quit());
  const second=desktop({project:two,kind,appData,locks});await second.ready();
  assert.equal(second.windows.length,0);assert.equal(second.messages[0].existingWindow,true);
  assert.equal(first.paths.userData,join(appData,`aidiy_${kind}_vue`));
 }
});

test('Diagの別窓起動: IDE / Codeは同じプロジェクトでも別窓、Liveは既存の排他を維持する',async t=>{
 const {root,one}=folders(t),locks=new Map(),appData=join(root,'profiles');mkdirSync(appData);
 for(const kind of ['ide','code','live']){
  const first=desktop({project:one,kind,appData,locks,newWindow:true});await first.ready();t.after(()=>first.app.quit());
  const second=desktop({project:one,kind,appData,locks,newWindow:true});await second.ready();t.after(()=>second.app.quit());
  assert.equal(first.windows.length,1);assert.equal(second.windows.length,kind==='live'?0:1);
  if(kind!=='live'){assert.notEqual(first.paths.userData,second.paths.userData);assert.equal(first.paths.userData,first.paths.sessionData);}
 }
});

test('IDE並行サーバー: 自動ポート・走査キャッシュ・接続・終了をプロジェクト間で共有しない',async t=>{
 const {one,two}=folders(t);writeFileSync(join(one,'one.txt'),'ONE');writeFileSync(join(two,'two.txt'),'TWO');
 const connections=[one,two].map(project=>createCoreConnection(project,{target:'http://127.0.0.1:1',fetcher:async()=>({ok:true,json:async()=>({status:'ok',name:'aidiy_code_agents'})})}));
 const a=await startDevelopment(one,{connection:connections[0]}),b=await startDevelopment(two,{connection:connections[1]});
 t.after(async()=>{await a.close();await b.close();});
 assert.notEqual(a.url,b.url);
 const post=(app,name)=>fetch(app.url+'api/connection/'+name,{method:'POST'}).then(r=>r.json());
 assert.equal((await post(a,'offline')).project.path,one);assert.equal((await post(b,'connect')).project.path,two);
 const galaxy=app=>fetch(app.url+'api/galaxy').then(r=>r.json());
 const [first,second]=await Promise.all([galaxy(a),galaxy(b)]);
 assert.match(JSON.stringify(first),/one\.txt/);assert.doesNotMatch(JSON.stringify(first),/two\.txt/);
 assert.match(JSON.stringify(second),/two\.txt/);assert.doesNotMatch(JSON.stringify(second),/one\.txt/);
 const before=connections[1].state();await post(a,'disconnect');
 assert.equal(connections[1].state().startedAt,before.startedAt);assert.equal(connections[1].state().connected,true);
 await a.close();assert.equal(connections[0].state().active,false);assert.equal(connections[1].state().active,true);
 assert.equal((await fetch(b.url+'api/galaxy')).status,200);
 await assert.rejects(()=>fetch(a.url));
});

test('起動引数: 明示プロジェクトを解決してからElectronへ渡し、重複側のサーバーだけ停止する',async t=>{
 const {root,one,two}=folders(t),{transformSync}=require('esbuild'),launchPath=new URL('../launch.mjs',import.meta.url);
 const source=readFileSync(launchPath,'utf8').replaceAll('import.meta.url',JSON.stringify(launchPath.href));
 const {code}=transformSync(source,{format:'cjs'}),module={exports:{}},started=[],spawned=[];
 const fakeProcess=new EventEmitter();Object.assign(fakeProcess,{env:{AIDIY_DEVELOPMENT_PROJECT:two},argv:[],cwd:()=>root});
 const child=new EventEmitter();child.connected=true;child.disconnect=()=>{child.connected=false;};
 const realOptions=await import('../viewer/launch-options.mjs');
 const load=name=>name==='./server.mjs'?{startDevelopment:async(project)=>{const app={url:'http://127.0.0.1:12349/',publicUrl:'http://127.0.0.1:12349/',close:async()=>{app.closed=true;}};started.push({project,app});return app;}}
  :name==='./デスクトップ/desktop-process.mjs'?{spawnDesktop:(_exe,_args,options)=>{spawned.push(options);queueMicrotask(()=>child.emit('message',{existingWindow:true}));return child;}}
  :name==='./viewer/launch-options.mjs'?{...realOptions,useBrowser:()=>false,electronExecutable:()=>'/mock/electron'}
  :desktopRequire(name);
 vm.runInNewContext(code,{module,exports:module.exports,require:load,process:fakeProcess,console:{log(){},warn(){}},setTimeout,clearTimeout,URL});
 await module.exports.launch('ide',['--project',one,'--foreground']);
 assert.equal(started[0].project,realpathSync.native(one));assert.equal(spawned[0].cwd,realpathSync.native(one));
 assert.equal(spawned[0].env.AIDIY_DEVELOPMENT_PROJECT,realpathSync.native(one));
 assert.equal(started[0].app.closed,true);assert.equal(child.connected,false);
});
