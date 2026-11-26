<!--
COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import QTable from '../../_share/qTublerFrame.vue';
import type { Column } from '../../../types/qTubler';
import { エラー表示, 日誌操作, ローカル日付 } from './日誌API';
import type { 日誌一覧 } from './日誌API';
import { 画面遷移先 } from './日誌画面';

const route = useRoute();
const router = useRouter();
const 日付値 = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
const 開始日付 = ref(日付値(route.query.開始日付));
const 終了日付 = ref(日付値(route.query.終了日付));
const 件数制限 = ref(route.query.件数制限 !== 'false');
const 結果 = ref<日誌一覧>({ items: [], total: 0, limit: null });
const 読込中 = ref(false);
const エラー = ref('');
const 並び列 = ref('日誌日付');
const 昇順 = ref(false);
const ページ = ref(1);
const ページ件数 = 30;
const メニュー = computed(() => 画面遷移先(router, route.query.URLメニュー) || '/Tトラン');
const 戻り先 = computed(() => 画面遷移先(router, route.query.URL戻り先));
const 編集条件 = computed(() => {
  const query = {
    開始日付: 開始日付.value || undefined, 終了日付: 終了日付.value || undefined,
    件数制限: String(件数制限.value), URLメニュー: メニュー.value,
    URL戻り先: 戻り先.value || undefined,
  };
  return { ...query, URL戻り先: router.resolve({ path: route.path, query }).fullPath };
});
const 新規日付 = computed(() => 開始日付.value && 開始日付.value === 終了日付.value ? 開始日付.value : ローカル日付());
const columns: Column[] = [
  { key: '日誌日付', label: '日誌日付', align: 'center', width: '150px' },
  { key: '利用者ID', label: '利用者ID' },
  { key: '利用者名', label: '利用者名' },
  { key: '記録件数', label: '記録件数', align: 'right', width: '100px' },
];
const ページ数 = computed(() => Math.max(1, Math.ceil(結果.value.items.length / ページ件数)));
const 表示行 = computed(() => [...結果.value.items].sort((a, b) => {
  const key = 並び列.value as keyof typeof a;
  const av = a[key], bv = b[key];
  const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ja');
  return 昇順.value ? order : -order;
}).slice((ページ.value - 1) * ページ件数, ページ.value * ページ件数));
function ソート(column: Column) {
  昇順.value = 並び列.value === column.key ? !昇順.value : true;
  並び列.value = column.key;
  ページ.value = 1;
}
let 最新検索 = 0;
async function 一覧取得() {
  const 検索番号 = ++最新検索;
  エラー.value = '';
  if (開始日付.value && 終了日付.value && 開始日付.value > 終了日付.value) {
    読込中.value = false;
    エラー.value = '開始日付は終了日付以前にしてください。';
    return;
  }
  読込中.value = true;
  try {
    const data = await 日誌操作<日誌一覧>('一覧', {
      開始日付: 開始日付.value || undefined,
      終了日付: 終了日付.value || undefined,
      件数制限: 件数制限.value,
    });
    if (検索番号 !== 最新検索) return;
    結果.value = data;
    ページ.value = 1;
  } catch (e) {
    if (検索番号 === 最新検索) エラー.value = エラー表示(e, '日誌一覧を取得できませんでした。');
  } finally {
    if (検索番号 === 最新検索) 読込中.value = false;
  }
}
watch(() => [route.query.開始日付, route.query.終了日付, route.query.件数制限], () => {
  開始日付.value = 日付値(route.query.開始日付);
  終了日付.value = 日付値(route.query.終了日付);
  件数制限.value = route.query.件数制限 !== 'false';
  void 一覧取得();
});
onMounted(一覧取得);
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">
      <span class="title-text">【 T日誌 】</span>
      <div class="header-actions">
        <RouterLink :to="メニュー" class="btn-menu">メニュー</RouterLink>
        <RouterLink v-if="戻り先 && 戻り先 !== メニュー" :to="戻り先" class="btn-return">戻る</RouterLink>
      </div>
    </h2>
    <div class="content">
      <section class="section">
        <form class="toolbar list-toolbar" @submit.prevent="一覧取得">
          <div class="toolbar-left">
            <div class="detail-row">
              <span class="detail-label">日付範囲</span>
              <div class="detail-value date-range">
                <input v-model="開始日付" type="date" class="detail-input date-input" aria-label="開始日付">
                <span class="range-separator">〜</span>
                <input v-model="終了日付" type="date" class="detail-input date-input" aria-label="終了日付">
              </div>
            </div>
            <button type="submit" class="btn btn-primary" :disabled="読込中">再検索</button>
          </div>
          <div class="toolbar-right">
            <RouterLink :to="{ name: 'T日誌編集', query: { ...編集条件, モード: '新規', 日誌日付: 新規日付 } }"
              class="btn btn-success">新規</RouterLink>
          </div>
        </form>
        <div class="table-options">
          <label class="checkbox-label">
            <input v-model="件数制限" type="checkbox" @change="一覧取得">
            件数制限
          </label>
        </div>
        <p v-if="エラー" role="alert" class="message-error">{{ エラー }}</p>
        <p v-if="結果.limit && 結果.total > 結果.items.length" role="status">
          {{ 結果.total }}件中、先頭{{ 結果.items.length }}件を表示しています。
        </p>
        <QTable :columns="columns" :rows="表示行" row-key="日誌日付" caption="ログイン中の利用者の日誌"
          :sort-key="並び列" :sort-order="昇順 ? 'asc' : 'desc'" :total-count="結果.items.length" :total-all="結果.total"
          :current-page="ページ" :total-pages="ページ数" :empty-text="読込中 ? '読み込み中…' : '日誌がありません。'"
          @sort="ソート" @page="ページ = $event">
          <template #cell="{ row, column, value }">
            <RouterLink v-if="column.key === '日誌日付'" class="id-link"
              :to="{ name: 'T日誌編集', query: { ...編集条件, モード: '編集', 日誌日付: row.日誌日付 } }">{{ value }}</RouterLink>
            <template v-else>{{ value }}</template>
          </template>
        </QTable>
      </section>
    </div>
  </div>
</template>

<style scoped src="./日誌.css"></style>
