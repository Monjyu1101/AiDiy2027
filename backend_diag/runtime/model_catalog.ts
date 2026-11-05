// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// backend_server/conf/conf_model.py (blob 7b70e037c3c9e5624509a6a7678f6d104c188f9a)
// 由来の診断専用移植。I/O・OAuth・静的候補の補充なし。日付は元実装と同じローカル時刻。
export type Pricing = Record<string,string|number|null|[]>;
export type Model = {model_id:string; トークン数:unknown; モダリティ:unknown; 作成日:string|null; pricing?:Pricing|null; output_modalities?:string[]; supported_parameters?:string[]};
// 不明・非数値の料金は null を残し、無料と誤認しない。既知の項目だけを抜いて追加料金を捨てない。
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const ZERO_DECIMAL = /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?$/;
export function safeRouterMetadata(value:unknown,secrets:string[]=[]):Partial<Model> {
 const source=value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const out:Partial<Model>={};
 if(Object.hasOwn(source,'pricing')) {
  const raw=source.pricing;
  if(raw===null||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length>64||Object.keys(raw).some(key=>!/^[a-z][a-z0-9_]{0,63}$/.test(key)))out.pricing=null;
  else out.pricing=Object.fromEntries(Object.entries(raw).map(([key,price])=>[key,
   ['overrides','pricing_overrides'].includes(key)&&Array.isArray(price)&&price.length===0?[]:
   typeof price==='number'&&Number.isFinite(price)?price:
   typeof price==='string'&&price.length<=64&&DECIMAL.test(price)&&!secrets.some(secret=>price.includes(secret))?price:null])) as Pricing;
 }
 const architecture=source.architecture!==null&&typeof source.architecture==='object'&&!Array.isArray(source.architecture)?source.architecture as Record<string,unknown>:{};
 for(const name of ['output_modalities','supported_parameters'] as const) {
  const owner=Object.hasOwn(source,name)?source:name==='output_modalities'?architecture:{};
  if(!Object.hasOwn(owner,name))continue;
  const values=owner[name];
  out[name]=Array.isArray(values)&&values.length<=100&&values.every(item=>typeof item==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(item)&&!secrets.some(secret=>item.includes(secret)))?[...values]:[];
 }
 return out;
}
// prompt/completion が両方明示され、追加料金も全て0の場合だけ無料。微小な正数の丸め落ちも許可しない。
export function zeroOpenrouterPricing(value:unknown):boolean {
 const pricing=safeRouterMetadata({pricing:value}).pricing;
 return !!pricing&&Object.hasOwn(pricing,'prompt')&&Object.hasOwn(pricing,'completion')&&Object.entries(pricing).every(([key,price])=>
  ['overrides','pricing_overrides'].includes(key)&&Array.isArray(price)&&price.length===0||typeof price==='number'&&price===0||typeof price==='string'&&ZERO_DECIMAL.test(price));
}
// 音声/画像生成にはtoken単価0でも従量料金があるため、無料Chatは出力textのみを確認する。
export function openrouterFreeModel(model:unknown):boolean {
 if(model===null||typeof model!=='object'||Array.isArray(model))return false;
 const detail=model as Record<string,unknown>,metadata=safeRouterMetadata(model);
 if(typeof detail.model_id==='string'&&/(?:^|[-/:])(?:content-safety|moderation|guard(?:rails)?)(?:[-/:]|$)/i.test(detail.model_id))return false;
 const output=metadata.output_modalities;
 const modality=typeof detail.モダリティ==='string'?detail.モダリティ:typeof (detail.architecture as Record<string,unknown>|undefined)?.modality==='string'?(detail.architecture as Record<string,unknown>).modality as string:'';
 const parts=modality.toLowerCase().split(/->|→/);
 const outputs=output??(parts.length===2?parts[1].split(/[+,/\s]+/).filter(Boolean):[]);
 const declared=parts.length===2?parts[1].split(/[+,/\s]+/).filter(Boolean):[];
 return zeroOpenrouterPricing(metadata.pricing)&&outputs.length>0&&outputs.every(value=>value==='text')&&declared.every(value=>value==='text');
}
export type Catalog = Record<string,Model>;
const empty = ():Catalog => Object.create(null);
export const pythonString = (value:unknown):string => value === null || value === undefined ? 'None' : value === true ? 'True' : value === false ? 'False' : String(value);
function dateLabel(date:Date):string {
  if (!Number.isFinite(date.getTime())) throw new Error('date');
  return `${String(date.getFullYear()).padStart(4,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`;
}
// Python naive datetime - timedelta はローカル暦の日数演算（DST境界も維持）。
function cutoff(now:Date,days:number):number {const date=new Date(now);date.setDate(date.getDate()-days);return date.getTime()/1000;}
type RawRow = Record<string,unknown>;
function row(value:unknown):RawRow {if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('shape');return value as RawRow;}
function entries(body:unknown):unknown[] {const items=row(body).data??[];if(!Array.isArray(items))throw new Error('shape');return items;}
function number(value:unknown):number {if(typeof value!=='number'||!Number.isFinite(value))throw new Error('number');return value;}
function string(value:unknown):string {if(typeof value!=='string')throw new Error('string');return value;}
export function openrouterCatalog(body:unknown,now=new Date()):Catalog {
 const out=empty();
 for(const entry of entries(body)) {
  const item=row(entry);
  const id=string(item.id ?? ''),provider=id.includes('/')?id.split('/')[0].toLowerCase():'';
  const days=provider==='perplexity'?365:['google','openai','anthropic','x-ai'].includes(provider)?240:90;
  const created=number(Object.hasOwn(item,'created')?item.created:0);if(created<cutoff(now,days))continue;
  out[id]={model_id:id,トークン数:pythonString(Object.hasOwn(item,'context_length')?item.context_length:0),モダリティ:Object.hasOwn(row(Object.hasOwn(item,'architecture')?item.architecture:{}),'modality') ? row(item.architecture).modality : 'unknown',作成日:dateLabel(new Date(created*1000)),...safeRouterMetadata(item)};
 }
 return out;
}
export function googleCatalog(models:{name:string;supported_actions:string[];input_token_limit?:unknown}[],router:Catalog={}):Catalog {
 const out=empty();
 for(const model of models) {
  if(!model.supported_actions.includes('generateContent'))continue;
  const id=model.name.replaceAll('models/','');
  out[id]={model_id:id,トークン数:pythonString(Object.hasOwn(model,'input_token_limit')?model.input_token_limit:0),モダリティ:model.supported_actions.join(','),作成日:null};
 }
 if(Object.keys(router).length)for(const id of Object.keys(out)){
  const key=`google/${id}`;
  if(Object.hasOwn(router,key))out[id].作成日=router[key].作成日;
  else if(!id.toLowerCase().includes('live'))delete out[id];
 }
 return out;
}
export function openaiCatalog(models:{id:string;created:number}[],router:Catalog={},now=new Date()):Catalog {
 const out=empty();
 for(const model of models){if(model.created<cutoff(now,240))continue;out[model.id]={model_id:model.id,トークン数:'0',モダリティ:null,作成日:dateLabel(new Date(model.created*1000))};}
 if(Object.keys(router).length)for(const id of Object.keys(out)){
  const key=`openai/${id}`;
  if(Object.hasOwn(router,key)){out[id].トークン数=router[key].トークン数;out[id].モダリティ=router[key].モダリティ;}
  if(!id.toLowerCase().includes('realtime')&&out[id].トークン数==='0')delete out[id];
 }
 return out;
}
function claudeDate(value:unknown):{timestamp:number|null;label:string|null}{
 if(!value)return {timestamp:null,label:null};
 try {
  if(value instanceof Date)return {timestamp:value.getTime()/1000,label:dateLabel(value)};
  // ISO の作成日は UTC への変換前の日付。fromisoformat と同様、不正な日付は不明扱い。
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value))throw new Error('date');
  const [year,month,day]=value.slice(0,10).split('-').map(Number);
  const check=new Date(Date.UTC(year,month-1,day));
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw new Error('date');
  const parsed=new Date(value.length===10?value+'T00:00:00':value);
  if(!Number.isFinite(parsed.getTime()))throw new Error('date');
  return {timestamp:parsed.getTime()/1000,label:value.slice(0,10).replaceAll('-','/')};
 }catch{return {timestamp:null,label:null};}
}
export function claudeCatalog(models:{data:{id:string;created_at?:unknown}[]},router:Catalog={},now=new Date()):Catalog {
 const out=empty();
 for(const model of models.data){const created=claudeDate(model.created_at);if(created.timestamp!==null&&created.timestamp<cutoff(now,240))continue;out[model.id]={model_id:model.id,トークン数:'0',モダリティ:null,作成日:created.label};}
 if(Object.keys(router).length)for(const id of Object.keys(out)){
  let normalized=id;
  if(normalized.length>=9&&normalized.slice(-9,-8)==='-'&&normalized.slice(-8,-6)==='20')normalized=normalized.slice(0,-9);
  if(normalized.length>=3&&normalized.at(-2)==='-'&&['3','4','5'].includes(normalized.at(-3)!)&&/^\p{Nd}$/u.test(normalized.at(-1)!))normalized=normalized.slice(0,-3)+normalized.at(-3)+'.'+normalized.at(-1);
  const key=`anthropic/${normalized}`;
  if(Object.hasOwn(router,key)){out[id].トークン数=router[key].トークン数;out[id].モダリティ=router[key].モダリティ;}
 }
 return out;
}
export function ollamaCatalog(body:unknown,now=new Date()):Catalog {
 const out=empty();
 const models=entries(body).filter((item):item is RawRow=>item!==null&&typeof item==='object'&&!Array.isArray(item));
 models.sort((a,b)=>number(b.created||0)-number(a.created||0));
 for(const model of models){if(!model.id||!model.created||number(model.created)<cutoff(now,240))continue;const id=string(model.id);let label='yyyy/mm/dd';try{label=dateLabel(new Date(Math.trunc(number(model.created))*1000));}catch{}out[id]={model_id:id,トークン数:'0',モダリティ:null,作成日:label};}
 return out;
}
// backend_server/conf/conf_model.py の _is_retired_openai_model / codex_models.py の filter_retired_models と同じ判定（旧 Sol を除外）。
export function isRetiredOpenaiModel(id:string):boolean {
 const slug=(id.trim().toLowerCase().split('/').at(-1)??'').replace(/^openai\./,'');
 return slug==='gpt-6-sol'||slug.startsWith('gpt-6-sol-')||slug.startsWith('gpt-6-sol.');
}
// get_chat_models と同じく、OpenAI / OpenRouter の表示一覧から廃止モデルを除く（補完用の元一覧は除かない）。
export function withoutRetired(models:Catalog):Catalog {
 const out=empty();for(const [id,model] of Object.entries(models))if(!isRetiredOpenaiModel(id))out[id]=model;return out;
}
// command_hermes/hermes_cli/codex_models.py（DEFAULT_CODEX_MODELS・_FORWARD_COMPAT_TEMPLATE_MODELS）と
// core/model_metadata.py（-900k 対象）、AIチャット_openai.py（_FALLBACK_MODELS）の写し。
export const DEFAULT_CODEX_MODELS=Object.freeze(['gpt-6-astra','gpt-6.1-sol','gpt-6.1-terra','gpt-6-luna']);
export const OAUTH_FALLBACK_MODELS=Object.freeze(['gpt-6-astra','gpt-6.1-sol','gpt-6.1-terra','gpt-6-luna']);
const FORWARD_COMPAT:readonly [string,readonly string[]][]=[['gpt-6-astra',['gpt-6.1-sol','gpt-6.1-terra','gpt-6-luna']],['gpt-6.1-sol',['gpt-5.5','gpt-5.4']],['gpt-6.1-terra',['gpt-5.5','gpt-5.4']],['gpt-6-luna',['gpt-5.5','gpt-5.4']]];
const CONTEXT_SUFFIX='-900k',CONTEXT_BASES=new Set(['gpt-6.1-sol','gpt-6.1-terra','gpt-6-luna','gpt-5.4','gpt-daybreak-blue-latest']),CONTEXT_SNAPSHOT_BASES=['gpt-6.1-sol','gpt-6.1-terra','gpt-6-luna'];
export function isCodex900kBase(model:string):boolean {
 const slug=model.trim().toLowerCase().split('/').at(-1)??'';
 if(!slug||slug.endsWith(CONTEXT_SUFFIX))return false;
 if(CONTEXT_BASES.has(slug))return true;
 return CONTEXT_SNAPSHOT_BASES.some(base=>slug.startsWith(base+'-')&&/^\d{4}-\d{2}-\d{2}$/.test(slug.slice(base.length+1)));
}
// _finalize_codex_models: 廃止除外 → 将来版の補完 → -900k 版の追加。
export function finalizeCodexModels(ids:readonly string[]):string[] {
 const ordered:string[]=[],seen=new Set<string>();
 for(const id of ids.filter(id=>!isRetiredOpenaiModel(id)))if(!seen.has(id)){ordered.push(id);seen.add(id);}
 for(const [synthetic,templates] of FORWARD_COMPAT)if(!seen.has(synthetic)&&templates.some(template=>seen.has(template))){ordered.push(synthetic);seen.add(synthetic);}
 const out:string[]=[],present=new Set(ordered);
 for(const id of ordered){out.push(id);const variant=id+CONTEXT_SUFFIX;if(present.has(variant)||out.includes(variant))continue;if(isCodex900kBase(id))out.push(variant);}
 return out;
}
// Codex の models 応答（API・models_cache.json 共通）: visibility=hide/hidden を除き、priority→slug の順。
export function codexSlugs(body:unknown):string[] {
 const items=row(body).models;if(!Array.isArray(items))throw new Error('shape');
 const sortable:[number,string][]=[];
 for(const entry of items){
  if(entry===null||typeof entry!=='object'||Array.isArray(entry))continue;
  const item=entry as RawRow,slug=typeof item.slug==='string'?item.slug.trim():'';if(!slug)continue;
  if(typeof item.visibility==='string'&&['hide','hidden'].includes(item.visibility.trim().toLowerCase()))continue;
  sortable.push([typeof item.priority==='number'&&Number.isFinite(item.priority)?Math.trunc(item.priority):10000,slug]);
 }
 sortable.sort((a,b)=>a[0]-b[0]||(a[1]<b[1]?-1:a[1]>b[1]?1:0));
 return [...new Set(sortable.map(([,slug])=>slug))];
}
// get_chat_models の OAuth 一覧と同じ形（作成日なし）にする。廃止モデルは表示でも除く。
export function idsCatalog(ids:readonly string[]):Catalog {
 const out=empty();for(const id of ids)if(!isRetiredOpenaiModel(id)&&!Object.hasOwn(out,id))out[id]={model_id:id,トークン数:null,モダリティ:null,作成日:null};return out;
}
// OpenAI OAuth（API 成功時）: _fetch_models_from_api と同じ順序・除外・補完。
export function codexCatalog(body:unknown):Catalog {return idsCatalog(finalizeCodexModels(codexSlugs(body)));}
// API が使えない場合の get_codex_model_ids と同じ順: config.toml の既定 → models_cache.json → 既定値。空なら _FALLBACK_MODELS。
export function codexFallbackCatalog(defaultModel:string|null,cacheIds:readonly string[]):Catalog {
 const ordered:string[]=[];for(const id of [...(defaultModel?[defaultModel]:[]),...cacheIds,...DEFAULT_CODEX_MODELS])if(!ordered.includes(id))ordered.push(id);
 const ids=finalizeCodexModels(ordered);return idsCatalog(ids.length?ids:OAUTH_FALLBACK_MODELS);
}
// backend_server/conf/conf_model.py の CODE_GROK_CLI_MODELS。本体は API を使わずこの固定候補を使う。
export const GROK_CLI_MODELS=Object.freeze(['grok-4.7','grok-4.6']);
// backend_server/conf/conf_model.py の CHAT_LOCAL_MODELS（backend_local の既定値）。本体は _config/AiDiy_chat_local.json を固定候補として流し込む。
export const LOCAL_CHAT_MODELS=Object.freeze(['google/gemma-4-E2B-it','google/gemma-4-E4B-it','google/gemma-4-E2B-it-qat-mobile-transformers','google/gemma-4-E4B-it-qat-mobile-transformers']);
// Grok（xAI）OAuth の /v1/models。本体に API 一覧の絞り込みは無いため、非表示モデルの除外だけを行う。
export function grokCatalog(body:unknown):Catalog {
 const source=row(body),list=Array.isArray(source.data)?source.data:Array.isArray(source.models)?source.models:null;
 if(!list)throw new Error('shape');
 const out=empty();
 for(const entry of list){
  if(entry===null||typeof entry!=='object'||Array.isArray(entry))continue;
  const item=entry as RawRow,info=item.info!==null&&typeof item.info==='object'&&!Array.isArray(item.info)?item.info as RawRow:{};
  const id=[item.id,item.model,item.slug,info.id].find((value):value is string=>typeof value==='string'&&!!value.trim())?.trim();
  if(!id||item.hidden===true||info.hidden===true||Object.hasOwn(out,id))continue;
  const context=[item.context_window,item.context_length,info.context_window].find(value=>typeof value==='number');
  out[id]={model_id:id,トークン数:typeof context==='number'?String(context):null,モダリティ:null,作成日:null};
 }
 return out;
}
// _get_ollama_local_models（ollama list）と同じ一覧。ollama list が使うローカル API の応答から名前だけを取り、作成日は付けない。
export function ollamaLocalCatalog(body:unknown):Catalog {
 const items=row(body).models;if(!Array.isArray(items))throw new Error('shape');
 const rows=items.filter((item):item is RawRow=>item!==null&&typeof item==='object'&&!Array.isArray(item)&&typeof (item as RawRow).name==='string'&&!!((item as RawRow).name as string).trim());
 const time=(item:RawRow)=>{const value=Date.parse(String(item.modified_at??''));return Number.isFinite(value)?value:0;};
 rows.sort((a,b)=>time(b)-time(a));
 const out=empty();for(const item of rows){const name=(item.name as string).trim().split(/\s+/)[0];if(!Object.hasOwn(out,name))out[name]={model_id:name,トークン数:null,モダリティ:null,作成日:null};}
 return out;
}
