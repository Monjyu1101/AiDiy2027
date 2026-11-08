// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// CDPの隔離worldでDOM要素に対して実行する。外側の変数、入力値、Cookie、Storageを参照しない。
function collectBrowserElement(){
 const element=this?.nodeType===1?this:this?.parentElement;
 if(!element)throw Error('表示要素を取得できません。');
 const doc=element.ownerDocument,win=doc.defaultView;
 const clean=value=>String(value||'').replace(/(?:Bearer\s+)[\w.+\/-]+/gi,'Bearer [非表示]').replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g,'[非表示]').replace(/\b(?:sk-|gh[pousr]_|github_pat_)[\w-]{12,}\b/g,'[非表示]').replace(/(["']?(?:password|passwd|secret|token|api[-_]?key|authorization)["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s<"']+)/gi,'$1[非表示]');
 const limited=(value,size)=>clean(value).slice(0,size);
 const safeURL=value=>{try{const url=new URL(value,doc.baseURI);if(!['http:','https:','file:'].includes(url.protocol))return '[URL省略]';url.username='';url.password='';url.search='';url.hash='';return limited(url.href,1024);}catch{return '[URL省略]';}};
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const omitted=node=>/^(script|style|template|iframe|frame|object|embed|meta|link)$/i.test(node.localName)||node.getAttribute?.('type')?.toLowerCase()==='hidden';
 const invisible=node=>{const style=win.getComputedStyle(node);return node.hidden||node.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse';};
 const privateContent=node=>/^(input|textarea|select|option)$/i.test(node.localName)||node.isContentEditable||node.closest?.('[contenteditable]:not([contenteditable="false"])');
 const attributes=node=>{
  const values={};
  for(const attribute of Array.from(node.attributes||[]).slice(0,80)){
   const name=attribute.name.toLowerCase();
   // 許可リスト。value、data-*、on*、style、srcdoc、nonce等を取り込まない。
   if(!/^(id|class|name|type|role|title|alt|href|src|for|width|height|aria-label|aria-labelledby|aria-describedby)$/.test(name))continue;
   values[name]=/^(href|src)$/.test(name)?safeURL(attribute.value):limited(attribute.value,256);
  }
  return values;
 };
 let remaining=16000,count=0,truncated=false;const textParts=[];
 const write=value=>{if(value.length>remaining)truncated=true;const result=value.slice(0,remaining);remaining-=result.length;return result;};
 function html(node,depth=0){
  if(remaining<=0||count++>=160||depth>8){truncated=true;return '';}
  if(node.nodeType===3){const value=limited(node.textContent,1000);if(textParts.join('').length<1000)textParts.push(value);return write(escape(value));}
  if(node.nodeType!==1||omitted(node)||invisible(node))return '';
  const tag=node.localName,attrs=Object.entries(attributes(node)).map(([name,value])=>` ${name}="${escape(value)}"`).join('');
  let value=write(`<${tag}${attrs}>`);
  if(!privateContent(node))for(const child of node.childNodes){value+=html(child,depth+1);if(!remaining||count>=160){truncated=true;break;}}
  else value+=write('<!-- 入力値は取得しません -->');
  return value+write(`</${tag}>`);
 }
 const path=[];let node=element;
 for(let i=0;node&&i<6;i++,node=node.parentElement){
  let part=node.localName;
  if(node.id&&node.id.length<128&&clean(node.id)===node.id){part+='#'+win.CSS.escape(node.id);path.unshift(part);break;}
  const siblings=node.parentElement?Array.from(node.parentElement.children).filter(s=>s.localName===node.localName):[];
  if(siblings.length>1)part+=`:nth-of-type(${siblings.indexOf(node)+1})`;
  path.unshift(part);
 }
 const source=html(element),rect=element.getBoundingClientRect(),style=win.getComputedStyle(element),css={};
 for(const property of ['display','position','width','height','margin','padding','color','background-color','font-family','font-size','font-weight','line-height','border','border-radius','gap','flex-direction','justify-content','align-items','grid-template-columns'])css[property]=limited(style.getPropertyValue(property),256);
 return{tag:element.localName,selector:path.join(' > '),attributes:attributes(element),text:limited(textParts.join('').replace(/\s+/g,' ').trim(),1000),html:source,css,rect:Object.fromEntries(['x','y','width','height'].map(key=>[key,Math.round(rect[key]*100)/100])),url:safeURL(doc.URL),truncated,notice:'表示中DOMのHTML / 計算済みCSSです。元のVue等のソースではありません。入力値・機密属性・URLのクエリとフラグメントは除外します。表示文章には個人情報が残ることがあります。'};
}
function browserElementText(value){
 return['【選択した画面要素】','ページ: '+value.url,'セレクター: '+value.selector,'要素: '+value.tag,'位置・サイズ: '+JSON.stringify(value.rect),'属性: '+JSON.stringify(value.attributes),'表示文: '+value.text,'',value.notice,value.truncated?'HTMLは上限で省略しています。':'','', 'HTML:',value.html,'','CSS（計算済み）:',Object.entries(value.css).map(([key,text])=>`${key}: ${text};`).join('\n')].filter(line=>line!==undefined).join('\n');
}
module.exports={collectBrowserElement,browserElementText};
