// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {open} from 'node:fs/promises';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw Object.assign(new Error(message),{status:400,trialFailure:true});};
const string=(value,max=16000)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export function manualInput(value,supported,label){
 if(!object(value)||Object.keys(value).some(key=>!['family','provider','model','voice','prompt','questions'].includes(key)))fail('試行入力が不正です。');
 const {family,provider,model,voice='',prompt,questions}=value;
 if(!supported(family,provider)||!label(provider)||!label(model)||(family==='PREDICTION'?prompt!==undefined:!string(prompt)))fail('プロバイダ・モデル・入力を確認してください。');
 if(family==='LIVE'&&!label(voice))fail('音声を選択してください。');
 const result={family,provider,model,voice,prompt};
 if(family==='DECISION'){
  if(!Array.isArray(questions)||questions.length!==1)fail('判断する質問を1件入力してください。');
  const q=questions[0];
  if(!object(q)||!['predicate','choice','score'].includes(q.type)||!string(q.name,100)||!string(q.instructions,4000))fail('質問の形式・名前・質問文を確認してください。');
  const list=q.type==='choice'?'choices':q.type==='score'?'levels':null,key=q.type==='choice'?'value':'label';
  if(Object.keys(q).some(k=>!['type','name','instructions',...(list?[list]:[])].includes(k)))fail('質問に未対応の項目があります。');
  const question={type:q.type,name:q.name.trim(),instructions:q.instructions.trim()};
  if(list){
   const items=q[list];
   if(!Array.isArray(items)||items.length<2||items.length>32||items.some(item=>!object(item)||!string(item[key],200)||Object.keys(item).some(k=>![key,'description'].includes(k))||(item.description!==undefined&&(typeof item.description!=='string'||item.description.length>1000)))||new Set(items.map(item=>item[key].trim())).size!==items.length)fail('選択肢・段階は重複のない2〜32件を入力してください。');
   question[list]=items.map(item=>({[key]:item[key].trim(),description:item.description||''}));
  }
  result.questions=[question];
 }else if(questions!==undefined)fail('質問はDecisionだけで指定できます。');
 return result;
}

// 通常の判断スキーマと同じ形式を確認する。特定の答えを正解にはしない。
export function manualDecisionAnswer(payload,questions){
 const invalid=()=>fail('判断応答の形式が質問と一致しません。');
 const answers=payload?.data?.answers,q=questions[0];
 if(payload?.status!=='OK'||!Array.isArray(answers)||answers.length!==1)invalid();
 const a=answers[0],prob=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
 if(!object(a)||a.name!==q.name)invalid();
 if(a.type==='refusal'){if(typeof a.refusal!=='string')invalid();return {type:a.type,name:a.name,refusal:a.refusal};}
 if(a.type!==q.type)invalid();
 if(a.type==='predicate'){if(!prob(a.probability))invalid();return {type:a.type,name:a.name,probability:a.probability};}
 const expected=q.type==='choice'?q.choices.map(c=>c.value):q.levels.map((_,i)=>i);
 if(!prob(a.confidence)||!Array.isArray(a.probabilities)||a.probabilities.length!==expected.length||new Set(a.probabilities.map(p=>p?.value)).size!==expected.length||a.probabilities.some(p=>!expected.includes(p?.value)||!prob(p?.probability))||Math.abs(a.probabilities.reduce((s,p)=>s+p.probability,0)-1)>1e-4)invalid();
 const probabilities=expected.map(value=>a.probabilities.find(p=>p.value===value));
 if(q.type==='choice'){if(!expected.includes(a.choice))invalid();return {type:a.type,name:a.name,choice:a.choice,probabilities:probabilities.map(({value,probability})=>({value,probability})),confidence:a.confidence};}
 if(typeof a.score!=='number'||!Number.isFinite(a.score)||Math.abs(a.score-probabilities.reduce((s,p)=>s+p.value*p.probability,0))>1e-4||probabilities.some((p,i)=>p.label!==q.levels[i].label))invalid();
 return {type:a.type,name:a.name,score:a.score,probabilities:probabilities.map(({value,label,probability})=>({value,label,probability})),confidence:a.confidence};
}

export async function readManualCatalog(name){
 const file=new URL(`../../_AIDIY/aidiy_diag/${name}_info.json`,import.meta.url);
 const handle=await open(file,'r');
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>4*1024*1024)throw Error('catalog');const buffer=Buffer.alloc(4*1024*1024+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>4*1024*1024)throw Error('catalog');return JSON.parse(buffer.subarray(0,bytesRead).toString('utf8').replace(/^\uFEFF/,''));}finally{await handle.close();}
}
