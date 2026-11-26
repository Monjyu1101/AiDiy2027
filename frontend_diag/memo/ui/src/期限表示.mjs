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
export function 期限経過(value,now=Date.now()){
 return 期限.期限は有効(value)&&Date.parse(value)<=now;
}
