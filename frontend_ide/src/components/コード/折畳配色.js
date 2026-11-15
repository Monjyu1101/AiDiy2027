// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { ref } from 'vue';
// Code の折畳アイコンの配色。折畳中に依頼が実行中ならシアンの脈動（online）、
// 回答が届いたら緑（success）、先頭が「!」の回答（AIコア共通のエラー応答）・エラー・停止なら赤（failure）。
// 未実行で折畳んだ場合は色を付けず、展開したら色を解除する。赤は次の依頼開始まで緑で上書きしない。
export function createReplyFoldTone() {
  const tone = ref('');
  let collapsed = false, running = false;
  return {
    tone,
    collapsed(value, isRunning = running) {
      collapsed = !!value; running = !!isRunning;
      tone.value = collapsed && running ? 'online' : '';
    },
    // Navi・Discord 等からの依頼は折畳中にも始まるため、開始時点で脈動を付ける。
    started() { running = true; if (collapsed) tone.value = 'online'; },
    // 回答より先に実行終了の状態が届く場合があるため、終了だけでは色を変えない。
    finished() { running = false; },
    reply(text) {
      if (!collapsed || !tone.value || typeof text !== 'string' || !text.trim()) return;
      if (/^[!！]/.test(text.trim())) tone.value = 'failure';
      else if (tone.value !== 'failure') tone.value = 'success';
    },
    failed() { if (collapsed && tone.value) tone.value = 'failure'; },
    reset() { running = false; tone.value = ''; },
  };
}
