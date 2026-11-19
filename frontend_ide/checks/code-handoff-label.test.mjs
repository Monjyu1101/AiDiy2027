// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parse,compileTemplate} from '@vue/compiler-sfc';

const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
function find(node,match){
 if(match(node))return node;
 for(const child of node.children??[]){const found=find(child,match);if(found)return found;}
}
const classIs=(node,name)=>node.tag==='button'&&node.props.some(prop=>prop.name==='class'&&prop.value?.content===name);

for(const [location,cls] of [
 ['ブラウザ/ブラウザパネル.vue','browser-handoff'],
 ['ファイル閲覧/ファイルビューア.vue','viewer-handoff'],
 ['開発スペース/Naviパネル.vue','navigation-handoff'],
])test(`連携ラベル: ${cls} は Codeへ と表示し、既存のクリック先を保つ`,()=>{
 const path=`../src/components/${location}`;
 const {descriptor,errors}=parse(source(path));
 assert.deepEqual(errors,[]);
 const template=compileTemplate({source:descriptor.template.content,filename:location,id:cls});
 assert.deepEqual(template.errors,[]);
 const button=find(descriptor.template.ast,node=>classIs(node,cls));
 assert.ok(button);
 assert.deepEqual(button.children.map(child=>child.content),['Codeへ']);
 assert.equal(button.props.find(p=>p.name==='on'&&p.arg?.content==='click').exp.content,'handoff');
});
test('連携ラベル: エクスプローラーとWebの紹介ページも Codeへ と表示する',()=>{
 assert.match(source('../src/components/ファイル閲覧/エクスプローラー操作表示.vue'),/\['handoff','Codeへ'/);
 assert.match(source('../../frontend_web/public/X自己紹介/index.html'),/Chrome DevTools 連携<\/span><span>Codeへ<\/span>/);
});
