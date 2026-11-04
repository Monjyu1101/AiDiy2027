// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import { linearRoute } from '../開発スペース/経路記録.js';

// 各階層では入口（中央）から直下のフォルダ・ファイルをAIの順番で結ぶ。
// 関係のない階層へは線を出さない。別枝への経路はそれぞれの親フォルダに現れる。
export function aiRouteTargets(route,trail,world) {
  const prefix=trail.length?trail.join('/')+'/':'';
  const targets=[];
  for(const path of route) {
    if(!path.startsWith(prefix))continue;
    const rest=path.slice(prefix.length),slash=rest.indexOf('/');
    const target=slash<0?world.byPath.get(path):world.galaxies.find(g=>g.path===prefix+rest.slice(0,slash));
    if(target&&targets.at(-1)!==target)targets.push(target);
  }
  return targets.length?[{x:0,y:0,z:0},...targets]:[];
}


// 検索は一本道だが、閲覧と同じ from / to 明細で描画する。
export function aiRouteRecords(route, trail, world) {
  const paths=[];
  for(const record of route) {
    if(typeof record==='string'){paths.push(record);continue;}
    // 逆辺を除外した後の明細も、直前のtoではなく自身のfromから繋ぐ。
    if(record.from!==null&&paths.at(-1)!==record.from.slice(2))paths.push(record.from.slice(2));
    paths.push(record.to.slice(2));
  }
  const [origin, ...targets] = aiRouteTargets(paths, trail, world);
  return linearRoute(targets).map(record => ({...record,from:record.from ?? origin}));
}
