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
import browserCDP from '../デスクトップ/ブラウザCDP.cjs';
import layout from '../デスクトップ/window-layout.cjs';


const {projectIdentity,projectProfile}=profiles;
const require=createRequire(import.meta.url),desktopPath=fileURLToPath(new URL('../desktop.cjs',import.meta.url));
const desktopRequire=createRequire(desktopPath),desktopSource=readFileSync(desktopPath,'utf8');

function desktop({project,cwd=project,kind='ide',url='http://127.0.0.1:12345/',appData,locks,newWindow=false,realBridges=false}){
 const app=new EventEmitter(),process=new EventEmitter(),windows=[],messages=[],paths={appData,temp:appData},order=[];
 const ipcMain=new EventEmitter(),handlers=new Map();ipcMain.handle=(name,handler)=>handlers.set(name,handler);
 let ready=Promise.resolve(),connected=true,active=true,startedAt=1,bridgeOptions,bridgeClosed=0;const bridges=[];const pages=[],availability=[];const bridge={name:'aidiy_browser 5ea6a3a0-21b2-4c31-80ab-123456789abc',add(record,page){pages.push({record,page});},close(){bridgeClosed++;}};
 app.getPath=name=>paths[name];app.setPath=(name,path)=>{paths[name]=path;order.push(name);};app.setName=()=>{};
 app.requestSingleInstanceLock=()=>{
  order.push('lock');const existing=locks.get(paths.userData);
  if(existing){existing.emit('second-instance');return false;}
  locks.set(paths.userData,app);return true;
 };
 app.exit=code=>{app.exitCode=code;if(locks.get(paths.userData)===app)locks.delete(paths.userData);app.emit('quit');};
 app.quit=()=>{let prevented=false;app.emit('before-quit',{preventDefault(){prevented=true;}});if(!prevented)app.exit(0);};
 app.whenReady=()=>({then:callback=>ready=Promise.resolve().then(callback)});
 process.env={AIDIY_DEVELOPMENT_KIND:kind,AIDIY_DEVELOPMENT_URL:url,AIDIY_BROWSER_SESSIONS_DIR:join(appData,'browser-sessions'),AIDIY_DEVELOPMENT_NEW_WINDOW:newWindow?'1':'0',...(project?{AIDIY_DEVELOPMENT_PROJECT:project}:{})};
 process.cwd=()=>cwd;process.send=(message,callback)=>{messages.push(message);callback?.();};
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.title=options.title;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};this.webContents.executeJavaScript=async()=>{};this.webContents.send=()=>{};windows.push(this);}
  setBounds(bounds){this.bounds=bounds;}getBounds(){return this.bounds;}
  setTitle(value){this.title=value;}getTitle(){return this.title;}
  isDestroyed(){return !!this.destroyed;}isMinimized(){return !!this.minimized;}
  minimize(){this.minimized=true;}restore(){this.minimized=false;this.restored=true;}
  show(){this.visible=true;}focus(){this.focused=true;this.focusCount=(this.focusCount||0)+1;}
  async loadURL(url){this.url=url;this.webContents.mainFrame.url=url;}setAlwaysOnTop(){}isAlwaysOnTop(){return false;}
  close(){this.destroy();}destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
 }
 const area={x:0,y:0,width:1920,height:1080};
 const electron={app,BrowserWindow:Window,ipcMain,shell:{},dialog:{},session:{defaultSession:{setPermissionCheckHandler(){},setPermissionRequestHandler(){}}},screen:Object.assign(new EventEmitter(),{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:area}),getDisplayMatching:()=>({workArea:area})})};
 const load=name=>name==='electron'?electron:name==='./host/scripts/window-opening.cjs'?{拡大表示:async(_type,window)=>{window.show();window.focus();return true;}}
  :name==='./デスクトップ/desktop-session.cjs'?{readDevelopmentState:async()=>({active,mode:'online',connected,startedAt,project:{path:project}})}:name==='./デスクトップ/ブラウザCDP.cjs'?{createBrowserCDP:async options=>{bridgeOptions=options;const value=realBridges?await browserCDP.createBrowserCDP(options):bridge;bridges.push(value);return value;}}:name==='./デスクトップ/ブラウザ.cjs'?{HOME:'https://www.google.com/',createBrowserViews:()=>({allowedURL:()=>true,attach:(record,target)=>{const page=Object.assign(new EventEmitter(),{isDestroyed:()=>record.window.isDestroyed(),getURL:()=>target||'https://example.test/',getTitle:()=> 'fixture',focus(){}});record.window.once('closed',()=>page.emit('destroyed'));return page;},setAvailable:(record,value)=>availability.push({record,value}),action:async()=>({ok:true}),maximize:record=>{record.window.browserMaximized=true;return true;}})}:desktopRequire(name);
 const api=vm.runInNewContext(`(function(require,__dirname,process){${desktopSource}\nreturn{createWindow,records:windows,checkChildren};})`,{console,setInterval,clearInterval,URL})(load,dirname(desktopPath),process);
 return{...api,app,process,windows,messages,paths,order,pages,availability,bridges,setConnected(value){connected=value;},setActive(value){active=value;},setStartedAt(value){startedAt=value;},get bridgeOptions(){return bridgeOptions;},get bridgeClosed(){return bridgeClosed;},ready:()=>ready,request:(name,window,...args)=>handlers.get(name)({sender:window.webContents,senderFrame:window.webContents.mainFrame},...args)};
}

test('Standalone Browser: 専用プロファイル、共有CDP、最終窓終了、Tools切断、他プロセス分離',async t=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-browser-desktop-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const a=desktop({kind:'browser',project:root,appData:root,locks:new Map()});await a.ready();
 const b=desktop({kind:'browser',project:root,appData:root,locks:new Map()});await b.ready();
 t.after(()=>{a.app.quit();b.app.quit();});
 assert.equal(a.windows.length,1);assert.equal(a.windows[0].url,'http://127.0.0.1:12345/#browser');
 assert.match(a.windows[0].options.icon,/AiDiy\.png$/);assert.match(a.windows[0].options.title,/AiDiy Browser/);
 assert.equal(a.windows[0].options.enableLargerThanScreen,true);assert.equal(await a.request('development:window',a.windows[0],'maximize'),true);assert.equal(a.windows[0].browserMaximized,true);
 assert.notEqual(a.paths.userData,b.paths.userData);assert.equal(a.paths.userData,a.paths.sessionData);assert.ok(!a.order.includes('lock'));
 assert.equal(a.bridgeOptions.sessionPrefix,'aidiy_browser');assert.equal(await a.bridgeOptions.canUse(),true);
 const second=await a.bridgeOptions.openPanel('https://example.com/');assert.equal(a.windows.length,2);assert.equal(second.owner,undefined);
 assert.equal(a.pages.length,2);assert.equal(a.messages[0].windowShown,true);
 a.setConnected(false);assert.equal(await a.bridgeOptions.canUse(),false);
 assert.equal((await a.request('development:browser-action',a.windows[0],'size','portrait')).ok,true);
 assert.equal((await a.request('development:browser-action',a.windows[0],'fullscreen')).ok,true);
 assert.equal((await a.request('development:browser-action',a.windows[0],'navigate','https://example.com/')).ok,false);
 await assert.rejects(a.bridgeOptions.openPanel('https://example.com/'),/tools/);
 a.setConnected(true);assert.equal((await a.request('development:browser-action',a.windows[0],'navigate','https://example.com/')).ok,true);
 a.windows[0].destroy();await new Promise(resolve=>setImmediate(resolve));assert.equal(a.bridgeClosed,0);assert.equal(await a.bridgeOptions.canUse(),true);
 second.window.destroy();await new Promise(resolve=>setImmediate(resolve));assert.equal(a.bridgeClosed,1);assert.equal(b.bridgeClosed,0);assert.equal(await b.bridgeOptions.canUse(),true);
 b.process.emit('disconnect');await new Promise(resolve=>setImmediate(resolve));assert.equal(b.bridgeClosed,1);assert.equal(b.windows[0].destroyed,true);
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function bridgeEndpoint(appData,name){
 const value=JSON.parse(readFileSync(join(appData,'browser-sessions',name+'.json'),'utf8'));
 return `http://127.0.0.1:${value.port}/${value.token}`;
}
async function bridgeRequest(base,path){const response=await fetch(base+path);return{status:response.status,value:await response.json()};}

test('IDE Browser: 窓別session/番号は1,2,3→2閉じ→2再利用、Codeと同じowner/linkKeyで終了管理',async t=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-browser-owned-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const projectA=join(root,'project-a'),projectB=join(root,'project-b'),locks=new Map();mkdirSync(projectA);mkdirSync(projectB);
 const a=desktop({project:projectA,appData:root,locks,realBridges:true});await a.ready();
 const b=desktop({project:projectB,appData:root,locks,realBridges:true});await b.ready();
 t.after(async()=>{a.app.quit();b.app.quit();await settle();});
 const ownerA=a.records.get(a.windows[0].webContents),ownerB=b.records.get(b.windows[0].webContents);
 const codeA=await a.createWindow('code',ownerA.url+'#code',undefined,ownerA,'online:1');
 assert.equal(a.records.get(codeA.webContents).slot,0);
 for(let n=0;n<3;n++)assert.equal((await a.request('development:open-browser',ownerA.window)).ok,true);
 assert.equal((await b.request('development:open-browser',ownerB.window)).ok,true);
 const childrenA=()=>[...a.records.values()].filter(record=>record.owner===ownerA&&record.kind==='browser');
 const [first,second,third]=childrenA(),other=[...b.records.values()].find(record=>record.kind==='browser');
 assert.deepEqual(childrenA().map(record=>record.slot),[0,1,2]);
 assert.deepEqual(childrenA().map(record=>record.browserSession),['aidiy_ide 1','aidiy_ide 2','aidiy_ide 3']);
 for(const record of [...childrenA(),other]){
  assert.equal(record.owner,record===other?ownerB:ownerA);assert.equal(record.linkKey,'online:1');
  const expected=`AiDiy IDE / Browser ${record.slot+1}`;
  assert.equal(record.window.getTitle(),expected);
  assert.deepEqual(record.window.getBounds(),layout.windowBounds('browser',{x:0,y:0,width:1920,height:1080},record.owner.window.getBounds(),record.slot));
  assert.equal(await (record===other?b:a).request('development:window',record.window,'title'),expected);
  record.window.setTitle('untrusted page title');record.window.webContents.emit('page-title-updated',{preventDefault(){}});
  assert.equal(record.window.getTitle(),expected,'WebページによるOSタイトル変更を許可しない');
  assert.equal(record.window.options.parent,undefined);
 }
 assert.equal(other.browserSession,'aidiy_ide 4');assert.equal(other.slot,3,'別IDEも共通採番して管理番号とsessionの衝突を防ぐ');
 assert.equal(new Set([...childrenA(),other].map(record=>record.browserTabId)).size,4);
 const endpoint=bridgeEndpoint(root,first.browserSession),otherEndpoint=bridgeEndpoint(root,other.browserSession);
 const list=await bridgeRequest(endpoint,'/json/list');assert.equal(list.status,200);
 assert.deepEqual(list.value.map(page=>page.id),[first.browserTabId]);assert.equal(list.value[0].session,first.browserSession);
 assert.equal((await bridgeRequest(otherEndpoint,'/json/list')).value[0].id,other.browserTabId);
 const oldSecondEndpoint=bridgeEndpoint(root,second.browserSession);
 assert.equal((await bridgeRequest(oldSecondEndpoint,'/close')).status,200);await settle();
 assert.equal(second.window.isDestroyed(),true);assert.equal(first.window.isDestroyed(),false);assert.equal(third.window.isDestroyed(),false);assert.equal(codeA.isDestroyed(),false);assert.equal(other.window.isDestroyed(),false);
 const created=await bridgeRequest(endpoint,'/json/new?url='+encodeURIComponent('https://example.test/new-child'));
 assert.equal(created.status,200);assert.equal(created.value.session,'aidiy_ide 2');assert.equal(created.value.url,'https://example.test/new-child');
 const reused=childrenA().find(record=>record.slot===1);assert.ok(reused);assert.equal(reused.browserTabId,created.value.id);assert.notEqual(reused.browserTabId,second.browserTabId);assert.equal(reused.window.getTitle(),'AiDiy IDE / Browser 2');
 const reusedEndpoint=bridgeEndpoint(root,reused.browserSession);assert.notEqual(reusedEndpoint,oldSecondEndpoint);
 assert.equal((await bridgeRequest(endpoint,'/json/activate/'+created.value.id)).status,409,'new_tab後は返却された新sessionを使う');
 assert.equal((await bridgeRequest(reusedEndpoint,'/json/activate/'+created.value.id)).status,200);
 await fetch(oldSecondEndpoint+'/json/list').then(response=>assert.notEqual(response.status,200),()=>{});
 a.setConnected(false);await a.checkChildren(ownerA);
 assert.equal(childrenA().length,3);assert.equal(codeA.isDestroyed(),false);assert.equal((await bridgeRequest(endpoint,'/json/list')).status,409);
 a.setConnected(true);await a.checkChildren(ownerA);assert.equal((await bridgeRequest(endpoint,'/json/list')).status,200);
 a.setStartedAt(2);assert.equal((await bridgeRequest(endpoint,'/json/list')).status,409,'監視前でも古いlinkKeyから操作しない');await a.checkChildren(ownerA);
 assert.equal(childrenA().length,0);assert.equal(codeA.isDestroyed(),true);assert.equal(other.window.isDestroyed(),false);
 assert.equal((await a.request('development:open-browser',ownerA.window)).ok,true);
 const restarted=childrenA()[0];assert.equal(restarted.linkKey,'online:2');assert.equal(restarted.slot,0);assert.equal(restarted.browserSession,'aidiy_ide 1');
 await a.request('development:end-session',restarted.window);assert.equal(restarted.window.isDestroyed(),false,'子Browser自身にはIDE利用終了の権限を与えない');
 await a.request('development:end-session',ownerA.window);assert.equal(restarted.window.isDestroyed(),true);assert.equal(ownerA.window.isDestroyed(),false);assert.equal(other.window.isDestroyed(),false);
 assert.equal((await a.request('development:open-browser',ownerA.window)).ok,true);
 const final=childrenA()[0],finalEndpoint=bridgeEndpoint(root,final.browserSession);
 ownerA.window.destroy();await settle();assert.equal(final.window.isDestroyed(),true);assert.equal(other.window.isDestroyed(),false);
 await assert.rejects(fetch(finalEndpoint+'/json/list'));
 assert.equal((await bridgeRequest(otherEndpoint,'/json/list')).status,200);
});

test('Standalone Browser: 実bridgeのUUIDはプロセス間で分離し生存中固定、new_tabとclose_sessionは当該起動だけを管理',async t=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-browser-process-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const a=desktop({kind:'browser',project:root,appData:root,locks:new Map(),realBridges:true});await a.ready();
 const b=desktop({kind:'browser',project:root,appData:root,locks:new Map(),realBridges:true});await b.ready();
 t.after(async()=>{a.app.quit();b.app.quit();await settle();});
 const first=[...a.records.values()][0],other=[...b.records.values()][0];
 assert.match(first.browserSession,/^aidiy_browser [a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/);
 assert.notEqual(first.browserSession,other.browserSession);
 for(const [instance,record]of [[a,first],[b,other]]){assert.equal(record.window.getTitle(),'AiDiy Browser');assert.equal(await instance.request('development:window',record.window,'title'),'AiDiy Browser');}
 const endpoint=bridgeEndpoint(root,first.browserSession),otherEndpoint=bridgeEndpoint(root,other.browserSession);
 const created=await bridgeRequest(endpoint,'/json/new?url='+encodeURIComponent('https://example.test/new'));
 assert.equal(created.status,200);assert.equal(created.value.url,'https://example.test/new');
 const second=[...a.records.values()].find(record=>record.browserTabId===created.value.id);
 assert.ok(second);assert.equal(second.browserSession,first.browserSession);assert.equal(created.value.session,first.browserSession);assert.equal(second.window.getTitle(),'AiDiy Browser');assert.equal(second.owner,undefined);assert.equal(second.slot,1);
 assert.equal((await bridgeRequest(endpoint,'/json/activate/'+second.browserTabId)).status,200);
 assert.equal((await bridgeRequest(otherEndpoint,'/json/activate/'+second.browserTabId)).status,409);
 first.window.destroy();await settle();
 assert.equal((await bridgeRequest(endpoint,'/json/list')).value[0].id,second.browserTabId);
 assert.equal(second.browserSession,first.browserSession);
 assert.equal((await bridgeRequest(endpoint,'/close')).status,200);await settle();
 assert.equal(second.window.isDestroyed(),true);assert.equal(other.window.isDestroyed(),false);
 await assert.rejects(fetch(endpoint+'/json/list'));
 assert.equal((await bridgeRequest(otherEndpoint,'/json/list')).value[0].id,other.browserTabId);
});
