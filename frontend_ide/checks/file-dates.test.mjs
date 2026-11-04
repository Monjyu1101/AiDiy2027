// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileDateInfo,nextLocalMidnight} from '../src/components/ファイル閲覧/ファイル日時.js';
test('日時: 無効値は例外を出さず、元日時と時刻を保持する',()=>{
 for(const value of [null,undefined,NaN,Infinity,'invalid',1e20])assert.deepEqual(fileDateInfo(value),{text:'—',today:false,iso:undefined,title:'更新日時不明'});
 const now=new Date(2026,9,16,12).getTime(), result=fileDateInfo(now,now);
 assert.equal(result.today,true);assert.match(result.text,/^今日 /);assert.match(result.title,/2026/);assert.equal(result.iso,new Date(now).toISOString());
 const yesterday=fileDateInfo(now-86400000,now);assert.equal(yesterday.today,false);assert.equal(yesterday.text,yesterday.title);
 assert.equal(new Date(nextLocalMidnight(now)).getHours(),0);
});
for(const zone of ['UTC','Asia/Tokyo','America/New_York'])test(`日時: ${zone} の深夜・年跨ぎ・UTC境界`,()=>{
 const module=new URL('../src/components/ファイル閲覧/ファイル日時.js',import.meta.url).href;
 const code=`import {fileDateInfo,nextLocalMidnight} from ${JSON.stringify(module)};
 const now=new Date(2026,0,1,0,1).getTime(), previous=new Date(2025,11,31,23,59).getTime();
 const boundary=Date.parse('2026-10-15T15:05:00Z'), file=Date.parse('2026-10-15T14:55:00Z');
 console.log(JSON.stringify({today:fileDateInfo(now,now).today,previous:fileDateInfo(previous,now).today,boundary:fileDateInfo(file,boundary).today,next:new Date(nextLocalMidnight(now)).getDate(),hour:new Date(nextLocalMidnight(now)).getHours()}));`;
 const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ:zone},encoding:'utf8'}));
 assert.deepEqual(result,{today:true,previous:false,boundary:zone!=='Asia/Tokyo',next:2,hour:0});
});

// 同じ本番関数を各TZの子プロセスで実行し、UTCへの読み替えと24時間固定を検出する。
for(const zone of ['UTC','Asia/Tokyo','America/New_York'])test(`時刻プリセット: ${zone} の境界・日跨ぎ・夏時間`,()=>{
 const module=new URL('../src/components/ファイル閲覧/ファイル日時.js',import.meta.url).href;
 const code=`import assert from 'node:assert/strict';
 import {timeSearchPresets,timeSearchRange,inTimeRange,localDateTimeInput,parseLocalDateTime} from ${JSON.stringify(module)};
 assert.deepEqual(timeSearchPresets.map(([,label])=>label),['起動','15分','1時間','2時間','午前','今日','午後','解除']);
 for(const now of [new Date(2026,9,28,14),new Date(2027,0,1,0,5),new Date(2026,2,8,14),new Date(2026,10,1,14)]){
  const at=+now,start=new Date(now),boundary=new Date(now),next=new Date(now);
  start.setHours(0,0,0,0);boundary.setHours(12,30,0,0);next.setHours(24,0,0,0);
  const startedAt=at-123456;
  assert.deepEqual(timeSearchRange('start',startedAt,at),{since:startedAt,until:null});
  assert.deepEqual(timeSearchRange('clear',startedAt,at),{since:null,until:null});
  for(const [preset,minutes] of [['fifteen',15],['hour',60],['twoHours',120]]){
   const {since,until}=timeSearchRange(preset,startedAt,at);
   assert.equal(since,at-minutes*60000);assert.equal(until,null);
   assert.equal(inTimeRange(since-0.5,since,until),false);
   assert.equal(inTimeRange(since,since,until),true);
   assert.equal(inTimeRange(at,since,until),true);
  }
  for(const [preset,lo,hi] of [['morning',+start,+boundary],['today',+start,+next],['afternoon',+boundary,+next]]){
   const {since,until}=timeSearchRange(preset,startedAt,at);
   assert.equal(since,lo);assert.equal(until,hi);
   assert.equal(inTimeRange(lo-0.5,since,until),false);
   assert.equal(inTimeRange(lo,since,until),true);
   assert.equal(inTimeRange(hi-0.5,since,until),true);
   assert.equal(inTimeRange(hi,since,until),false);
   assert.equal(parseLocalDateTime(localDateTimeInput(until-1000),{end:true}),until);
  }
 }
 const before=+new Date(2026,11,31,23,59,59),after=before+1000;
 assert.equal(timeSearchRange('today',0,before).until,timeSearchRange('today',0,after).since);
 // 手入力は従来どおり開始を含み、終了秒全体を含む。
 const since=parseLocalDateTime('2026-10-28T12:30:00'),until=parseLocalDateTime('2026-10-28T12:30:00',{end:true});
 assert.equal(inTimeRange(since,since,until),true);assert.equal(inTimeRange(since+999.5,since,until),true);
 assert.equal(inTimeRange(until,since,until),false);
 `;
 execFileSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ:zone},encoding:'utf8'});
});
