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
import shared from '../デスクトップ/下書き共有.cjs';
import drafts from '../デスクトップ/draft-router.cjs';
import {appendDraft} from '../src/components/下書き連携/下書き受け渡し.js';

test('Navi連携: 別プロセス相当のCode/LiveへHTTP経由で下書きを渡し、別プロジェクト・古い会話を拒否',async t=>{
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
 const source={kind:'navi',window:{isDestroyed:()=>false}};
 const list=await sender.list(source);assert.deepEqual(list.targets.map(x=>x.kind).sort(),['code','live']);
 const text='今回の目標\n対処しようとしている内容\n今回の作業 <AI本文>  ';
 for(const chosen of list.targets){const result=await sender.insert(source,{targetId:chosen.id,contextId:chosen.contextId,projectPath:project,sessionKey:list.sessionKey,text});assert.equal(result.ok,true);}
 assert.equal(sent.length,2);
 for(const {record} of [code,live])assert.equal(draftText.get(record),'既存の下書き\n\n'+text);
 const chosen=list.targets.find(x=>x.kind==='code');router.register(code.record,{kind:'code',contextId:'new-conversation',projectPath:project,label:'Code'});
 await assert.rejects(sender.insert(source,{targetId:chosen.id,contextId:chosen.contextId,projectPath:project,sessionKey:list.sessionKey,text:'送らない'}));assert.equal(sent.length,2);
 await assert.rejects(sender.insert(source,{targetId:chosen.id,contextId:chosen.contextId,projectPath:other,sessionKey:list.sessionKey,text:'送らない'}));
});
