// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {linearRoute,restoreRoute,visitPoint,sameRoute,uniqueRouteRecords,searchRouteRecords} from '../src/components/開発スペース/経路記録.js';
import {aiRouteRecords} from '../src/components/開発スペース/検索経路.js';

test('閲覧明細: 同一点・往復は現在点だけ変更し、再訪先から枝を末尾追加する',()=>{
  const records=[];let current=null;
  const visit=to=>{const result=visitPoint(records,current,to);current=result.current;return result.record;};
  visit('f:A');visit('f:B');
  const before=structuredClone(records);
  assert.equal(visit('f:B'),null);assert.equal(visit('f:A'),null);
  assert.deepEqual(records,before);assert.equal(current,'f:A');
  assert.deepEqual(visit('f:C'),{from:'f:A',to:'f:C'});
  assert.deepEqual(records,[{from:null,to:'f:A'},{from:'f:A',to:'f:B'},{from:'f:A',to:'f:C'}]);
  visit('f:B');assert.deepEqual(visit('f:D'),{from:'f:B',to:'f:D'});
});

test('旧保存形式: 再訪を新しい辺にせず、最後の現在点を復元する',()=>{
  assert.deepEqual(restoreRoute(['f:A','f:B','f:A','f:C','f:A']),{
    records:[{from:null,to:'f:A'},{from:'f:A',to:'f:B'},{from:'f:A',to:'f:C'}],current:'f:A',
  });
  const restored=restoreRoute([{from:null,to:'f:A'},{from:'f:A',to:'f:B'}],'f:A');
  assert.deepEqual(visitPoint(restored.records,restored.current,'f:C').record,{from:'f:A',to:'f:C'});
});

test('保存形式の検証: 壊れた明細を無視し、欠けた端点を隣接点で勝手に繋がない',()=>{
  assert.deepEqual(restoreRoute([null,{},42,'bad',{from:42,to:'f:A'},['f:A']]),{records:[],current:null});
  const records=[{from:null,to:'f:A'},{from:'f:deleted',to:'f:C'}];
  assert.deepEqual(restoreRoute(records,'f:unknown'),{records,current:'f:C'});
  assert.deepEqual(restoreRoute(records,null),{records,current:null});
});

test('長い航路: 40件を越えた後も古い参照点の再訪を追加しない',()=>{
  const records=[];let current=null;
  for(let i=0;i<100;i++)current=visitPoint(records,current,`f:${i}`).current;
  assert.equal(visitPoint(records,current,'f:0').record,null);
  assert.equal(records.length,100);
});

test('検索明細: 閲覧と同じ from/to で一本道と階層ごとの入口を保つ',()=>{
  assert.deepEqual(linearRoute(['A','B','C']),[{from:null,to:'A'},{from:'A',to:'B'},{from:'B',to:'C'}]);
  const a={path:'A'},folder={path:'src'},b={path:'src/B'},world={byPath:new Map([['A',a],['src/B',b]]),galaxies:[folder]};
  assert.deepEqual(aiRouteRecords(['A','src/B'],[],world),[{from:{x:0,y:0,z:0},to:a},{from:a,to:folder}]);
  assert.deepEqual(aiRouteRecords(['A','src/B'],['src'],world),[{from:{x:0,y:0,z:0},to:b}]);
  assert.deepEqual(aiRouteRecords(['A'],['other'],world),[]);
});


test('同一路の判定: 逆向きも同じとし、最初の向きと明細順を保つ',()=>{
  const first={from:'f:B',to:'f:A'},branch={from:'f:A',to:'f:C'};
  assert.equal(sameRoute(first,{from:'f:A',to:'f:B'}),true);
  assert.equal(sameRoute(first,branch),false);
  const records=uniqueRouteRecords([first,{from:'f:A',to:'f:B'},branch,{from:'f:C',to:'f:A'},first]);
  assert.deepEqual(records,[first,branch]);assert.equal(records[0],first);
  assert.deepEqual(first,{from:'f:B',to:'f:A'},'向きをソートして書き換えない');
  assert.equal(uniqueRouteRecords([{from:'a:b',to:'c'},{from:'a',to:'b:c'}]).length,2,'文字連結による点IDの衝突を作らない');
});

test('始点行のない旧明細: 逆向きは追加せず、到着点を現在点として分岐する',()=>{
  const restored=restoreRoute([{from:'f:A',to:'f:B'},{from:'f:B',to:'f:A'}]);
  assert.deepEqual(restored,{records:[{from:'f:A',to:'f:B'}],current:'f:A'});
  assert.deepEqual(visitPoint(restored.records,restored.current,'f:C'),{current:'f:C',record:{from:'f:A',to:'f:C'}});
  const direct=[{from:'f:A',to:'f:B'}];
  assert.deepEqual(visitPoint(direct,'f:B','f:A'),{current:'f:A',record:null});
  assert.equal(direct.length,1);
});

test('検索の往復: 元のパス順を変えず、共有明細では逆辺を1本へ整理する',()=>{
  const paths=['A','B','A','C','A'];
  assert.deepEqual(searchRouteRecords(paths),[{from:null,to:'f:A'},{from:'f:A',to:'f:B'},{from:'f:A',to:'f:C'}]);
  assert.deepEqual(paths,['A','B','A','C','A']);
  const a={path:'src'},b={path:'other'},world={byPath:new Map(),galaxies:[a,b]};
  assert.deepEqual(aiRouteRecords(['src/A','other/B','src/C'],[],world),[
    {from:{x:0,y:0,z:0},to:a},{from:a,to:b},
  ],'異なるファイルが同じ親へ投影された逆辺も共通規則で整理する');
});


test('整理済み検索明細の投影: 逆辺を除いた後も明細自身の出発点を保つ',()=>{
  const a={path:'A'},b={path:'B'},c={path:'C'};
  const world={byPath:new Map([['A',a],['B',b],['C',c]]),galaxies:[]};
  assert.deepEqual(aiRouteRecords(searchRouteRecords(['A','B','A','C']),[],world),[
    {from:{x:0,y:0,z:0},to:a},{from:a,to:b},{from:a,to:c},
  ],'B→C として誤接続しない');
});
