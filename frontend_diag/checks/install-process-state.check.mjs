import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstallProcessTracker,readWindowsInstallProcesses} from '../diag/導入管理/process_state.mjs';
const row=(pid,parentPid,created)=>({pid,parentPid,created});
test('親終了後の子孫、孫の終了まで監視する',async()=>{
 let rows=[row(10,1,10000),row(11,10,10001)];
 const tracker=createInstallProcessTracker(10,{started:10000,read:async()=>rows});
 assert.equal(await tracker.running(),true);
 rows=[row(11,10,10001),row(12,11,10002)];assert.equal(await tracker.running(),true);
 rows=[row(12,11,10002)];assert.equal(await tracker.running(),true);
 rows=[];assert.equal(await tracker.running(),false);
});
test('終了済みPIDが再利用された別プロセスとその子を追わない',async()=>{
 let rows=[row(10,1,10000),row(11,10,10001)];
 const tracker=createInstallProcessTracker(10,{started:10000,read:async()=>rows});await tracker.running();
 rows=[row(10,1,20000),row(11,10,20001),row(12,10,20002)];assert.equal(await tracker.running(),false);
});
test('照会失敗は不明、復旧後に再確認',async()=>{
 let failed=true;const tracker=createInstallProcessTracker(10,{started:10000,read:async()=>{if(failed)throw Error('denied');return [];}});
 assert.equal(await tracker.running(),null);failed=false;assert.equal(await tracker.running(),false);
});
test('最初の照会前に終了した親の残存子も監視',async()=>{
 const tracker=createInstallProcessTracker(10,{started:10000,read:async()=>[row(11,10,10001)]});assert.equal(await tracker.running(),true);
});
test('OS照会失敗・破損結果ではプロセス無しと判定しない',async()=>{
 for(const output of ['', '{}','[]','[{"pid":1,"parentPid":0}]'])await assert.rejects(readWindowsInstallProcesses({execFileFn:(_e,_a,_o,cb)=>cb(null,output)}));
 await assert.rejects(readWindowsInstallProcesses({execFileFn:(_e,_a,_o,cb)=>cb(Error('timeout'))}));
});
test('Windows プロセス一覧は固定PowerShellで取得し作成時刻とPIDを検証',async()=>{
 let options;
 const rows=await readWindowsInstallProcesses({env:{SystemRoot:'C:\\Windows'},execFileFn:(exe,args,opts,cb)=>{options={exe,args,opts};cb(null,JSON.stringify([{pid:1,parentPid:0,created:123,name:'node.exe',commandLine:'node diag'}]));}});
 assert.equal(rows[0].created,123);assert.match(options.exe,/powershell\.exe$/);assert.equal(options.opts.timeout,10000);assert.match(options.args.at(-1),/Get-CimInstance Win32_Process/);
});
