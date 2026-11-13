// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import {画像を検証,最大画像バイト数} from '../../画像.mjs';
export function 貼付ファイル(transfer){
 return Array.from(transfer?.files||[]).length?Array.from(transfer.files):Array.from(transfer?.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
}
export async function 画像読込(file){
 if(!file||!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type))throw Error('PNG・JPEG・GIF・WebP画像を1枚指定してください。');
 if(file.size>最大画像バイト数)throw Error('画像は5 MB以内にしてください。');
 const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('画像を読み込めませんでした。'));reader.readAsDataURL(file);});
 画像を検証(data);
 await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{if(image.naturalWidth*image.naturalHeight>40000000)reject(Error('画像は4000万画素以内にしてください。'));else resolve();};image.onerror=()=>reject(Error('画像を表示できません。'));image.src=data;});
 return data;
}
