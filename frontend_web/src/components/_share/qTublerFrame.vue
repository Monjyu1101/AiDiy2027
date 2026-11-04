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
import { watch } from 'vue';
import type { PropType } from 'vue';
import type { Column } from '@/types/qTubler';
import { qMessage } from '@/utils/qAlert';

const props = defineProps({
  columns: {
    type: Array as PropType<Column[]>,
    required: true
  },
  rows: {
    type: Array as PropType<Record<string, any>[]>,
    default: () => []
  },
  rowKey: {
    type: [String, Function] as PropType<string | ((row: Record<string, any>, index: number) => string | number)>,
    default: 'id'
  },
  emptyText: {
    type: String,
    default: 'データがありません。'
  },
  caption: {
    type: String,
    default: ''
  },
  sortKey: {
    type: String,
    default: ''
  },
  sortOrder: {
    type: String,
    default: 'asc'
  },
  message: {
    type: String,
    default: ''
  },
  messageType: {
    type: String,
    default: 'success'
  },
  hasFilter: {
    type: Boolean,
    default: false
  },
  totalCount: {
    type: Number,
    default: 0
  },
  totalAll: {
    type: Number,
    default: 0
  },
  currentPage: {
    type: Number,
    default: 1
  },
  totalPages: {
    type: Number,
    default: 1
  }
});

const emit = defineEmits(['sort', 'page', 'row-click', 'row-dblclick']);

const changePage = (page: number) => {
  if (page < 1 || page > props.totalPages) return;
  emit('page', page);
};

const resolveRowKey = (row: Record<string, any>, index: number): string | number => {
  if (typeof props.rowKey === 'function') {
    return props.rowKey(row, index);
  }
  if (typeof props.rowKey === 'string' && row?.[props.rowKey] !== undefined) {
    return row[props.rowKey];
  }
  return index;
};

const columnStyle = (
  column: Column
): { width: string | undefined; textAlign: 'left' | 'right' | 'center' } => ({
  width: column.width || undefined,
  textAlign: column.align || 'left'
});

const isSortable = (column: Column): boolean => column.sortable !== false;

const handleSort = (column: Column) => {
  if (!isSortable(column)) return;
  emit('sort', column);
};

const handleRowClick = (row: Record<string, any>, event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('a, button, input, select, textarea, label')) return;
  emit('row-click', row);
};

const handleRowDblClick = (row: Record<string, any>, event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('button, input, select, textarea, label')) return;
  emit('row-dblclick', row);
};

watch(
  () => [props.message, props.messageType] as const,
  ([message, messageType]) => {
    if (!message) return;
    void qMessage(message, messageType || 'success');
  }
);
</script>

<template>
  <div class="table-wrapper">
    <div class="table-container">
      <div class="common-table">
        <table>
          <caption v-if="caption">{{ caption }}</caption>
          <thead>
            <tr>
              <th v-for="column in columns" :key="column.key" :style="columnStyle(column)">
                <button
                  v-if="isSortable(column)"
                  type="button"
                  class="sort-button"
                  @click="handleSort(column)"
                >
                  <span>{{ column.label }}</span>
                  <span v-if="sortKey === column.key" class="sort-indicator">
                    {{ sortOrder === 'desc' ? '▼' : '▲' }}
                  </span>
                  <span v-else class="sort-indicator sort-indicator-muted">↕</span>
                </button>
                <span v-else>{{ column.label }}</span>
              </th>
              <th class="dummy-column"></th>
            </tr>
            <tr v-if="$slots.filter">
              <th v-for="column in columns" :key="column.key" :style="columnStyle(column)">
                <slot name="filter" :column="column"></slot>
              </th>
              <th class="dummy-column"></th>
            </tr>
          </thead>
          <tbody v-if="rows.length">
            <tr
              v-for="(row, index) in rows"
              :key="resolveRowKey(row, index)"
              @click="handleRowClick(row, $event)"
              @dblclick="handleRowDblClick(row, $event)"
            >
              <td v-for="column in columns" :key="column.key" :style="columnStyle(column)">
                <slot name="cell" :row="row" :column="column" :value="row[column.key]">
                  {{ row[column.key] ?? '' }}
                </slot>
              </td>
              <td class="dummy-column"></td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr>
              <td class="empty" :colspan="columns.length + 1">{{ emptyText }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="table-footer">
      <div class="table-count">
        <template v-if="hasFilter">
          絞込 {{ totalCount }} 件 / 全 {{ totalAll }} 件
        </template>
        <template v-else>
          全 {{ totalAll }} 件
        </template>
      </div>
      <div class="pager">
        <button class="pager-btn" :disabled="currentPage === 1" @click="changePage(1)">
          &lt;&lt;
        </button>
        <button class="pager-btn" :disabled="currentPage === 1" @click="changePage(currentPage - 1)">
          &lt;
        </button>
        <span class="pager-current">{{ currentPage }}</span>
        <button class="pager-btn" :disabled="currentPage === totalPages" @click="changePage(currentPage + 1)">
          &gt;
        </button>
        <button class="pager-btn" :disabled="currentPage === totalPages" @click="changePage(totalPages)">
          &gt;&gt;
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-container {
  overflow: auto;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.common-table {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 0;
  overflow: auto;
  box-shadow: none;
  background-color: #f1f5f9;
  flex: 1;
  min-height: 100%;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  color: #1e293b;
  background-color: transparent;
}

caption {
  text-align: left;
  padding: 8px;
  font-weight: bold;
  font-size: 14px;
}

th,
td {
  padding: 6px 10px;
  border-bottom: 1px solid #e2e8f0;
  border-right: 1px solid #e5e7eb;
  vertical-align: middle;
  white-space: nowrap;
}

.dummy-column {
  width: auto;
  padding: 0;
  border-right: none !important;
  pointer-events: none;
}

th:last-child,
td:last-child {
  border-right: none;
}

th {
  background: #37474f;
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-size: 13px;
  line-height: 1.2;
  border-color: #263238;
}

thead th {
  padding: 2px 10px;
  height: auto;
  border-bottom: none;
}

thead tr:first-child th {
  padding-top: 4px;
  padding-bottom: 0;
}

thead tr:nth-child(2) th {
  padding: 0 10px 2px 10px;
  background: #37474f;
  border-bottom: 2px solid #263238;
}

.sort-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: #fff;
  cursor: pointer;
  transition: color 0.15s;
}

.sort-button:hover {
  color: #b0bec5;
}

.sort-indicator {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
  transition: color 0.15s;
}

.sort-button:hover .sort-indicator {
  color: #fff;
}

.sort-indicator-muted {
  opacity: 0.4;
}

tbody tr:nth-child(even) {
  background: #f9fafb;
}

tbody tr:hover {
  background: #e0f2fe;
  transition: background 0.15s;
}

tbody tr {
  border-bottom: 1px solid #f1f5f9;
  background-color: #fff;
}

tbody td {
  color: #475569;
}

.empty {
  text-align: center;
  padding: 40px 20px;
  color: #94a3b8;
  font-size: 14px;
}
</style>

<style>
/* 共通テーブルフッタースタイル */
.table-footer {
  margin-top: 0;
  padding: 5px 6px;
  background: #37474f;
  border: 1px solid #263238;
  border-top: 0;
  border-radius: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #fff;
  flex-shrink: 0;
}

.table-count {
  min-width: 160px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.pager-btn {
  min-width: 34px;
  padding: 6px 10px;
  border: 1px solid #546e7a;
  background: #546e7a;
  color: #fff;
  font-size: 12px;
  border-radius: 0;
  cursor: pointer;
}

.pager-btn:hover {
  background: #607d8b;
}

.pager-btn.active {
  background: #263238;
  color: #fff;
  border-color: #263238;
}

.pager-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.pager-current {
  min-width: 32px;
  text-align: center;
  font-weight: 600;
  color: #fff;
}

/* 共通フィルター入力スタイル */
.filter-input {
  display: block;
  width: 100%;
  padding: 2px 6px;
  border: 1px solid #cbd5e1;
  border-radius: 0;
  margin: 0;
  font-size: 13px;
  background: #fff;
  line-height: 1.2;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.filter-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.filter-input::placeholder {
  color: #94a3b8;
}

/* 共通IDリンクスタイル */
.id-link {
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
  transition: color 0.15s;
}

.id-link:hover {
  color: #1d4ed8;
  text-decoration: underline;
}

</style>
