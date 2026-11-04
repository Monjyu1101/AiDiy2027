// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// URL全体のdecodeURI/decodeURIComponentは禁止。authority・ASCIIエスケープはそのまま。
// 日本語の可視文字だけを復号し、不可視文字・方向制御・似た区切り文字は展開しない。
const japanese=/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー。、「」『』・]+$/u;
const invisible=/[\p{Default_Ignorable_Code_Point}\p{C}\p{Z}]/u;
const multibyte=/%(?:[cC][2-9a-fA-F]|[dD][0-9a-fA-F])%[89aAbB][0-9a-fA-F]|%[eE][0-9a-fA-F](?:%[89aAbB][0-9a-fA-F]){2}|%[fF][0-4](?:%[89aAbB][0-9a-fA-F]){3}/g;
export function displayBrowserURL(value){
 const url=typeof value==='string'?value:'';
 // 対応する階層URLのpath/query/hashだけ。ホスト名・ユーザー情報・不明なschemeは触らない。
 const parts=/^((?:https?|file):\/\/[^/?#]*)([/?#][\s\S]*)?$/i.exec(url);
 if(!parts)return url;
 return parts[1]+(parts[2]||'').replace(multibyte,encoded=>{
  try{const decoded=decodeURIComponent(encoded);return japanese.test(decoded)&&!invisible.test(decoded)?decoded:encoded;}catch{return encoded;}
 });
}
export function browserAddressTarget(address,currentURL){
 // 未編集のEnterはエスケープの大小文字も含め元のURLをそのまま渡す。
 return address===displayBrowserURL(currentURL)?currentURL:address;
}
