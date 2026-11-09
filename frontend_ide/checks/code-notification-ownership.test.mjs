// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { baseParse } from '@vue/compiler-dom';
import { parse } from '@vue/compiler-sfc';
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('../src/components/コード/会話到着演出.js',import.meta.url))],bundle:true,write:false,format:'cjs'}).outputFiles[0].text;
function documentFixture(name){
 const doc=new EventTarget(),timers=new Map(),intervals=new Map(),animations=[];let id=0,clock=0;
 const win={setTimeout(fn,ms=0){timers.set(++id,{fn,at:clock+ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn){intervals.set(++id,fn);return id;},clearInterval(id){intervals.delete(id);},requestAnimationFrame(fn){return win.setTimeout(fn,16);},cancelAnimationFrame(id){win.clearTimeout(id);}};
 Object.assign(doc,{name,hidden:false,defaultView:win,createElement:tag=>element(tag)});
 function element(tag){
  const node=new EventTarget();Object.assign(node,{tagName:tag.toUpperCase(),ownerDocument:doc,children:[],parentNode:null,className:'',style:{},textContent:'',scrollTop:0,scrollHeight:0,
   append(...children){for(const child of children){child.remove();child.parentNode=this;this.children.push(child);adopt(child,this.ownerDocument);}},
   replaceChildren(...children){for(const child of [...this.children])child.remove();this.append(...children);},
   remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}},
   setAttribute(){},querySelector(selector){return descendants(this).find(item=>item!==this&&item.classList.contains(selector.slice(1)));},
   closest(selector){for(let current=this;current;current=current.parentNode)if(current.classList.contains(selector.slice(1)))return current;return null;},
   getBoundingClientRect(){return{left:20,top:20,width:300,height:200};},
   animate(frames,options){const animation={frames,options,finished:new Promise(()=>{}),cancel(){}};animations.push(animation);return animation;},
  });
  node.classList={add(...names){node.className=[...new Set([...node.className.split(' ').filter(Boolean),...names])].join(' ');},remove(...names){node.className=node.className.split(' ').filter(name=>!names.includes(name)).join(' ');},contains(name){return node.className.split(' ').includes(name);}};
  Object.defineProperties(node,{isConnected:{get(){let root=this;while(root.parentNode)root=root.parentNode;return root===this.ownerDocument.body;}},parentElement:{get(){return this.parentNode;}},firstElementChild:{get(){return this.children[0];}}});return node;
 }
 doc.body=element('body');
 return{doc,win,timers,intervals,animations,async drain(){let count=0;while(timers.size){assert.ok(++count<1000,'timer loop');const[next,task]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(next);clock=task.at;task.fn();await Promise.resolve();}}};
}
function adopt(node,doc){node.ownerDocument=doc;for(const child of node.children)adopt(child,doc);}
const descendants=node=>[node,...node.children.flatMap(descendants)];
const popups=doc=>descendants(doc.body).filter(node=>node.classList.contains('answer-popup'));
function fixture(){
 const ide=documentFixture('IDE'),child=documentFixture('Code window'),module={exports:{}};
 vm.runInNewContext(bundle,{module,document:ide.doc,window:ide.win,Date,console});
 function code(doc){const root=doc.createElement('section');root.className='code-component';doc.body.append(root);const row=doc.createElement('article'),content=doc.createElement('div');content.className='content';row.append(content);root.append(row);return{root,row};}
 return{ide,child,code,arrival:host=>module.exports.chatArrival(()=>{},host)};
}
test('Navi別窓へ移したCodeの通知・文字送り・タイマーは元IDEではなく所有窓に属する',async()=>{
 const f=fixture(),{root,row}=f.code(f.ide.doc),arrival=f.arrival(row=>row.closest('.code-component'));
 f.child.doc.body.append(root);f.ide.doc.hidden=true;arrival.show(row,'assistant','完了しました');
 assert.equal(popups(f.ide.doc).length,0);assert.equal(popups(f.child.doc).length,1);assert.equal(popups(f.child.doc)[0].parentNode,root);assert.ok(popups(f.child.doc)[0].classList.contains('answer-popup-local'));
 assert.equal(f.ide.timers.size,0);assert.equal(f.ide.intervals.size,0);assert.equal(f.child.intervals.size,1);
 const popup=popups(f.child.doc)[0];await f.child.drain();assert.equal(popup.style.position,'absolute');assert.equal(popup.style.left,'0px');assert.equal(popups(f.child.doc).length,0);assert.equal(row.classList.contains('arrival-waiting'),false);assert.equal(row.classList.contains('arrival-pending'),false);arrival.dispose();
});
test('同一IDE内の複数Navi Codeも各自の領域に通知し、片方の破棄は他方を消さない',()=>{
 const f=fixture(),a=f.code(f.ide.doc),b=f.code(f.ide.doc),first=f.arrival(row=>row.closest('.code-component')),second=f.arrival(row=>row.closest('.code-component'));
 first.show(a.row,'assistant','A完了');second.show(b.row,'assistant','B完了');assert.deepEqual(popups(f.ide.doc).map(node=>node.parentNode),[a.root,b.root]);
 first.dispose();assert.equal(popups(f.ide.doc).length,1);assert.equal(popups(f.ide.doc)[0].parentNode,b.root);second.dispose();assert.equal(popups(f.ide.doc).length,0);assert.equal(f.ide.timers.size,0);assert.equal(f.ide.intervals.size,0);
});
test('Web IDEのCodeタブだけ従来のページ中央通知を維持する',()=>{
 const f=fixture(),{row}=f.code(f.ide.doc),arrival=f.arrival(row=>row.ownerDocument.body);arrival.show(row,'assistant','Web完了');
 const popup=popups(f.ide.doc)[0];assert.equal(popup.parentNode,f.ide.doc.body);assert.equal(popup.classList.contains('answer-popup-local'),false);arrival.dispose();
});
test('非表示の所有窓では通知せず、表示中の通知もその窓の非表示・破棄で後片付けする',()=>{
 const f=fixture(),{row}=f.code(f.child.doc),arrival=f.arrival(row=>row.closest('.code-component'));f.child.doc.hidden=true;arrival.show(row,'assistant','非表示');assert.equal(popups(f.ide.doc).length,0);assert.equal(popups(f.child.doc).length,0);
 f.child.doc.hidden=false;arrival.show(row,'assistant','表示');assert.equal(popups(f.child.doc).length,1);f.ide.doc.hidden=true;f.ide.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(popups(f.child.doc).length,1);
 f.child.doc.hidden=true;f.child.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(popups(f.child.doc).length,0);assert.equal(row.classList.contains('arrival-waiting'),false);arrival.dispose();assert.equal(f.child.timers.size,0);assert.equal(f.child.intervals.size,0);
});
test('実行中に別Documentへ移した後の回答は前の演出を残さず移動先へ表示する',()=>{
 const f=fixture(),{root,row}=f.code(f.ide.doc),arrival=f.arrival(row=>row.closest('.code-component'));arrival.show(row,'assistant','途中');f.child.doc.body.append(root);arrival.show(row,'assistant','完了');
 assert.equal(popups(f.ide.doc).length,0);assert.equal(popups(f.child.doc).length,1);assert.equal(f.ide.timers.size,0);assert.equal(f.ide.intervals.size,0);arrival.dispose();
});
test('別窓Codeの手動送信演出も元IDEへ要素・RAFを追加しない',async()=>{
 const f=fixture(),{root,row}=f.code(f.child.doc),arrival=f.arrival(row=>row.closest('.code-component')),input=f.child.doc.createElement('textarea');root.append(input);arrival.reserve(input,'入力');arrival.show(row,'user','入力');await f.child.drain();
 assert.equal(f.ide.animations.length,0);assert.equal(f.ide.timers.size,0);assert.ok(f.child.animations.length>0);assert.equal(row.classList.contains('arrival-pending'),false);arrival.dispose();
});
test('通知先が失われてもIDEへフォールバックせず、本文をそのCodeで即表示する',()=>{
 const f=fixture(),{row}=f.code(f.child.doc),arrival=f.arrival(()=>null);arrival.show(row,'assistant','完了');assert.equal(popups(f.ide.doc).length,0);assert.equal(popups(f.child.doc).length,0);assert.equal(row.classList.contains('arrival-waiting'),false);arrival.dispose();
});
const attr=(node,name)=>node.props?.find(prop=>prop.type===6&&prop.name===name);
const walk=node=>[node,...(node.children||[]).flatMap(walk)];
test('Web内実行の例外をAppのブラウザー版タブだけに明示し、Navi・単独・IDE子窓・VS Codeでは使わない',()=>{
 const app=baseParse(parse(readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')).descriptor.template.content),nodes=walk(app),codes=nodes.filter(node=>node.tag==='CodePanel');assert.equal(codes.length,2);
 const web=codes.find(node=>attr(node,'page-notifications'));assert.ok(web);const aside=nodes.find(node=>node.tag==='aside'&&walk(node).includes(web));assert.equal(aside.props.find(prop=>prop.type===7&&prop.name==='if').exp.content,'!desktop');
 const other=codes.find(node=>node!==web);assert.equal(attr(other,'page-notifications'),undefined);
 const navi=baseParse(parse(readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url),'utf8')).descriptor.template.content);for(const code of walk(navi).filter(node=>node.tag==='CodePanel'))assert.equal(attr(code,'page-notifications'),undefined);
 const css=readFileSync(new URL('../src/components/共通表示/会話表示.css',import.meta.url),'utf8'),layout=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');assert.match(layout,/\.ai-component\{[^}]*position:relative;overflow:hidden/);assert.match(css,/\.answer-popup\.answer-popup-local \{ position: absolute; width: min\(560px, calc\(100% - 16px\)\)/);
});
