// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { nextTick } from 'vue';

// 右上ボタンの一括処理が終わったら、パネル内の一覧・詳細を先頭の表示へ戻す。
export async function 先頭へスクロール(panel) {
  await nextTick();
  for (const element of panel?.querySelectorAll(':scope > main > aside, :scope > main > article') || []) element.scrollTop = 0;
}

// 実行中フラグが true から false へ変わったとき（一括処理の完了時）だけ呼ぶ。
export const 完了時 = callback => (now, before) => { if (before && !now) callback(); };
