// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
test('shared host perimeter reserves one pixel inside the existing dimensions',()=>{
 const rule=css.match(/\.development-app:not\(\.routes-window\):not\(\.all-displays\):not\(\.browser-header-only\)\{([^}]+)\}/)?.[1];
 assert.ok(rule);assert.match(rule,/border:1px solid var\(--aidiy-panel-border\)/);assert.match(rule,/box-sizing:border-box/);
 assert.doesNotMatch(rule,/padding|margin|width|height|app-region|z-index/);
 assert.match(css,/\.ide-heading\{top:1px;left:1px;right:1px\}/);
});
test('embedded panels retain their existing border widths and no child frame is added',()=>{
 assert.match(css,/\.development-app :is\(\.ai-popup,\.explorer-panel,\.explorer-routes,\.viewer-popup,\.viewer-pinned\)\{border-color:var\(--aidiy-panel-border\)\}/);
 assert.doesNotMatch(css,/\.ai-component::after/);
});
