// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// xterm 6.0.0用。upstream #5759と同じく、変換開始時にtextareaと変換表示を再同期する。
// Piなどが描画後に戻した実カーソルを使う。入力値・選択範囲・送信データは変更しない。
// xterm更新時は本体側の対応を確認し、不要になった互換処理を撤去する。
export function termImeAnchor(terminal) {
  const textarea = terminal?.textarea;
  const core = terminal?._core;
  const helper = core?._compositionHelper;
  if (!textarea || typeof core?._syncTextArea !== 'function' || typeof helper?.updateCompositionElements !== 'function') {
    return { dispose() {} };
  }
  // captureはxtermのcompositionstartより先、bubbleは後に登録して実行する。
  const beforeStart = () => core._syncTextArea();
  const afterStart = () => helper.updateCompositionElements();
  textarea.addEventListener('compositionstart', beforeStart, true);
  textarea.addEventListener('compositionstart', afterStart);
  return { dispose() {
    textarea.removeEventListener('compositionstart', beforeStart, true);
    textarea.removeEventListener('compositionstart', afterStart);
  } };
}
