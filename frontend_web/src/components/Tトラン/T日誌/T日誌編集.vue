<!--
COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../../stores/auth';
import { qConfirm } from '../../../utils/qAlert';
import { 画面遷移先 } from './日誌画面';
import { saveReturnMessage } from '../../../utils/listSessionState';
import { エラー表示, 日誌操作, ローカル日付 } from './日誌API';
import type { 日誌, 日誌明細, 日誌記録, 日誌保存, 日誌添付 } from './日誌API';
import { 画像形式, 添付Blob, 添付サイズ, 添付を読む, 添付上限, 添付合計上限 } from './添付';

type 編集添付 = 日誌添付 & { key: number; preview: string };
type 編集行 = { key: number; 展開: boolean; 作業内容: string; 添付: 編集添付[]; ドラッグ数: number };
type 編集記録 = Omit<日誌記録, '作業ID' | '明細' | '作業時間' | '新規更新ファイル数'> & { key: number; 作業ID: number | null; 展開: boolean; 明細: 編集行[]; 時間入力: string; 件数入力: string };
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
let 次のキー = 0;
const 日誌日付 = ref('');
const 更新版 = ref('');
type 利用者項目 = { 利用者ID: string; 利用者名: string };
const 利用者 = ref<利用者項目 | null>(null);
const 選択利用者ID = ref('');
const 候補 = ref<利用者項目[]>([]);
const 候補エラー = ref('');
async function 候補を取得() {
  候補エラー.value = '';
  操作中.value = true;
  try {
    候補.value = await 日誌操作<利用者項目[]>('利用者候補');
  } catch (e) {
    候補エラー.value = エラー表示(e, '利用者の候補を取得できませんでした。');
  } finally {
    操作中.value = false;
  }
}
const 記録 = ref<編集記録[]>([]);
const エラー = ref('');
const 操作中 = ref(false);
const 読込失敗 = ref(false);
const 未保存 = ref(false);
const 記録上限 = 30;
const 行上限 = 100;
const 明細添付件数上限 = 20;
const 編集 = computed(() => route.query.モード === '編集' || (!route.query.モード && Boolean(route.query.日誌日付)));
const 行数 = computed(() => 記録.value.reduce((count, item) => count + item.明細.length, 0));
const 閉じた = ref(false);
const メニュー = computed(() => 画面遷移先(router, route.query.URLメニュー) || '/Tトラン');
const 戻り先 = computed(() => 画面遷移先(router, route.query.URL戻り先));
const 一覧へ = () => 日誌一覧へ移動();
const 日誌一覧へ移動 = (message?: string) => {
  const 戻り先一覧 = 戻り先.value && router.resolve(戻り先.value).name === 'T日誌一覧';
  const target = 戻り先一覧 ? 戻り先.value : router.resolve({ name: 'T日誌一覧' }).fullPath;
  if (message) saveReturnMessage(target, message, 'success');
  return router.push(target);
};

function 表示URL(base64: string): string {
  const 形式 = 画像形式(base64);
  if (形式) {
    try { return URL.createObjectURL(添付Blob(base64, 形式)); }
    catch { /* 読めない添付にはダウンロード操作を残す。 */ }
  }
  return '';
}
function 添付を作る(file: 日誌添付): 編集添付 {
  return { ...file, key: ++次のキー, preview: 表示URL(file.base64内容) };
}
function 行を作る(行?: 日誌明細, 展開 = !行): 編集行 {
  return {
    key: ++次のキー, 展開, 作業内容: 行?.作業内容 ?? '', 添付: (行?.添付 ?? []).map(添付を作る), ドラッグ数: 0,
  };
}
function 記録を作る(item?: 日誌記録, 展開 = true): 編集記録 {
  return {
    key: ++次のキー, 展開, 作業ID: item?.作業ID ?? null, プロジェクト: item?.プロジェクト ?? '', 作業タイトル: item?.作業タイトル ?? '', 時間入力: item?.作業時間?.toFixed(2) ?? '', 件数入力: item?.新規更新ファイル数?.toString() ?? '',
    明細: item ? item.明細.map(行 => 行を作る(行)) : [行を作る()],
  };
}
function 有効な明細(行: 編集行) {
  return Boolean(行.作業内容.trim() || 行.添付.length);
}
function 明細見出し(行: 編集行) {
  const 要約 = 行.作業内容.trim().replace(/\s+/g, ' ');
  return 要約 || 行.添付[0]?.ファイル名 || '未入力';
}
function 表示URL解除(file: 編集添付) {
  if (file.preview) URL.revokeObjectURL(file.preview);
  file.preview = '';
}
function 行の表示URL解除(行: 編集行) { 行.添付.forEach(表示URL解除); }
function 表示を片付ける() {
  for (const item of 記録.value) for (const 行 of item.明細) 行の表示URL解除(行);
}
function 変更した() { 未保存.value = true; }
function 記録を追加() {
  if (記録.value.length >= 記録上限) return;
  const item = 記録を作る();
  if (行数.value >= 行上限) item.明細 = [];
  記録.value.push(item);
  変更した();
}
function 記録を削除(index: number) {
  for (const 行 of 記録.value[index]!.明細) 行の表示URL解除(行);
  記録.value.splice(index, 1);
  変更した();
}
function 行を追加(item: 編集記録) {
  if (行数.value >= 行上限) return;
  item.明細.push(行を作る());
  変更した();
}
function 行を削除(item: 編集記録, index: number) {
  行の表示URL解除(item.明細[index]!);
  item.明細.splice(index, 1);
  変更した();
}
function 添付を外す(行: 編集行, index: number) {
  const [file] = 行.添付.splice(index, 1);
  if (file) 表示URL解除(file);
  変更した();
}

function 添付を選ぶ(event: Event, 行: 編集行) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  void 添付を追加(files, 行);
}
function ファイルドラッグ(event: DragEvent) {
  return event.dataTransfer?.types.includes('Files') ?? false;
}
function 添付ドラッグ開始(event: DragEvent, 行: 編集行) {
  if (ファイルドラッグ(event) && !操作中.value) 行.ドラッグ数 += 1;
}
function 添付ドラッグ終了(event: DragEvent, 行: 編集行) {
  if (ファイルドラッグ(event)) 行.ドラッグ数 = Math.max(0, 行.ドラッグ数 - 1);
}
function 添付ドラッグ中(event: DragEvent) {
  if (event.dataTransfer && ファイルドラッグ(event)) {
    event.dataTransfer.dropEffect = 操作中.value ? 'none' : 'copy';
  }
}
function 添付をドロップ(event: DragEvent, 行: 編集行) {
  行.ドラッグ数 = 0;
  void 添付を追加(Array.from(event.dataTransfer?.files ?? []), 行);
}

async function 添付を追加(files: File[], 行: 編集行) {
  if (!files.length || 操作中.value) return;
  エラー.value = '';
  if (行.添付.length + files.length > 明細添付件数上限) {
    エラー.value = `明細1行の添付は${明細添付件数上限}ファイルまでです。`;
    return;
  }
  const 既存サイズ = 記録.value.flatMap(item => item.明細).flatMap(item => item.添付)
    .reduce((sum, file) => sum + 添付サイズ(file.base64内容), 0);
  if (files.some(file => !file.size || file.size > 添付上限)
      || 既存サイズ + files.reduce((sum, file) => sum + file.size, 0) > 添付合計上限) {
    エラー.value = '添付は空でないファイルを選び、1件5 MiB、日誌全体で15 MiB以内にしてください。';
    return;
  }
  if (files.some(({ name }) => !name.trim() || name === '.' || name === '..' || Array.from(name).length > 255
      || [...name].some(c => '/\\:'.includes(c) || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) {
    エラー.value = 'ファイル名は255文字以内で、パスや制御文字を含まない名前にしてください。';
    return;
  }
  操作中.value = true;
  try {
    const data = await Promise.all(files.map(async file => ({ ファイル名: file.name, base64内容: await 添付を読む(file) })));
    if (閉じた.value) return;
    行.添付.push(...data.map(添付を作る));
    変更した();
  } catch (e) {
    エラー.value = エラー表示(e, '添付の読み込みに失敗しました。');
  } finally {
    操作中.value = false;
  }
}
function ダウンロード(行: 編集添付) {
  try {
    // 保存したファイルは常にダウンロード。HTMLやSVGを同一オリジンで開かない。
    const url = URL.createObjectURL(添付Blob(行.base64内容));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 行.ファイル名.replace(/[\\/]/g, '_');
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    エラー.value = '添付ファイルをダウンロードできませんでした。';
  }
}

function 日誌を表示(data: 日誌) {
  利用者.value = { 利用者ID: data.利用者ID, 利用者名: data.利用者名 };
  選択利用者ID.value = data.利用者ID;
  日誌日付.value = data.日誌日付;
  更新版.value = data.更新版;
  表示を片付ける();
  記録.value = data.記録.map((item, i) => 記録を作る(item, i === 0));
}
async function 読み込み() {
  表示を片付ける();
  記録.value = [];
  未保存.value = 読込失敗.value = false;
  エラー.value = '';
  利用者.value = null;
  選択利用者ID.value = auth.user?.利用者ID ?? '';
  候補.value = [];
  候補エラー.value = '';
  更新版.value = '';
  const query = route.query.日誌日付;
  const 対象日付 = typeof query === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query) ? query : '';
  日誌日付.value = 対象日付 || ローカル日付();
  if (!編集.value) {
    記録.value = [記録を作る()];
    await 候補を取得();
    return;
  }
  if (!対象日付) {
    読込失敗.value = true;
    エラー.value = '編集する日付が指定されていません。一覧から選んでください。';
    return;
  }
  操作中.value = true;
  try {
    const 対象ID = typeof route.query.利用者ID === 'string' ? route.query.利用者ID : 選択利用者ID.value;
    const data = await 日誌操作<日誌>('取得', { 日誌日付: 対象日付, 利用者ID: 対象ID });
    if (!閉じた.value) 日誌を表示(data);
  } catch (e) {
    読込失敗.value = true;
    エラー.value = エラー表示(e, '日誌の取得に失敗しました。');
  } finally {
    操作中.value = false;
  }
}
const 作業時間形式 = /^[0-9]{1,2}(?:\.[0-9]{1,2})?$/;

function 保存内容(): 日誌保存 {
  if (!日誌日付.value || !選択利用者ID.value || !記録.value.length) throw new Error('日付・利用者・作業を入力してください。');
  const 未入力 = 記録.value.findIndex(item => !item.作業タイトル.trim());
  if (未入力 >= 0) {
    const item = 記録.value[未入力]!;
    item.展開 = true;
    void nextTick(() => document.getElementById(`diary-title-${item.key}`)?.focus());
    throw new Error(`作業 ${未入力 + 1} のタイトルを入力してください。`);
  }
  const 不正時間 = 記録.value.findIndex(item => item.時間入力.trim() !== '' && !作業時間形式.test(item.時間入力.trim()));
  if (不正時間 >= 0) {
    const item = 記録.value[不正時間]!;
    item.展開 = true;
    void nextTick(() => document.getElementById(`diary-hours-${item.key}`)?.focus());
    throw new Error(`作業 ${不正時間 + 1} の作業時間(h)は0〜99.99の範囲で、小数第2位まで入力してください。`);
  }
  const 不正件数 = 記録.value.findIndex(item => item.件数入力.trim() !== '' && (
    !/^[0-9]+$/.test(item.件数入力.trim()) || !Number.isSafeInteger(Number(item.件数入力))
  ));
  if (不正件数 >= 0) {
    const item = 記録.value[不正件数]!;
    item.展開 = true;
    void nextTick(() => document.getElementById(`diary-count-${item.key}`)?.focus());
    throw new Error(`作業 ${不正件数 + 1} の新規・更新ファイル数は0以上の整数を入力してください。`);
  }
  return {
    日誌日付: 日誌日付.value, 利用者ID: 選択利用者ID.value, ...(編集.value ? { 更新版: 更新版.value } : {}),
    記録: 記録.value.map(item => ({
      作業ID: item.作業ID, プロジェクト: item.プロジェクト, 作業タイトル: item.作業タイトル.trim(),
      作業時間: item.時間入力.trim() === '' ? null : Number(item.時間入力), 新規更新ファイル数: item.件数入力.trim() === '' ? null : Number(item.件数入力),
      明細: item.明細.filter(有効な明細).map((行, j) => ({
        行番号: j + 1, 作業内容: 行.作業内容, 添付: 行.添付.map(({ ファイル名, base64内容 }) => ({ ファイル名, base64内容 })),
      })),
    })),
  };
}
async function 保存() {
  if (操作中.value || 読込失敗.value) return;
  エラー.value = '';
  操作中.value = true;
  try {
    const 更新 = 編集.value;
    const data = await 日誌操作<日誌>(更新 ? '変更' : '登録', 保存内容());
    if (閉じた.value) return;
    更新版.value = data.更新版;
    未保存.value = false;
    操作中.value = false;
    await 日誌一覧へ移動(更新 ? '日誌を更新しました。' : '日誌を登録しました。');
  } catch (e) {
    エラー.value = エラー表示(e, '日誌の保存に失敗しました。');
  } finally {
    操作中.value = false;
  }
}
async function 日誌を削除() {
  if (操作中.value || !編集.value || 読込失敗.value) return;
  if (!await qConfirm(`${日誌日付.value}の ${利用者.value?.利用者名 ?? 選択利用者ID.value} の日誌を削除しますか？記録・明細・添付も削除されます。`)) return;
  if (閉じた.value || 操作中.value) return;
  エラー.value = '';
  操作中.value = true;
  try {
    await 日誌操作('削除', { 日誌日付: 日誌日付.value, 利用者ID: 選択利用者ID.value });
    未保存.value = false;
    操作中.value = false;
    await 日誌一覧へ移動('日誌を削除しました。');
  } catch (e) {
    エラー.value = エラー表示(e, '日誌の削除に失敗しました。');
  } finally {
    操作中.value = false;
  }
}
function ページ離脱(event: BeforeUnloadEvent) {
  if (!未保存.value) return;
  event.preventDefault();
  event.returnValue = true;
}
async function 遷移確認() {
  // 処理中に別の利用者・日付へ誤って内容を移さない。
  if (操作中.value && auth.isAuthenticated) return false;
  if (!auth.isAuthenticated || !未保存.value) return true;
  return qConfirm('未保存の変更を破棄して移動しますか？');
}
onBeforeRouteLeave(遷移確認);
onBeforeRouteUpdate((to, from) => (
  to.query.日誌日付 !== from.query.日誌日付 || to.query.モード !== from.query.モード || to.query.利用者ID !== from.query.利用者ID
) ? 遷移確認() : true);
watch(() => [route.query.日誌日付, route.query.モード, route.query.利用者ID], 読み込み);
onMounted(() => {
  window.addEventListener('beforeunload', ページ離脱);
  void 読み込み();
});
onBeforeUnmount(() => {
  閉じた.value = true;
  window.removeEventListener('beforeunload', ページ離脱);
  表示を片付ける();
});
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">
      <span class="title-text">【 T日誌 】{{ 編集 ? '編集' : '新規登録' }}</span>
      <div class="header-actions">
        <button type="button" class="btn-menu" :disabled="操作中" @click="router.push(メニュー)">メニュー</button>
        <button v-if="戻り先 && 戻り先 !== メニュー" type="button" class="btn-return"
          :disabled="操作中" @click="router.resolve(戻り先).name === 'T日誌一覧' ? 一覧へ() : router.push(戻り先)">戻る</button>
      </div>
    </h2>
    <div class="content editor-content">
      <section class="section">
        <div class="toolbar">
          <button type="button" class="btn btn-secondary" :disabled="操作中" @click="一覧へ">一覧に戻る</button>
          <button v-if="読込失敗 && route.query.日誌日付" type="button" class="btn btn-primary"
            :disabled="操作中" @click="読み込み">再読み込み</button>
          <span v-if="未保存" class="dirty" role="status">未保存</span>
          <span v-if="操作中" role="status">処理中…</span>
        </div>
        <p v-if="エラー" role="alert" class="message-error">{{ エラー }}</p>
        <form v-if="!読込失敗 && 記録.length" class="detail-form diary-editor" @submit.prevent="保存">
          <fieldset :disabled="操作中">
            <div class="diary-header">
              <label class="detail-row">
                <span class="detail-label">日誌日付<span v-if="!編集" class="required-mark">*</span></span>
                <span class="detail-value">
                  <input v-model="日誌日付" class="detail-input date-input" type="date" required :readonly="編集" @input="変更した">
                </span>
              </label>
              <label class="detail-row">
                <span class="detail-label">利用者<span v-if="!編集" class="required-mark">*</span></span>
                <span v-if="編集" class="detail-value">
                  <span class="diary-user-display">{{ 利用者?.利用者ID }} : {{ 利用者?.利用者名 }}</span>
                </span>
                <span v-else class="detail-value">
                  <select v-model="選択利用者ID" class="detail-input" required @change="変更した">
                    <option value="" disabled>利用者を選択</option>
                    <option v-if="auth.user && !候補.some(row => row.利用者ID === auth.user?.利用者ID)" :value="auth.user.利用者ID">
                      {{ auth.user.利用者ID }} : {{ auth.user.利用者名 }}
                    </option>
                    <option v-for="row in 候補" :key="row.利用者ID" :value="row.利用者ID">{{ row.利用者ID }} : {{ row.利用者名 }}</option>
                  </select>
                </span>
              </label>
              <p v-if="候補エラー" role="alert" class="message-error">
                {{ 候補エラー }} <button type="button" class="btn btn-secondary" @click="候補を取得">再取得</button>
              </p>
            </div>
            <section v-for="(item, i) in 記録" :key="item.key" class="diary-record" :aria-label="`作業 ${i + 1}`">
              <div class="fold-bar record-bar">
                <button type="button" class="fold-toggle" :aria-expanded="item.展開"
                  :aria-controls="`diary-record-${item.key}`" @click="item.展開 = !item.展開">
                  <span aria-hidden="true">{{ item.展開 ? '▽' : '▶' }}</span>
                  <span>作業 {{ i + 1 }}</span>
                  <template v-if="!item.展開">
                    <span class="fold-label">{{ item.作業タイトル.trim() || 'タイトル未入力' }}</span>
                    <span v-if="作業時間形式.test(item.時間入力.trim())" class="fold-count">{{ Number(item.時間入力).toFixed(2) }} h</span>
                    <span v-if="/^[0-9]+$/.test(item.件数入力.trim())" class="fold-count">更新 {{ item.件数入力.trim() }}件</span>
                    <span class="fold-count">明細 {{ item.明細.length }}件</span>
                  </template>
                </button>
                <input v-if="item.展開" :id="`diary-title-${item.key}`" v-model="item.作業タイトル" type="text"
                  :aria-label="`作業 ${i + 1} の作業タイトル`" maxlength="200" placeholder="作業タイトル"
                  aria-required="true" @input="変更した">
              </div>
              <div v-show="item.展開" :id="`diary-record-${item.key}`" class="fold-body">
                <header class="actions record-heading">
                  <label class="detail-row record-project">
                    <span class="detail-label">プロジェクト</span>
                    <span class="detail-value">
                      <input v-model="item.プロジェクト" type="text" maxlength="4096" autocomplete="off"
                        spellcheck="false" @input="変更した">
                    </span>
                  </label>
                  <label class="detail-row record-hours">
                    <span class="detail-label">作業時間(h)</span>
                    <span class="detail-value">
                      <input :id="`diary-hours-${item.key}`" v-model="item.時間入力" type="text" inputmode="decimal"
                        placeholder="n.nn" @input="変更した">
                    </span>
                  </label>
                  <label class="detail-row record-count">
                    <span class="detail-label">新規・更新F数</span>
                    <span class="detail-value">
                      <input :id="`diary-count-${item.key}`" v-model="item.件数入力" type="text" inputmode="numeric"
                        maxlength="16" @input="変更した">
                    </span>
                  </label>
                  <button v-if="記録.length > 1" type="button" class="btn btn-secondary" @click="記録を削除(i)">作業を外す</button>
                </header>
                <div v-for="(行, j) in item.明細" :key="行.key" class="diary-line">
                  <div class="fold-bar line-bar">
                    <button type="button" class="fold-toggle" :aria-expanded="行.展開"
                      :aria-controls="`diary-line-${行.key}`" @click="行.展開 = !行.展開">
                      <span aria-hidden="true">{{ 行.展開 ? '▽' : '▶' }}</span>
                      <span>明細 {{ j + 1 }}</span>
                      <template v-if="!行.展開">
                        <span class="fold-label">{{ 明細見出し(行) }}</span>
                        <span v-if="行.添付.length" class="fold-count">添付 {{ 行.添付.length }}件</span>
                      </template>
                    </button>
                    <textarea v-if="行.展開" v-model="行.作業内容" rows="3" maxlength="10000" placeholder="作業内容"
                      :aria-label="`作業 ${i + 1} 明細 ${j + 1} の作業内容`" @input="変更した"></textarea>
                    <button type="button" class="btn btn-danger btn-remove-line" @click="行を削除(item, j)">明細を外す</button>
                  </div>
                  <div v-show="行.展開" :id="`diary-line-${行.key}`" class="fold-body line-body">
                    <div class="line-attachments" :class="{ 'has-attachments': 行.添付.length > 0 }">
                      <ul v-if="行.添付.length" class="attachment-list" tabindex="0"
                        :aria-label="`作業 ${i + 1} 明細 ${j + 1} の添付一覧`">
                        <li v-for="(file, index) in 行.添付" :key="file.key">
                          <div class="actions attachment">
                            <button type="button" class="btn btn-secondary filename" @click="ダウンロード(file)">{{ file.ファイル名 }} を保存</button>
                            <button type="button" class="btn btn-secondary" :aria-label="`${file.ファイル名} を外す`"
                              @click="添付を外す(行, index)">添付を外す</button>
                          </div>
                          <img v-if="file.preview" :src="file.preview" :alt="`添付画像: ${file.ファイル名}`" class="preview"
                            @error="表示URL解除(file)">
                        </li>
                      </ul>
                      <label class="drop-zone" :class="{ 'drag-active': 行.ドラッグ数 > 0 }" title="ファイルを選択、またはドロップ（複数可）"
                        @dragenter.prevent="添付ドラッグ開始($event, 行)" @dragover.prevent="添付ドラッグ中"
                        @dragleave="添付ドラッグ終了($event, 行)" @drop.prevent.stop="添付をドロップ($event, 行)">
                        <span aria-hidden="true">{{ 行.添付.length ? '＋' : 'ファイルを選択、またはここにドロップ（複数可）' }}</span>
                        <input type="file" multiple :aria-label="`作業 ${i + 1} 明細 ${j + 1} の添付`" @change="添付を選ぶ($event, 行)">
                      </label>
                    </div>
                  </div>
                </div>
                <button type="button" class="btn btn-add-row" :disabled="行数 >= 行上限" @click="行を追加(item)">明細を追加</button>
              </div>
            </section>
            <div class="actions">
              <button type="button" class="btn btn-add-row" :disabled="記録.length >= 記録上限" @click="記録を追加">作業を追加</button>
              <span class="help">添付は明細1行20ファイル、1ファイル5 MiB、日誌全体15 MiBまで。</span>
            </div>
            <div class="form-buttons">
              <button type="submit" class="btn btn-success">{{ 編集 ? '更新' : '登録' }}</button>
              <button v-if="編集" type="button" class="btn btn-danger" @click="日誌を削除">削除</button>
            </div>
          </fieldset>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped src="./日誌.css"></style>
<style scoped>
.diary-editor{--diary-input-height:28px;--diary-fold-bg:#37474f}
.diary-editor > fieldset{display:grid;gap:16px}
.diary-record,.diary-line{border:1px solid var(--border-color,#c8d0d6);min-width:0}
.diary-header{width:fit-content;max-width:100%}
.diary-header .detail-row + .detail-row{margin-top:-1px}
.diary-header .detail-label{padding-block:4px}
.diary-header .detail-input,.record-heading input,.record-bar > input{height:var(--diary-input-height);margin:0;padding-block:0}
.diary-user-display{display:flex;align-items:center;min-height:var(--diary-input-height);min-width:0;overflow-wrap:anywhere}
.fold-body{padding:12px;background:#fff}
.fold-body{border-top:1px solid var(--border-color,#c8d0d6);display:grid;gap:10px;min-width:0;justify-items:start}
.fold-bar{display:flex;align-items:center;min-width:0;background:var(--diary-fold-bg)}
.fold-bar > .fold-toggle[aria-expanded="true"]{width:auto;flex:none}
.record-bar > input{flex:1;min-width:0;margin-inline-end:12px}
.fold-toggle{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:8px 12px;border:0;
  color:#fff;background:var(--diary-fold-bg);font:inherit;text-align:left;cursor:pointer}
.fold-toggle:hover{background:#455a64}
.fold-toggle:focus-visible{outline:2px solid currentColor;outline-offset:-2px}
.fold-toggle > :not(.fold-label){flex:none}
.fold-label{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
.fold-count{font-size:.85em}
.record-heading,.diary-line,.line-attachments{width:100%}
.record-heading .detail-row{align-items:stretch;gap:0}
.record-heading .detail-label{width:auto;min-width:0;padding:4px 8px;white-space:nowrap}
.record-heading .detail-value{padding:4px 6px}
.record-heading .record-project{flex:1 0 min(100%,240px);min-width:0}
.record-project input{width:100%}
.record-hours input{width:4.5em}
.record-count input{width:5em}
.btn-add-row{background:#2563eb;color:#fff}
.btn-add-row:hover:not(:disabled){background:#1d4ed8}
.line-bar textarea{flex:1;min-width:0;margin:6px 12px 6px 0;resize:vertical}
.line-bar > .btn-remove-line{flex:none;margin-inline-end:8px;padding:5px 8px;font-size:12px;white-space:nowrap}
.preview{max-width:100%;max-height:220px;object-fit:contain}
.filename{overflow-wrap:anywhere;max-width:100%;text-align:start}
.attachment{max-width:100%}
.line-attachments{display:grid;justify-items:center;align-items:start;min-width:0}
.line-attachments.has-attachments{grid-template-columns:minmax(0,1fr) 20%;gap:8px}
.drop-zone{position:relative;box-sizing:border-box;display:grid;place-items:center;text-align:center;
  min-height:44px;max-width:100%;padding:8px;border:2px dashed var(--border-color,#8a9ca9);border-radius:6px}
.has-attachments .drop-zone{width:100%;min-width:0;padding-inline:0;font-size:20px}
.drop-zone:focus-within,.drop-zone.drag-active{border-color:#2689b3;background:color-mix(in srgb,#2689b3 12%,transparent)}
.drop-zone input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.attachment-list{box-sizing:border-box;width:100%;min-width:0;list-style:none;margin:0;padding:2px 0 6px;
  display:flex;align-items:flex-start;gap:8px;overflow-x:auto;overscroll-behavior-inline:contain}
.attachment-list:focus-visible{outline:2px solid #2689b3;outline-offset:-2px}
.attachment-list > li{box-sizing:border-box;flex:0 0 min(184px,85%);min-width:0;padding:8px;
  border:1px solid var(--border-color,#c8d0d6);border-radius:4px}
.attachment-list .btn{padding:4px 8px;font-size:12px}
.help,.dirty{font-size:.85em}
</style>
