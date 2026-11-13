// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { ref } from 'vue';

// v-show で画面を切り替えても、設定更新中も選択を維持する。
export function 外部連携状態を作成() { return { selected: ref('') }; }
