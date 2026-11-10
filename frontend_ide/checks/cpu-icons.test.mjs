// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('CPU uses a silver title with dark path glyphs and matching local PNG',()=>{
 const svg=readFileSync(new URL('../aidiy_cpu/AiDiy_cpu.svg',import.meta.url),'utf8');
 assert.match(svg,/<rect[^>]*fill="#CBD5E1"/);
 assert.match(svg,/aria-label="CPU" fill="#111827"/);
 assert.doesNotMatch(svg,/<text/);
 assert.deepEqual(readFileSync(new URL('../aidiy_cpu/AiDiy_cpu.png',import.meta.url)),readFileSync(new URL('../public/AiDiy_cpu.png',import.meta.url)));
});
