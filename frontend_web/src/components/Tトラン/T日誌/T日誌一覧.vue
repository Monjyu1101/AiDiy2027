<!--
COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import QTable from '../../_share/qTublerFrame.vue';
import type { Column } from '../../../types/qTubler';
import { エラー表示, 日誌操作, ローカル日付 } from './日誌API';
import type { 日誌一覧 } from './日誌API';

const route = useRoute();
const 日付値 = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
const 開始日付 = ref(日付値(route.query.開始日付));
const 終了日付 = ref(日付値(route.query.終了日付));
const 件数制限 = ref(route.query.件数制限 !== 'false');
const 結果 = ref<日誌一覧>({ items: [], total: 0, limit: null });
const 読込中 = ref(false);
const エラー = ref('');
const 並び列 = ref('日付');
const 昇順 = ref(false);
const ページ = ref(1);
const ページ件数 = 30;
const メニュー = computed(() => route.query.URLメニュー === '／メニュー' ? '/メニュー' : '/Tトラン');
const 一覧条件 = computed(() => ({
  開始日付: 開始日付.value || undefined, 終了日付: 終了日付.value || undefined,
  件数制限: String(件数制限.value), URLメニュー: メニュー.value.replace(/\//g, '／'),
}));
const 新規日付 = computed(() => 開始日付.value && 開始日付.value === 終了日付.value ? 開始日付.value : ローカル日付());
const columns: Column[] = [
  { key: '日付', label: '日付', align: 'center', width: '150px' },
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
async function 一覧取得() {
  if (読込中.value) return;
  エラー.value = '';
  if (開始日付.value && 終了日付.value && 開始日付.value > 終了日付.value) {
    エラー.value = '開始日付は終了日付以前にしてください。';
    return;
  }
  読込中.value = true;
  try {
    結果.value = await 日誌操作<日誌一覧>('一覧', {
      開始日付: 開始日付.value || undefined,
      終了日付: 終了日付.value || undefined,
      件数制限: 件数制限.value,
    });
    ページ.value = 1;
  } catch (e) {
    エラー.value = エラー表示(e, '日誌一覧を取得できませんでした。');
  } finally {
    読込中.value = false;
  }
}
onMounted(一覧取得);
</script>

<template>
  <div class="page-container">
    <h2 class="page-title"><span>【 T日誌 一覧 】</span><RouterLink :to="メニュー" class="btn btn-secondary">メニュー</RouterLink></h2>
    <div class="content">
      <form class="controls" @submit.prevent="一覧取得">
        <fieldset :disabled="読込中">
          <label>開始日付 <input v-model="開始日付" type="date"></label>
          <label>終了日付 <input v-model="終了日付" type="date"></label>
          <label><input v-model="件数制限" type="checkbox"> 件数制限</label>
          <button type="submit" class="btn btn-secondary">{{ 読込中 ? '検索中…' : '検索' }}</button>
        </fieldset>
        <RouterLink :to="{ name: 'T日誌編集', query: { ...一覧条件, モード: '新規', 日付: 新規日付 } }" class="btn btn-primary">新規</RouterLink>
      </form>
      <p v-if="エラー" role="alert" class="error">{{ エラー }}</p>
      <p v-if="結果.limit && 結果.total > 結果.items.length" role="status">
        {{ 結果.total }}件中、先頭{{ 結果.items.length }}件を表示しています。
      </p>
      <QTable :columns="columns" :rows="表示行" row-key="日付" caption="ログイン中の利用者の日誌"
        :sort-key="並び列" :sort-order="昇順 ? 'asc' : 'desc'" :total-count="結果.items.length" :total-all="結果.total"
        :current-page="ページ" :total-pages="ページ数" :empty-text="読込中 ? '読み込み中…' : '日誌がありません。'"
        @sort="ソート" @page="ページ = $event">
        <template #cell="{ row, column, value }">
          <RouterLink v-if="column.key === '日付'" class="id-link"
            :to="{ name: 'T日誌編集', query: { ...一覧条件, モード: '編集', 日付: row.日付 } }">{{ value }}</RouterLink>
          <template v-else>{{ value }}</template>
        </template>
      </QTable>
    </div>
  </div>
</template>

<style scoped src="./日誌.css"></style>
