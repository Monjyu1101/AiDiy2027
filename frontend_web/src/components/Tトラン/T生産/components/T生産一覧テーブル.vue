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
  生産工程ID: {
    type: String,
    default: ''
  },
  生産区分ID: {
    type: String,
    default: ''
  },
  受入商品ID: {
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

const 生産一覧 = ref([]);
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
  単位: '',
  生産区分名: '',
  生産工程名: '',
  生産内容: '',
  生産備考: '',
  更新日時: '',
  更新利用者名: ''
});
const rowKey = '生産伝票ID';
const columns = computed<Column[]>(() => {
  const baseColumns: Column[] = [
    { key: '生産伝票ID',   label: '生産伝票ID',   width: '120px', sortable: true, align: 'center' },
    { key: '生産開始日時', label: '開始日時',     width: '155px', sortable: true, align: 'center' },
    { key: '生産終了日時', label: '終了日時',     width: '155px', sortable: true, align: 'center' },
    { key: '受入商品ID',   label: '受入商品ID',   width: '100px', sortable: true, align: 'center' },
    { key: '受入商品名',   label: '受入商品名',   width: '160px', sortable: true },
    { key: '受入数量',     label: '受入数量',     width: '100px', sortable: true, align: 'right' },
    { key: '単位',         label: '単位',         width: '70px',  sortable: true, align: 'center' },
    { key: '生産区分名',   label: '生産区分',     width: '110px', sortable: true, align: 'center' },
    { key: '生産工程名',   label: '生産工程',     width: '130px', sortable: true, align: 'center' },
    { key: '生産内容',     label: '生産内容',     width: '200px', sortable: true },
    { key: '生産備考',     label: '生産備考',     width: '180px', sortable: true },
    { key: '更新日時',     label: '更新日時',     width: '155px', sortable: true },
    { key: '更新利用者名', label: '更新利用者名', width: '120px', sortable: true }
  ];
  if (props.有効列表示) {
    baseColumns.splice(11, 0, { key: '有効', label: '有効', width: '60px', sortable: true, align: 'center' });
  }
  return baseColumns;
});

const formatDateTime = (val: string | null | undefined) => {
  if (!val) return '';
  const s = String(val);
  if (s.length >= 16) {
    return s.substring(0, 10) + ' ' + s.substring(11, 16);
  }
  return s;
};

const message = ref('');
const messageType = ref('success');

const setMessage = (text, type = 'success') => {
  message.value = text;
  messageType.value = type;
};

const hasFilter = computed((): boolean => {
  return Boolean(Object.values(filters).some((value) => String(value || '').trim() !== '') ||
    props.開始日付 ||
    props.終了日付 ||
    props.生産工程ID ||
    props.生産区分ID ||
    props.受入商品ID);
});
const filteredRows = computed(() => {
  return 生産一覧.value.filter((row) => {
    // 列フィルタのチェック
    const columnMatch = columns.value.every((column) => {
      const filterValue = (filters[column.key] || '').trim();
      if (!filterValue) return true;
      const cellValue = row?.[column.key] ?? '';
      return String(cellValue).toLowerCase().includes(filterValue.toLowerCase());
    });

    if (!columnMatch) return false;

    // 日付条件のチェック
    const startDate = String(row?.['生産開始日時'] ?? '').slice(0, 10);
    const endDate = String(row?.['生産終了日時'] ?? '').slice(0, 10);

    if (props.開始日付) {
      const startOk =
        (startDate && startDate >= props.開始日付) ||
        (endDate && endDate >= props.開始日付);
      if (!startOk) return false;
    }

    if (props.終了日付) {
      const endOk =
        (startDate && startDate <= props.終了日付) ||
        (endDate && endDate <= props.終了日付);
      if (!endOk) return false;
    }

    if (props.生産工程ID) {
      const rowProcessId = String(row?.生産工程ID ?? '');
      if (rowProcessId !== String(props.生産工程ID)) return false;
    }

    if (props.生産区分ID) {
      if (String(row?.生産区分ID ?? '') !== String(props.生産区分ID)) return false;
    }

    if (props.受入商品ID) {
      const filter = props.受入商品ID.toLowerCase();
      if (!String(row?.受入商品ID ?? '').toLowerCase().includes(filter)) return false;
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
  const query: Record<string, any> = { モード: '編集', 生産伝票ID: row.生産伝票ID };
  if (props.URLメニュー) {
    query.URLメニュー = props.URLメニュー;
  }
  if (props.URL戻り先) {
    query.URL戻り先 = props.URL戻り先;
  }
  router.push({ path: '/Tトラン/T生産/編集', query });
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
    if (props.生産区分ID) payload.生産区分ID = String(props.生産区分ID);
    if (props.生産工程ID) payload.生産工程ID = String(props.生産工程ID);
    if (props.受入商品ID) payload.受入商品ID = String(props.受入商品ID);
    const res = await apiClient.post(
      '/apps/V生産/一覧',
      Object.keys(payload).length ? payload : undefined
    );
    if (res.data.status === 'OK') {
      const data = res.data.data;
      const items = Array.isArray(data) ? data : data?.items ?? [];
      生産一覧.value = items;
      serverTotal.value = Array.isArray(data) ? items.length : Number(data?.total ?? items.length);
      currentPage.value = 1;
    } else {
      setMessage(res.data.message || 'T生産一覧の取得に失敗しました。', 'error');
    }
  } catch (e) {
    setMessage('T生産一覧の取得でエラーが発生しました。', 'error');
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
      <template v-if="column.key === '生産伝票ID'">
        <a href="#" class="id-link" @click.prevent="openDetail(row)">{{ row.生産伝票ID }}</a>
      </template>
      <template v-else-if="column.key === '有効'">
        <qBooleanCheckbox :checked="Boolean(row.有効)" ariaLabel="有効状態" />
      </template>
      <template v-else-if="['生産開始日時', '生産終了日時', '更新日時'].includes(column.key)">
        {{ formatDateTime(value) }}
      </template>
      <template v-else-if="column.key === '受入数量'">
        {{ value != null ? Number(value).toLocaleString('ja-JP', { maximumFractionDigits: 3 }) : '' }}
      </template>
      <template v-else>
        {{ value ?? '' }}
      </template>
    </template>
  </qTublerFrame>
</template>

<style scoped>
.unit-label {
  margin-left: 4px;
  font-size: 11px;
  color: #666;
}
</style>
