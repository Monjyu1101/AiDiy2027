// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
test('Task and Team use the common AiDiy artwork and fixed colored title bands',async()=>{
 const code=await readFile(new URL('aidiy_code/AiDiy_code.svg',root),'utf8');
 const image=code.match(/<image\b[^>]+\/>/)[0];
 for(const [id,color,ink] of [['task','#0F5C3A','#7DD3FC'],['team','#7DD3FC','#0F5C3A']]){
  const svg=await readFile(new URL(`aidiy_${id}/AiDiy_${id}.svg`,root),'utf8');
  assert.equal(svg.match(/<image\b[^>]+\/>/)[0],image);
  assert.match(svg,/width="512" height="512" viewBox="0 0 512 512"/);
  assert.ok(svg.includes(`<rect x="0" y="384" width="512" height="128" fill="${color}"/>`));
  assert.ok(svg.includes(`aria-label="${id.toUpperCase()}"`));
  assert.ok(svg.includes('fill:'+ink+';stroke:'+ink));assert.doesNotMatch(svg,/<text\b/);
  const png=await readFile(new URL(`aidiy_${id}/AiDiy_${id}.png`,root));assert.deepEqual(png,await readFile(new URL(`public/AiDiy_${id}.png`,root)));assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512);
 }
});
test('standalone Task and Team select their own public icon',async()=>{
 const desktop=await readFile(new URL('desktop.cjs',root),'utf8');
 assert.match(desktop,/\['cpu','navi','code','live','console','task','team'\]\.includes\(kind\)/);
});
