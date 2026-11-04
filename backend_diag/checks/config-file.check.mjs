// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import path from 'node:path';
test('fixed-path config reads bound real files and reject nonregular files without blocking',{timeout:10000},async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'diag-config-files-'));
 try {
  const runtime=path.join(root,'backend_diag/runtime');await mkdir(runtime,{recursive:true});
  const module=path.join(runtime,'model_probe.mjs');await copyFile(new URL('../runtime/model_probe.mjs',import.meta.url),module);
  const {readConfig,CONFIG_LIMIT}=await import(pathToFileURL(module).href);
  assert.equal((await readConfig())[0],'未作成');
  await mkdir(path.join(root,'_config'));const config=path.join(root,'_config/AiDiy_key.json');
  await writeFile(config,JSON.stringify({gemini_key_id:'synthetic-only'}));assert.deepEqual(await readConfig(),['読込済み',{gemini_key_id:'synthetic-only'}]);
  await writeFile(config,' '.repeat(CONFIG_LIMIT+1));assert.deepEqual(await readConfig(),['読込不可',{}]);
  await rm(config);await mkdir(config);assert.deepEqual(await readConfig(),['読込不可',{}]);await rm(config,{recursive:true});
  if(process.platform!=='win32'){
   await symlink('/dev/null',config);assert.deepEqual(await readConfig(),['読込不可',{}]);await rm(config);
   await promisify(execFile)('mkfifo',[config]);assert.deepEqual(await readConfig(),['読込不可',{}]);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
