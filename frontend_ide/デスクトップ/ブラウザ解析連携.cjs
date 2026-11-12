// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {previewFile,validPreviewPath}=require('./native-preview-actions.cjs');
function createBrowserSourceSelection({trustedEvent,readState,sessionKey,context,focusWindow,isQuitting=()=>false,fetcher=fetch}){
 const pending=new WeakSet();
 return async function select(event,value){
  const source=trustedEvent(event),owner=source?.owner;
  if(source?.kind!=='browser'||owner?.kind!=='ide'||owner.owner)return{ok:false,error:'IDEから起動したBrowserで利用できます。'};
  if(!value||typeof value.url!=='string'||value.url.length>8192||typeof value.id!=='string'||value.id.length>128||!validPreviewPath(value.path))return{ok:false,error:'解析結果のファイル指定が不正です。'};
  if(pending.has(source))return{ok:false,error:'ファイルを選択中です。'};
  const revision=owner.revision,initial=context(source);
  const samePage=latest=>latest&&initial&&latest.url===value.url&&latest.activeTabId===initial.activeTabId&&latest.navigationRevision===initial.navigationRevision&&latest.session===initial.session;
  const current=()=>!isQuitting()&&trustedEvent(event)===source&&!source.window.isDestroyed()&&!owner.window.isDestroyed()&&source.owner===owner&&owner.revision===revision&&samePage(context(source));
  const active=state=>current()&&state?.active&&typeof state.project?.path==='string'&&source.linkKey===sessionKey(state);
  pending.add(source);
  try{
   const state=await readState(owner);if(!active(state))throw Error('IDEの利用状態や表示ページが変わりました。');
   const root=state.project.path,key=sessionKey(state);
   const target=new URL('/api/browser-analysis',owner.url);target.searchParams.set('url',value.url);
   const response=await fetcher(target,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('解析結果を確認できません。');
   const data=await response.json(),result=data?.result;
   if(result?.id!==value.id||!Array.isArray(result.files)||!result.files.some(file=>file.path===value.path))throw Error('このファイルは現在の解析結果に含まれていません。');
   const {validSearchPath}=await import('../ファイル機能/ai-search.mjs');
   const {isInternalCredentialPath}=await import('../ファイル機能/内部認証ファイル.mjs');
   const {hasAlwaysExcludedDirectory}=await import('../ファイル機能/フォルダ除外規則.mjs');
   const latest=await readState(owner);
   if(!active(latest)||latest.project.path!==root||sessionKey(latest)!==key)throw Error('IDEの利用状態や表示ページが変わりました。');
   const file=previewFile(root,value.path);
   if(!validSearchPath(value.path)||isInternalCredentialPath(file.full)||hasAlwaysExcludedDirectory(require('node:path').relative(file.realRoot,file.full)))throw Error('このファイルは表示できません。');
   owner.window.webContents.send('development:browser-select-source',{path:value.path,startedAt:latest.startedAt,projectPath:root});
   focusWindow(owner.window);
   return{ok:true};
  }catch(error){return{ok:false,error:error.message};}
  finally{pending.delete(source);}
 };
}
// 未連携Browserには起動案内だけを返す。検出したIDEを所有者・送信先にしない。
function createBrowserAnalysisContext({trustedEvent,context,discover,isQuitting=()=>false}){
 return async function analysisContext(event){
  const record=trustedEvent(event),initial=record?.kind==='browser'?context(record,event):null;
  if(!initial||isQuitting())return{ok:false,error:'解析対象を取得できません。'};
  if(initial.canSelectSource)return{ok:true,context:initial};
  let status={};try{status=await discover(record);}catch{/* 検出失敗は解析を妨げず、起動中とは表示しない。 */}
  const latest=context(record,event);
  if(isQuitting()||trustedEvent(event)!==record||!latest||latest.url!==initial.url||latest.activeTabId!==initial.activeTabId||latest.navigationRevision!==initial.navigationRevision||latest.session!==initial.session||latest.projectPath!==initial.projectPath||latest.canSelectSource!==initial.canSelectSource)return{ok:false,error:'Browserの表示ページや利用状態が変わりました。もう一度開いてください。'};
  return{ok:true,context:{...latest,ideRunning:status.ideRunning===true,viewerAvailable:status.viewerAvailable===true}};
 };
}
module.exports={createBrowserSourceSelection,createBrowserAnalysisContext};
