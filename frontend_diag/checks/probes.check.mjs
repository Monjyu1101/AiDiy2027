// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {probe,resolveProgram,scan,catalog,expandPath} from '../diag/診断/probes.mjs';

async function fixture(code,options={}) {
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-test-'));
 try {const script=path.join(directory,'fixture.cjs');await writeFile(script,code);return await probe({id:'fixture',version_args:[script]}, {resolve:async()=>process.execPath,timeout:5000,...options});}
 finally {await rm(directory,{recursive:true,force:true});}
}
test('missing and unsupported are separate',async()=>{
 assert.equal((await probe({id:'absent',commands:['no-such-aidiy-tool'],version_args:['--version']})).状態,'未検出');
 assert.equal((await probe({id:'other',platforms:['imaginary']})).状態,'未確認');
});
test('GUI/no version and Windows wrappers only discover',async()=>{
 for(const entry of [{id:'gui',version_args:null},{id:'wrapper',version_args:['--version']}]) {
 const result=await probe(entry,{resolve:async()=>'/fake/tool.cmd'});assert.equal(result.状態,'OK'); }
});
test('safe actual Node version',async()=>{
 const result=await probe({id:'node',commands:['node'],version_args:['--version']});assert.equal(result.状態,'OK');assert.equal(result.バージョン,process.versions.node);
});
test('default deadline accepts a version command taking longer than five seconds',async()=>{
 const result=await fixture('setTimeout(()=>console.log("1.2.3"),6000)',{timeout:undefined});
 assert.equal(result.状態,'OK');assert.equal(result.バージョン,'1.2.3');
});
test('failure, timeout and output caps',async()=>{
 assert.equal((await fixture('process.exit(9)')).状態,'NG');
 assert.match((await fixture('setInterval(()=>{},1000)',{timeout:250})).説明,/タイムアウト/);
 assert.match((await fixture('process.stdout.write("x".repeat(1000000))')).説明,/上限/);
});
test('parent exit with inherited pipe holder is bounded',{skip:process.platform==='win32'},async()=>{
 const start=Date.now(); const result=await fixture('require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:["ignore",process.stdout,process.stderr]});console.log("1.2.3");process.exit(0);',{timeout:1000});
 assert.ok(Date.now()-start<1500);assert.equal(result.状態,'OK');
});
test('raw output and sensitive inherited environment never returned',async()=>{
 process.env.AIDIY_TEST_SECRET='private-fixture';
 try {const result=await fixture('console.log(process.env.AIDIY_TEST_SECRET?"9.9.9":"1.2.3");console.log("private-output");');assert.equal(result.バージョン,'1.2.3');assert.ok(!JSON.stringify(result).includes('private'));}
 finally {delete process.env.AIDIY_TEST_SECRET;}
});
test('scan maximum concurrency is four and results keep catalog ordering',async()=>{
 let active=0,max=0;const result=await scan(Array.from({length:13},(_,id)=>({id})),async e=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return e.id;});assert.equal(max,4);assert.deepEqual(result,Array.from({length:13},(_,i)=>i));
});
test('standard paths expand supported environment syntax',()=>{
 assert.equal(expandPath('~/$ROOT/%ROOT%/${ROOT}',{ROOT:'value'},'/home/user'),'/home/user/value/value/value');
 assert.equal(expandPath('${UNKNOWN}/bin',{}),null);
 assert.equal(expandPath('${PROGRAMFILES(X86)}/Chrome',{'PROGRAMFILES(X86)':'C:/Program Files (x86)'}),'C:/Program Files (x86)/Chrome');
});
test('catalog identifiers unique; fixed version args and source evidence required',async()=>{
 const entries=await catalog();assert.ok(entries.length>=19);assert.equal(entries[0].id,'python');assert.equal(entries[1].id,'uv');assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
 for(const entry of entries) {assert.ok(entry.sources.length);assert.ok(entry.commands.length);assert.ok(entry.version_args===null || (Array.isArray(entry.version_args)&&entry.version_args.every(v=>typeof v==='string')));}
});
test('Windows disk converter is not ImageMagick',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-convert-'));const {mkdir}=await import('node:fs/promises');
 try {const system=path.join(directory,'Windows','System32');await mkdir(system,{recursive:true});await writeFile(path.join(system,'convert.exe'),'fixture');assert.equal(await resolveProgram({id:'convert',commands:['convert']},{platform:'win32',env:{PATH:system}}),null);}
 finally {await rm(directory,{recursive:true,force:true});}
});
test('coverage is pinned to complete selected-source manifest and exact catalog bytes',async()=>{
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const coverage=JSON.parse(await readFile(new URL('../diag/診断/coverage.json',import.meta.url),'utf8'));
 // Windows の改行変換（CRLF）でチェックアウトされても、記録時の LF の内容と比較する。
 const lf=bytes=>Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'),'utf8');
 const manifestBytes=lf(await readFile(new URL('../reference/source-manifest.json',import.meta.url)));
 const catalogBytes=lf(await readFile(new URL('../diag/診断/catalog.json',import.meta.url)));
 assert.equal(coverage.complete,true);assert.equal(coverage.sourceTargetFiles,3333);assert.equal(coverage.scannedSourceFiles,3333);
 assert.equal(JSON.parse(manifestBytes).length,3333);assert.equal(createHash('sha256').update(manifestBytes).digest('hex'),coverage.sourceTargetManifestSha256);
 assert.equal(JSON.parse(catalogBytes).length,19);assert.equal(createHash('sha256').update(catalogBytes).digest('hex'),coverage.catalogSha256);
 for (const entry of JSON.parse(catalogBytes)) assert.ok(entry.evidence?.length && entry.evidence.every(e=>e.path && Number.isInteger(e.line) && e.line>0));
});

test('menu classification keeps base minimal and all source evidence',async()=>{
 const entries=await catalog();
 assert.deepEqual(entries.filter(e=>e.menuGroup==='ベース').map(e=>e.id),['python','uv','node','npm','npx','electron']);
 assert.ok(entries.every(e=>!['optional','reference'].includes(e.usageTier)));
 assert.ok(entries.every(e=>!['git','pip','bash','docker','curl','winget'].includes(e.id)));
 for(const e of entries) {assert.ok(['ベース','CLI群','その他拡張'].includes(e.menuGroup));assert.ok(e.usageTier);}
 assert.equal(entries.find(e=>e.id==='ffmpeg').usageTier,'integration');
 assert.equal(entries.find(e=>e.id==='chrome').name,'Chrome');
 assert.equal(entries.find(e=>e.id==='code').name,'VS Code');
 assert.equal(entries.find(e=>e.id==='codex').menuGroup,'CLI群');
 assert.deepEqual(entries.filter(e=>e.menuGroup==='CLI群').map(e=>e.id),['claude','codex','copilot','agy','grok','opencode','ollama']);
 assert.ok(entries.every(e=>!e.id.startsWith('aidiy_') && !['hermes','afplay','gst-launch','pwsh','edge','brave'].includes(e.id)));
 for(const entry of entries) assert.ok(entry.sources.every(s=>!s.startsWith('command_hermes/')) && entry.evidence.every(e=>!e.path.startsWith('command_hermes/')));
 assert.equal(entries.filter(e=>e.usageTier==='integration').length,6);
});

test('version warning, NG command failure and ERR execution failures are distinct',async()=>{
 const tooOld=await probe({id:'fixture',version_args:['--version'],minimumVersion:'999.0'}, {resolve:async()=>process.execPath});
 assert.equal(tooOld.状態,'注意');assert.equal(tooOld.バージョン,process.versions.node);assert.equal(tooOld.パス,process.execPath);assert.match(tooOld.説明,/要件/);
 const broken=await probe({id:'fixture',version_args:['--version']},{resolve:async()=>'/no-such-diag-executable'});assert.equal(broken.状態,'ERR');
 assert.equal((await fixture('setInterval(()=>{},1000)')).状態,'ERR');
 assert.equal((await fixture('process.stdout.write("x".repeat(1000000))')).状態,'ERR');
 const excluded=await probe({id:'fixture',platforms:['imaginary']});assert.equal(excluded.状態,'未確認');assert.match(excluded.説明,/対象外/);
});
