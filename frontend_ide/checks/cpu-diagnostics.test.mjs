// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {localMetricsUrl,selectSample,collectCpuDiagnostics,windowsCpuReferenceCommand} from '../scripts/check-cpu-metrics.mjs';
test('CPU診断は指定されたloopbackのmetricsだけを読み、外部URLや認証情報を拒否',()=>{
 assert.equal(localMetricsUrl(undefined),null);assert.equal(localMetricsUrl('http://127.0.0.1:12345/'),'http://127.0.0.1:12345/api/system-metrics');
 for(const url of ['https://127.0.0.1:1/','http://example.com:1/','http://127.0.0.1/','http://user:pass@127.0.0.1:1/','http://127.0.0.1:1/other','http://127.0.0.1:1/?token=secret'])assert.throws(()=>localMetricsUrl(url));
});
test('CPU診断は必要な計測項目だけ残し、古い応答の診断項目欠損を識別',()=>{
 const data=selectSample({timestamp:1,cpu:12,other:'not needed',cpuDetails:{osTimes:12,secret:'omit'}});
 assert.equal(data.cpuSource,'missing-in-response');assert.equal(data.details.osTimes,12);assert.equal(data.other,undefined);assert.equal(data.details.secret,undefined);assert.deepEqual(selectSample(null),{error:'invalid-metrics-response'});
});
const system={release:()=> 'test-build',cpus:()=>[{model:'test-cpu'}]};
test('CPU診断は12回の現行値と継続参照値を比較し、計測を片付ける',async()=>{
 let now=0,closed=false,calls=0;
 const report=await collectCpuDiagnostics({platform:'win32',system,now:()=>now,sleep:async ms=>{now+=ms;},makeMetrics:()=>({sample:async()=>({timestamp:now,cpu:5,cpuSource:'os-times',cpuDetails:{osTimes:5}}),close:()=>closed=true}),run:async(file,args,options)=>{calls++;assert.equal(file,'powershell.exe');assert.equal(options.shell,false);assert.equal(options.timeout,25000);assert.match(args.at(-1),/Get-Counter/);return{stdout:JSON.stringify({samples:[{time:50,utility:85}]})};}});
 assert.equal(calls,1);assert.equal(report.samples.length,12);assert.equal(report.reference.samples[0].utility,85);assert.equal(report.mode,'new-local-sampler');assert.equal(closed,true);
});
test('既存サーバー指定時は別サンプラーを起動せず、リダイレクトを許さない',async()=>{
 let calls=0,now=0;
 const report=await collectCpuDiagnostics({url:'http://127.0.0.1:12345/',platform:'linux',system,now:()=>now,sleep:async ms=>{now+=ms;},makeMetrics:()=>{throw Error('must not start');},fetcher:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:12345/api/system-metrics');assert.equal(options.redirect,'error');return{ok:true,json:async()=>({timestamp:now,cpu:42})};}});
 assert.equal(calls,12);assert.equal(report.mode,'existing-local-server');assert.equal(report.samples[0].cpuSource,'missing-in-response');
});
test('参照コマンド失敗でも現行値の結果を残し、例外の秘密情報を出さない',async()=>{
 const report=await collectCpuDiagnostics({platform:'win32',system,sleep:async()=>{},makeMetrics:()=>({sample:async()=>{throw Error('private');},close(){}}),run:async()=>{throw Object.assign(Error('private path'),{code:'ENOENT'});}});
 assert.equal(report.samples.length,12);assert.deepEqual(report.reference,{error:'reference-command-failed',code:'ENOENT',killed:false,stderr:''});assert.doesNotMatch(JSON.stringify(report),/private/);
});
test('PDH診断は1つのクエリーで2指標を連続採取し、初回を除き、WMI更新器を使う',()=>{
 assert.match(windowsCpuReferenceCommand,/-SampleInterval 1 -MaxSamples 9/);assert.match(windowsCpuReferenceCommand,/Select-Object -Skip 1/);
 assert.match(windowsCpuReferenceCommand,/WbemScripting.SWbemRefresher/);assert.match(windowsCpuReferenceCommand,/\$refresher.Refresh\(\)/);
 assert.match(windowsCpuReferenceCommand,/CurrentLanguage/);assert.match(windowsCpuReferenceCommand,/\$c.Status -ne 0 -and \$c.Status -ne 1/);
 assert.doesNotMatch(windowsCpuReferenceCommand,/Set-ItemProperty|Set-ExecutionPolicy|Start-Process|Invoke-WebRequest/);
});
