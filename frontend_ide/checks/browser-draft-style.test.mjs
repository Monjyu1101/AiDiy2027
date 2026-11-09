// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse,compileStyle} from '@vue/compiler-sfc';

function compiledDeclarations(){
 const filename=new URL('../src/dialog/下書き連携ダイアログ.vue',import.meta.url);
 const {descriptor,errors}=parse(readFileSync(filename,'utf8'),{filename:filename.pathname});assert.deepEqual(errors,[]);
 const declarations=[];
 for(const style of descriptor.styles){
  const compiled=compileStyle({source:style.content,filename:filename.pathname,id:'data-v-draft-style-test',scoped:style.scoped});assert.deepEqual(compiled.errors,[]);
  compiled.rawResult.root.walkDecls(declaration=>declarations.push({selector:declaration.parent.selector,property:declaration.prop,value:declaration.value}));
 }
 return declarations;
}

test('Browser下書きの実CSS: nativeドラッグ領域は見出しだけで、パネル全面に広がらない',()=>{
 const declarations=compiledDeclarations();
 // :global(.draft-native-window)>h3 はVueの変換で >h3 が落ちる。必ず出力CSSを検証する。
 const draggable=declarations.filter(item=>item.property==='-webkit-app-region'&&item.value==='drag');
 assert.deepEqual(draggable.map(item=>item.selector),['.draft-native-window>h3']);
 assert.ok(declarations.some(item=>item.selector==='.model-dialog.draft-native-window'&&item.property==='-webkit-app-region'&&item.value==='no-drag'),'本文・連携先・追加・キャンセルはマウス操作領域にする');
});

test('Browser下書きの実CSS: 子窓全体の寸法とスクロールは維持する',()=>{
 const declarations=compiledDeclarations();
 const style=Object.fromEntries(declarations.filter(item=>item.selector==='.model-dialog.draft-native-window').map(item=>[item.property,item.value]));
 assert.equal(style.width,'100%');assert.equal(style.height,'100dvh');assert.equal(style.overflow,'auto');
});
