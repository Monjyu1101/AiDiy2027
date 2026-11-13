// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
export const メモ色 = Object.freeze(['yellow', 'blue', 'green', 'pink', 'purple', 'vivid-red', 'vivid-blue', 'vivid-green', 'vivid-orange', 'vivid-purple', 'vivid-cyan']);
export function メモキー(メモ) { return JSON.stringify([メモ.保存先, メモ.id]); }
export function 編集値(メモ) {
  return {タイトル:メモ.タイトル || '', 本文:メモ.本文 || '', 色:メモ.色 || 'yellow',...(メモ.画像!==undefined?{画像:メモ.画像}:{}),...(メモ.位置?{位置:メモ.位置}:{}),...(メモ.サイズ?{サイズ:メモ.サイズ}:{})};
}
export function 編集開始(メモ) {
  return {...メモ, ...編集値(メモ), 元:JSON.stringify(編集値(メモ)), 保存中:false, エラー:''};
}
export function 変更あり(メモ) { return メモ.新規 === true || JSON.stringify(編集値(メモ)) !== メモ.元; }
export function 保存要求(メモ) {
  const body={保存先:メモ.保存先,...編集値(メモ)};
  if (!メモ.新規) Object.assign(body,{id:メモ.id,revision:メモ.revision});
  return body;
}
