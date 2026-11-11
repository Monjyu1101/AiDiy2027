// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 単調時計・対象別の最後の実受信で判断する。インスタンス間では状態を共有しない。
export function 受信間隔を作成({now=()=>performance.now()}={}){
 const 最後=new Map();
 function 受信(id){最後.set(id,now());}
 function 間隔(id){if(!最後.has(id))受信(id);return now()-最後.get(id)<=30000?800:2000;}
 return {受信,間隔};
}
