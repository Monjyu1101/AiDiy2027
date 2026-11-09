// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Naviの終了通知音。backend_tools の aidiy_notification_sounds で固定音だけを鳴らす。
// 画面からは種別名だけを受け取り、通知種別・scene・任意文字列（tts）は渡させない。
import {toolsTarget} from './ai-search.mjs';

// scene は auto（部品の既定）。画面の種別名をそのまま部品の日本語の通知種別として呼び、読み替えない。
// 使うのは 完了（評価が100%）と 注意（評価が100%未満・失敗・停止）の2つだけ。
export const NAVIGATION_SOUNDS=Object.freeze(Object.fromEntries(['注意','完了'].map(type=>[type,Object.freeze({notification_type:type,scene:'auto'})])));
const MAX_PENDING=12;

export async function playNavigationSound(project,sound,{fetcher=fetch,timeout=30000}={}){
 const origin=new URL('/',await toolsTarget(project)).href;
 const response=await fetcher(origin+'aidiy_notification_sounds/play',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sound),signal:AbortSignal.timeout(timeout)});
 if(!response.ok)throw Error(`通知音を再生できません（HTTP ${response.status}）`);
 const result=await response.json();if(result?.error)throw Error(result.error);return result;
}

export function createNavigationSound(project,{state,play=sound=>playNavigationSound(project,sound)}={}){
 // 通知音部品は再生が終わるまで返らず、同時に呼ぶと前の音が途中で切れる。評価と停止が続けて鳴る場合も、受け付けた順に1つずつ鳴らす。
 let queue=Promise.resolve(),pending=0;
 const enqueue=sound=>{
  if(pending>=MAX_PENDING)return false;
  pending++;queue=queue.then(()=>play(sound)).catch(()=>{}).finally(()=>{pending--;});return true;
 };
 return {async handle(req,res,url){
  if(url.pathname!=='/api/navigation/sound')return false;
  const reply=(status,data)=>res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(data));
  try{
   if(req.method!=='POST'){req.resume();reply(405,{error:'POST required'});return true;}
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1000)throw Error('入力が大きすぎます。');chunks.push(Buffer.from(chunk));}
   const kind=JSON.parse(Buffer.concat(chunks).toString('utf8'))?.kind;
   if(typeof kind!=='string'||!Object.hasOwn(NAVIGATION_SOUNDS,kind))throw Error('通知音の種別が不正です。');
   if(!state?.().active){reply(409,{error:'IDEの利用を開始してください。'});return true;}
   // 再生完了まで待つと画面の処理が遅れるため、受付だけ返す。Tools未起動・スピーカー無効は無視する。
   reply(202,{kind,queued:enqueue(NAVIGATION_SOUNDS[kind])});
  }catch(e){reply(400,{error:e.message});}
  return true;
 }};
}
