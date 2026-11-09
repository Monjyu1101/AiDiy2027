// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 操作のcapture時点の通知だけを、クリック・入力の処理が終わってから消す。
// 同じ操作で届いた後続通知は、同じ文面でも新しい通知として保持する。
export function createNavigationMessage(write,{schedule=callback=>setTimeout(callback,0),cancel=clearTimeout}={}){
 let revision=0,message='',disposed=false;
 const pending=new Set();
 function show(text){if(disposed)return;revision++;message=text;write(text);}
 function dismiss(event){
  if(disposed||!message)return;
  // Enter / Spaceのボタン操作は、その後のclickを1回の操作として扱う。
  // keydownで消すと、押下中のボタンが消えたり、同じ操作の通知を消したりする。
  if(event?.type==='keydown'&&['Enter',' ','Spacebar'].includes(event.key)&&event.target?.closest?.('button,a[href],input[type="button"],input[type="submit"],input[type="reset"]'))return;
  const current=revision;
  const timer=schedule(()=>{pending.delete(timer);if(!disposed&&revision===current)show('');});
  pending.add(timer);
 }
 function dispose(){disposed=true;revision++;for(const timer of pending)cancel(timer);pending.clear();}
 return{show,dismiss,dispose};
}
