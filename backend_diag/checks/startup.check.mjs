// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {verify,manifest} from '../ui/verify.mjs';
import {startupMessage} from '../diag_main.mjs';
async function fixture(){
 const workspace=await mkdtemp(path.join(os.tmpdir(),'diag-startup-'));
 const root=path.join(workspace,'backend_diag');
 await cp(new URL('../',import.meta.url),root,{recursive:true,filter:source=>!/(?:^|[/\\])(?:node_modules|tests|__pycache__)(?:[/\\]|$)/.test(source)});
 await cp(new URL('../../scripts/opencode-npm.mjs',import.meta.url),path.join(workspace,'scripts/opencode-npm.mjs'));
 return root;
}
async function cleanup(root){
 const workspace=path.resolve(root,'..');
 if(path.dirname(workspace)!==path.resolve(os.tmpdir()) || !path.basename(workspace).startsWith('diag-startup-'))throw Error('invalid fixture workspace');
 await rm(workspace,{recursive:true,force:true});
}
async function convert(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 const name=path.join(dir,entry.name);if(entry.isDirectory())await convert(name);
 else if(/\.(?:vue|ts|[cm]?js|css|html|json|md|txt|svg|py)$/.test(name))await writeFile(name,(await readFile(name,'utf8')).replace(/\r?\n/g,'\r\n'));
}}
test('LF and Windows CRLF checkouts verify without rebuilding; actual edits still fail',async()=>{
 const root=await fixture(),ui=path.join(root,'ui');
 try {
  assert.equal(await verify(ui),true);const lf=await manifest(ui);
  assert.ok(Object.hasOwn(lf, 'src/components/導入状況/導入状況パネル.vue'));
  assert.deepEqual(Object.keys(lf), Object.keys(lf).sort());
  assert.ok(!Object.keys(lf).some(name => name.includes('/checks/')));
  await convert(path.dirname(root));assert.equal(await verify(ui),true);assert.deepEqual(await manifest(ui),lf);
  const manifestFile=path.join(root,'static/build-manifest.json');
  await writeFile(manifestFile,JSON.stringify(Object.fromEntries(Object.entries(lf).reverse())));assert.equal(await verify(ui),true);
  for(const relative of ['ui/src/components/共通表示/シアンバー.css','ui/src/App.vue','ui/src/components/導入状況/導入状況パネル.vue','ui/src/components/導入状況/導入状況状態.mjs','ui/src/components/導入状況/導入状況表示.mjs','ui/src/components/導入状況/導入状況.css','runtime/model_catalog.ts','runtime/model_probe.mjs','ui/tsconfig.runtime.json','ui/build.mjs','static/app.js','static/style.css','static/index.html','ui/src/components/アプリ起動/CLIアイコン/copilot.svg','ui/src/components/アプリ起動/CLIアイコン/LICENSE_ICONS.md','ui/src/components/アプリ起動/CLIアイコン/upstream/antigravity-logo-mark.svg','static/LICENSE_ICONS.md','static/LICENSE-Octicons.txt']){
   const file=path.join(root,relative),before=await readFile(file);await writeFile(file,Buffer.concat([before,Buffer.from('\nchanged')]));assert.equal(await verify(ui),false,relative);await writeFile(file,before);
  }
  await rm(path.join(root,'static/app.js'));assert.equal(await verify(ui),false);
 }finally {await cleanup(root);}
});
test('startup failure messages categorize causes and never echo raw errors',()=>{
 for(const code of ['UI','ELECTRON','DESKTOP','CATALOG','ARGUMENTS']){const msg=startupMessage({diagCode:code,message:'PRIVATE KEY',stack:'SECRET'});assert.ok(!msg.includes('PRIVATE'));assert.ok(!msg.includes('SECRET'));assert.notEqual(msg,startupMessage({}));}
 assert.match(startupMessage({code:'EADDRINUSE'}),/--port 0/);
 assert.ok(!startupMessage({message:'SECRET token=abc'}).includes('SECRET'));
 assert.ok(!startupMessage({diagCode:'UI'}).includes('_setup.py'));
});
for(const crlf of [false,true])test(`real Node browser startup and all static assets, ${crlf?'CRLF':'LF'} checkout`,{timeout:15000},async()=>{
 const root=await fixture();let child;
 try {
  // 外部通信のみを差し替え。実際の引数処理・検証・HTTP listen・静的配信を実行する。
  await writeFile(path.join(root,'モデル情報/public_models.mjs'),`export function createPublicModelCache(){return {refresh:async()=>({}),snapshot:()=>({}),input:()=>({})};}`);
  if(crlf)await convert(path.dirname(root));
  child=spawn(process.execPath,[path.join(root,'diag_main.mjs'),'--browser','--no-open','--port','0'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  const exited=once(child,'exit');let output='',errors='';child.stderr.on('data',chunk=>errors+=chunk);
  const address=await new Promise((resolve,reject)=>{
   child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\/#token=/);if(match)resolve(match[0].split('#')[0]);});
   child.once('exit',()=>reject(new Error('Startup ended: '+errors)));
  });
  for(const asset of ['','app.js','style.css','AiDiy_diag.png']){const response=await fetch(address+asset);assert.equal(response.status,200);assert.ok((await response.text()).length>0);}
  assert.equal((await fetch(address+'api/'+encodeURIComponent('キー設定'))).status,401);
  // Windows の kill(SIGTERM) は正常終了処理を通さないため、既存の停止通知を使う。
  if(process.platform==='win32')await writeFile(path.join(root,'.stop-request'),randomBytes(16).toString('hex'));
  else child.kill('SIGTERM');
  await exited;assert.equal(child.exitCode,0);assert.equal(errors,'');
 }finally{if(child?.exitCode===null)child.kill('SIGKILL');await cleanup(root);}
});

test('CLI errors report actionable categories without echoing arguments or file contents',{timeout:15000},async()=>{
 const root=await fixture();
 const run=async args=>{
  const child=spawn(process.execPath,[path.join(root,'diag_main.mjs'),...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});let stderr='',stdout='';
  child.stderr.on('data',value=>stderr+=value);child.stdout.on('data',value=>stdout+=value);const [code]=await once(child,'exit');assert.equal(code,1);assert.equal(stdout,'');assert.ok(!stderr.includes('PRIVATE'));return stderr;
 };
 try {
  assert.match(await run(['--PRIVATE']),/起動引数/);
  const app=path.join(root,'static/app.js'),before=await readFile(app);await writeFile(app,'PRIVATE');
  assert.match(await run(['--no-open']),/Vue UI/);await writeFile(app,before);
  await writeFile(path.join(root,'診断/catalog.json'),'PRIVATE');assert.match(await run(['--no-open']),/catalog.json/);
 }finally{await cleanup(root);}
});
