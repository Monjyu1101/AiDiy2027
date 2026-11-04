/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
test('Slack は公式ロゴを保持し、黒い名称帯だけ白枠・白文字にする（Discord と同じ図案）', async () => {
  const svg = await readFile(new URL('panel/AiDiy_slack.svg', root), 'utf8');
  assert.match(svg, /width="512" height="512" viewBox="0 0 512 512"/);
  assert.match(svg, /id="caption-band" x="0" y="384" width="512" height="128" fill="#000000"/);
  assert.ok(svg.includes('aria-label="Slack" fill="#FFFFFF"'));
  assert.doesNotMatch(svg, /<script|<filter/);
  const image = svg.match(/xlink:href="data:image\/svg\+xml;base64,([^"]+)"/)!; assert.ok(image);
  const original = await readFile(new URL('panel/upstream/slack-symbol.svg', root));
  assert.equal(createHash('sha256').update(Buffer.from(image[1], 'base64')).digest('hex'), createHash('sha256').update(original).digest('hex'));
  const png = await readFile(new URL('panel/AiDiy_slack.png', root)); assert.equal(png.readUInt32BE(16), 512); assert.equal(png.readUInt32BE(20), 512);
});
