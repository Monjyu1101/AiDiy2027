// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 評価は読取専用のまま。明示的な開始だけが専用Codeへの実行を許可する。
// evaluated は再評価が終わるたびに、その総合達成率を渡す（100%到達の回、3回改善なしで止まる回も含む）。
export async function runNavigationAutopilot({initial,runCode,evaluate,isCurrent,signal,report=()=>{},evaluated=()=>{}}){
 const check=()=>{if(signal.aborted||!isCurrent())throw Error('自動航行を停止しました。');};
 let result=initial,round=0,stalled=0;
 const best=new Map((initial?.items||[]).map(item=>[item.id,item.progress]));
 while(true){
  check();
  if(!result||!Number.isInteger(result.overall?.progress))throw Error('評価結果を確認できないため停止しました。');
  if(result.overall.progress===100)return '総合評価が100%になったため、自動航行を終了しました。';
  const next=result.items?.find(item=>item.progress<100);
  if(!next||result.nextItemId!==next.id||typeof result.nextPrompt!=='string'||!result.nextPrompt.trim())throw Error('実行できるプロンプトがないため停止しました。');
  report({phase:'code',round:++round,text:`${round}回目: Codeでプロンプトを実行中…`});
  await runCode(result.nextPrompt,signal);check();
  report({phase:'evaluate',round,text:`${round}回目: 読取専用で再評価中…`});
  const updated=await evaluate(signal);check();
  if(updated?.navigationId!==initial.navigationId||updated?.goal!==initial.goal||updated?.items?.length!==initial.items.length||updated.items.some((item,index)=>item.id!==initial.items[index].id||item.name!==initial.items[index].name))throw Error('対象のナビ記録が変わったため停止しました。');
  evaluated({round,progress:updated.overall?.progress});
  let improved=false;
  for(const item of updated.items){if(item.progress>(best.get(item.id)??0)){best.set(item.id,item.progress);improved=true;}}
  stalled=improved?0:stalled+1;result=updated;
  if(result.overall?.progress!==100&&stalled>=3)throw Error('3回続けて項目の達成率が改善しなかったため停止しました。Codeの結果と評価理由を確認してください。');
 }
}
export function navigationWait(ms,signal){
 return new Promise((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);reject(Error('自動航行を停止しました。'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);
  signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
 });
}
