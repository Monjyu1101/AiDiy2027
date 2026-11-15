// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import { ref } from 'vue';

// 折畳時を既読の起点にし、最後の変更から15秒だけシアンで知らせる。
export function createContentFoldTone({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const tone = ref('');
  let folded = false, timer, revision = 0, disposed = false;
  function cancel() { revision++; clearTimer(timer); timer = undefined; }
  function collapsed(value) {
    if (disposed || folded === !!value) return;
    folded = !!value; cancel(); tone.value = folded ? 'offline' : '';
  }
  function changed() {
    if (disposed || !folded) return;
    cancel(); tone.value = 'online';
    const current = revision;
    timer = setTimer(() => { if (!disposed && folded && current === revision) { timer = undefined; tone.value = 'success'; } }, 15_000);
  }
  function dispose() { disposed = true; cancel(); folded = false; tone.value = ''; }
  return { tone, collapsed, changed, dispose, blackExpanded: true };
}
