// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  watch,
  type Ref,
} from 'vue';

/**
 * 表示中だけポーリングし、折り畳み中は通常の2倍の間隔へ落とす。
 * v-ifによるアンマウント、KeepAliveの非活性化、ブラウザータブ非表示ではタイマーを停止する。
 */
export const use表示連動ポーリング = (
  更新処理: () => void | Promise<void>,
  通常間隔ミリ秒: number,
  開いている?: Ref<boolean>,
) => {
  let timer: ReturnType<typeof setInterval> | null = null;
  let コンポーネント表示中 = false;

  const 停止 = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const 開始 = () => {
    停止();
    if (!コンポーネント表示中 || (typeof document !== 'undefined' && document.hidden)) return;
    const interval = 開いている?.value === false ? 通常間隔ミリ秒 * 2 : 通常間隔ミリ秒;
    timer = setInterval(() => void 更新処理(), interval);
  };

  const 表示状態変更 = () => {
    if (!コンポーネント表示中 || document.hidden) {
      停止();
      return;
    }
    void 更新処理();
    開始();
  };

  const watch停止 = 開いている ? watch(開いている, 開始) : null;

  onMounted(() => {
    コンポーネント表示中 = true;
    document.addEventListener('visibilitychange', 表示状態変更);
    開始();
  });

  onActivated(() => {
    コンポーネント表示中 = true;
    開始();
  });

  onDeactivated(() => {
    コンポーネント表示中 = false;
    停止();
  });

  onBeforeUnmount(() => {
    コンポーネント表示中 = false;
    停止();
    document.removeEventListener('visibilitychange', 表示状態変更);
    watch停止?.();
  });
};
