// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import registry from '../デスクトップ/Diagミニ位置.cjs';
test('Diag mini publishes real resize and move, clears normal/minimized/closed, rejects dead or invalid records',()=>{
 const folder=mkdtempSync(join(tmpdir(),'cpu-diag-')),file=join(folder,'mini-bounds.json');
 const window=new EventEmitter();let active=true,minimized=false,bounds={x:-368,y:800,width:360,height:240};
 Object.assign(window,{isDestroyed:()=>false,isMinimized:()=>minimized,isVisible:()=>true,getBounds:()=>bounds});
 const track=registry.trackDiagMiniBounds(window,()=>active,{file});
 try{
  assert.deepEqual(registry.readDiagMiniBounds(file),bounds);
  bounds={...bounds,y:700,height:340};window.emit('resize');assert.deepEqual(registry.readDiagMiniBounds(file),bounds);
  bounds={...bounds,x:100};window.emit('move');assert.deepEqual(registry.readDiagMiniBounds(file),bounds);
  minimized=true;window.emit('minimize');assert.equal(registry.readDiagMiniBounds(file),null);
  minimized=false;window.emit('restore');assert.deepEqual(registry.readDiagMiniBounds(file),bounds);
  active=false;window.emit('resize');assert.equal(existsSync(file),false);
  active=true;track.save();assert.equal(registry.readDiagMiniBounds(file,()=>false),null);
  for(const data of ['{',JSON.stringify({pid:process.pid,bounds:{...bounds,height:999}}),JSON.stringify({pid:-1,bounds})]){writeFileSync(file,data);assert.equal(registry.readDiagMiniBounds(file),null);}
  track.save();window.emit('closed');assert.equal(existsSync(file),false);assert.equal(window.listenerCount('move'),0);
 }finally{track.dispose();rmSync(folder,{recursive:true,force:true});}
});
