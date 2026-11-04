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
  開始日付: { type: String, default: '' },
  終了日付: { type: String, default: '' },
  生産工程ID: { type: String, default: '' },
  生産区分ID: { type: String, default: '' },
  払出商品ID: { type: String, default: '' },
  件数制限: { type: Boolean, default: true },
  無効も表示: { type: Boolean, default: false },
  有効列表示: { type: Boolean, default: false },
  URLメニュー: { type: String, default: '' },
  URL戻り先: { type: String, default: '' }
});

const 払出一覧 = ref([]);
const serverTotal = ref(0);
const pageSize = ref(100);
const currentPage = ref(1);
const sortKey = ref('生産開始日時');
const sortOrder = ref('desc');

const filters = reactive({
  生産伝票ID: '',
  生産開始日時: '',
  生産終了日時: '',
  受入商品ID: '',
  受入商品名: '',
  受入数量: '',
  受入単位: '',
  払出商品ID: '',
  払出商品名: '',
  払出数量: '',
  払出単位: '',
  所要数量備考: '',
  生産区分名: '',
  生産工程名: '',
  更新日時: '',
  更新利用者名: ''
});

const rowKey = '一覧行ID';
const columns = computed<Column[]>(() => {
  const baseColumns: Column[] = [
    { key: '生産伝票ID',       label: '生産伝票ID',     width: '120px', sortable: true, align: 'center' },
    { key: '生産開始日時',     label: '開始日時',       width: '130px', sortable: true, align: 'center' },
    { key: '生産終了日時',     label: '終了日時',       width: '130px', sortable: true, align: 'center' },
    { key: '受入商品ID',       label: '受入商品ID',     width: '100px', sortable: true, align: 'center' },
    { key: '受入商品名',       label: '受入商品名',     width: '150px', sortable: true },
    { key: '受入数量',         label: '受入数量',       width: '90px',  sortable: true, align: 'right' },
    { key: '受入単位',         label: '単位',           width: '60px',  sortable: true, align: 'center' },
    { key: '生産区分名',       label: '生産区分',       width: '100px', sortable: true, align: 'center' },
    { key: '生産工程名',       label: '生産工程',       width: '110px', sortable: true, align: 'center' },
    { key: '払出商品ID',       label: '払出商品ID',     width: '100px', sortable: true, align: 'center' },
    { key: '払出商品名',       label: '払出商品名',     width: '150px', sortable: true },
    { key: '払出数量',         label: '払出数量',       width: '90px',  sortable: true, align: 'right' },
    { key: '払出単位',         label: '単位',           width: '60px',  sortable: true, align: 'center' },
    { key: '所要数量備考',     label: '所要数量備考',   width: '160px', sortable: true },
    { key: '更新日時',         label: '更新日時',       width: '130px', sortable: true },
    { key: '更新利用者名',     label: '更新利用者名',   width: '110px', sortable: true }
  ];
  if (props.有効列表示) {
    baseColumns.splice(14, 0, { key: '有効', label: '有効', width: '55px', sortable: true, align: 'center' });
  }
  return baseColumns;
});

const formatDateTime = (val: string | null | undefined) => {
  if (!val) return '';
  const s = String(val);
  return s.length >= 16 ? s.substring(0, 10) + ' ' + s.substring(11, 16) : s;
};

const message = ref('');
const messageType = ref('success');
const setMessage = (text, type = 'success') => {
  message.value = text;
  messageType.value = type;
};

const hasFilter = computed((): boolean => {
  return Boolean(
    Object.values(filters).some((v) => String(v || '').trim() !== '') ||
    props.開始日付 || props.終了日付 || props.生産工程ID || props.生産区分ID || props.払出商品ID
  );
});

const filteredRows = computed(() => {
  return 払出一覧.value.filter((row) => {
    const columnMatch = columns.value.every((col) => {
      const fv = (filters[col.key] || '').trim();
      if (!fv) return true;
      return String(row?.[col.key] ?? '').toLowerCase().includes(fv.toLowerCase());
    });
    if (!columnMatch) return false;

    if (props.生産工程ID && String(row?.生産工程ID ?? '') !== String(props.生産工程ID)) return false;
    if (props.生産区分ID && String(row?.生産区分ID ?? '') !== String(props.生産区分ID)) return false;
    if (props.払出商品ID && String(row?.払出商品ID ?? '') !== String(props.払出商品ID)) return false;

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
    const aVal = a?.[sortKey.value] ?? '';
    const bVal = b?.[sortKey.value] ?? '';
    const aN = Number(aVal), bN = Number(bVal);
    const isNum = !Number.isNaN(aN) && !Number.isNaN(bN);
    const result = isNum ? aN - bN : String(aVal).localeCompare(String(bVal), 'ja');
    return sortOrder.value === 'desc' ? -result : result;
  });
  return rows;
});

const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return sortedRows.value.slice(start, start + pageSize.value);
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
  const query: Record<string, any> = { モード: '編集', 生産伝票ID: row.生産伝票ID };
  if (props.URLメニュー) query.URLメニュー = props.URLメニュー;
  if (props.URL戻り先) query.URL戻り先 = props.URL戻り先;
  router.push({ path: '/Tトラン/T生産/編集', query });
};

const loadData = async () => {
  message.value = '';
  try {
    const payload: Record<string, any> = {
      件数制限: props.件数制限,
      無効も表示: props.無効も表示
    };
    if (props.開始日付) payload.開始日付 = props.開始日付;
    if (props.終了日付) payload.終了日付 = props.終了日付;
    if (props.生産区分ID) payload.生産区分ID = props.生産区分ID;
    if (props.生産工程ID) payload.生産工程ID = props.生産工程ID;
    if (props.払出商品ID) payload.払出商品ID = props.払出商品ID;
    const res = await apiClient.post('/apps/T生産/払出一覧', payload);
    if (res.data.status === 'OK') {
      const data = res.data.data;
      const items = Array.isArray(data) ? data : data?.items ?? [];
      払出一覧.value = items.map((item: any) => ({
        ...item,
        一覧行ID: `${item.生産伝票ID ?? ''}-${item.明細SEQ ?? ''}`
      }));
      serverTotal.value = Array.isArray(data) ? items.length : Number(data?.total ?? items.length);
      currentPage.value = 1;
    } else {
      setMessage(res.data.message || '生産払出一覧の取得に失敗しました。', 'error');
    }
  } catch {
    setMessage('生産払出一覧の取得でエラーが発生しました。', 'error');
  }
};

onMounted(async () => {
  await loadData();
});

defineExpose({ loadData });
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
      <template v-if="column.key === '生産伝票ID'">
        <a href="#" class="id-link" @click.prevent="openDetail(row)">{{ row.生産伝票ID }}</a>
      </template>
      <template v-else-if="column.key === '有効'">
        <qBooleanCheckbox :checked="Boolean(row.有効)" ariaLabel="有効状態" />
      </template>
      <template v-else-if="['生産開始日時', '生産終了日時', '更新日時'].includes(column.key)">
        {{ formatDateTime(value) }}
      </template>
      <template v-else-if="['受入数量', '払出数量'].includes(column.key)">
        {{ value != null ? Number(value).toLocaleString('ja-JP', { maximumFractionDigits: 3 }) : '' }}
      </template>
      <template v-else>
        {{ value ?? '' }}
      </template>
    </template>
  </qTublerFrame>
</template>

<style scoped>
</style>
