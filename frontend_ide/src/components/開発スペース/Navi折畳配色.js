// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { ref } from 'vue';
// Navi の折畳アイコンの配色。ナビ・再評価・コード実行・自動航行のどれかが動いている間に折畳むか、
// 折畳中に動き始めたらシアンの脈動（online）。止まったら緑（success）、エラーと判断できる場合は赤（failure）。
// 未実行で折畳んだ場合は色を付けず、展開したら色を解除する。
export function createActivityFoldTone() {
  const tone = ref('');
  let collapsed = false, active = false;
  return {
    tone,
    collapsed(value) { collapsed = !!value; tone.value = collapsed && active ? 'online' : ''; },
    activity(isActive, failed = false) {
      const was = active; active = !!isActive;
      if (!collapsed) return;
      if (active && !was) tone.value = 'online';
      else if (!active && was && tone.value === 'online') tone.value = failed ? 'failure' : 'success';
    },
    reset() { active = false; tone.value = ''; },
  };
}
