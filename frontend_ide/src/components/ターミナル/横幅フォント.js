// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// FitAddonの実測値には余白・スクロールバー・DPI丸めも含まれる。
// セルを縮めても80列入らない幅では6pxを維持し、実際の列数をPTYへ送る。
export function createTermFontFit(terminal, fit, { minimum = 6, columns = 80 } = {}) {
  let preferred = Math.max(minimum, Number(terminal.options.fontSize) || 14);
  let applied = terminal.options.fontSize;
  let fitting = false;
  return function fitFont() {
    if (fitting) return;
    fitting = true;
    try {
      // 外部から手動指定されたサイズは自動縮小値と区別して保持する。
      if (terminal.options.fontSize !== applied) {
        preferred = Math.max(minimum, Number(terminal.options.fontSize) || preferred);
      }
      const previous = terminal.options.fontSize;
      terminal.options.fontSize = preferred;
      let dimensions = fit.proposeDimensions();
      if (!dimensions || !Number.isFinite(dimensions.cols) || dimensions.rows < 1) {
        terminal.options.fontSize = previous;
        return;
      }
      let size = preferred;
      while (dimensions.cols < columns && size > minimum) {
        size = Math.max(minimum, size - 1);
        terminal.options.fontSize = size;
        dimensions = fit.proposeDimensions();
        if (!dimensions || !Number.isFinite(dimensions.cols)) {
          terminal.options.fontSize = previous;
          return;
        }
      }
      applied = terminal.options.fontSize;
      // resizeイベントは最終サイズだけ。タブごとに独立したpreferredを持つ。
      fit.fit();
    } finally { fitting = false; }
  };
}
