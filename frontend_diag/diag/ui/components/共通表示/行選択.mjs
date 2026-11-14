// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 一覧の行は文字のない余白をクリックしても選択する。行内のボタン・リンク・入力はそれぞれの操作を優先する。
const 操作要素 = 'button,a,input,select,textarea,label,summary,[role="button"]';
export function 行の余白クリック(event) {
  const target = event?.target;
  return !(target && typeof target.closest === 'function' && target.closest(操作要素));
}
