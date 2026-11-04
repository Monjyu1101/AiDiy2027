// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 同じ文字・フォントのCanvas文字幅をフレームごとに測り直さない。
// 階層再構築・サイズ変更・Webフォント読込時に呼出側で破棄する。
export function createTextWidthCache(context) {
  const widths = new Map();
  return {
    measure(text) {
      const key = `${context.font}\n${text}`;
      if (!widths.has(key)) widths.set(key, context.measureText(text).width);
      return widths.get(key);
    },
    clear() { widths.clear(); },
  };
}
