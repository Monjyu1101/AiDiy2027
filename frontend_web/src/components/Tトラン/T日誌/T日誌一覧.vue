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
import type { 日誌一覧, 日誌一覧候補 } from './日誌API';
import { 日誌検索状態, 画面遷移先 } from './日誌画面';

import { useAuthStore } from '../../../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const 初期検索状態 = 日誌検索状態(router, auth.user?.利用者ID);
const 日付値 = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
const 初期開始日付 = () => 日付値(route.query.開始日付) || ローカル日付();
const 開始日付 = ref(初期開始日付());
const 終了日付 = ref(日付値(route.query.終了日付) || 開始日付.value);
const 同一日 = computed(() => Boolean(開始日付.value && 開始日付.value === 終了日付.value));
const 利用者ID = ref(初期検索状態.日誌検索利用者);
const プロジェクト = ref(初期検索状態.日誌検索プロジェクト);
const キーワード = ref(初期検索状態.日誌検索キーワード);
const 候補 = ref<日誌一覧候補 | null>(null);
const 候補エラー = ref('');
const 件数制限 = ref(route.query.件数制限 !== 'false');
const 結果 = ref<日誌一覧>({ items: [], total: 0, limit: null });
const 読込中 = ref(false);
const エラー = ref('');
const 並び列 = ref('日誌日付');
const 昇順 = ref(false);
const ページ = ref(1);
const ページ件数 = 30;
const 件数表示 = new Intl.NumberFormat('ja-JP');
const 利用者表示 = (id: string, name: string) => `${id} : ${name}`;
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
const 編集状態 = computed(() => ({
  日誌検索所有者: auth.user?.利用者ID ?? '',
  日誌検索利用者: 利用者ID.value,
  日誌検索プロジェクト: プロジェクト.value,
  日誌検索キーワード: キーワード.value,
}));
const 新規日付 = computed(() => 同一日.value ? 開始日付.value : ローカル日付());
const columns: Column[] = [
  { key: '日誌日付', label: '日誌日付', align: 'center', width: '150px' },
  { key: '利用者ID', label: '利用者', width: 'var(--user-column-width)' },
  { key: '記録件数', label: '記録件数', align: 'right', width: '100px' },
  { key: '作業タイトル', label: '作業タイトル', align: 'left', width: 'var(--work-title-width)', sortable: false },
  { key: '新規更新ファイル数', label: '新規・更新ファイル数', align: 'right', width: '150px', sortable: false },
];
const ページ数 = computed(() => Math.max(1, Math.ceil(結果.value.items.length / ページ件数)));
const 表示行 = computed(() => [...結果.value.items].sort((a, b) => {
  const key = 並び列.value as keyof typeof a;
  const av = a[key], bv = b[key];
  const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ja');
  return 昇順.value ? order : -order;
}).slice((ページ.value - 1) * ページ件数, ページ.value * ページ件数).map(row => ({
  ...row, 日誌行キー: JSON.stringify([row.日誌日付, row.利用者ID]),
})));
function ソート(column: Column) {
  昇順.value = 並び列.value === column.key ? !昇順.value : true;
  並び列.value = column.key;
  ページ.value = 1;
}
function 開始日変更(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  開始日付.value = 終了日付.value = value;
}

async function 日付を移動(日数: -1 | 1) {
  if (!同一日.value) return;
  // UTC の暦日として加減し、夏時間や月・年の境界でも正しく日付を進める。
  const date = new Date(`${開始日付.value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return;
  date.setUTCDate(date.getUTCDate() + 日数);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return;
  開始日付.value = 終了日付.value = date.toISOString().slice(0, 10);
  await 一覧取得();
}

let 最新検索 = 0;
async function 一覧取得() {
  const 検索番号 = ++最新検索;
  エラー.value = '';
  if (!日付値(開始日付.value) || !日付値(終了日付.value)) {
    読込中.value = false;
    エラー.value = '日付範囲の開始日付と終了日付を入力してください。';
    return;
  }
  if (開始日付.value > 終了日付.value) {
    読込中.value = false;
    エラー.value = '開始日付は終了日付以前にしてください。';
    return;
  }
  読込中.value = true;
  try {
    const data = await 日誌操作<日誌一覧>('一覧検索', {
      開始日付: 開始日付.value || undefined,
      終了日付: 終了日付.value || undefined,
      件数制限: 件数制限.value,
      利用者ID: 利用者ID.value || undefined,
      プロジェクト: プロジェクト.value || undefined,
      キーワード: キーワード.value.trim() || undefined,
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
  開始日付.value = 初期開始日付();
  終了日付.value = 日付値(route.query.終了日付) || 開始日付.value;
  件数制限.value = route.query.件数制限 !== 'false';
  void 一覧取得();
});
async function 候補取得() {
  候補エラー.value = '';
  try {
    候補.value = await 日誌操作<日誌一覧候補>('一覧候補');
  } catch (e) {
    候補エラー.value = エラー表示(e, '利用者・プロジェクトの検索候補を取得できませんでした。');
  }
}
function 検索() {
  if (候補エラー.value) void 候補取得();
  void 一覧取得();
}
onMounted(() => {
  void 候補取得();
  void 一覧取得();
});
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
        <form class="toolbar list-toolbar" @submit.prevent="検索">
          <div class="toolbar-left">
            <div class="search-panel">
              <div class="detail-row date-row">
                <span class="detail-label">日付範囲</span>
                <div class="detail-value date-range">
                  <input :value="開始日付" type="date" class="detail-input date-input" aria-label="開始日付"
                    @input="開始日変更">
                  <span class="range-separator">〜</span>
                  <input v-model="終了日付" type="date" class="detail-input date-input" aria-label="終了日付">
                  <div v-if="同一日" class="day-navigation">
                    <button type="button" class="btn btn-secondary" aria-label="前日" title="前日" @click="日付を移動(-1)">−</button>
                    <button type="button" class="btn btn-secondary" aria-label="翌日" title="翌日" @click="日付を移動(1)">＋</button>
                  </div>
                </div>
              </div>
              <div class="detail-row">
                <label class="detail-label" for="diary-search-user">利用者</label>
                <span class="detail-value">
                  <select id="diary-search-user" v-model="利用者ID" class="detail-input search-input">
                    <option value="">未指定</option>
                    <option v-if="利用者ID && !候補?.利用者.some(user => user.利用者ID === 利用者ID)" :value="利用者ID">{{ 利用者ID }}</option>
                    <option v-for="user in 候補?.利用者 ?? []" :key="user.利用者ID" :value="user.利用者ID">
                      {{ 利用者表示(user.利用者ID, user.利用者名) }}
                    </option>
                  </select>
                </span>
              </div>
              <div class="detail-row">
                <label class="detail-label" for="diary-search-project">プロジェクト</label>
                <span class="detail-value">
                  <select id="diary-search-project" v-model="プロジェクト" class="detail-input search-input">
                    <option value="">未指定</option>
                    <option v-if="プロジェクト && !候補?.プロジェクト.includes(プロジェクト)" :value="プロジェクト">{{ プロジェクト }}</option>
                    <option v-for="path in 候補?.プロジェクト ?? []" :key="path" :value="path">{{ path }}</option>
                  </select>
                </span>
              </div>
              <div class="detail-row">
                <label class="detail-label" for="diary-search-keyword">文字検索</label>
                <span class="detail-value">
                  <input id="diary-search-keyword" v-model="キーワード" class="detail-input search-input" type="search" maxlength="200"
                    placeholder="作業タイトル・内容・ファイル名など">
                </span>
              </div>
            </div>
            <button type="submit" class="btn btn-primary" :disabled="読込中">検索</button>
          </div>
          <div class="toolbar-right">
            <RouterLink :to="{ name: 'T日誌編集', state: 編集状態, query: { ...編集条件, モード: '新規', 日誌日付: 新規日付 } }"
              class="btn btn-success">新規</RouterLink>
          </div>
        </form>
        <div class="table-options">
          <label class="checkbox-label">
            <input v-model="件数制限" type="checkbox" @change="一覧取得">
            件数制限
          </label>
        </div>
        <p v-if="候補エラー" role="alert" class="message-error">{{ 候補エラー }}</p>
        <p v-if="エラー" role="alert" class="message-error">{{ エラー }}</p>
        <p v-if="結果.limit && 結果.total > 結果.items.length" role="status">
          {{ 結果.total }}件中、先頭{{ 結果.items.length }}件を表示しています。
        </p>
        <QTable :columns="columns" :rows="表示行" row-key="日誌行キー" caption="日誌一覧"
          :sort-key="並び列" :sort-order="昇順 ? 'asc' : 'desc'" :total-count="結果.items.length" :total-all="結果.total"
          :current-page="ページ" :total-pages="ページ数" :empty-text="読込中 ? '読み込み中…' : '日誌がありません。'"
          @sort="ソート" @page="ページ = $event">
          <template #cell="{ row, column, value }">
            <RouterLink v-if="column.key === '日誌日付' && row.利用者ID === auth.user?.利用者ID" class="id-link"
              :to="{ name: 'T日誌編集', state: 編集状態, query: { ...編集条件, モード: '編集', 日誌日付: row.日誌日付 } }">{{ value }}</RouterLink>
            <span v-else-if="column.key === '利用者ID'" class="user-cell"
              :title="利用者表示(row.利用者ID, row.利用者名)">{{ 利用者表示(row.利用者ID, row.利用者名) }}</span>
            <div v-else-if="column.key === '作業タイトル' || column.key === '新規更新ファイル数'" class="work-list">
              <div v-for="作業 in row.作業一覧" :key="作業.作業ID" class="work-line">
                <span v-if="column.key === '作業タイトル'" class="work-title" :title="作業.作業タイトル">{{ 作業.作業タイトル }}</span>
                <span v-else>{{ 作業.新規更新ファイル数 === null ? '未入力' : 件数表示.format(作業.新規更新ファイル数) }}</span>
              </div>
            </div>
            <template v-else>{{ value }}</template>
          </template>
        </QTable>
      </section>
    </div>
  </div>
</template>

<style scoped src="./日誌.css"></style>
<style scoped>
.page-container { --work-title-width: clamp(300px, 60vw, 680px); }
.section {
  container-type: inline-size;
  --search-panel-width: 570px;
  --search-label-width: 160px;
  --search-value-padding: 12px;
  --user-column-width: max(90px, calc(min(var(--search-panel-width), 100cqw) - var(--search-label-width) - 2 * var(--search-value-padding) - 1px));
}
.search-panel {
  width: var(--search-panel-width);
  max-width: 100%;
  min-width: 0;
  font-size: 14px;
}
.search-panel .detail-row + .detail-row { margin-top: -1px; }
/* T生産などの検索欄と同じ寸法。グローバルの入力欄の上下マージンを持ち込まない。 */
.search-panel .detail-label { width: var(--search-label-width); white-space: nowrap; }
.search-panel .detail-value { padding-inline: var(--search-value-padding); }
.search-panel .detail-input {
  width: 100%;
  min-width: 0;
  height: 28px;
  margin: 0;
  padding: 0 8px;
  font-size: inherit;
}
.search-panel .date-range {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
  gap: 4px 8px;
  width: auto;
}
.day-navigation { display: flex; gap: 4px; }
.day-navigation .btn { width: 28px; height: 28px; padding: 0; }

@media (max-width: 640px) {
  .section { --search-label-width: 108px; --search-value-padding: 8px; }
}

@media (max-width: 465px) {
  .search-panel .date-range { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); }
  .search-panel .date-input { padding-inline: 3px; }
  .day-navigation { grid-column: 1 / -1; justify-self: end; }
}

@media (max-width: 370px) {
  .search-panel .date-row { flex-direction: column; }
  .search-panel .date-row .detail-label { width: 100%; min-height: 0; justify-content: flex-start; padding-block: 4px; }
  .search-panel .date-range {
    border-top: 0;
    border-left: 1px solid #ccc;
  }
}
.work-line { display: flex; align-items: center; min-height: 26px; }
.work-line + .work-line { border-top: 1px solid #e2e8f0; }
.work-list { display: grid; justify-content: stretch; }
.work-line > span { width: 100%; }
.work-title { display: block; overflow: hidden; text-overflow: ellipsis; max-width: var(--work-title-width); }
.user-cell {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(var(--user-column-width) - 21px);
}
</style>
