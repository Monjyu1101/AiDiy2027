// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse,compileStyle} from '@vue/compiler-sfc';

test('Browser全画面ヘッダー: 薄いシアンの四角いすりガラス・青系文字で通常表示を保つ',()=>{
 const {descriptor}=parse(readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'));
 const style=compileStyle({source:descriptor.styles[0].content,id:'data-v-browser-header',scoped:true});
 assert.deepEqual(style.errors,[]);
 const rules=style.rawResult.root.nodes.filter(node=>node.type==='rule');
 const values=selector=>Object.fromEntries(rules.find(rule=>rule.selector.replaceAll('[data-v-browser-header]','').startsWith(selector)).nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));
 const header=values('.browser-header-only .browser-chrome');
 assert.equal(header['border-radius'],'0');
 assert.equal(header.background,'rgba(64,210,245,.10)');
 assert.equal(header.opacity,undefined,'内容全体のopacityは下げない');
 assert.equal(header.color,'#4b8eaa');
 assert.ok(header['text-shadow'],'透過面でも文字を見分けられる薄い明部を添える');
 assert.equal(header['backdrop-filter'],undefined,'中央はぼかさず裏のWeb本文を透かす');
 assert.equal(header['-webkit-backdrop-filter'],undefined);
 assert.equal(header.border,'1px solid rgba(35,147,179,.42)');
 assert.equal(header['box-shadow'],undefined);
 const rim=values('.browser-header-only .browser-chrome::after');assert.equal(rim['pointer-events'],'none','ガラスの縁は操作を遮らない');assert.equal(rim.inset,'0','4辺をパネル内に収める');
 const panel=values('.development-app.browser-header-only');
 assert.equal(panel.width,'100%','800 DIPのnative窓へrendererを追従させる');
 assert.equal(panel['max-width'],'none','renderer側で別の固定幅を重ねない');
 const controls=rules.find(rule=>rule.selector.includes('.browser-header-only')&&rule.selector.includes('.reload-control.refresh-button')&&!rule.selector.includes(':hover'));
 assert.equal(controls.nodes.find(node=>node.prop==='border-radius').value,'0');
 assert.equal(values('.browser-header-only .browser-toolbar input')['border-radius'],'0');
 assert.equal(values('.browser-chrome').background,'#000','通常表示の操作面は黒基準に揃える');
 assert.equal(values('.browser-header-only .browser-toolbar input').background,'rgba(239,255,255,.10)','入力欄は局所的な明るい下地で黒文字を読めるようにする');
});

test('Browserタイトルは通常・全画面・折畳とも1行で操作欄と衝突しない',()=>{
 const source=readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8');
 const {descriptor}=parse(source),style=compileStyle({source:descriptor.styles[0].content,id:'browser-header-nowrap',scoped:false});assert.deepEqual(style.errors,[]);
 assert.doesNotMatch(source,/grid-row:[23]|flex-wrap:wrap|white-space:normal/);
 assert.match(source,/grid-template-columns:minmax\(0,1fr\) minmax\(0,22cqi\) minmax\(0,1fr\)/);
 assert.match(source,/flex-wrap:nowrap;white-space:nowrap;overflow-x:auto/);
 assert.match(source,/overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
 assert.match(source,/browserAction\('header-size',chromeHeight.value\)/);
});

test('Browser孤立利用: スタンドアロン表示を既存文字色の細い枠で囲む',()=>{
 const {descriptor}=parse(readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'));
 const style=compileStyle({source:descriptor.styles[0].content,id:'data-v-browser-header',scoped:true});assert.deepEqual(style.errors,[]);
 const rule=style.rawResult.root.nodes.find(node=>node.type==='rule'&&node.selector.startsWith('.browser-isolated-label'));
 const values=Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));
 assert.equal(values.border,'1px solid currentColor');assert.equal(values['white-space'],'nowrap');
});

test('Browserタイトルは左右対称列で中心を維持する',()=>{
 const source=readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8');
 assert.match(source,/\.browser-panel :deep\(\.panel-brand\)\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,22cqi\) minmax\(0,1fr\)/);
 assert.match(source,/\.browser-panel :deep\(\.panel-brand>strong\)\{[^}]*text-align:center;justify-self:center/);
});
