// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import layout from '../デスクトップ/window-layout.cjs';
const text=path=>readFileSync(new URL(path,import.meta.url),'utf8');
for(const kind of ['task','team']){
 test(`${kind}: independent launcher, desktop identity and setup registration`,()=>{
  assert.match(text(`../aidiy_${kind}/launch.mjs`),new RegExp(`launch\\('${kind}'\\)`));
  assert.match(text(`../aidiy_${kind}.cmd`),new RegExp(`aidiy_${kind}\\\\launch.mjs`));
  assert.match(text('../launch.mjs'),/\['code','live','ide','console','task','team','browser','navi','cpu'\]\.includes\(kind\)/);
  assert.match(text('../desktop.cjs'),/`aidiy_\$\{kind\}`/);
  assert.ok(text('../desktop.cjs').includes(`kind==='${kind}'?'${kind[0].toUpperCase()+kind.slice(1)}'`));
  assert.ok(text('../_setup.py').includes(`frontend_ide/aidiy_${kind}`));
  assert.ok(text('../../_setup.py').includes(`frontend_ide/aidiy_${kind}`));
 });
 test(`${kind}: work area and minimum dimensions stay bounded`,()=>{
  for(const area of [{x:0,y:0,width:1920,height:1040},{x:-600,y:30,width:600,height:400},{x:0,y:-300,width:320,height:240}]){
   const b=layout.windowBounds(kind,area),m=layout.windowMinimumSize(kind,b);
   assert.ok(b.x>=area.x&&b.y>=area.y&&b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);
   assert.ok(m.minWidth<=b.width&&m.minHeight<=b.height);
  }
 });
}

for(const kind of ['task','team']){
 test(`${kind}: help and unsupported model/connection flags are explicit`,()=>{
  const entry=fileURLToPath(new URL(`../aidiy_${kind}/launch.mjs`,import.meta.url));
  const help=spawnSync(process.execPath,[entry,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0);assert.ok(help.stdout.startsWith(`aidiy_${kind} `));
  assert.doesNotMatch(help.stdout,/--provider|--model|--offline|--connect/);
  for(const flag of [['--provider','openai'],['--model','auto'],['--offline'],['--connect']]){
   const result=spawnSync(process.execPath,[entry,...flag],{encoding:'utf8'});
   assert.equal(result.status,1);assert.match(result.stderr,/画面内で指定/);
  }
 });
}
