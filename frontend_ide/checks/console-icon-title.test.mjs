// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
test('Console title keeps the standard band and white path glyphs on an orange band', async () => {
  const svg = await readFile(new URL('aidiy_console/AiDiy_console.svg', root), 'utf8');
  assert.match(svg, /width="512"/); assert.match(svg, /height="512"/);
  assert.match(svg, /viewBox="0 0 512 512"/);
  assert.match(svg, /<title[^>]*>AiDiy CONSOLE<\/title>/);
  assert.match(svg, /fill="#C15308"/i);
  assert.match(svg, /aria-label="CONSOLE"/);
  assert.match(svg, /fill:#FFFFFF/i);
  assert.doesNotMatch(svg, /<text\b/);
});
test('Console title PNG is identical in its owner and local IDE distribution', async () => {
  const png = await readFile(new URL('public/AiDiy_console.png', root));
  assert.equal(png.readUInt32BE(16), 512); assert.equal(png.readUInt32BE(20), 512);
  for (const relative of ['aidiy_console/AiDiy_console.png']) {
    assert.deepEqual(await readFile(new URL(relative, root)), png);
  }
});
