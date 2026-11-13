// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
export function 表示対象を作成({location,storage=()=>globalThis.sessionStorage}){
 const key='aidiy-memo-target:'+location.origin+location.pathname;
 const save=value=>{try{storage()?.setItem(key,JSON.stringify(value));}catch{}};
 let target={};try{target=JSON.parse(storage()?.getItem(key)||'{}')||{};}catch{}
 const parameters=new URLSearchParams(location.hash.slice(1));
 if(parameters.has('new')||parameters.has('source')||parameters.has('id')||parameters.has('scope'))target={new:parameters.get('new')==='1',source:parameters.get('source')||'',id:parameters.get('id')||'',scope:parameters.get('scope')==='system'?'system':'normal'};
 const initialScope=target.scope==='system'?'system':'normal';
 const initialNew=target.new===true,initialSource=typeof target.source==='string'?target.source:'',initialId=typeof target.id==='string'?target.id:'';
 save({new:initialNew,source:initialSource,id:initialId,scope:initialScope});
 return {initialNew,initialSource,initialId,initialScope,onSaved(note){save({new:false,source:note.保存先,id:note.id,scope:initialScope});}};
}

export function メモAPIを作成(api,scope){return (route,options)=>api(scope==='system'?route.replace(/^api\/メモ(?=\/|$)/,'api/メモ/単体'):route,options);}
