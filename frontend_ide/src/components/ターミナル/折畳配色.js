// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { ref } from 'vue';
// Term の折畳アイコンの配色。折畳んだ時点でコマンド実行中だった場合だけ色を付ける。
// 実行中はシアンの脈動（online）、そのまま終了したら終了コード0で緑（success）・0以外で赤（failure）。
// 未実行で折畳んだ場合は色を付けず、展開したら色を解除する。
export function createCommandFoldTone() {
  const tone = ref('');
  let running = false;
  function finished(code) {
    running = false;
    if (tone.value === 'online') tone.value = code === 0 ? 'success' : 'failure';
  }
  return {
    tone,
    get running() { return running; },
    // powershell-init.ps1 の OSC 133。C=コマンド開始、D;<終了コード>=終了。xterm の処理済みとして true を返す。
    marker(data) {
      if (data === 'C') running = true;
      else if (typeof data === 'string' && data.startsWith('D')) { const code = Number.parseInt(data.slice(2), 10); finished(Number.isFinite(code) ? code : 1); }
      return true;
    },
    collapsed(value) { tone.value = value && running ? 'online' : ''; },
    // シェル自体が終了した場合も、実行中だったコマンドの結果として扱う。
    shellExited(code) { if (running) finished(code); },
    reset() { running = false; tone.value = ''; },
  };
}
