// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import 期限 from '../../期限.cjs';
const pad=value=>String(value).padStart(2,'0');
export function 期限入力表示(value){
 if(!期限.期限は有効(value))return '';
 const date=new Date(value);
 return `${String(date.getFullYear()).padStart(4,'0')}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function 期限見出し(value){
 const local=期限入力表示(value);
 return local?`${local.slice(5,10).replace('-','/')} ${local.slice(11)}`:'';
}
export function 期限を変換(value){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;
 const date=new Date(value);
 if(!Number.isFinite(+date))return null;
 const iso=date.toISOString();
 return 期限入力表示(iso)===value?iso:null;
}
export function 新規期限初期値(now=Date.now()){
 const next=new Date(now);
 next.setHours(next.getHours()+1,0,0,0);
 return 期限入力表示(next.toISOString());
}
const 予告時間=15*60*1000;
export function 期限状態(value,now=Date.now()){
 if(!期限.期限は有効(value))return {状態:'なし',次の切替:null};
 const remaining=Date.parse(value)-now;
 if(remaining<=0)return {状態:'到達',次の切替:null};
 if(remaining<=予告時間)return {状態:'予告',次の切替:remaining};
 return {状態:'通常',次の切替:remaining-予告時間};
}

export const 期限の分=Object.freeze(['00','15','30','45']);
export function 指定期限を変換(date,hour,minute){
 return 期限の分.includes(minute)?期限を変換(`${date}T${hour}:${minute}`):null;
}
