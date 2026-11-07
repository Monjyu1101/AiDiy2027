// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// falseはxtermの変換だけを止める。コピー・貼付けはブラウザーの既定動作と
// xtermのcopy/pasteイベントへ任せ、権限付きClipboard APIや二重貼付けを避ける。
export function consoleKeyHandler(send, { platform = globalThis.navigator?.platform || '', terminal } = {}) {
  const isMac = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'].includes(platform);
  let win32InputMode = false;
  const reset = () => { win32InputMode = false; };
  // ConPTYの要求に従う。ブラウザーのOSでは接続先PTYの入力形式を判断できない。
  // xterm 6が未対応の9001だけを記憶し、同じCSIに含まれる既存モードは奪わない。
  const subscriptions = terminal ? [
    ...['h', 'l'].map(final => terminal.parser.registerCsiHandler({ prefix: '?', final }, params => {
      if (params.includes(9001)) win32InputMode = final === 'h';
      return false;
    })),
    terminal.parser.registerEscHandler({ final: 'c' }, () => { reset(); return false; }),
  ] : [];
  const handle = event => {
    if (event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return true;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'c' || key === 'v')) return false;
    if (event.metaKey) return true;
    const modifiers = 1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0);
    let data;
    if (key === 'enter' && modifiers > 1) {
      if (win32InputMode) {
        // WindowsのCodex等は文字列ではなくKEY_EVENT_RECORDを読む。
        // Vk;Sc;Uc;Kd;Cs;Rc。Ctrlでも文字はCR、修飾はCsで独立して保持する。
        const state = (event.shiftKey ? 16 : 0) | (event.altKey ? 2 : 0) | (event.ctrlKey ? 8 : 0)
          | (event.code === 'NumpadEnter' || event.location === 3 ? 256 : 0);
        // 一回のkeydownにdown/upを対で送る。フォーカス移動でkeyupを失っても
        // 押下状態を残さず、keypress/keyupによる二重入力も起こさない。
        data = `\x1b[13;28;13;1;${state};1_\x1b[13;28;13;0;${state};1_`;
      } else {
        // Linux/macOS等は従来どおり。未要求のPTYへWin32形式を送らない。
        data = !event.ctrlKey && !event.shiftKey ? '\x1b\r' : `\x1b[13;${modifiers}u`;
      }
    } else if (key === 'tab' && (event.ctrlKey || event.altKey)) {
      data = `\x1b[9;${modifiers}u`;
    } else if (modifiers > 1 && ['insert', 'pageup', 'pagedown'].includes(key)) {
      // xterm標準のコピー・貼付け・ローカルスクロールに奪われないよう送る。
      data = `\x1b[${{ insert: 2, pageup: 5, pagedown: 6 }[key]};${modifiers}~`;
    } else if (event.key.length === 1 && (event.ctrlKey || event.altKey)) {
      // MacのOptionは文字入力用。xterm既定のmacOptionIsMeta:falseに合わせ、
      // Option/Shift+Optionの入力・dead key合成をESC付き文字へ置き換えない。
      if (isMac && event.altKey && !event.ctrlKey) return true;
      // keyCodeのUS配列換算ではなく、実際に入力された記号を使う。
      let character = event.key;
      if (event.ctrlKey) {
        if (/^[a-z]$/i.test(character)) character = String.fromCharCode(key.charCodeAt(0) - 96);
        else {
          const controls = { ' ': 0, '@': 0, '`': 0, '2': 0, '[': 27, '{': 27, '3': 27,
            '\\': 28, '|': 28, '4': 28, ']': 29, '}': 29, '5': 29, '^': 30, '~': 30, '6': 30,
            '_': 31, '/': 31, '-': 31, '7': 31, '?': 127, '8': 127 };
          character = Object.hasOwn(controls, character) ? String.fromCharCode(controls[character]) : null;
        }
      }
      data = character === null ? `\x1b[${event.key.codePointAt(0)};${modifiers}u` : (event.altKey ? '\x1b' : '') + character;
    }
    if (data !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'keydown') {
        send(data);
      }
      return false;
    }
    return true;
  };
  handle.reset = reset;
  handle.restore = enabled => { if (typeof enabled === 'boolean') win32InputMode = enabled; };
  handle.dispose = () => { reset(); for (const subscription of subscriptions) subscription.dispose(); };
  return handle;
}
