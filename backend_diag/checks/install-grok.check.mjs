// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Grok Build / Antigravity の署名判定と OpenCode 2.x の npm shim 照合。実インストーラー・導入先は使わない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GROK_INSTALLER_URL,GROK_INSTALLER_SHA256,GROK_FILES,officialSigner,inspectGrok,executeGrok} from '../導入管理/grok.mjs';
import {officialIdentity} from '../導入管理/antigravity.mjs';
import {NPM_PACKAGES,npmCapability} from '../導入管理/導入管理.mjs';

const xai='OID.1.3.6.1.4.1.311.60.2.1.3=US, OID.2.5.4.15=Private Organization, CN=X.AI LLC, SERIALNUMBER=NV20243235882, O=X.AI LLC, L=Palo Alto, S=California, C=US';
const xcorp='CN=X Corp., O=X Corp., L=Bastrop, S=Texas, C=US';
const google='CN=Google LLC, O=Google LLC, L=Mountain View, S=California, C=US';

test('Grok は公式 URL・固定ハッシュ・~/.grok/bin の固定ファイルだけを扱う',()=>{
  assert.equal(GROK_INSTALLER_URL,'https://x.ai/cli/install.ps1');assert.match(GROK_INSTALLER_SHA256,/^[0-9a-f]{64}$/);
  assert.deepEqual(GROK_FILES,['grok.exe','agent.exe','grove.exe','grove-fsmonitor.exe','grove-credential.exe']);assert.equal(Object.isFrozen(GROK_FILES),true);
});

test('Grok の署名は有効な X.AI / X Corp. の署名者だけを公式と判定する',()=>{
  assert.equal(officialSigner({status:'Valid',subject:xai}),true);assert.equal(officialSigner({status:'Valid',subject:xcorp}),true);
  for(const info of [null,{status:'NotSigned',subject:xai},{status:'NotSigned',subject:xcorp},{status:'Valid',subject:'CN=X Corp. Fake, O=Other'},{status:'Valid',subject:'CN=X Corp, O=X Corp.'},{status:'Valid',subject:'CN=Example, O=X Corp.'},{status:'HashMismatch',subject:xai},{status:'Valid',subject:'CN=X.AI LLC Fake, O=Other'},{status:'Valid',subject:'CN=Example, O=X.AI LLC'},{status:'Valid',subject:google}])assert.equal(officialSigner(info),false);
});

test('Antigravity は製品情報が空でも有効な Google 署名なら公式、値がある場合は一致を求める',()=>{
  assert.equal(officialIdentity({status:'Valid',subject:google,company:'',product:'',original:''}),true);
  assert.equal(officialIdentity({status:'Valid',subject:google,company:'Google LLC',product:'Antigravity CLI',original:'agy.exe'}),true);
  for(const identity of [{status:'Valid',subject:google,company:'Other',product:'',original:''},{status:'Valid',subject:google,company:'Google LLC',product:'Other',original:'agy.exe'},{status:'NotSigned',subject:google,company:'',product:'',original:''},{status:'Valid',subject:xai,company:'',product:'',original:''}])assert.equal(officialIdentity(identity),false);
});

test('Grok は Windows 以外・未対応操作では実行しない',async()=>{
  const state=await inspectGrok({id:'grok'},{platform:'linux',env:{},run:()=>assert.fail('実行しない')});
  assert.match(state.item.再導入説明,/旧ファイルを退避.*更新・再導入/);assert.match(state.item.再導入説明,/失敗・中止時.*復元/);assert.doesNotMatch(state.item.再導入説明,/削除してから/);
  assert.deepEqual(state.item.操作,[]);assert.match(state.item.理由,/Windows のみ/);
  for(const [entry,action] of [[{id:'grok'},'更新'],[{id:'agy'},'導入']])await assert.rejects(()=>executeGrok(entry,action,{},{platform:'win32',run:()=>assert.fail('実行しない')}),{status:400});
});

test('OpenCode 2.x の @opencode/cli は "./bin/opencode.exe" 表記の Windows shim も所有扱いする',async t=>{
  assert.equal(NPM_PACKAGES.opencode,'@opencode/cli');
  const prefix=await mkdtemp(path.join(os.tmpdir(),'diag-opencode-'));t.after(()=>rm(prefix,{recursive:true,force:true}));
  const root=path.join(prefix,'node_modules'),directory=path.join(root,'@opencode','cli');
  await mkdir(path.join(directory,'bin'),{recursive:true});
  await writeFile(path.join(directory,'package.json'),JSON.stringify({name:'@opencode/cli',bin:{opencode:'./bin/opencode.exe'}}));
  await writeFile(path.join(directory,'bin','opencode.exe'),'MZ fixture');
  const shim=path.join(prefix,'opencode.cmd');
  await writeFile(shim,'@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe"   %*\r\n');
  const capability=await npmCapability({id:'opencode'},{prefix,root},{platform:'win32',resolve:async()=>shim});
  assert.deepEqual(capability.操作,['再導入','削除']);
});
