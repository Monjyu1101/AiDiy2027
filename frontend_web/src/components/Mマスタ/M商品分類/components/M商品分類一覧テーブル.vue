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
import type { Column, V商品分類 } from '../../../../types';

const props = defineProps({
  件数制限: { type: Boolean, default: true },
  無効も表示: { type: Boolean, default: false },
  有効列表示: { type: Boolean, default: false },
  URLメニュー: { type: String, default: '' },
  URL戻り先: { type: String, default: '' }
});

const router = useRouter();

const 商品分類一覧 = ref<V商品分類[]>([]);
const serverTotal = ref(0);
const pageSize = ref(100);
const currentPage = ref(1);
const sortKey = ref('商品分類ID');
const sortOrder = ref('asc');
const filters = reactive({
  商品分類ID: '',
  商品分類名: '',
  商品分類備考: '',
  更新日時: '',
  更新利用者名: ''
});
const rowKey = '商品分類ID';
const columns = computed<Column[]>(() => {
  const baseColumns: Column[] = [
    { key: '商品分類ID', label: '商品分類ID', width: '120px', sortable: true, align: 'center' },
    { key: '商品分類名', label: '商品分類名', width: '200px', sortable: true },
    { key: '商品分類備考', label: '商品分類備考', width: '220px', sortable: true },
    { key: '更新日時', label: '更新日時', width: '160px', sortable: true },
    { key: '更新利用者名', label: '更新利用者名', width: '130px', sortable: true }
  ];
  if (props.有効列表示) {
    baseColumns.splice(3, 0, { key: '有効', label: '有効', width: '60px', sortable: true, align: 'center' });
  }
  return baseColumns;
});

const message = ref('');
const messageType = ref('success');

const setMessage = (text, type = 'success') => {
  message.value = text;
  messageType.value = type;
};

const hasFilter = computed(() => {
  return Object.values(filters).some((value) => String(value || '').trim() !== '');
});
const filteredRows = computed(() => {
  return 商品分類一覧.value.filter((row) => {
    return columns.value.every((column) => {
      const filterValue = (filters[column.key] || '').trim();
      if (!filterValue) return true;
      const cellValue = row?.[column.key] ?? '';
      return String(cellValue).toLowerCase().includes(filterValue.toLowerCase());
    });
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
  const query: Record<string, string> = { モード: '編集', 商品分類ID: row.商品分類ID };
  if (props.URLメニュー) {
    query.URLメニュー = props.URLメニュー;
  }
  if (props.URL戻り先) {
    query.URL戻り先 = props.URL戻り先;
  }
  router.push({ path: '/Mマスタ/M商品分類/編集', query });
};

const loadData = async () => {
  message.value = '';
  try {
    const res = await apiClient.post('/apps/V商品分類/一覧', {
      件数制限: props.件数制限,
      無効も表示: props.無効も表示
    });
    if (res.data.status === 'OK') {
      const data = res.data.data;
      const items = Array.isArray(data) ? data : data?.items ?? [];
      商品分類一覧.value = items;
      serverTotal.value = Array.isArray(data) ? items.length : Number(data?.total ?? items.length);
      currentPage.value = 1;
    } else {
      setMessage(res.data.message || 'M商品分類一覧の取得に失敗しました。', 'error');
    }
  } catch (e) {
    setMessage('M商品分類一覧の取得でエラーが発生しました。', 'error');
  }
};

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
      <template v-if="column.key === '商品分類ID' || column.key === '商品分類名'">
        <a href="#" class="id-link" @click.prevent="openDetail(row)">{{ value ?? '' }}</a>
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

<style scoped>
</style>
