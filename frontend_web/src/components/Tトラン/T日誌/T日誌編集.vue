<!--
COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../../stores/auth';
import { qConfirm, qMessage } from '../../../utils/qAlert';
import { エラー表示, 日誌操作, ローカル日付 } from './日誌API';
import type { 日誌, 日誌明細, 日誌記録, 日誌保存 } from './日誌API';
import { 画像形式, 添付Blob, 添付サイズ, 添付を読む, 添付上限, 添付合計上限 } from './添付';

type 編集行 = Omit<日誌明細, '行SEQ'> & { key: number; preview: string };
type 編集記録 = Omit<日誌記録, '記録SEQ' | '明細'> & { key: number; 明細: 編集行[] };
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
let 次のキー = 0;
const 日付 = ref('');
const 利用者 = ref<{ 利用者ID: string; 利用者名: string } | null>(null);
const 記録 = ref<編集記録[]>([]);
const エラー = ref('');
const 操作中 = ref(false);
const 読込失敗 = ref(false);
const 未保存 = ref(false);
const 記録上限 = 30;
const 行上限 = 100;
const 編集 = computed(() => route.query.モード === '編集' || (!route.query.モード && Boolean(route.query.日付)));
let 登録直後の日付 = '';
const 行数 = computed(() => 記録.value.reduce((count, item) => count + item.明細.length, 0));
const 閉じた = ref(false);
const 一覧へ = () => router.push({
  name: 'T日誌一覧',
  query: {
    開始日付: route.query.開始日付, 終了日付: route.query.終了日付,
    件数制限: route.query.件数制限, URLメニュー: route.query.URLメニュー,
  },
});

function 表示URL(base64: string): string {
  const 形式 = 画像形式(base64);
  if (形式) {
    try { return URL.createObjectURL(添付Blob(base64, 形式)); }
    catch { /* 読めない添付にはダウンロード操作を残す。 */ }
  }
  return '';
}
function 行を作る(行?: 日誌明細): 編集行 {
  return {
    key: ++次のキー, 内容: 行?.内容 ?? '', ファイル名: 行?.ファイル名 ?? '',
    base64内容: 行?.base64内容 ?? '', preview: 行?.base64内容 ? 表示URL(行.base64内容) : '',
  };
}
function 記録を作る(item?: 日誌記録): 編集記録 {
  return { key: ++次のキー, 記録タイトル: item?.記録タイトル ?? '', 明細: item ? item.明細.map(行を作る) : [行を作る()] };
}
function 表示URL解除(行: 編集行) {
  if (行.preview) URL.revokeObjectURL(行.preview);
  行.preview = '';
}
function 表示を片付ける() {
  for (const item of 記録.value) for (const 行 of item.明細) 表示URL解除(行);
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
  for (const 行 of 記録.value[index]!.明細) 表示URL解除(行);
  記録.value.splice(index, 1);
  変更した();
}
function 行を追加(item: 編集記録) {
  if (行数.value >= 行上限) return;
  item.明細.push(行を作る());
  変更した();
}
function 行を削除(item: 編集記録, index: number) {
  表示URL解除(item.明細[index]!);
  item.明細.splice(index, 1);
  変更した();
}
function 添付を外す(行: 編集行) {
  表示URL解除(行);
  行.ファイル名 = 行.base64内容 = '';
  変更した();
}

async function 添付を選ぶ(event: Event, 行: 編集行) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || 操作中.value) return;
  エラー.value = '';
  const 他の添付サイズ = 記録.value.flatMap(item => item.明細)
    .filter(item => item.key !== 行.key).reduce((sum, item) => sum + 添付サイズ(item.base64内容), 0);
  if (!file.size || file.size > 添付上限 || 他の添付サイズ + file.size > 添付合計上限) {
    エラー.value = '添付は空でないファイルを選び、1件5 MiB、日誌全体で15 MiB以内にしてください。';
    return;
  }
  if (Array.from(file.name).length > 255) {
    エラー.value = 'ファイル名は255文字以内にしてください。';
    return;
  }
  操作中.value = true;
  try {
    const base64 = await 添付を読む(file);
    if (閉じた.value) return;
    表示URL解除(行);
    行.ファイル名 = file.name;
    行.base64内容 = base64;
    行.preview = 表示URL(base64);
    変更した();
  } catch (e) {
    エラー.value = エラー表示(e, '添付の読み込みに失敗しました。');
  } finally {
    操作中.value = false;
  }
}
function ダウンロード(行: 編集行) {
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
  日付.value = data.日付;
  表示を片付ける();
  記録.value = data.記録.map(記録を作る);
}
async function 読み込み() {
  表示を片付ける();
  記録.value = [];
  未保存.value = 読込失敗.value = false;
  エラー.value = '';
  利用者.value = null;
  const query = route.query.日付;
  const 対象日付 = typeof query === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query) ? query : '';
  日付.value = 対象日付 || ローカル日付();
  if (!編集.value) {
    記録.value = [記録を作る()];
    return;
  }
  if (!対象日付) {
    読込失敗.value = true;
    エラー.value = '編集する日付が指定されていません。一覧から選んでください。';
    return;
  }
  操作中.value = true;
  try {
    const data = await 日誌操作<日誌>('取得', { 日付: 対象日付 });
    if (!閉じた.value) 日誌を表示(data);
  } catch (e) {
    読込失敗.value = true;
    エラー.value = エラー表示(e, '日誌の取得に失敗しました。');
  } finally {
    操作中.value = false;
  }
}
function 保存内容(): 日誌保存 {
  if (!日付.value || !記録.value.length || 記録.value.some(item => !item.記録タイトル.trim())) {
    throw new Error('日付と、各記録のタイトルを入力してください。');
  }
  return {
    日付: 日付.value,
    記録: 記録.value.map((item, i) => ({
      記録SEQ: i + 1, 記録タイトル: item.記録タイトル.trim(),
      明細: item.明細.filter(行 => 行.内容.trim() || 行.base64内容).map((行, j) => ({
        行SEQ: j + 1, 内容: 行.内容, ファイル名: 行.ファイル名, base64内容: 行.base64内容,
      })),
    })),
  };
}
async function 保存() {
  if (操作中.value || 読込失敗.value) return;
  エラー.value = '';
  操作中.value = true;
  try {
    const data = await 日誌操作<日誌>(編集.value ? '変更' : '登録', 保存内容());
    if (閉じた.value) return;
    日誌を表示(data);
    未保存.value = false;
    操作中.value = false;
    if (!編集.value) {
      登録直後の日付 = data.日付;
      try {
        await router.replace({ name: 'T日誌編集', query: { ...route.query, モード: '編集', 日付: data.日付 } });
      } finally {
        登録直後の日付 = '';
      }
    }
    void qMessage('日誌を保存しました。');
  } catch (e) {
    エラー.value = エラー表示(e, '日誌の保存に失敗しました。');
  } finally {
    操作中.value = false;
  }
}
async function 日誌を削除() {
  if (操作中.value || !編集.value || 読込失敗.value) return;
  if (!await qConfirm(`${日付.value}の日誌を削除しますか？記録・明細・添付も削除されます。`)) return;
  if (閉じた.value || 操作中.value) return;
  エラー.value = '';
  操作中.value = true;
  try {
    await 日誌操作('削除', { 日付: 日付.value });
    未保存.value = false;
    操作中.value = false;
    await 一覧へ();
    void qMessage('日誌を削除しました。');
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
  to.query.日付 !== from.query.日付 || to.query.モード !== from.query.モード
) ? 遷移確認() : true);
watch(() => [route.query.日付, route.query.モード], ([次の日付, 次のモード]) => {
  if (登録直後の日付 && 次の日付 === 登録直後の日付 && 次のモード === '編集') return;
  void 読み込み();
});
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
      <span>【 T日誌 {{ 編集 ? '編集' : '新規' }} 】</span>
      <button type="button" class="btn btn-secondary" :disabled="操作中" @click="一覧へ">一覧へ</button>
    </h2>
    <p v-if="エラー" role="alert" class="error">{{ エラー }}</p>
    <button v-if="読込失敗 && route.query.日付" class="btn btn-secondary" :disabled="操作中" @click="読み込み">再読み込み</button>
    <p v-if="操作中" role="status">処理中…</p>
    <form v-if="!読込失敗 && 記録.length" class="diary-editor" @submit.prevent="保存">
      <fieldset :disabled="操作中">
        <div class="actions diary-header">
          <label>日付 <input v-model="日付" type="date" required :readonly="編集" @input="変更した"></label>
          <span>利用者: {{ (利用者 ?? auth.user)?.利用者ID }} {{ (利用者 ?? auth.user)?.利用者名 }}</span>
          <span v-if="未保存" class="dirty" role="status">未保存</span>
        </div>
        <section v-for="(item, i) in 記録" :key="item.key" class="diary-record" :aria-label="`記録 ${i + 1}`">
          <header class="actions record-heading">
            <label class="record-title">
              <span>記録 {{ i + 1 }} タイトル</span>
              <input v-model="item.記録タイトル" type="text" maxlength="200" required @input="変更した">
            </label>
            <button v-if="記録.length > 1" type="button" class="btn btn-secondary" @click="記録を削除(i)">記録を外す</button>
          </header>
          <div v-for="(行, j) in item.明細" :key="行.key" class="diary-line">
            <label>
              <span>明細 {{ j + 1 }} 内容</span>
              <textarea v-model="行.内容" rows="3" maxlength="10000" @input="変更した"></textarea>
            </label>
            <div class="actions">
              <label>添付 <input type="file" :aria-label="`記録 ${i + 1} 明細 ${j + 1} の添付`" @change="添付を選ぶ($event, 行)"></label>
              <button type="button" class="btn btn-secondary" @click="行を削除(item, j)">明細を外す</button>
            </div>
            <div v-if="行.ファイル名" class="actions attachment">
              <button type="button" class="btn btn-secondary filename" @click="ダウンロード(行)">{{ 行.ファイル名 }} を保存</button>
              <button type="button" class="btn btn-secondary" @click="添付を外す(行)">添付を外す</button>
            </div>
            <img v-if="行.preview" :src="行.preview" :alt="`添付画像: ${行.ファイル名}`" class="preview"
              @error="表示URL解除(行)">
          </div>
          <button type="button" class="btn btn-secondary" :disabled="行数 >= 行上限" @click="行を追加(item)">明細を追加</button>
        </section>
        <div class="actions">
          <button type="button" class="btn btn-secondary" :disabled="記録.length >= 記録上限" @click="記録を追加">記録を追加</button>
          <span class="help">添付は1ファイル5 MiB、日誌全体で15 MiBまで。</span>
        </div>
        <div class="actions diary-footer">
          <button type="submit" class="btn btn-primary">保存</button>
          <button v-if="編集" type="button" class="btn btn-danger" @click="日誌を削除">日誌を削除</button>
        </div>
      </fieldset>
    </form>
  </div>
</template>

<style scoped src="./日誌.css"></style>
<style scoped>
.diary-editor > fieldset{display:grid;gap:16px}
.diary-header,.diary-record,.diary-line{border:1px solid var(--border-color,#c8d0d6);padding:12px}
.diary-record,.diary-line{display:grid;gap:10px;justify-items:start;min-width:0}
.record-heading,.diary-line,.diary-line > label{width:100%}
.record-heading .record-title{flex:1;min-width:min(100%,240px);flex-wrap:wrap}
.record-title input{flex:1;min-width:100px}
.diary-line > label{display:grid;gap:4px}
textarea{width:100%;resize:vertical}
.diary-footer{padding-top:8px;border-top:1px solid var(--border-color,#c8d0d6)}
.preview{max-width:100%;max-height:220px;object-fit:contain}
.filename{overflow-wrap:anywhere;max-width:100%;text-align:start}
.attachment{max-width:100%}
.help,.dirty{font-size:.85em}
</style>
