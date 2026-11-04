// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileRecency,createUpdateMarks,updateFlash} from '../src/components/ファイル閲覧/更新の目印.js';
const now=+new Date(2026,9,16,12), day=+new Date(2026,9,16);
const files=[{path:'older',mtime:day-86400001,size:1},{path:'yesterday',mtime:day-1,size:1},{path:'today',mtime:day+1,size:1},{path:'latest-a',mtime:now,size:1},{path:'latest-b',mtime:now,size:1}];
test('表示対象の当日更新と同率最終更新を区別し、前日と無効日時は通常表示',()=>{
 const value=fileRecency(files,now);
 assert.deepEqual({...value.levels},{today:1,'latest-a':2,'latest-b':2});
 assert.deepEqual({...fileRecency(files.slice(0,3),now).levels},{today:2});
 assert.deepEqual({...fileRecency(files.slice(0,2),now).levels},{});
 assert.equal(fileRecency([{path:'bad',mtime:NaN},{path:'future',mtime:day+86400000}],now).latest,null);
});
test('初回/無差分/フォルダ・フィルター切替は発光せず、追加と実変更だけ短く発光する',()=>{
 const tracker=createUpdateMarks();assert.deepEqual(tracker.update(files,'root|on',now).flashes,{});
 assert.deepEqual(tracker.update(files,'root|on',now+1).flashes,{});
 const changed=files.map(file=>file.path==='today'?{...file,size:2}:file).concat({path:'added',mtime:now,size:2});
 let marks=tracker.update(changed,'root|on',now+2);assert.deepEqual(Object.keys(marks.flashes),['today','added']);
 const id=marks.flashes.today.id;assert.equal(tracker.update(changed,'root|on',now+3).flashes.today.id,id);
 assert.equal(updateFlash(marks.flashes.today,now+602),1);assert.equal(updateFlash(marks.flashes.today,now+1202),0);
 assert.deepEqual(Object.keys(tracker.update(changed.filter(file=>file.path!=='added'),'root|on',now+4).flashes),['today']);
 assert.deepEqual(tracker.snapshot(now+1202).flashes,{});
 assert.deepEqual(tracker.update(files,'root|off',now+1300).flashes,{});
 assert.deepEqual(tracker.update(changed,'root|off',now+1400,false).flashes,{});
 assert.deepEqual(tracker.update(files,'child|off',now+1500).flashes,{});
 tracker.clear();assert.deepEqual(tracker.snapshot(now).flashes,{});
});
for(const zone of ['UTC','Asia/Tokyo','America/New_York'])test(`ローカル日付 ${zone}: 日跨ぎ・夏時間・年跨ぎ`,()=>{
 const module=new URL('../src/components/ファイル閲覧/更新の目印.js',import.meta.url).href;
 const code=`import assert from 'node:assert/strict';import {fileRecency} from ${JSON.stringify(module)};
 for(const now of [new Date(2026,0,1,0,1),new Date(2026,2,9,0,1),new Date(2026,10,2,0,1)]){
 const prev=new Date(now);prev.setDate(prev.getDate()-1);prev.setHours(0,0,1,0);
 assert.deepEqual({...fileRecency([{path:'p',mtime:+prev}],+now).levels},{});
 assert.equal(fileRecency([{path:'p',mtime:+prev}],+now).latest,null);}`;
 execFileSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ:zone}});
});
