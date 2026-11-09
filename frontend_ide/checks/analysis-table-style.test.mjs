// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse,compileStyle} from '@vue/compiler-sfc';
function declarations(browser=false){
 const filename=new URL(browser?'../src/dialog/ブラウザ解析ダイアログ.vue':'../src/style.css',import.meta.url);
 const source=readFileSync(filename,'utf8'),styles=browser?parse(source,{filename:filename.pathname}).descriptor.styles:[{content:source,scoped:false}];
 const declarations=[];
 for(const style of styles){const compiled=compileStyle({source:style.content,filename:filename.pathname,id:'data-v-analysis-test',scoped:style.scoped});assert.deepEqual(compiled.errors,[]);compiled.rawResult.root.walkDecls(item=>declarations.push({selector:item.parent.selector,property:item.prop,value:item.value}));}
 return(selector,property)=>declarations.filter(item=>item.selector?.split(',').some(value=>value.trim().replaceAll('[data-v-analysis-test]','')===selector)&&item.property===property).at(-1)?.value;
}
for(const browser of [false,true])test(`${browser?'Browser':'ファイル'}解析の実CSS: 表内スクロール・見出し固定・読みやすい文字・縞行・スクエアを維持する`,()=>{
 const style=declarations(browser),area=browser?'.browser-analysis-sources':'.analysis-table-scroll',table=browser?area+' table':'.analysis-result table',cell=browser?area+' td':'.analysis-result td',header=browser?area+' th':'.analysis-result th';
 assert.equal(style(area,'overflow'),'auto');assert.equal(style(area,'max-width'),'100%');assert.ok(style(area,'max-height'));assert.ok(style(table,'min-width'));assert.equal(style(table,'font-size'),'13px');assert.equal(style(header,'position'),'sticky');assert.equal(style(header,'top'),'0');assert.equal(style(cell,'vertical-align'),'top');assert.equal(style(cell,'word-break'),'normal');assert.equal(style(cell,'overflow-wrap'),'anywhere');assert.notEqual(style(cell,'background'),style(browser?area+' tbody tr:nth-child(even) td':'.analysis-result tbody tr:nth-child(even) td','background'));assert.ok(style(area+':focus-visible','outline'));
 if(browser){assert.equal(style('.browser-analysis-dialog','border-radius'),'0');assert.equal(style('.browser-analysis-target','border-radius'),'0');assert.equal(style('.browser-analysis-native>header button','-webkit-app-region'),'no-drag');assert.equal(style('.browser-analysis-source:focus-visible','outline'),'2px solid #9edfff');}
 else{assert.equal(style(table,'display'),'table');assert.equal(style(cell,'text-align'),undefined,'Markdownの左・中央・右揃えを上書きしない');}
});
