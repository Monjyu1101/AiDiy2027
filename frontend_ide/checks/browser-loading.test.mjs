// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse,compileTemplate} from '@vue/compiler-sfc';
import {transformSync} from 'esbuild';
import * as vue from 'vue';
import vm from 'node:vm';
const {descriptor}=parse(readFileSync(new URL('../src/components/ブラウザ/ブラウザパネル.vue',import.meta.url),'utf8'));
const compiled=compileTemplate({source:descriptor.template.content,filename:'Browser.vue',id:'loading-check'});
assert.deepEqual(compiled.errors,[]);
const module={exports:{}};
vm.runInNewContext(transformSync(compiled.code,{format:'cjs'}).code,{module,exports:module.exports,require:()=>({...vue,resolveComponent:name=>name})});
function labels(loading,error=''){
 const page={tabs:[{id:'a',title:'ページ',loading}],activeTabId:'a',loading,error,available:true};
 const context={page,tabLabel:tab=>tab.title,infoTabId:'',connectionTarget:'',analysisStatus:{status:'idle'},openingAnalysis:false,headerOnly:false,headerOffset:0,windowTitle:'Browser',standalone:false,headerWindowApi:undefined,capturing:false,handing:false,captureMessage:'',address:'',error:'',transition(){},capture(){},handoff(){},action(){},navigate(){}};
 const root=module.exports.render(context,[]);
 function all(v){return v&&typeof v==='object'?[v,...(Array.isArray(v.children)?v.children.flatMap(all):[])]:[];}
 return all(root);
}
for(const loading of [true,false])test(`Browser loading stays in tab and reload control, no extra row: ${loading}`,()=>{
 const nodes=labels(loading);
 assert.equal(nodes.some(n=>n.props?.['aria-label']==='読み込み中'),loading);
 assert.equal(nodes.some(n=>n.props?.['aria-label']==='読み込みを停止'),loading);
 assert.ok(!nodes.some(n=>n.type==='p'));
});
test('page load failure is handled in native body, never a URL-below error row',()=>{
 assert.ok(!labels(false,'failed').some(n=>n.type==='p'));
});
