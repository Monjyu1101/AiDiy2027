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

const props = defineProps({
  URLメニュー: { type: String, default: '' },
  URL戻り先: { type: String, default: '' }
});

const router = useRouter();

const 得意先一覧 = ref([]);
const pageSize = ref(100);
const currentPage = ref(1);
const sortKey = ref('得意先ID');
const sortOrder = ref('asc');
const filters = reactive({
  得意先ID: '',
  得意先名: '',
  得意先備考: '',
  更新日時: '',
  更新利用者名: ''
});
const rowKey = '得意先ID';
const columns = [
  { key: '得意先ID', label: '得意先ID', width: '120px', sortable: true },
  { key: '得意先名', label: '得意先名', width: '240px', sortable: true },
  { key: '得意先備考', label: '得意先備考', width: '260px', sortable: true },
  { key: '更新日時', label: '更新日時', width: '160px', sortable: true },
  { key: '更新利用者名', label: '更新利用者名', width: '130px', sortable: true }
];

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
  return 得意先一覧.value.filter((row) => {
    return columns.every((column) => {
      const filterValue = (filters[column.key] || '').trim();
      if (!filterValue) return true;
      const cellValue = row?.[column.key] ?? '';
      return String(cellValue).toLowerCase().includes(filterValue.toLowerCase());
    });
  });
});
const totalCount = computed(() => filteredRows.value.length);
const totalAll = computed(() => 得意先一覧.value.length);
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
  const query: Record<string, string> = { モード: '編集', 得意先ID: row.得意先ID };
  if (props.URLメニュー) query.URLメニュー = props.URLメニュー;
  if (props.URL戻り先) query.URL戻り先 = props.URL戻り先;
  router.push({ path: '/Mマスタ/M得意先/編集', query });
};

const loadData = async () => {
  message.value = '';
  try {
    const res = await apiClient.post('/apps/V得意先/一覧');
    if (res.data.status === 'OK') {
      const data = res.data.data;
      const items = Array.isArray(data) ? data : data?.items ?? [];
      得意先一覧.value = items;
      currentPage.value = 1;
    } else {
      setMessage(res.data.message || 'M得意先一覧の取得に失敗しました。', 'error');
    }
  } catch (e) {
    setMessage('M得意先一覧の取得でエラーが発生しました。', 'error');
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
      <template v-if="column.key === '得意先ID'">
        <a href="#" class="id-link" @click.prevent="openDetail(row)">{{ row.得意先ID }}</a>
      </template>
      <template v-else>
        {{ value ?? '' }}
      </template>
    </template>
  </qTublerFrame>
</template>
