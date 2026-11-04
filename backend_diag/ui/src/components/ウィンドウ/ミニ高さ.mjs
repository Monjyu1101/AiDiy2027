// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 内容の自然な高さだけを測る。窓の高さを測らないので、縮小後も余白やresize循環が残らない。
export function ミニ高さを合わせる(content,{api=globalThis.window?.aidiyWindow,Observer=globalThis.ResizeObserver,style=globalThis.getComputedStyle}={}){
 if(!content?.getBoundingClientRect||typeof api?.resizeMini!=='function')return()=>{};
 const root=content.closest('#app'),title=root?.querySelector('.panel-brand'),bar=root?.querySelector('.connection-bar');
 if(!title||!bar)return()=>{};
 let stopped=false,scheduled=false,last=0;
 function measure(){
  if(stopped||scheduled)return;scheduled=true;
  Promise.resolve().then(()=>{
   scheduled=false;if(stopped)return;
   // 外周1px枠の上下を内容高へ足す。省くと最下段に縦スクロールが残る。
   const frame=root&&style?style(root):null;
   const border=(parseFloat(frame?.borderTopWidth)||0)+(parseFloat(frame?.borderBottomWidth)||0);
   const raw=[content,title,bar].reduce((sum,node)=>sum+node.getBoundingClientRect().height,0)+border;
   if(!Number.isFinite(raw)||raw<=0)return;
   const height=Math.max(80,Math.min(360,Math.ceil(raw)));if(height===last)return;last=height;
   try{Promise.resolve(api.resizeMini(height)).then(accepted=>{if(accepted!==true&&last===height)last=0;},()=>{if(last===height)last=0;});}catch{last=0;}
  });
 }
 const observer=Observer?new Observer(measure):null;
 for(const node of [content,title,bar])observer?.observe(node);
 measure();
 return()=>{stopped=true;observer?.disconnect();};
}
