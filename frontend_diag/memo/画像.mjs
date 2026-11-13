// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
export const 最大画像バイト数=5*1024*1024;
export const 最大メモバイト数=1024*1024+Math.ceil(最大画像バイト数/3)*4+4096;
// Data URL以外のURL、SVG、HTMLを許可しない。Nodeとrendererで同じ検査を使う。
export function 画像を検証(value){
 if(value===undefined||value==='')return '';
 const fail=()=>{throw Object.assign(Error('画像はPNG・JPEG・GIF・WebPのいずれか1枚、5 MB以内で指定してください。'),{status:400});};
 if(typeof value!=='string'||value.length>Math.ceil(最大画像バイト数/3)*4+32)return fail();
 const match=/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match||match[2].length%4!==0)return fail();
 const encoded=match[2],size=encoded.length/4*3-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
 if(size>最大画像バイト数)return fail();
 // 末尾の未使用bitもcanonical base64であることを確認する。
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 if(encoded.endsWith('==')&&(alphabet.indexOf(encoded.at(-3))&15)||encoded.endsWith('=')&&!encoded.endsWith('==')&&(alphabet.indexOf(encoded.at(-2))&3))return fail();
 const head=atob(encoded.slice(0,Math.min(encoded.length,32)));
 const bytes=[...head].map(char=>char.charCodeAt(0));
 const png=bytes.length>=24&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)&&head.slice(12,16)==='IHDR';
 const jpeg=size>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const gif=size>=13&&(head.startsWith('GIF87a')||head.startsWith('GIF89a'));
 const webp=size>=20&&head.startsWith('RIFF')&&head.slice(8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(head.slice(12,16));
 if(!({png,jpeg,gif,webp})[match[1]])return fail();
 return value;
}
