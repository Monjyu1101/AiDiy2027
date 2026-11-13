// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const {ipcRenderer}=require('electron');
ipcRenderer.on('diag:icon-menu-items',(_event,items)=>{
 const list=document.querySelector('.app-list');list.replaceChildren();
 const aidiyKeys=new Set(['app:avatar','app:task','app:team','app:ide','app:memo','app:cpu','app:console','app:code','app:live','app:browser','app:navi','app:discord','app:slack']);
 const columns=[document.createElement('div'),document.createElement('div')];
 for(const [index,column] of columns.entries()){column.className='app-column';column.setAttribute('role','group');column.setAttribute('aria-label',index===0?'AiDiy':'CLI・外部ツール');const title=document.createElement('div');title.className='column-title';title.textContent=index===0?'AiDiy':'CLI・外部ツール';column.append(title);list.append(column);}

 for(const item of items){const button=document.createElement('button');button.setAttribute('role','menuitem');button.dataset.action=item.key;button.disabled=item.enabled===false;if(typeof item.reason==='string')button.title=item.reason;
 const img=document.createElement('img');img.src=item.icon;img.alt='';const label=document.createElement('span');label.textContent=item.label;
 const arrow=document.createElement('span');arrow.className='launch-arrow';arrow.textContent='↗';button.append(img,label,arrow);columns[aidiyKeys.has(item.key)?0:1].append(button);}
});
window.addEventListener('DOMContentLoaded',()=>{
 document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(button&&!button.disabled)ipcRenderer.send('diag:icon-menu-action',button.dataset.action);else if(event.target===document.body)ipcRenderer.send('diag:icon-menu-action','dismiss');});
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();ipcRenderer.send('diag:icon-menu-action','dismiss');}
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   const buttons=[...document.querySelectorAll('button')].filter(button=>!button.disabled&&button.getClientRects().length),index=buttons.indexOf(document.activeElement);
   const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
   buttons[next]?.focus();event.preventDefault();
  }
 });
 document.querySelector('button')?.focus();
});
