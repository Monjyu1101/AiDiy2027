// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { startDevelopment } from '../server.mjs';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
for(const kind of ['task','team'])test(`${kind}: own config/assets, no unrelated viewer API, origin protected`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'aidiy-taskteam-server-'));
 const app=await startDevelopment(root,{kind});
 try{
  const config=await fetch(new URL('/development/config',app.url)).then(r=>r.json());assert.equal(config.kind,kind);assert.equal(config.taskTeamBase,'/taskteam-api');
  const html=await fetch(app.url).then(r=>r.text());assert.match(html,/taskteam.js/);assert.doesNotMatch(html,/\/development\/app.js/);
  for(const path of ['/development/taskteam.js','/development/taskteam.css'])assert.equal((await fetch(new URL(path,app.url))).status,200);
  for(const path of ['/api/tree','/api/panels','/api/explorer','/api/state'])assert.equal((await fetch(new URL(path,app.url))).status,404);
  assert.equal((await fetch(new URL('/taskteam-api/status',app.url),{headers:{Origin:'https://evil.invalid'}})).status,403);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
