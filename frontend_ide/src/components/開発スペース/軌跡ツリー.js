// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { uniqueRouteRecords } from './経路記録.js';
const valid = value => typeof value === 'string' && /^(?:[gf]:.+|o:.*)$/.test(value);

// 保存済みの辺だけを表示する。循環・合流は参照行で止め、架空の親子を補わない。
// 再帰を使わないので長い検索経路でもスタックを消費しない。
export function routeTreeRows(input) {
  const records=uniqueRouteRecords(input.filter(r=>r&&valid(r.to)&&(r.from===null||valid(r.from))&&r.from!==r.to));
  const children=new Map(),points=new Set(),parents=new Set(),roots=[];
  for(const {from,to} of records){
    points.add(to);
    if(from===null){roots.push(to);continue;}
    points.add(from);parents.add(to);
    if(!children.has(from))children.set(from,[]);children.get(from).push(to);
  }
  roots.push(...[...points].filter(point=>!parents.has(point)));
  const rows=[],seen=new Set();
  function visit(point){
    const stack=[{point,parent:null,depth:0}];
    while(stack.length){
      const row=stack.pop(),reference=seen.has(row.point);
      rows.push({...row,key:rows.length,reference,path:row.point.slice(2),type:row.point[0]==='f'?'file':'dir',origin:row.point[0]==='o'});
      if(reference)continue;
      seen.add(row.point);
      const next=children.get(row.point)||[];
      for(let i=next.length-1;i>=0;i--)stack.push({point:next[i],parent:row.point,depth:row.depth+1});
    }
  }
  for(const root of [...roots,...points])if(!seen.has(root))visit(root);
  return rows;
}

// 閲覧日時一覧は表示対象、voyagesは構造。消去した一覧を履歴の辺から復活させない。
export function viewTreeRecords(voyages,paths,folders=[]) {
  const source=Object.entries(voyages||{}),records=[];
  // 階層のnull始点はそのフォルダ内の出発元。親階層の到着点とは表示上だけ分ける。
  // 元の明細・保存形式は変更せず、フォルダ境界の既存の関係を明示する。
  const origins=new Set(folders);
  for(const [base,entries] of source){
    if(!Array.isArray(entries))continue;
    if(entries.length)origins.add(base);
    for(const r of entries)if(r&&valid(r.to)&&(r.from===null||valid(r.from))){
      records.push({from:r.from===null?'o:'+base:r.from,to:r.to});
      if(r.to.startsWith('g:'))origins.add(r.to.slice(2));
    }
  }
  for(const base of origins)records.unshift({from:base?'g:'+base:null,to:'o:'+base});
  const allowedFiles=new Set(paths.map(path=>'f:'+path));
  const keep=new Set([...allowedFiles,...folders.flatMap(path=>['g:'+path,'o:'+path])]),parents=new Map();
  for(const {from,to} of records)if(from!==null){if(!parents.has(to))parents.set(to,[]);parents.get(to).push(from);}
  const queue=[...keep];for(let i=0;i<queue.length;i++)for(const from of parents.get(queue[i])||[]){
    if(from.startsWith('f:')&&!allowedFiles.has(from))continue;
    if(!keep.has(from)){keep.add(from);queue.push(from);}
  }
  const selected=records.filter(r=>keep.has(r.to)).map(r=>({from:keep.has(r.from)?r.from:null,to:r.to}));
  const recorded=new Set(selected.flatMap(r=>[r.from,r.to]));
  for(const point of [...allowedFiles,...folders.map(path=>'g:'+path)])if(!recorded.has(point))selected.push({from:null,to:point});
  return selected;
}

// 到着・出発元は同じフォルダへの1操作。普通のファイルや終端は飛ばさない。
export function routeNavigationSteps(rows){
  const seen=new Set();return rows.filter(row=>{const key=row.type+':'+row.path;if(row.reference||seen.has(key))return false;seen.add(key);return true;});
}
