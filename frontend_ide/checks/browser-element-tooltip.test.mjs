// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createBrowserElementPanel,renderBrowserElementTooltip} from '../デスクトップ/ブラウザ要素パネル.cjs';
import {collectBrowserElement} from '../デスクトップ/ブラウザ要素情報.cjs';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture(){
 const elements=[],listeners=new Map();
 function element(tag){
  const attrs={},properties={};const node={tag,attrs,properties,adoptedStyleSheets:[],children:[],textContent:'',isConnected:true,style:{setProperty:(name,value,priority)=>{properties[name]={value,priority};}},setAttribute:(name,value)=>{attrs[name]=value;},removeAttribute:name=>{delete attrs[name];},append(...children){this.children.push(...children);},attachShadow(options){this.shadowOptions=options;return this.shadow=element('shadow-root');},showPopover(){this.popoverShown=true;},getBoundingClientRect:()=>({width:360,height:160}),remove(){this.isConnected=false;}};elements.push(node);return node;
 }
 const document={createElement:element,documentElement:element('html')},window={innerWidth:800,innerHeight:600,addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:(name,callback)=>{if(listeners.get(name)===callback)listeners.delete(name);}};
 const context=vm.createContext({document,window,CSSStyleSheet:class{replaceSync(text){this.text=text;}}});
 const run=(action,id='one',value)=>vm.runInContext(`(${renderBrowserElementTooltip.toString()})(${JSON.stringify(action)},${JSON.stringify(id)},${JSON.stringify(value??null)})`,context);
 return{elements,document,window,listeners,run,host:()=>document.documentElement.children.at(-1)};
}
const value={selector:'button#save',tag:'button',html:'<button><img src=x onerror=alert(1)></button>',rect:{x:770,y:550,width:30,height:40},css:{display:'block','font-size':'16px'}};
test('要素説明: 別窓を作らず、見出しを最上部へ、内容はtextContent、クリックとフォーカスは遮らない',()=>{
 const f=fixture();assert.equal(f.run('open'),true);const host=f.host(),section=host.shadow.children[0];
 assert.equal(section.children[0].textContent,'項目選択中　esc=キャンセル');assert.equal(host.attrs['data-aidiy-element-tooltip'],'true');assert.equal(host.properties['pointer-events'].value,'none');assert.equal(host.properties.position.value,'fixed');assert.equal(host.shadowOptions.mode,'closed');assert.equal(host.attrs.popover,'manual');assert.equal(host.popoverShown,true);assert.match(host.shadow.adoptedStyleSheets[0].text,/background:transparent!important;pointer-events:none!important/);assert.equal(f.elements.some(node=>node.tag==='style'),false,'サイトのstyle CSPへ依存しない');
 f.run('update','one',value);assert.equal(section.children[1].textContent,'button#save');assert.match(section.children[2].textContent,/30 × 40/);assert.equal(section.children[3].textContent,value.html);assert.equal(f.elements.some(node=>node.tag==='img'),false,'HTMLは実行せず文字列表示');
 assert.equal(host.properties.left.value,'428px');assert.equal(host.properties.top.value,'382px');assert.equal(f.listeners.size,2);
 f.listeners.get('scroll')();assert.match(section.children[1].textContent,/マウスを重ね/);assert.equal(section.children[3].textContent,'');
 assert.equal(f.run('close'),true);assert.equal(host.isConnected,false);assert.equal(f.listeners.size,0);assert.equal(f.run('update','one',value),false);
});
test('要素説明: 再開始と遅い旧窓のclose/updateで現在の説明を消さない',()=>{
 const f=fixture();f.run('open','old');const old=f.host();f.run('open','new');const current=f.host();assert.equal(old.isConnected,false);assert.equal(current.isConnected,true);
 f.run('close','old');assert.equal(current.isConnected,true);assert.equal(f.run('update','old',value),false);assert.equal(f.run('update','new',value),true);f.run('close','new');assert.equal(current.isConnected,false);
});
test('要素説明: 読込中の取消・更新を直列化し、隔離worldだけを使い最後に説明を除去',async()=>{
 let resolve;const calls=[],contents={isDestroyed:()=>false,executeJavaScriptInIsolatedWorld:async(world,scripts)=>{calls.push({world,code:scripts[0].code});if(calls.length===1)await new Promise(done=>{resolve=done;});return true;}};
 const panel=createBrowserElementPanel({contents,onClose(){}}),opening=panel.open();await flush();panel.update(value);const closing=panel.close();resolve();await opening;await closing;await flush();assert.equal(calls.length,2);assert.ok(calls.every(call=>call.world===1005));assert.match(calls.at(-1).code,/\("close",/);assert.doesNotMatch(calls.at(-1).code,/<button>/);
});
test('要素説明: 描画開始失敗を通知し、破棄したページへ遅い更新を送らない',async()=>{
 let destroyed=false,calls=0;const panel=createBrowserElementPanel({contents:{isDestroyed:()=>destroyed,executeJavaScriptInIsolatedWorld:async()=>{calls++;throw Error('gone');}},onClose(){}});await assert.rejects(panel.open(),/gone/);destroyed=true;panel.update(value);await panel.close();assert.equal(calls,1);
});
test('要素説明: 説明枠そのものを選択情報に混ぜない',()=>{
 assert.throws(()=>collectBrowserElement.call({nodeType:1,getAttribute:()=> 'true'}),/表示要素/);
});
