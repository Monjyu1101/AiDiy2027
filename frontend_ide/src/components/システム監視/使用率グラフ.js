// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const percent=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:null;
export function chartSeries(samples){
 const recent=samples.slice(-60);
 return [['cpu','#68dbaa'],['gpu','#a69cff'],['ram','#55c8f5']].map(([key,color])=>{
  const segments=[];let points=[];
  for(let i=0;i<recent.length;i++){
   const value=percent(recent[i][key]);
   if(value===null){if(points.length)segments.push(points);points=[];continue;}
   points.push([350-(recent.length-1-i)*322/59,160-value*1.44]);
  }
  if(points.length)segments.push(points);
  const path=points=>points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('');
  const value=percent(recent.at(-1)?.[key]);
  return {key,color,value,y:value===null?160:160-value*1.44,line:segments.map(path).join(''),area:segments.map(p=>`${path(p)}L${p.at(-1)[0]} 160L${p[0][0]} 160Z`).join('')};
 });
}
// 最新点に追従させつつ、同じ使用率のラベルだけ上下へ離す。
export function placeLabels(series){
 const sorted=series.map((item,i)=>({...item,labelY:item.value===null?128+i*16:item.y})).sort((a,b)=>a.labelY-b.labelY);
 for(let i=0;i<sorted.length;i++)sorted[i].labelY=Math.max(20,sorted[i].labelY,i?sorted[i-1].labelY+18:20);
 for(let i=sorted.length-1;i>=0;i--)sorted[i].labelY=Math.min(156,sorted[i].labelY,i<sorted.length-1?sorted[i+1].labelY-18:156);
 return sorted;
}
