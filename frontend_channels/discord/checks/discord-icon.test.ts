// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
test('Discord は公式ロゴを保持し、黒い名称帯だけ白枠・白文字にする',async()=>{
 for(const id of ['discord']){
  const svg=await readFile(new URL(`panel/AiDiy_${id}.svg`,root),'utf8');
  assert.match(svg,/width="512" height="512" viewBox="0 0 512 512"/);assert.match(svg,/id="caption-band" x="0" y="384" width="512" height="128" fill="#000000"/);assert.ok(svg.includes(`aria-label="Discord" fill="#FFFFFF"`));assert.match(svg,/id="caption-frame" x="4" y="388" width="504" height="120" fill="none" stroke="#FFFFFF" stroke-width="8"/);assert.doesNotMatch(svg,/<script|<filter|id="white-frame"|id="caption-divider"/);assert.equal([...svg.matchAll(/<[^>]+stroke=/g)].length,1);
  const image=svg.match(/xlink:href="data:image\/svg\+xml;base64,([^"]+)"/)!;assert.ok(image);assert.equal(createHash('sha256').update(Buffer.from(image[1],'base64')).digest('hex'),createHash('sha256').update(await readFile(new URL('panel/upstream/discord-symbol.svg',root))).digest('hex'));
  const png=await readFile(new URL(`panel/AiDiy_${id}.png`,root));assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512);
 }
 await assert.rejects(readFile(new URL('discord/panel/AiDiy_discord.svg',root)),{code:'ENOENT'});
});
