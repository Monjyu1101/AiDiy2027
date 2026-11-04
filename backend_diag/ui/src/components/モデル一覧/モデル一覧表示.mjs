// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { computed, watch } from 'vue';
import { 外部連携か, 確認不要か, 設定表示 } from '../キー設定共通/キー設定表示.mjs';
import { モデル一覧状態を作成 } from './モデル一覧状態.mjs';
import { 完了時 } from '../共通表示/先頭表示.mjs';

export function モデル一覧表示を作成(props) {
 const { selected } = モデル一覧状態を作成();
 const items = computed(() => (props.data?.項目 || []).filter(item => !外部連携か(item) && !確認不要か(item)));
 const row = computed(() => items.value.find(item => item.id === selected.value));
 const result = computed(() => props.results?.[selected.value]);
 // 公開モデル一覧の取得状態。ネットワーク取得は OK、同梱キャッシュはキャッシュ利用。
 const 公開状態 = computed(() => props.publicModels?.状態 === '取得済' ? (props.publicModels.取得元 === 'キャッシュ' ? 'キャッシュ利用' : 'OK') : props.publicModels?.状態 || '未取得');
 // 一覧再取得中は、取得している行へ選択（右側のモデル一覧）を順に切り替える。
 watch(() => props.testing, id => { if (props.latestBusy && id && items.value.some(item => item.id === id)) selected.value = id; });
 // 一覧再取得が終わったら、一覧の1項目目を表示する。
 watch(() => props.latestBusy, 完了時(() => { selected.value = items.value[0]?.id || ''; }));
 // 設定状況の説明は「接続は未確認」だが、テスト（OK / NG）後は接続を試した旨に置き換えて矛盾させない。
 const 確認内容 = computed(() => ['OK', 'NG'].includes(result.value?.状態) ? String(row.value?.説明 || '').replace('接続は未確認です。', '接続はテストで確認しました（結果は「テスト」欄）。') : row.value?.説明);
 return { selected, items, row, result, config: 設定表示, 公開状態, 確認内容 };
}
