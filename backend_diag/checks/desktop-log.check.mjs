// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,mkdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {recordDesktopFailure,recordProbeFailure} from '../起動/desktop-log.mjs';

const limit=65536;
function fixture(fn) {
  const root=mkdtempSync(path.join(os.tmpdir(),'diag-log-limit-'));
  try{return fn(path.join(root,'errors.log'),root);}
  finally{rmSync(root,{recursive:true,force:true});}
}
test('log accepts exactly 64 KiB and resets before the next complete record',()=>fixture(file=>{
  const bytes=Buffer.byteLength('2000-01-01T00:00:00.000Z Electron LOAD\n');
  writeFileSync(file,'x'.repeat(limit-bytes));
  assert.equal(recordDesktopFailure('LOAD',file),true);
  assert.equal(statSync(file).size,limit);
  assert.equal(recordDesktopFailure('EXIT',file),true);
  assert.match(readFileSync(file,'utf8'),/^\d{4}-[^\n]+ Electron EXIT\n$/);
  assert.ok(statSync(file).size<limit);
}));
test('oversized logs reset repeatedly and continue appending after each reset',()=>fixture(file=>{
  for(let cycle=0;cycle<4;cycle++) {
    writeFileSync(file,'x'.repeat(limit+cycle));
    assert.equal(recordDesktopFailure('LOAD',file),true);
    assert.equal(recordDesktopFailure('EXIT',file),true);
    const text=readFileSync(file,'utf8');
    assert.match(text,/^\d{4}-[^\n]+ Electron LOAD\n\d{4}-[^\n]+ Electron EXIT\n$/);
    assert.ok(Buffer.byteLength(text)<=limit);
  }
}));
test('sustained writes cross the limit more than once without losing the newest record',()=>fixture(file=>{
  let resets=0,previous=0;
  for(let index=0;index<4000;index++) {
    assert.equal(recordDesktopFailure('LOAD',file),true);
    const size=statSync(file).size;assert.ok(size<=limit);
    if(size<previous)resets++;
    previous=size;
  }
  assert.ok(resets>=2);
  assert.equal(recordDesktopFailure('EXIT',file),true);
  assert.match(readFileSync(file,'utf8'),/ Electron EXIT\n$/);
}));
test('fresh processes reopen capped logs and keep safe records after restart',()=>fixture(file=>{
  const moduleUrl=new URL('../起動/desktop-log.mjs',import.meta.url).href;
  const script=`import {recordDesktopFailure} from ${JSON.stringify(moduleUrl)};if(!recordDesktopFailure('LOAD',process.argv[1])||!recordDesktopFailure('EXIT',process.argv[1]))process.exit(1);`;
  for(let restart=0;restart<3;restart++) {
    writeFileSync(file,'x'.repeat(limit));
    const child=spawnSync(process.execPath,['--input-type=module','-e',script,file],{encoding:'utf8',windowsHide:true,timeout:5000});
    assert.ifError(child.error);assert.equal(child.status,0,child.stderr);
    assert.match(readFileSync(file,'utf8'),/^\d{4}-[^\n]+ Electron LOAD\n\d{4}-[^\n]+ Electron EXIT\n$/);
    assert.ok(statSync(file).size<=limit);
  }
}));
test('rotation preserves the fixed field allowlist and never records secrets',()=>fixture(file=>{
  writeFileSync(file,'x'.repeat(limit));
  assert.equal(recordDesktopFailure('SECRET #token=private',file),false);
  assert.equal(recordProbeFailure({reason:'SECRET'},file),false);
  assert.equal(statSync(file).size,limit);
  assert.equal(recordProbeFailure({id:'private/path',reason:'nonzero_exit',args:['/private/path','--version','SECRET'],exitCode:7,signal:'SECRET/path',errorCode:'SECRET/path',stderr:'SECRET',token:'SECRET',url:'https://private/'},file),true);
  const text=readFileSync(file,'utf8');
  assert.deepEqual(JSON.parse(text.split('[aidiy-diag:probe] ')[1]),{id:'unknown',reason:'nonzero_exit',args:['--version'],errorCode:null,exitCode:7,signal:null});
  assert.ok(!/SECRET|private|https:|token/.test(text));assert.ok(Buffer.byteLength(text)<=limit);
}));
test('directories and unavailable parent paths fail without throwing',()=>fixture((file,root)=>{
  mkdirSync(file);
  assert.equal(recordDesktopFailure('LOAD',file),false);
  assert.equal(recordDesktopFailure('LOAD',path.join(root,'missing','errors.log')),false);
  assert.ok(statSync(file).isDirectory());
}));
