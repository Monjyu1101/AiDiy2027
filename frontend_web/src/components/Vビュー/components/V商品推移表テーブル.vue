<!--
  -*- coding: utf-8 -*-

  -------------------------------------------------------------------------
  COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
  Licensed under "AiDiy 公開利用ライセンス v1.1".
  Commercial use requires prior written consent from all copyright holders.
  See LICENSE for full terms. Thank you for keeping the rules.
  https://github.com/monjyu1101/AiDiy2027
  -------------------------------------------------------------------------
-->

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

interface 日別データ型 {
  入庫数量?: number
  出庫数量?: number
  推定在庫?: number
  棚卸数量?: number | null
  生産受入数量?: number
  生産払出数量?: number
  入庫最終更新日時?: string
  出庫最終更新日時?: string
  棚卸最終更新日時?: string
  生産受入最終更新日時?: string
  生産払出最終更新日時?: string
  [key: string]: any
}

interface 商品型 {
  商品ID: string
  商品名: string
  日別データ?: 日別データ型[]
  [key: string]: any
}

const props = defineProps({
  日付リスト: {
    type: Array as () => string[],
    required: false,
    default: () => []
  },
  商品データ: {
    type: Array as () => 商品型[],
    required: false,
    default: () => []
  },
  URLメニュー: {
    type: String,
    required: false,
    default: ''
  }
});

const router = useRouter();

const DISPLAY_DAYS = 32;

// 日付フォーマット整形 (MM/DD) + (Day)
const formatDateParts = (dateStr: string) => {
  if (!dateStr) return { label: '', day: '' };
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return { label: '', day: '' };
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const day = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return { label: `${m}/${d}`, day: `(${day})` };
};

// 土日判定クラス
const getDayClass = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDay();
  if (day === 0) return 'sunday-background'; // 日曜
  if (day === 6) return 'saturday-background'; // 土曜
  return '';
};

const formatDateKey = (date: Date): string => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const buildDateList = (startDate: Date, count: number): string[] => {
  const dates = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    dates.push(formatDateKey(date));
  }
  return dates;
};

const displayDates = computed(() => {
  const rawList = Array.isArray(props.日付リスト) ? props.日付リスト.filter(Boolean) : [];
  if (rawList.length >= DISPLAY_DAYS) {
    return rawList.slice(0, DISPLAY_DAYS);
  }
  if (rawList.length === 0) {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    return buildDateList(startDate, DISPLAY_DAYS);
  }
  const lastDate = new Date(rawList[rawList.length - 1]);
  if (Number.isNaN(lastDate.getTime())) {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    return buildDateList(startDate, DISPLAY_DAYS);
  }
  const paddedList = [...rawList];
  const missingCount = DISPLAY_DAYS - rawList.length;
  for (let i = 1; i <= missingCount; i += 1) {
    const next = new Date(lastDate);
    next.setDate(next.getDate() + i);
    paddedList.push(formatDateKey(next));
  }
  return paddedList;
});

const displayHeaders = computed(() => {
  return displayDates.value.map((date) => {
    const parts = formatDateParts(date);
    return {
      key: date,
      label: parts.label,
      day: parts.day
    };
  });
});

const getDayData = (product: 商品型, index: number): 日別データ型 => {
  if (!product || !Array.isArray(product.日別データ)) return {};
  return product.日別データ[index] ?? {};
};

const isStocktaking = (dayData: 日別データ型): boolean => {
  if (!dayData) return false;
  return dayData.棚卸数量 !== null && dayData.棚卸数量 !== undefined;
};

const isNegativeStock = (dayData: 日別データ型): boolean => {
  if (!dayData) return false;
  return Number(dayData.推定在庫) < 0;
};

const toFullwidthUrl = (value: string): string =>
  value.replace(/\//g, '／').replace(/\?/g, '？').replace(/&/g, '＆').replace(/=/g, '＝');

const openList = (type: string, product: 商品型, date: string) => {
  if (!date || !product?.商品ID) return;

  const pathMap = {
    入庫: '/Tトラン/T商品入庫/一覧',
    出庫: '/Tトラン/T商品出庫/一覧',
    棚卸: '/Tトラン/T商品棚卸/一覧'
  };

  const path = pathMap[type];
  if (!path) return;
  const returnQuery = `URL戻り先=${toFullwidthUrl('/Vビュー/V商品推移表')}${props.URLメニュー ? `&URLメニュー=${toFullwidthUrl(props.URLメニュー)}` : ''}`;
  const queryString = `開始日付=${encodeURIComponent(date)}&終了日付=${encodeURIComponent(date)}&商品ID=${encodeURIComponent(product.商品ID)}&${returnQuery}`;
  router.push(`${path}?${queryString}`);
};

const openSeisanList = (type: string, product: 商品型, date: string) => {
  if (!date || !product?.商品ID) return;
  const returnQuery = `URL戻り先=${toFullwidthUrl('/Vビュー/V商品推移表')}${props.URLメニュー ? `&URLメニュー=${toFullwidthUrl(props.URLメニュー)}` : ''}`;

  if (type === '受入') {
    const queryString = `開始日付=${encodeURIComponent(date)}&終了日付=${encodeURIComponent(date)}&受入商品ID=${encodeURIComponent(product.商品ID)}&${returnQuery}`;
    router.push(`/Tトラン/T生産/一覧?${queryString}`);
  } else if (type === '払出') {
    const queryString = `開始日付=${encodeURIComponent(date)}&終了日付=${encodeURIComponent(date)}&払出商品ID=${encodeURIComponent(product.商品ID)}&${returnQuery}`;
    router.push(`/Tトラン/T生産払出/一覧?${queryString}`);
  }
};

const parseUpdateDate = (value: any): Date | null => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

// 最新更新データの判定（1時間以内）
const isRecentUpdate = (updatedStr: any): boolean => {
  const updated = parseUpdateDate(updatedStr);
  if (!updated) return false;
  const now = new Date();
  const diffMs = now.getTime() - updated.getTime();
  return diffMs >= 0 && diffMs <= 5 * 60 * 1000;
};
</script>

<template>
  <div class="table-container">
    <table class="transition-table">
      <thead>
        <tr>
          <th class="product-header">商品</th>
          <th class="type-header">区</th>
          <th v-for="header in displayHeaders" :key="header.key" class="date-header">
            <span class="date-top">{{ header.label }}</span>
            <span class="date-bottom">{{ header.day }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="product in 商品データ" :key="product.商品ID">
          <!-- 入庫行 -->
          <tr>
            <td class="product-cell" rowspan="5">
              {{ product.商品名 }}
              <div v-if="product.商品ID" class="product-sub">{{ product.商品ID }}</div>
            </td>
            <td class="type-cell inbound">入</td>
            <td
              v-for="(date, index) in displayDates"
              :key="'in-' + index"
              class="data-cell inbound-data"
              :class="[
                getDayClass(date),
                { 'recent-update': isRecentUpdate(getDayData(product, index).入庫最終更新日時) }
              ]"
              @dblclick="openList('入庫', product, date)"
            >
              {{ getDayData(product, index).入庫数量 > 0 ? getDayData(product, index).入庫数量 : '' }}
            </td>
          </tr>
          <!-- 生産受入行 -->
          <tr>
            <td class="type-cell prod-inbound">受</td>
            <td
              v-for="(date, index) in displayDates"
              :key="'prod-in-' + index"
              class="data-cell prod-inbound-data"
              :class="[
                getDayClass(date),
                { 'recent-update': isRecentUpdate(getDayData(product, index).生産受入最終更新日時) }
              ]"
              @dblclick="openSeisanList('受入', product, date)"
            >
              {{ getDayData(product, index).生産受入数量 > 0 ? getDayData(product, index).生産受入数量 : '' }}
            </td>
          </tr>
          <!-- 生産払出行 -->
          <tr>
            <td class="type-cell prod-outbound">払</td>
            <td
              v-for="(date, index) in displayDates"
              :key="'prod-out-' + index"
              class="data-cell prod-outbound-data"
              :class="[
                getDayClass(date),
                { 'recent-update': isRecentUpdate(getDayData(product, index).生産払出最終更新日時) }
              ]"
              @dblclick="openSeisanList('払出', product, date)"
            >
              {{ getDayData(product, index).生産払出数量 > 0 ? getDayData(product, index).生産払出数量 : '' }}
            </td>
          </tr>
          <!-- 出庫行 -->
          <tr>
            <td class="type-cell outbound">出</td>
            <td
              v-for="(date, index) in displayDates"
              :key="'out-' + index"
              class="data-cell outbound-data"
              :class="[
                getDayClass(date),
                { 'recent-update': isRecentUpdate(getDayData(product, index).出庫最終更新日時) }
              ]"
              @dblclick="openList('出庫', product, date)"
            >
              {{ getDayData(product, index).出庫数量 > 0 ? getDayData(product, index).出庫数量 : '' }}
            </td>
          </tr>
          <!-- 在庫行 -->
          <tr>
            <td class="type-cell inventory">在</td>
            <td
              v-for="(date, index) in displayDates"
              :key="'inv-' + index"
              class="data-cell inventory-data"
              :class="[
                getDayClass(date),
                {
                  'stocktaking': isStocktaking(getDayData(product, index)),
                  'negative': isNegativeStock(getDayData(product, index)),
                  'recent-update': isRecentUpdate(getDayData(product, index).棚卸最終更新日時)
                }
              ]"
              @dblclick="openList('棚卸', product, date)"
            >
              {{ getDayData(product, index).推定在庫 ?? '' }}
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* テーブルコンテナ */
.table-container {
  overflow-x: auto;
  margin-top: 5px;
  flex: 1;
}

/* 推移表テーブル */
.transition-table {
  width: auto;
  border-collapse: collapse;
  font-size: 12px;
  min-width: 1200px;
  display: table;
}

.transition-table th,
.transition-table td {
  border: 1px solid #ddd;
  padding: 1px;
  text-align: center;
  vertical-align: middle;
  height: 16px;
  box-sizing: border-box;
}

/* 1行目（入）: 下線なし */
.transition-table tbody tr:nth-child(5n+1) td {
    border-bottom: none !important;
}
/* 2〜4行目（受・払・出）: 上下線なし */
.transition-table tbody tr:nth-child(5n+2) td,
.transition-table tbody tr:nth-child(5n+3) td,
.transition-table tbody tr:nth-child(5n+4) td {
    border-top: none !important;
    border-bottom: none !important;
}
/* 5行目（在）: 商品ブロックの区切り */
.transition-table tbody tr:nth-child(5n) td {
    border-top: none !important;
    border-bottom: 2px solid #aaa;
}


.transition-table th {
  background-color: #2c3e50; /* 深い藍色 */
  color: #fff;
  font-weight: bold;
  position: sticky;
  top: 0;
  z-index: 10;
}

.transition-table th.date-header {
  height: 28px;
  line-height: 1.1;
  padding: 2px 4px;
}

.date-top,
.date-bottom {
  display: block;
}

.date-bottom {
  font-size: 10px;
  opacity: 0.9;
}

.transition-table th.product-header {
  position: sticky;
  left: 0;
  z-index: 20;
  min-width: 150px;
  width: 150px;
}

.transition-table th.type-header {
  position: sticky;
  left: 150px; /* product-header width */
  z-index: 20;
  min-width: 25px;
  width: 25px;
  font-size: 11px;
}

.transition-table td.type-cell {
  background: #f0f8ff;
  font-weight: bold;
  position: sticky;
  left: 150px;
  z-index: 5;
  text-align: center;
  min-width: 25px;
  width: 25px;
  font-size: 11px;
}

.transition-table td.product-cell {
  background: #f8f9fa;
  font-weight: bold;
  position: sticky;
  left: 0;
  z-index: 5;
  text-align: left;
  min-width: 150px;
  padding-left: 5px;
  vertical-align: middle;
  border-bottom: 2px solid #aaa;
}

.product-sub {
  font-size: 10px;
  color: #666;
  line-height: 1.1;
}

.transition-table td.type-cell.inbound {
  background: #e8f5e8;
  color: #28a745;
}

.transition-table td.type-cell.prod-inbound {
  background: #e0f7f0;
  color: #0d9488;
}

.transition-table td.type-cell.prod-outbound {
  background: #fff4e5;
  color: #e67e00;
}

.transition-table td.type-cell.outbound {
  background: #fdf2f2;
  color: #000;
}

.transition-table td.type-cell.inventory {
  background: #e3f2fd;
  color: #007bff;
}

/* データセル */
.data-cell {
  min-width: 60px;
  height: 16px;
  padding: 1px 4px;
  font-size: 10px;
  font-weight: bold;
  white-space: nowrap;
  cursor: pointer;
}

.data-cell.inbound-data {
  background: #f8fff8;
  color: #28a745;
  text-align: left;
  padding-left: 6px;
}

.data-cell.prod-inbound-data {
  background: #f0faf7;
  color: #0d9488;
  text-align: center;
}

.data-cell.prod-outbound-data {
  background: #fffaf0;
  color: #e67e00;
  text-align: center;
}

.data-cell.outbound-data {
  background: #fff8f8;
  color: #000;
  text-align: right;
  padding-right: 6px;
  font-size: 14px;
}

.data-cell.inventory-data {
  background: #f0f8ff;
  color: #007bff;
  text-align: center;
}

.data-cell.inventory-data.negative {
  color: #dc3545;
}

/* 棚卸データ時の背景前景反転スタイル */
.data-cell.inventory-data.stocktaking {
  background: #007bff !important;
  color: white !important;
}

.data-cell.inventory-data.stocktaking.negative {
  background: #dc3545 !important;
}

/* 土日カラー (importantをつけて優先させる) */
.data-cell.saturday-background {
  background: #e0f7fa !important;
}

.data-cell.sunday-background {
  background: #ffebee !important;
}
/* 土日の棚卸などはさらに優先順位考慮が必要だが、今回はsimplificationのため順序依存 */
/* CSSの記述順序でstocktakingが下にあれば勝つが、important同士だと競合。 */

/* stocktakingをより強くする */
.data-cell.inventory-data.stocktaking {
    background-color: #007bff !important; /* 青 */
}
.data-cell.inventory-data.stocktaking.negative {
    background: #dc3545 !important;
}

@keyframes blink {
  0%,
  50% {
    opacity: 1;
  }
  25%,
  75% {
    opacity: 0.3;
  }
}

.data-cell.recent-update {
  animation: blink 2s infinite;
}
</style>
