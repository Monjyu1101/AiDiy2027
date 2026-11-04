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
import { taskChannelName } from '../../../task-session';
import { openTaskDialog } from '../../../task-windows';
// AIタスク_明細一覧: 選択中タスクのタスク明細表をタブラー表示（データは親から受け取る）
// 5秒ごとにタスクID単位の最大更新日時を確認し、変化時は親へ再読込を依頼する
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { PropType } from 'vue';
import type { Column } from '@taskteam/types';
import { taskClient } from '@taskteam/api/client';
import { qConfirm, qMessage } from '@taskteam/utils/qAlert';
import qTublerFrame from '@taskteam/_share/qTublerFrame.vue';
import qBooleanCheckbox from '@taskteam/_share/qBooleanCheckbox.vue';
import AIタスク明細編集 from '../dialog/AIタスク_明細編集.vue';
import AIタスク応答内容 from '../dialog/AIタスク_応答内容.vue';

const props = defineProps({
  タスクID: { type: String, default: '' },
  明細: { type: Array as PropType<Record<string, any>[]>, default: () => [] },
  showHeader: { type: Boolean, default: true }
});
const emit = defineEmits(['reload']);

const currentPage = ref(1);
const pageSize = ref(100);
const rowKey = '明細SEQ';

const columns: Column[] = [
  { key: '明細SEQ', label: 'SEQ', width: '50px', sortable: false, align: 'center' },
  { key: 'タイプ', label: 'タイプ', width: '60px', sortable: false, align: 'center' },
  { key: 'タイトル', label: 'タイトル', width: '150px', sortable: false },
  { key: '先行SEQ', label: '先行SEQ', width: '80px', sortable: false, align: 'center' },
  { key: '操作検証', label: '操作検証', width: '60px', sortable: false, align: 'center' },
  { key: '実行有効', label: '実行有効', width: '60px', sortable: false, align: 'center' },
  { key: '状態', label: '状態', width: '90px', sortable: false, align: 'center' },
  { key: 'PID', label: 'PID', width: '60px', sortable: false, align: 'center' },
  { key: '開始日時', label: '開始日時', width: '140px', sortable: false, align: 'center' },
  { key: '終了日時', label: '終了日時', width: '140px', sortable: false, align: 'center' },
  { key: '実行回数', label: '実行回数', width: '70px', sortable: false, align: 'right' },
  { key: '予測分数', label: '予測分', width: '60px', sortable: false, align: 'right' },
  { key: '実績分数', label: '実績分', width: '60px', sortable: false, align: 'right' },
  { key: '応答内容', label: '応答内容', width: '240px', sortable: false },
  { key: '更新日時', label: '更新日時', width: '140px', sortable: false, align: 'center' }
];

const totalCount = computed(() => props.明細.length);
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize.value)));
const pagedRows = computed(() => {
  const startIndex = (currentPage.value - 1) * pageSize.value;
  return props.明細.slice(startIndex, startIndex + pageSize.value);
});

const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value) return;
  currentPage.value = page;
};

// タイプセルのクラス: start / end / if / or を色で区別する（do は既定色）
const タイプクラス = (value: any) => {
  const タイプ = String(value ?? '');
  if (タイプ === 'start') return 'type-start';
  if (タイプ === 'end') return 'type-end';
  if (タイプ === 'if') return 'type-if';
  if (タイプ === 'or') return 'type-or';
  return '';
};

// 状態セルのクラス: 実行中は緑ブリンク（行は薄緑）、完了/エラー/中止は行を灰色にするマーカー
// エラー/中止は状態セルの文字を赤にする
const 状態クラス = (value: any) => {
  const 状態 = String(value ?? '');
  if (状態 === '実行中') return 'status-running';
  if (状態 === 'エラー' || 状態 === '中止') return 'status-done status-alert';
  // パスは if 分岐で通らなかっただけなので、失敗の赤ではなく淡色にする
  if (状態 === 'パス') return 'status-done status-passed';
  if (状態 === '完了') return 'status-done';
  return '';
};

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let dialogChannel: BroadcastChannel | null = null;
let 明細最大更新日時 = '';

const 最大更新日時取得 = async () => {
  if (!props.タスクID) return '';
  const res = await taskClient.post('/task/タスク明細/最大更新日時', {
    タスクID: props.タスクID
  });
  if (res.data.status !== 'OK') return 明細最大更新日時;
  return String(res.data.data?.最大更新日時 ?? '');
};

const 更新基準初期化 = async () => {
  if (!props.タスクID) {
    明細最大更新日時 = '';
    return;
  }
  try {
    明細最大更新日時 = await 最大更新日時取得();
  } catch {
    明細最大更新日時 = '';
  }
};

const 更新確認 = async () => {
  if (!props.タスクID) return;
  try {
    const 最大更新日時 = await 最大更新日時取得();
    if (最大更新日時 !== 明細最大更新日時) {
      明細最大更新日時 = 最大更新日時;
      emit('reload');
    }
  } catch {
    // 自動更新確認の失敗は、通常操作を邪魔しない
  }
};

const 自動更新開始 = () => {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => void 更新確認(), 5000);
};

// 実行有効欄クリック: 確認のうえタスク明細 1 行の実行有効フラグを切り替える
const 実行有効切替 = async (row: Record<string, any>) => {
  const 新実行有効 = !row.実行有効;
  // 有効化はエラー・完了とも待機へ戻す（＝そのステップの再実行）ので、その旨を確認文に出す
  const 確認文 = 新実行有効
    ? 'タスク明細を有効化しますか？\nエラー・完了のステップは待機に戻り、もう一度実行されます。'
    : 'タスク明細を無効化しますか？';
  const confirmed = await qConfirm(確認文);
  if (!confirmed) return;
  try {
    const res = await taskClient.post('/task/タスク明細/実行有効切替', {
      タスクID: props.タスクID,
      明細SEQ: Number(row.明細SEQ ?? 0),
      実行有効: 新実行有効
    });
    if (res.data.status === 'OK') {
      void qMessage(res.data.message || (新実行有効 ? 'タスク明細を有効化しました。' : 'タスク明細を無効化しました。'));
      emit('reload');
    } else {
      void qMessage(res.data.message || '実行有効フラグの変更に失敗しました。', 'error');
    }
  } catch (e) {
    void qMessage('実行有効フラグの変更でエラーが発生しました。backend_taskteam (8093) の起動を確認してください。', 'error');
  }
};

// ==================================================
// タスク明細修正ダイアログ
// ==================================================
const dialogOpen = ref(false);
const 編集明細 = ref<Record<string, any> | null>(null);

const 修正ダイアログ表示 = (row: Record<string, any>) => {
  if (window.aidiyWindow?.taskWindows) {
    void openTaskDialog({
      kind: 'detail',
      編集明細: { ...row }
    });
    return;
  }
  編集明細.value = { ...row };
  dialogOpen.value = true;
};

const 登録完了 = () => {
  emit('reload');
};

// ==================================================
// 応答内容表示ダイアログ
// ==================================================
const 応答内容ダイアログ表示 = ref(false);
const 応答内容タイトル = ref('');
const 応答内容要求値 = ref('');
const 応答内容表示値 = ref('');

const 応答内容を開く = (row: Record<string, any>) => {
  const 要求内容 = String(row.要求内容 ?? '');
  const 内容 = String(row.応答内容 ?? '');
  if (!要求内容.trim() && !内容.trim()) return;
  const タイトル = `要求・応答内容 - ${props.タスクID}/${row.明細SEQ}${row.タイトル ? ' ' + row.タイトル : ''}`;
  if (window.aidiyWindow?.taskWindows) {
    void openTaskDialog({
      kind: 'response',
      タイトル,
      要求内容,
      内容
    });
    return;
  }
  応答内容タイトル.value = タイトル;
  応答内容要求値.value = 要求内容;
  応答内容表示値.value = 内容;
  応答内容ダイアログ表示.value = true;
};

const handleRowDblClick = (row: Record<string, any>) => {
  応答内容を開く(row);
};

watch(() => props.タスクID, async () => {
  currentPage.value = 1;
  await 更新基準初期化();
}, { immediate: true });

onMounted(() => {
  if (window.aidiyWindow?.taskWindows) {
    dialogChannel = new BroadcastChannel(taskChannelName('dialog'));
    dialogChannel.addEventListener('message', (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object' || payload.type !== 'task-dialog-registered') return;
      if (payload.kind !== 'detail') return;
      emit('reload');
    });
  }
  自動更新開始();
});

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  dialogChannel?.close();
  dialogChannel = null;
});
</script>

<template>
  <div class="detail-panel">
    <div v-if="props.showHeader" class="panel-header">
      <span class="panel-title">【タスク明細】</span>
      <span v-if="props.タスクID" class="panel-subtitle">{{ props.タスクID }}</span>
    </div>

    <div class="panel-body">
      <div v-if="!props.タスクID" class="panel-placeholder">
        タスク要求を選択してください
      </div>
      <qTublerFrame
        v-else
        :columns="columns"
        :rows="pagedRows"
        :rowKey="rowKey"
        :totalCount="totalCount"
        :totalAll="totalCount"
        :currentPage="currentPage"
        :totalPages="totalPages"
        @page="goToPage"
        @row-dblclick="handleRowDblClick"
      >
        <template #cell="{ row, column, value }">
          <template v-if="column.key === '明細SEQ'">
            <a
              href="#"
              class="seq-link"
              @click.prevent="修正ダイアログ表示(row)"
            >{{ value ?? '' }}</a>
          </template>
          <template v-else-if="column.key === 'タイプ'">
            <span :class="タイプクラス(value)">{{ value ?? '' }}</span>
          </template>
          <template v-else-if="column.key === '操作検証'">
            <span class="check-flag">
              <qBooleanCheckbox :checked="Boolean(value)" ariaLabel="操作検証状態" />
            </span>
          </template>
          <template v-else-if="column.key === '実行有効'">
            <button
              type="button"
              class="valid-toggle"
              title="有効化/無効化を切り替え"
              @click="実行有効切替(row)"
            >
              <qBooleanCheckbox :checked="Boolean(value)" ariaLabel="実行有効状態" />
            </button>
          </template>
          <template v-else-if="column.key === '予測分数' || column.key === '実績分数'">
            <!-- 未見積り・未実行の 0 は空欄にして、値のある行だけ目に入るようにする -->
            {{ Number(value ?? 0) > 0 ? value : '' }}
          </template>
          <template v-else-if="column.key === '状態'">
            <span :class="状態クラス(value)">{{ value ?? '' }}</span>
          </template>
          <template v-else-if="column.key === '応答内容'">
            <a
              v-if="String(value ?? '').trim()"
              href="#"
              class="seq-link"
              @click.prevent="応答内容を開く(row)"
            >{{ value }}</a>
            <template v-else>{{ value ?? '' }}</template>
          </template>
          <template v-else>
            {{ value ?? '' }}
          </template>
        </template>
      </qTublerFrame>
    </div>

    <component
      :is="AIタスク明細編集"
      :is-open="dialogOpen"
      :編集明細="編集明細"
      @close="dialogOpen = false"
      @registered="登録完了"
    />

    <AIタスク応答内容
      :is-open="応答内容ダイアログ表示"
      :タイトル="応答内容タイトル"
      :要求内容="応答内容要求値"
      :内容="応答内容表示値"
      @close="応答内容ダイアログ表示 = false"
    />
  </div>
</template>

<style scoped>
.detail-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: #ddd;
}

/* 見出しはアバター画面の紫タイトルバー（_WindowShell purple）と同色 */
.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  height: 28px;
  box-sizing: border-box;
  background: linear-gradient(135deg, rgba(108, 78, 196, 0.94), rgba(143, 104, 221, 0.9));
  border-bottom: 1px solid rgba(93, 68, 168, 0.95);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(44, 24, 101, 0.3);
  flex-shrink: 0;
}

.panel-title {
  font-size: 13px;
  color: #fff;
  font-weight: bold;
  letter-spacing: 1px;
}

.panel-subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 8px;
}

/* 表の行がない領域はパネルの黒地を見せる */
.panel-body :deep(.common-table) {
  background-color: transparent;
}

/* データなし表示は表の中央に置く */
.panel-body :deep(.common-table table:has(td.empty)) {
  height: 100%;
}

/* 表は黒文字（行ゼブラは qTubler 標準のまま） */
.panel-body :deep(tbody td) {
  color: #000;
  padding: 2px 6px;
  font-size: 10px;
  line-height: 1.15;
}

.panel-body :deep(tbody tr:nth-child(odd)) {
  background-color: #fff;
}

.panel-body :deep(tbody tr:nth-child(even)) {
  background-color: #eef3f8;
}

/* 行カラーリング: 完了/エラー/中止は灰色、実行中は薄緑 */
.panel-body :deep(tbody tr:has(.status-done) td) {
  background-color: #d9d9d9;
  color: #555;
}

.panel-body :deep(tbody tr:has(.status-running) td) {
  background-color: #d9f2e0;
}

.panel-body :deep(tbody tr:hover td) {
  background-color: #dceeff;
}

/* 実行中: 状態セルの文字は緑ブリンク */
.panel-body :deep(.status-running) {
  color: #15803d;
  font-weight: 700;
  animation: status-blink 1s ease-in-out infinite;
}

/* エラー/中止: 状態セルの文字は赤 */
.panel-body :deep(.status-alert) {
  color: #dc2626;
  font-weight: 700;
}

/* タイプ: start / end / if / or に色を付け、do は既定色のままにする */
.panel-body :deep(.type-start) {
  color: #1d4ed8;
  font-weight: 700;
}

.panel-body :deep(.type-end) {
  color: #b45309;
  font-weight: 700;
}

.panel-body :deep(.type-if) {
  color: #7c3aed;
  font-weight: 700;
}

.panel-body :deep(.type-or) {
  color: #0e7490;
  font-weight: 700;
}

/* パス: 分岐で通らなかった枝。エラーの赤とは分けて、通らなかったことだけ示す */
.panel-body :deep(.status-passed) {
  color: #9e9e9e;
  font-weight: 700;
}

@keyframes status-blink {
  50% {
    opacity: 0.2;
  }
}

.panel-body :deep(tbody td a),
.panel-body :deep(tbody td button) {
  font-size: inherit;
}

.panel-body :deep(.table-footer) {
  min-height: 28px;
  padding: 2px 6px;
  gap: 8px;
  flex-wrap: nowrap;
  box-sizing: border-box;
  font-size: 11px;
}

.panel-body :deep(.table-count) {
  min-width: 120px;
}

.panel-body :deep(.pager) {
  gap: 3px;
  flex-wrap: nowrap;
}

.panel-body :deep(.pager-btn) {
  min-width: 26px;
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
}

.panel-body :deep(.pager-current) {
  min-width: 24px;
  font-size: 11px;
}

.panel-placeholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(220, 214, 247, 0.55);
  font-size: 13px;
}

/* 操作検証は実行有効と同じ大きさに揃え、色は淡いグレー（クリックできない表示専用の印） */
.check-flag {
  display: inline-flex;
  align-items: center;
}

.check-flag :deep(.readonly-checkbox) {
  width: 12px;
  height: 12px;
}

.check-flag :deep(.readonly-checkbox-mark) {
  font-size: 9px;
}

.check-flag :deep(.readonly-checkbox.is-checked) {
  border-color: #9aa8b5;
  background: #9aa8b5;
}

.valid-toggle {
  background: none;
  border: none;
  border-bottom: 1px solid #000;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}

.valid-toggle :deep(.readonly-checkbox) {
  width: 12px;
  height: 12px;
}

.valid-toggle :deep(.readonly-checkbox-mark) {
  font-size: 9px;
}

.seq-link {
  color: #000;
  font-weight: normal;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.seq-link:hover {
  text-decoration: underline;
}
</style>
