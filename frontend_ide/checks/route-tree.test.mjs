// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {routeTreeRows,viewTreeRecords,routeNavigationSteps} from '../src/components/開発スペース/軌跡ツリー.js';
import {visitPoint,searchRouteRecords} from '../src/components/開発スペース/経路記録.js';

test('軌跡ツリー: 再訪からの分岐・逆辺は保存済みの親子を変えずに表示',()=>{
 const records=[];let current=null;
 for(const point of ['f:A','f:B','f:A','f:C','f:B','f:D','f:A'])current=visitPoint(records,current,point).current;
 const saved=structuredClone(records),rows=routeTreeRows([...records,{from:'f:B',to:'f:A'}]);
 assert.deepEqual(rows.map(r=>[r.point,r.parent,r.depth,r.reference]),[
  ['f:A',null,0,false],['f:B','f:A',1,false],['f:D','f:B',2,false],['f:C','f:A',1,false],
 ]);
 assert.deepEqual(records,saved);assert.equal(visitPoint(records,current,'f:C').record,null);assert.deepEqual(records,saved);
});
test('軌跡ツリー: 循環・合流は本物の辺の参照だけを表示し無限展開しない',()=>{
 const records=[{from:'f:A',to:'f:B'},{from:'f:B',to:'f:C'},{from:'f:C',to:'f:A'},{from:'f:A',to:'f:D'},{from:'f:D',to:'f:C'}];
 const rows=routeTreeRows(records);
 assert.equal(rows.filter(r=>!r.reference).length,4);assert.equal(rows.length,6);
 for(const row of rows.filter(r=>r.parent))assert.ok(records.some(r=>r.from===row.parent&&r.to===row.point));
 assert.equal(rows.filter(r=>r.reference).length,2);
});
test('軌跡ツリー: 検索順序・並列候補・空状態・長い経路',()=>{
 assert.deepEqual(routeTreeRows([]),[]);
 assert.deepEqual(routeTreeRows(searchRouteRecords(['A','B','A','C'])).map(r=>[r.path,r.parent]),[['A',null],['B','f:A'],['C','f:A']]);
 const parallel=['a/b.txt','a/c.txt','other.txt'].map(path=>({from:null,to:'f:'+path}));
 assert.ok(routeTreeRows(parallel).every(r=>r.depth===0&&r.parent===null),'検索順位やフォルダ階層から親子を捏造しない');
 const rows=routeTreeRows(searchRouteRecords(Array.from({length:12000},(_,i)=>String(i))));
 assert.equal(rows.length,12000);assert.equal(rows.at(-1).depth,11999);
});
test('閲覧ツリー: journal順から辺を作らず、出発点を保持し、クリアで空になる',()=>{
 const voyages={'':[{from:null,to:'f:A'},{from:'f:A',to:'g:src'},{from:'f:A',to:'f:B'}],src:[{from:null,to:'f:src/C'}]};
 const saved=structuredClone(voyages);
 assert.deepEqual(routeTreeRows(viewTreeRecords(voyages,['B','A','legacy.txt'])).map(r=>[r.path,r.parent]),[['',null],['A','o:'],['B','f:A'],['legacy.txt',null]]);
 assert.deepEqual(viewTreeRecords(voyages,[]),[]);assert.deepEqual(voyages,saved);
});


test('フォルダ入場の対: 上位の到着点と内部出発元を分け、前後移動は1操作にまとめる',()=>{
 const voyages={'':[{from:null,to:'g:A'}],A:[{from:null,to:'g:A/B'}],'A/B':[{from:null,to:'f:A/B/one.txt'},{from:'f:A/B/one.txt',to:'f:A/B/two.txt'}]};
 const original=structuredClone(voyages);
 const rows=routeTreeRows(viewTreeRecords(voyages,['A/B/one.txt','A/B/two.txt'],['A','A/B']));
 assert.equal(rows.find(r=>r.point==='o:A').parent,'g:A');assert.equal(rows.find(r=>r.point==='g:A/B').parent,'o:A');
 assert.equal(rows.find(r=>r.point==='o:A/B').parent,'g:A/B');assert.equal(rows.find(r=>r.path==='A/B/one.txt').parent,'o:A/B');
 assert.deepEqual(routeNavigationSteps(rows).map(r=>r.path),['','A','A/B','A/B/one.txt','A/B/two.txt']);
 assert.deepEqual(voyages,original);
});
