// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { computed, watch } from 'vue';
import { 完了時 } from '../共通表示/先頭表示.mjs';
import { 外部連携か, 設定表示 } from '../キー設定共通/キー設定表示.mjs';
import { 外部連携状態を作成 } from './外部連携状態.mjs';

export function 外部連携表示を作成(props) {
 const { selected } = 外部連携状態を作成();
 const items = computed(() => (props.data?.項目 || []).filter(item => 外部連携か(item)));
 const row = computed(() => items.value.find(item => item.id === selected.value));
 const result = computed(() => props.results?.[selected.value]);
 // 状況確認中は、確認している行へ選択（右側の詳細）を順に切り替える。
 watch(() => props.testing, id => { if (props.busy && id && items.value.some(item => item.id === id)) selected.value = id; });
 // 状況確認が終わったら、一覧の1項目目を表示する。
 watch(() => props.busy, 完了時(() => { selected.value = items.value[0]?.id || ''; }));
 return { selected, items, row, result, config: 設定表示 };
}
