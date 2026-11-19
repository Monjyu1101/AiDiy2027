// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('CPU uses a generic line/area chart, silver title and matching local PNG',()=>{
 const svg=readFileSync(new URL('../aidiy_cpu/AiDiy_cpu.svg',import.meta.url),'utf8');
 assert.match(svg,/<path fill="#CBD5E1" d="M0 384h512v128H0z"/);
 assert.match(svg,/<linearGradient id="area" x1="0%" y1="0%" x2="0%" y2="100%"><stop stop-color="#fff7ba"\/><stop offset="1" stop-color="#ffe28c"\/><\/linearGradient>/, 'mountain uses the MEMO paper yellow palette from top to bottom');
 assert.match(svg,/<svg[^>]*width="512" height="512" viewBox="0 0 512 512"/);
 assert.match(svg,/<path fill="url\(#area\)" d="M88 275l59-47 52 25 60-76 56 41 62-76 59 60v111H88z"/);
 assert.match(svg,/<path d="M88 231l59-58 52 33 60-89 56 45 62-76 59 59" fill="none" stroke="#edfbff" stroke-width="18"/);
 assert.doesNotMatch(svg,/<image\b|(?:xlink:)?href=|data:image/, 'generic chart stays vector-only and self-contained');
 assert.match(svg,/aria-label="CPU" fill="#111827"/);
 assert.doesNotMatch(svg,/<text/);
 assert.deepEqual(readFileSync(new URL('../aidiy_cpu/AiDiy_cpu.png',import.meta.url)),readFileSync(new URL('../public/AiDiy_cpu.png',import.meta.url)));
});
