// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
const copy=value=>JSON.parse(JSON.stringify(value));
export function メモ内容(note={}) {
 return {タイトル:note.タイトル||'',本文:note.本文||'',色:note.色||'yellow',...(note.位置?{位置:copy(note.位置)}:{}),...(note.サイズ?{サイズ:copy(note.サイズ)}:{})};
}
export function 空メモ(note){return !note.タイトル.trim()&&!note.本文.trim();}
export function 自動保存を作成({api,note=null,sourceId,delay=150,changed=()=>{},identity=()=>{},clientId=globalThis.crypto.randomUUID()}){
 let draft=メモ内容(note||{}),saved=note?JSON.stringify(draft):null,record=note?{id:note.id,revision:note.revision,保存先:note.保存先}:null;
 let timer,flight=null,error=null,disposed=false,pendingCreate=null,deleted=false,removing=null;
 const signature=()=>JSON.stringify(draft);
 const blankNew=()=>!record&&!pendingCreate&&空メモ(draft);
 const dirty=()=>!deleted&&!blankNew()&&(!record||signature()!==saved);
 const snapshot=()=>({draft:copy(draft),saving:!!flight,error:error?.message||'',conflict:error?.status===409,dirty:dirty(),blankNew:blankNew(),id:record?.id||null});
 const emit=()=>{if(!disposed)changed(snapshot());};
 async function drain(){
  while(!disposed&&dirty()&&!error){
   const captured=copy(draft),capturedSignature=JSON.stringify(captured);
   let body,creating=!record;
   if(creating){pendingCreate ||= {保存先:sourceId,...captured,clientId};body=pendingCreate;}
   else body={...record,...captured};
   try{
    const result=await api(creating?'api/メモ/作成':'api/メモ/保存',{method:'POST',body:copy(body)});
    record={id:result.id,revision:result.revision,保存先:result.保存先};
    // 作成応答喪失からの再試行は最初の同じ本文を確認してから最新入力を追送する。
    saved=creating?JSON.stringify(メモ内容(body)):capturedSignature;pendingCreate=null;
    try{await identity(copy(result));}catch{}
   }catch(failure){error=failure instanceof Error?failure:Error('保存できませんでした。');}
   emit();
  }
  return !error&&!dirty();
 }
 function flush(){
  clearTimeout(timer);
  if(removing)return removing;
  if(deleted)return Promise.resolve(true);
  if(disposed)return Promise.resolve(false);
  if(flight)return flight;
  if(error)return Promise.resolve(false);
  if(!dirty()){emit();return Promise.resolve(true);}
  // Microtask化し、同期API/mockでもflight設定より先に完了しないようにする。
  flight=Promise.resolve().then(drain).finally(()=>{flight=null;emit();});emit();return flight;
 }
 function edit(patch){
  if(disposed||deleted)return;
  draft={...draft,...copy(patch)};clearTimeout(timer);emit();
  if(!error&&dirty())timer=setTimeout(()=>{void flush();},delay);
 }
 function retry(){error=null;emit();return flush();}
 function trash(){
  if(removing)return removing;
  if(deleted)return Promise.resolve(true);
  const saved=flush();
  removing=saved.then(async ok=>{
   if(!ok)return false;
   try{
    if(record)await api('api/メモ/削除',{method:'POST',body:copy(record)});
    deleted=true;clearTimeout(timer);emit();return true;
   }catch(failure){error=failure instanceof Error?failure:Error('削除できませんでした。');emit();return false;}
  }).finally(()=>{removing=null;});
  return removing;
 }
 function dispose(){disposed=true;clearTimeout(timer);}
 emit();return {edit,flush,trash,retry,snapshot,dispose};
}
