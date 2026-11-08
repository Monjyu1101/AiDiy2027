// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {validSearchPath} from './ai-search.mjs';
import {isPageSource,normalizeDisplayUrls,normalizeDisplayUrlReason} from '../viewer/表示URL.mjs';
export const relatedScope=(value,path)=>['direct','none'].includes(value)?value:value==='page'&&isPageSource(path)?value:'';
export function normalizeRelatedSources(value,scope){
 if(!Array.isArray(value)||scope==='none')return [];
 const output=[],seen=new Set();
 for(const item of value){
  if(!item||!validSearchPath(item.path)||!['caller','callee','page','related'].includes(item.relation))continue;
  if(scope==='direct'&&!['caller','callee'].includes(item.relation))continue;
  const reason=normalizeDisplayUrlReason(item.reason);if(!reason)continue;
  const line=Number.isInteger(item.line)&&item.line>0&&item.line<=10000000?item.line:null;
  const key=JSON.stringify([item.path,item.relation,line,reason]);if(seen.has(key))continue;seen.add(key);
  output.push({path:item.path,relation:item.relation,...(line?{line}:{}),reason});if(output.length>=100)break;
 }
 return output;
}
export function normalizeAnalysisResult(value,path){
 if(!value||typeof value.content!=='string'||!value.content.trim()||value.content.length>200000)return null;
 const scope=relatedScope(value.relatedSourceScope,path);
 return {id:value.id,requestId:value.requestId,path:value.path,instruction:value.instruction,createdAt:value.createdAt,source:value.source,content:value.content,...(typeof value.warning==='string'?{warning:normalizeDisplayUrlReason(value.warning)}:{}),summary:typeof value.summary==='string'&&value.summary.trim()?value.summary.trim().slice(0,20000):value.content,
  relatedSourceScope:scope,relatedSources:normalizeRelatedSources(value.relatedSources,scope==='page'?'page':scope==='none'?'none':'direct'),
  displayUrls:isPageSource(path)&&!['direct','none'].includes(scope)?normalizeDisplayUrls(value.displayUrls):[],displayUrlReason:normalizeDisplayUrlReason(value.displayUrlReason)};
}
// 原本は各attempt.resultに保持する。これは表示のたびに作る合成であり、原本へ書き戻さない。
export function composeFileAnalysis(run){
 const successful=(run?.attempts||[]).filter(item=>item.result).sort((a,b)=>a.index-b.index);if(!successful.length)return null;
 const urls=new Map(),sources=new Map(),summaries=new Map(),displayUrlReasons=[];
 for(const attempt of successful){
  const result=attempt.result,index=attempt.index;
  const summary=result.summary||result.content,key=summary.trim();
  if(!summaries.has(key))summaries.set(key,{content:summary,analyses:[]});summaries.get(key).analyses.push(index);
  for(const item of result.displayUrls||[]){
   if(!urls.has(item.url))urls.set(item.url,{url:item.url,label:item.label||'',reason:item.reason||'',evidence:[]});
   urls.get(item.url).evidence.push({analysis:index,label:item.label||'',reason:item.reason||''});
  }
  if(result.displayUrlReason)displayUrlReasons.push({analysis:index,reason:result.displayUrlReason});
  for(const item of result.relatedSources||[]){
   if(!sources.has(item.path))sources.set(item.path,{path:item.path,evidence:[]});
   sources.get(item.path).evidence.push({analysis:index,relation:item.relation,line:item.line,reason:item.reason});
  }
 }
 const values=[...summaries.values()],scopes=successful.map(item=>item.result.relatedSourceScope);
 return{id:run.id,instruction:run.instruction,source:run.source,createdAt:Math.max(...successful.map(x=>x.result.createdAt||run.startedAt||0)),
  content:values.map(x=>x.content).join('\n\n'),summaries:values,relatedSources:[...sources.values()],
  displayUrls:[...urls.values()],displayUrlReasons,displayUrlReason:displayUrlReasons.map(x=>`解析${x.analysis}: ${x.reason}`).join('\n'),
  relatedSourceScope:scopes.includes('page')?'page':scopes.includes('direct')?'direct':scopes.includes('none')?'none':'',
  analyses:successful.map(item=>({index:item.index,id:item.id,result:item.result})),successCount:successful.length,totalCount:run.attempts.length};
}
