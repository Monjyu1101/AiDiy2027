// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {EventEmitter} from 'node:events';
import cdp from '../デスクトップ/ブラウザCDP.cjs';
import browser from '../デスクトップ/ブラウザ.cjs';
import shared from '../デスクトップ/下書き共有.cjs';
import drafts from '../デスクトップ/draft-router.cjs';
import {appendDraft} from '../src/components/下書き連携/下書き受け渡し.js';

test('Browser連携: session・tab_idが先頭、URLと60秒以内の画像だけを後続に追加',()=>{
 const root=resolve('.'),url='https://example.com/日本語?q=1';
 for(const source of [{session:'aidiy_ide 2',tabId:'IDEのBrowser2'},{session:'aidiy_browser 05687026-3ad0-4b23-8be1-f797738ac6cc',tabId:'単独Browser'}]){
  const text=`session: ${source.session}\ntab_id: ${source.tabId}\n`+url;
  assert.deepEqual(browser.browserDraftRequest(root,url,null,100000,source),{projectPath:root,path:url,text,selection:false});
  for(const age of [0,59999,60000])assert.equal(browser.browserDraftRequest(root,url,{path:'temp/input/browser.png',at:100000-age},100000,source).text,text+'\n画像: '+join(root,'temp/input/browser.png'));
  for(const age of [-1,60001])assert.equal(browser.browserDraftRequest(root,url,{path:'temp/input/browser.png',at:100000-age},100000,source).text,text);
 }
 for(const source of [undefined,{}, {session:'aidiy_ide 1'}, {tabId:'tab'}])assert.throws(()=>browser.browserDraftRequest(root,url,null,100000,source),/接続先/);
});

test('Browser連携: 信頼済み送信窓の実session・tab_idを使用し、別窓の操作や再連携に影響されない',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'aidiy-browser-draft-source-')),bridges=[],records=new Map();
 t.after(async()=>{for(const record of records.values())record.window.emit('closed');for(const bridge of bridges)bridge.close();await rm(directory,{recursive:true,force:true});});
 class View{
  constructor(){this.webContents=Object.assign(new EventEmitter(),{url:'',getURL(){return this.url;},getTitle:()=>'',isLoading:()=>false,isDestroyed:()=>false,navigationHistory:{canGoBack:()=>false,canGoForward:()=>false},loadURL:async function(url){this.url=url;},setWindowOpenHandler(){},close(){this.emit('destroyed');}});}
  setVisible(){}setBounds(){}
 }
 const control=browser.createBrowserViews({WebContentsView:View,projectRoot:directory,session:{fromPartition:()=>({setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}}})},trustedEvent:event=>records.get(event.sender)});
 const groups=[];
 for(const sessionPrefix of ['aidiy_ide','aidiy_ide','aidiy_browser','aidiy_browser']){
  const bridge=await cdp.createBrowserCDP({directory,sessionPrefix,canUse:async()=>true,openPanel:async()=>{},allowedURL:()=>true});bridges.push(bridge);
  const group=[];
  for(let slot=0;slot<2;slot++){
   const window=Object.assign(new EventEmitter(),{isDestroyed:()=>false,isFullScreen:()=>false,contentView:{addChildView(){}},webContents:Object.assign(new EventEmitter(),{send(){}})});
   const record={kind:'browser',slot,window,url:'http://127.0.0.1:12345/',browserSession:bridge.name};records.set(window.webContents,record);
   const page=control.attach(record,`https://example.test/${bridge.name.startsWith('aidiy_ide')?'ide':'standalone'}/${slot}`);bridge.add(record,page);group.push(record);
  }
  groups.push(group);
 }
 for(let i=0;i<groups.length;i++){
  const manifest=JSON.parse(await readFile(join(directory,bridges[i].name+'.json'),'utf8'));
  const tabs=await(await fetch(`http://127.0.0.1:${manifest.port}/${manifest.token}/json/list`)).json();
  for(let n=0;n<2;n++){
   const record=groups[i][n],event={sender:record.window.webContents},source={session:record.browserSession,tabId:record.browserTabId};
   assert.equal(source.tabId,tabs[n].id);assert.equal(source.session,manifest.name);
   const first=await control.action(event,'draft');assert.equal(first.ok,true);
   assert.equal(first.request.text,`session: ${manifest.name}\ntab_id: ${tabs[n].id}\n${tabs[n].url}`);
   // 別窓へ操作した後でも、rendererから偽のsessionを指定しても送信元だけを使う。
   await control.action({sender:groups[(i+1)%groups.length][0].window.webContents},'draft');
   const repeat=await control.action(event,'draft',{session:'default',tabId:groups[(i+1)%groups.length][0].browserTabId});
   assert.deepEqual(repeat,first);
  }
 }
 assert.equal((await control.action({sender:{}},'draft')).ok,false);
});

test('Browser連携: 別プロセス相当のCode/LiveへHTTP経由で下書きを渡し、別プロジェクト・古い会話を拒否',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidiy-draft-bridge-')),project=join(root,'project'),other=join(root,'other');await mkdir(project);await mkdir(other);
 t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});});
 const directory=join(root,'registry'),bridges=[];t.after(async()=>{await Promise.all(bridges.map(b=>b.close()));});
 const state={active:true,mode:'online',startedAt:1,project:{path:project}},key=s=>`${s.mode}:${s.startedAt}`;
 const targetRecords=new Map(),sourceRecords=new Map();const sent=[],draftText=new Map();let router;
 function target(kind,folder){
  const record={kind,slot:0,revision:0,window:{isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,webContents:{send:(_name,payload)=>{setImmediate(()=>{const result=appendDraft(draftText.get(record)||'既存の下書き',payload.text,kind);draftText.set(record,result.draft);sent.push({kind,text:payload.text,...result});router.acknowledge(record,{requestId:payload.requestId,ok:result.ok});});}}}};
  targetRecords.set(record.window.webContents,record);return{record,folder};
 }
 const code=target('code',project),live=target('live',project),foreign=target('code',other);
 const readState=async r=>r===foreign.record?{...state,project:{path:other}}:state;
 router=drafts.createDraftRouter({records:targetRecords,readState,sessionKey:key,focusWindow:()=>{}});
 for(const {record,folder} of [code,live,foreign])router.register(record,{kind:record.kind,contextId:record.kind+folder,projectPath:folder,label:record.kind});
 const remote=await shared.createSharedDraftBridge({directory,records:targetRecords,router,readState,sessionKey:key});bridges.push(remote);
 const sender=await shared.createSharedDraftBridge({directory,records:sourceRecords,router:drafts.createDraftRouter({records:sourceRecords,readState,sessionKey:key,focusWindow:()=>{}}),readState,sessionKey:key});bridges.push(sender);
 const source={kind:'browser',window:{isDestroyed:()=>false}};
 const list=await sender.list(source);assert.deepEqual(list.targets.map(x=>x.kind).sort(),['code','live']);
 const identities=[{session:'aidiy_ide 2',tabId:'browser-2'},{session:'aidiy_browser 05687026-3ad0-4b23-8be1-f797738ac6cc',tabId:'standalone-1'}];
 const payloads=[];
 for(const identity of identities)for(const age of [0,60001]){
  const request=browser.browserDraftRequest(project,'https://example.com/',{path:'temp/input/browser.png',at:100000-age},100000,identity);payloads.push(request.text);
  for(const chosen of list.targets){const result=await sender.insert(source,{targetId:chosen.id,contextId:chosen.contextId,projectPath:project,sessionKey:list.sessionKey,text:request.text});assert.equal(result.ok,true);}
 }
 assert.equal(sent.length,8);
 for(const {record} of [code,live])assert.equal(draftText.get(record),'既存の下書き\n\n'+payloads.join('\n\n'),'Code/Liveとも連携順にsessionを含め追記し、既存下書きを保持する');
 assert.equal(payloads.filter(text=>text.includes('画像:')).length,2);
 const chosen=list.targets.find(x=>x.kind==='code');router.register(code.record,{kind:'code',contextId:'new-conversation',projectPath:project,label:'Code'});
 await assert.rejects(sender.insert(source,{targetId:chosen.id,contextId:chosen.contextId,projectPath:project,sessionKey:list.sessionKey,text:'送らない'}));assert.equal(sent.length,8);
 await assert.rejects(sender.insert(source,{targetId:chosen.id,contextId:chosen.contextId,projectPath:other,sessionKey:list.sessionKey,text:'送らない'}));
});
