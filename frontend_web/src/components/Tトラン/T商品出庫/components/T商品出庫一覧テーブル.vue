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
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import apiClient from '../../../../api/client';
import qTublerFrame from '../../../_share/qTublerFrame.vue';
import qBooleanCheckbox from '../../../_share/qBooleanCheckbox.vue';
import type { Column } from '../../../../types/qTubler';

const router = useRouter();

const props = defineProps({
  開始日付: {
    type: String,
    default: ''
  },
  終了日付: {
    type: String,
    default: ''
  },
  商品ID: {
    type: String,
    default: ''
  },
  件数制限: {
    type: Boolean,
    default: true
  },
  無効も表示: {
    type: Boolean,
    default: false
  },
  有効列表示: {
    type: Boolean,
    default: false
  },
  URLメニュー: {
    type: String,
    default: ''
  },
  URL戻り先: {
    type: String,
    default: ''
  }
});

const 商品出庫一覧 = ref([]);
const serverTotal = ref(0);
const pageSize = ref(100);
const currentPage = ref(1);
const sortKey = ref('出庫日');
const sortOrder = ref('desc');
const filters = reactive({
  出庫伝票ID: '',
  出庫日: '',
  商品ID: '',
  商品名: '',
  出庫数量: '',
  出庫備考: '',
  更新日時: '',
  更新利用者名: ''
});
const rowKey = '一覧行ID';
const columns = computed<Column[]>(() => {
  const baseColumns: Column[] = [
    { key: '出庫伝票ID', label: '出庫伝票ID', width: '120px', sortable: true, align: 'center' },
    { key: '出庫日', label: '出庫日', width: '120px', sortable: true, align: 'center' },
    { key: '商品ID', label: '商品ID', width: '100px', sortable: true, align: 'center' },
    { key: '商品名', label: '商品名', width: '150px', sortable: true },
    { key: '出庫数量', label: '出庫数量', width: '100px', sortable: true, align: 'right' },
    { key: '出庫備考', label: '出庫備考', width: '220px', sortable: true },
    { key: '更新日時', label: '更新日時', width: '160px', sortable: true },
    { key: '更新利用者名', label: '更新利用者名', width: '130px', sortable: true }
  ];
  if (props.有効列表示) {
    baseColumns.splice(6, 0, { key: '有効', label: '有効', width: '60px', sortable: true, align: 'center' });
  }
  return baseColumns;
});

const message = ref('');
const messageType = ref('success');
const numberFormatter = new Intl.NumberFormat('ja-JP');

const setMessage = (text, type = 'success') => {
  message.value = text;
  messageType.value = type;
};

const hasFilter = computed((): boolean => {
  return Boolean(Object.values(filters).some((value) => String(value || '').trim() !== '') ||
    props.開始日付 ||
    props.終了日付 ||
    props.商品ID);
});
const filteredRows = computed(() => {
  return 商品出庫一覧.value.filter((row) => {
    // 列フィルタのチェック
    const columnMatch = columns.value.every((column) => {
      const filterValue = (filters[column.key] || '').trim();
      if (!filterValue) return true;
      const cellValue = row?.[column.key] ?? '';
      return String(cellValue).toLowerCase().includes(filterValue.toLowerCase());
    });

    if (!columnMatch) return false;

    // 日付条件のチェック
    const rowDate = String(row?.['出庫日'] ?? '').slice(0, 10);

    if (props.開始日付) {
      if (!rowDate || rowDate < props.開始日付) return false;
    }

    if (props.終了日付) {
      if (!rowDate || rowDate > props.終了日付) return false;
    }

    if (props.商品ID) {
      const rowProductId = String(row?.商品ID ?? '');
      if (rowProductId !== String(props.商品ID)) return false;
    }

    return true;
  });
});
const totalCount = computed(() => filteredRows.value.length);
const totalAll = computed(() => serverTotal.value);
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize.value)));
const sortedRows = computed(() => {
  const rows = [...filteredRows.value];
  if (!sortKey.value) return rows;
  rows.sort((a, b) => {
    const aValue = a?.[sortKey.value] ?? '';
    const bValue = b?.[sortKey.value] ?? '';
    const aNum = Number(aValue);
    const bNum = Number(bValue);
    const isNumeric = !Number.isNaN(aNum) && !Number.isNaN(bNum);
    let result = 0;
    if (isNumeric) {
      result = aNum - bNum;
    } else {
      result = String(aValue).localeCompare(String(bValue), 'ja');
    }
    return sortOrder.value === 'desc' ? -result : result;
  });
  return rows;
});
const pagedRows = computed(() => {
  const startIndex = (currentPage.value - 1) * pageSize.value;
  return sortedRows.value.slice(startIndex, startIndex + pageSize.value);
});

const handleSort = (column) => {
  if (!column.sortable) return;
  if (sortKey.value === column.key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = column.key;
    sortOrder.value = 'asc';
  }
};

const goToPage = (page) => {
  if (page < 1 || page > totalPages.value) return;
  currentPage.value = page;
};

const openDetail = (row) => {
  const query: Record<string, any> = { モード: '編集', 出庫伝票ID: row.出庫伝票ID };
  if (props.URLメニュー) {
    query.URLメニュー = props.URLメニュー;
  }
  if (props.URL戻り先) {
    query.URL戻り先 = props.URL戻り先;
  }
  router.push({ path: '/Tトラン/T商品出庫/編集', query });
};

// ==================================================
// 一覧データ取得
// ==================================================
const loadData = async () => {
  message.value = '';
  try {
    const payload: Record<string, string | boolean> = {
      件数制限: props.件数制限,
      無効も表示: props.無効も表示
    };
    if (props.開始日付) payload.開始日付 = String(props.開始日付);
    if (props.終了日付) payload.終了日付 = String(props.終了日付);
    if (props.商品ID) payload.商品ID = String(props.商品ID);
    const res = await apiClient.post(
      '/apps/V商品出庫/一覧',
      Object.keys(payload).length ? payload : undefined
    );
    if (res.data.status === 'OK') {
      const data = res.data.data;
      const items = Array.isArray(data) ? data : data?.items ?? [];
      商品出庫一覧.value = items;
      serverTotal.value = Array.isArray(data) ? items.length : Number(data?.total ?? items.length);
      currentPage.value = 1;
    } else {
      setMessage(res.data.message || 'T商品出庫一覧の取得に失敗しました。', 'error');
    }
  } catch (e) {
    setMessage('T商品出庫一覧の取得でエラーが発生しました。', 'error');
  }
};

// ==================================================
// 初期化
// ==================================================
onMounted(async () => {
  await loadData();
});

defineExpose({
  loadData
});
</script>

<template>
  <qTublerFrame
    :columns="columns"
    :rows="pagedRows"
    :rowKey="rowKey"
    :sortKey="sortKey"
    :sortOrder="sortOrder"
    :message="message"
    :messageType="messageType"
    :hasFilter="hasFilter"
    :totalCount="totalCount"
    :totalAll="totalAll"
    :currentPage="currentPage"
    :totalPages="totalPages"
    @sort="handleSort"
    @page="goToPage"
  >
    <template #filter="{ column }">
      <input
        v-if="filters[column.key] !== undefined"
        v-model="filters[column.key]"
        class="filter-input"
        type="text"
      />
    </template>
    <template #cell="{ row, column, value }">
      <template v-if="column.key === '出庫伝票ID'">
        <a href="#" class="id-link" @click.prevent="openDetail(row)">{{ row.出庫伝票ID }}</a>
      </template>
      <template v-else-if="column.key === '出庫数量'">
        {{ value === null || value === undefined || value === '' ? '' : numberFormatter.format(Number(value)) }}
      </template>
      <template v-else-if="column.key === '有効'">
        <qBooleanCheckbox :checked="Boolean(row.有効)" ariaLabel="有効状態" />
      </template>
      <template v-else>
        {{ value ?? '' }}
      </template>
    </template>
  </qTublerFrame>
</template>

