// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {randomUUID}=require('node:crypto');

// 一時的な説明だけを隔離worldから表示する。ページへpreloadやIPCを与えず、文字はtextContentで描く。
function renderBrowserElementTooltip(action,id,value){
 const key='__aidiyBrowserElementTooltip',previous=globalThis[key];
 if(action==='close'){if(previous?.id===id)previous.close();return true;}
 if(action==='open')previous?.close();
 let state=globalThis[key];
 if(action==='open'){
  const host=document.createElement('div');host.setAttribute('data-aidiy-element-tooltip','true');host.setAttribute('aria-hidden','true');
  for(const [name,text] of Object.entries({all:'initial',position:'fixed',display:'block',margin:'0',padding:'0',border:'0',background:'transparent','pointer-events':'none','z-index':'2147483647',width:'min(360px, calc(100vw - 24px))','max-height':'calc(100vh - 24px)',overflow:'hidden'}))host.style.setProperty(name,text,'important');
  const shadow=host.attachShadow({mode:'closed'});
  const section=document.createElement('section'),heading=document.createElement('strong'),selector=document.createElement('p'),detail=document.createElement('p'),html=document.createElement('pre');
  // JSのstyleプロパティを使い、対象サイトのinline-style CSPや全体CSSへ依存しない。
  const style=(node,values)=>{for(const [name,text]of Object.entries(values))node.style.setProperty(name,text);};
  style(section,{'box-sizing':'border-box',background:'#101923',color:'#dce6f4',border:'1px solid #67cce6','border-radius':'4px',padding:'10px','box-shadow':'0 3px 12px #0005',font:'12px/1.5 system-ui','overflow-wrap':'anywhere'});
  style(heading,{display:'block',color:'#80eaff','font-size':'13px','margin-bottom':'5px'});
  for(const node of [selector,detail])style(node,{margin:'3px 0'});
  style(html,{margin:'5px 0 0','white-space':'pre-wrap',overflow:'hidden','max-height':'7.5em',font:'11px/1.4 monospace',color:'#b8c9da'});
  heading.textContent='項目選択中　esc=キャンセル';selector.textContent='項目にマウスを重ねてください。';
  section.append(heading,selector,detail,html);shadow.append(section);document.documentElement.append(host);
  // 対象ページのz-indexやfullscreenの前にも出し、フォーカス・クリックは奪わない。
  if(typeof host.showPopover==='function'&&typeof CSSStyleSheet==='function'&&'adoptedStyleSheets'in shadow){
   try{
    // サイト側の汎用::backdrop指定でも、背景を暗くしたり操作を塞いだりしない。
    const sheet=new CSSStyleSheet();sheet.replaceSync(':host::backdrop{background:transparent!important;pointer-events:none!important}');shadow.adoptedStyleSheets=[sheet];
    host.setAttribute('popover','manual');host.showPopover();
   }catch{host.removeAttribute('popover');}
  }
  const position=rect=>{
   const box=host.getBoundingClientRect(),margin=12,w=window.innerWidth,h=window.innerHeight;
   const left=Math.max(margin,Math.min(rect?.x??margin,w-box.width-margin));
   const below=rect?rect.y+rect.height+8:margin,above=rect?rect.y-box.height-8:margin;
   const top=Math.max(margin,Math.min(below+box.height<=h-margin?below:above,h-box.height-margin));
   host.style.setProperty('left',left+'px','important');host.style.setProperty('top',top+'px','important');
  };
  const reset=()=>{selector.textContent='項目にマウスを重ねてください。';detail.textContent='';html.textContent='';position();};
  const close=()=>{window.removeEventListener('scroll',reset,true);window.removeEventListener('resize',reset);host.remove();if(globalThis[key]?.id===id)delete globalThis[key];};
  state={id,host,selector,detail,html,position,close};globalThis[key]=state;
  window.addEventListener('scroll',reset,{capture:true,passive:true});window.addEventListener('resize',reset,{passive:true});position();
 }
 if(!state||state.id!==id||!state.host.isConnected)return false;
 if(action==='update'&&value){
  state.selector.textContent=String(value.selector||value.tag||'').slice(0,1000);
  state.detail.textContent=`${value.rect.width} × ${value.rect.height}　${value.css.display||''}　${value.css['font-size']||''}`;
  state.html.textContent=String(value.html||'').slice(0,700);state.position(value.rect);
 }
 return true;
}
function createBrowserElementPanel({contents,onClose}){
 const id=randomUUID();let disposed=false,queue=Promise.resolve();
 function run(action,value){
  const next=queue.then(()=>{
   if(contents.isDestroyed()||(disposed&&action!=='close'))return false;
   return contents.executeJavaScriptInIsolatedWorld(1005,[{code:`(${renderBrowserElementTooltip.toString()})(${JSON.stringify(action)},${JSON.stringify(id)},${JSON.stringify(value??null)})`}]);
  });queue=next.catch(()=>{});return next;
 }
 return{
  async open(){if(!await run('open'))throw Error('項目の説明を表示できません。');},
  update(value){if(!disposed)void run('update',value).then(ok=>{if(!ok&&!disposed)onClose();}).catch(()=>{if(!disposed)onClose();});},
  close(){disposed=true;return run('close').catch(()=>{});},
 };
}
module.exports={createBrowserElementPanel,renderBrowserElementTooltip};
