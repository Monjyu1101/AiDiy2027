<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup lang="ts">
// 開いている間は5秒、折り畳み中は10秒ごとに更新確認し、非表示中は停止する
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { teamClient } from '@taskteam/api/client';
import 再読込ボタン from '@taskteam/components/再読込ボタン.vue';
import TeamWorkEdit from '../dialog/AIチーム_依頼編集.vue';
import AIチーム_応答内容 from '../dialog/AIチーム_応答内容.vue';
import type { チーム依頼 } from '../AIチーム_型';
import { use自由配置パネル } from '../use自由配置パネル';
import { use表示連動ポーリング } from '../use表示連動ポーリング';

const props = defineProps<{
  利用者ID: string;
  利用者名: string;
}>();

const 要員ID = computed(() => props.利用者ID || 'admin');
const 依頼一覧 = ref<チーム依頼[]>([]);
const 読込中 = ref(false);
const 読込エラー = ref('');
const 編集ダイアログ表示 = ref(false);
const 編集依頼 = ref<チーム依頼 | null>(null);
let 依頼最大更新日時 = '';
let 依頼取得中 = false;

// 一覧は未完了を上に表示するため先頭行＝最終更新とは限らない。
// 新規依頼へ引き継ぐ値は、状態に関係なく本当の最終レコードから取得する。
const 最終依頼 = computed<チーム依頼 | null>(() => {
  const items = [...依頼一覧.value];
  items.sort((a, b) =>
    String(b.更新日時 ?? '').localeCompare(String(a.更新日時 ?? ''))
    || String(b.依頼ID ?? '').localeCompare(String(a.依頼ID ?? '')),
  );
  return items[0] ?? null;
});

const {
  panelRef,
  位置,
  zIndex,
  開いている,
  開閉を切替,
  ドラッグ開始,
  ドラッグ中,
  ドラッグ終了,
} = use自由配置パネル('AIチーム_依頼状況位置', 'right', 'top', {
  initialOpen: false,
});

const 最大更新日時取得 = async (): Promise<string> => {
  const response = await teamClient.post('/team/依頼/最大更新日時', {
    要員ID: 要員ID.value,
  });
  if (response.data?.status !== 'OK') return 依頼最大更新日時;
  return String(response.data?.data?.最大更新日時 ?? '');
};

const 依頼一覧読込 = async (読込表示 = true) => {
  if (依頼取得中) return;
  依頼取得中 = true;
  if (読込表示) {
    読込中.value = true;
    読込エラー.value = '';
  }
  try {
    // 一覧取得中に更新が入った場合は、次回確認で拾えるよう基準を先に取得する。
    const newBaseline = await 最大更新日時取得();
    const response = await teamClient.post('/team/依頼/一覧', { 要員ID: 要員ID.value });
    if (response.data?.status !== 'OK') {
      throw new Error(response.data?.message || 'チーム依頼を取得できませんでした');
    }
    const items = response.data?.data?.items;
    if (!Array.isArray(items)) throw new Error('チーム依頼の応答形式が正しくありません');
    依頼一覧.value = items as チーム依頼[];
    依頼最大更新日時 = newBaseline;
    読込エラー.value = '';
  } catch (error) {
    if (読込表示) {
      読込エラー.value = error instanceof Error ? error.message : 'チーム依頼を取得できませんでした';
    }
  } finally {
    if (読込表示) 読込中.value = false;
    依頼取得中 = false;
  }
};

const 更新確認 = async () => {
  try {
    if (依頼取得中) return;
    const maxUpdatedAt = await 最大更新日時取得();
    if (maxUpdatedAt !== 依頼最大更新日時) await 依頼一覧読込(false);
  } catch {
    // 自動更新確認の失敗は、通常操作を邪魔しない。
  }
};

use表示連動ポーリング(更新確認, 5000, 開いている);

const 新規依頼を開く = () => {
  編集依頼.value = null;
  編集ダイアログ表示.value = true;
};

const 依頼を開く = (work: チーム依頼) => {
  編集依頼.value = work;
  編集ダイアログ表示.value = true;
};

const 応答内容ダイアログ表示 = ref(false);
const 応答内容タイトル = ref('');
const 応答内容要求値 = ref('');
const 応答内容表示値 = ref('');
const まとめ内容表示値 = ref('');

const 応答内容を開く = (work: チーム依頼) => {
  const 要求 = String(work.要求内容 ?? '');
  const 内容 = String(work.応答内容 ?? '');
  const まとめ = String(work.まとめ内容 ?? '');
  if (!要求.trim() && !内容.trim() && !まとめ.trim()) return;
  応答内容タイトル.value = `要求・応答内容 - ${work.依頼ID}${work.応答タイトル ? ' / ' + work.応答タイトル : ''}`;
  応答内容要求値.value = 要求;
  応答内容表示値.value = 内容;
  まとめ内容表示値.value = まとめ;
  応答内容ダイアログ表示.value = true;
};

// シングルクリックで編集ダイアログ、ダブルクリックで応答内容ダイアログ。
// クリックをそのまま処理すると dblclick 時に編集ダイアログが割り込むため、
// 一定時間待って dblclick が来なければシングルクリック扱いにする。
let 行クリックタイマー: ReturnType<typeof setTimeout> | null = null;

const 行クリック = (work: チーム依頼) => {
  if (行クリックタイマー) clearTimeout(行クリックタイマー);
  行クリックタイマー = setTimeout(() => {
    行クリックタイマー = null;
    依頼を開く(work);
  }, 220);
};

const 行ダブルクリック = (work: チーム依頼) => {
  if (行クリックタイマー) {
    clearTimeout(行クリックタイマー);
    行クリックタイマー = null;
  }
  応答内容を開く(work);
};

const 保存後処理 = (work: チーム依頼) => {
  const index = 依頼一覧.value.findIndex((item) => item.依頼ID === work.依頼ID);
  if (index >= 0) 依頼一覧.value.splice(index, 1, work);
  else 依頼一覧.value.unshift(work);
};

const 状態class = (status: チーム依頼['状態']) => ({
  waiting: ['準備開始', '準備中', '準備完了', '待機'].includes(status),
  working: status === '実行中',
  completed: status === '完了' || status === '済',
  stopped: status === 'エラー' || status === '中止',
});

// 行カラーリング: 表示優先順位が9（backend算出の灰色対象）の行を灰色にする
const 行状態クラス = (work: チーム依頼) => (Number(work.表示優先順位 ?? 1) === 9 ? 'row-inactive' : '');

onMounted(async () => {
  await 依頼一覧読込();
});

onBeforeUnmount(() => {
  if (行クリックタイマー) clearTimeout(行クリックタイマー);
});
</script>

<template>
  <aside
    ref="panelRef"
    class="task-panel"
    :class="{ collapsed: !開いている }"
    :style="{ transform: `translate3d(${位置.x}px, ${位置.y}px, 0)`, zIndex }"
  >
    <div
      class="panel-header drag-handle"
      title="ドラッグして移動"
      @pointerdown="ドラッグ開始"
      @pointermove="ドラッグ中"
      @pointerup="ドラッグ終了"
      @pointercancel="ドラッグ終了"
    >
      <button
        type="button"
        class="collapse-toggle"
        :title="開いている ? '閉じる' : '開く'"
        :aria-expanded="開いている"
        @pointerdown.stop
        @click="開閉を切替"
      >{{ 開いている ? '▼' : '▶' }}</button>
      <span class="panel-title">【依頼状況】</span>
      <span class="panel-count">{{ 依頼一覧.length }}件</span>
      <button type="button" class="new-button" @pointerdown.stop @click="新規依頼を開く">追加</button>
    </div>

    <div v-if="開いている" class="table-frame">
      <table>
        <thead>
          <tr>
            <th>依頼ID</th>
            <th>タイトル</th>
            <th>状態</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="work in 依頼一覧"
            :key="work.依頼ID"
            :class="行状態クラス(work)"
            @click="行クリック(work)"
            @dblclick="行ダブルクリック(work)"
          >
            <td class="work-id">{{ work.依頼ID }}</td>
            <td>
              <strong>{{ work.タイトル || '（タイトルなし）' }}</strong>
              <small>{{ work.TEAM_AI_NAME }} / {{ work.TEAM_AI_MODEL_do }}</small>
            </td>
            <td>
              <span class="status-badge" :class="状態class(work.状態)">{{ work.状態 }}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="読込中" class="panel-message">チーム依頼を読み込んでいます…</div>
      <div v-else-if="読込エラー" class="panel-message error">
        <span>{{ 読込エラー }}</span>
        <component :is="再読込ボタン" label="再読込" @click="() => 依頼一覧読込()" />
      </div>
      <div v-else-if="依頼一覧.length === 0" class="panel-message">
        登録済みのチーム依頼はありません。
      </div>
    </div>
  </aside>

  <component
    :is="TeamWorkEdit"
    :isOpen="編集ダイアログ表示"
    :編集依頼="編集依頼"
    :最終依頼="最終依頼"
    :利用者ID="props.利用者ID"
    :利用者名="props.利用者名"
    @close="編集ダイアログ表示 = false"
    @saved="保存後処理"
  />

  <AIチーム_応答内容
    :is-open="応答内容ダイアログ表示"
    :タイトル="応答内容タイトル"
    :要求内容="応答内容要求値"
    :内容="応答内容表示値"
    :まとめ内容="まとめ内容表示値"
    @close="応答内容ダイアログ表示 = false"
  />
</template>

<style scoped>
.task-panel {
  width: 430px;
  max-width: calc(100% - 24px);
  /* 画面縦幅の 50% までに収め、あふれる分は本体側で縦スクロールさせる。
     縦の狭い画面では画面割合が置き場所（.workspace）を超えてしまうので、そちらも上限にする */
  max-height: min(50vh, calc(100% - 36px));
  position: absolute;
  top: 0;
  left: 0;
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(93, 68, 168, 0.95);
  background: rgba(11, 24, 37, 0.94);
  box-shadow: 0 18px 45px rgba(2, 8, 14, 0.42);
  z-index: 7;
  will-change: transform;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
}

.task-panel:hover {
  border-color: rgba(154, 120, 235, 0.95);
  box-shadow:
    0 18px 45px rgba(2, 8, 14, 0.42),
    0 0 0 1px rgba(154, 120, 235, 0.4),
    0 0 16px rgba(154, 120, 235, 0.4);
}

.panel-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -18px -14px 14px;
  padding: 0 10px;
  height: 28px;
  box-sizing: border-box;
  background: linear-gradient(135deg, rgba(108, 78, 196, 0.78), rgba(143, 104, 221, 0.72));
  border-bottom: 1px solid rgba(93, 68, 168, 0.95);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(44, 24, 101, 0.3);
}

.collapse-toggle {
  flex: none;
  width: 18px;
  height: 18px;
  margin-left: -2px;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}

.collapse-toggle:hover {
  background: rgba(255, 255, 255, 0.16);
}

/* 閉じたときはタイトルバーだけを残す（本体側の余白を消す）。
   草原を広く見せたいので、折り畳み中は薄くして背景を透かす（触れると戻る） */
.task-panel.collapsed {
  padding-bottom: 0;
  opacity: 0.34;
}

.task-panel.collapsed:hover,
.task-panel.collapsed:focus-within {
  opacity: 1;
}

.task-panel.collapsed .panel-header {
  margin-bottom: 0;
}

.panel-title {
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  white-space: nowrap;
}

.panel-count {
  color: #e4ddff;
  font-size: 10px;
  font-weight: 700;
}

.drag-handle {
  cursor: move;
  touch-action: none;
  user-select: none;
}

.new-button {
  margin-left: auto;
  height: 22px;
  padding: 0 14px;
  border: none;
  border-radius: 3px;
  background-color: #28a745;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

.new-button:hover {
  background-color: #1e7e34;
}


.table-frame {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid rgba(139, 206, 231, 0.12);
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

th {
  padding: 4px 8px;
  color: #718b9b;
  background: rgba(18, 38, 54, 0.9);
  text-align: left;
  font-size: 9px;
}

th:first-child {
  width: 112px;
}

th:last-child {
  width: 56px;
  text-align: center;
}

td {
  padding: 3px 8px;
  border-top: 1px solid rgba(139, 206, 231, 0.08);
  color: #d8e8ef;
  vertical-align: middle;
  font-size: 10px;
  line-height: 1.25;
}

tbody tr {
  cursor: pointer;
  transition: background 0.15s ease;
}

tbody tr:hover {
  background: rgba(75, 125, 151, 0.12);
}

/* 行カラーリング: 表示優先順位9（完了/済/エラー/中止）は灰色 */
tbody tr.row-inactive {
  background: rgba(255, 255, 255, 0.03);
}

tbody tr.row-inactive td {
  color: #5f7686;
}

tbody tr.row-inactive .work-id {
  color: #4a5b68;
}

tbody tr.row-inactive td small {
  color: #4a5b68;
}

.work-id {
  color: #7bbbd0;
  font-family: Consolas, monospace;
  font-size: 8px;
}

td strong,
td small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

td small {
  margin-top: 0;
  color: #60798a;
  font-size: 8px;
}

.status-badge {
  display: inline-block;
  width: 48px;
  padding: 1px 0;
  border: 1px solid #60798a;
  border-radius: 999px;
  text-align: center;
  font-size: 8px;
}

.status-badge.waiting {
  color: #ffd580;
  border-color: rgba(255, 213, 128, 0.4);
}

.status-badge.working {
  color: #65e8b7;
  border-color: rgba(101, 232, 183, 0.4);
}

.status-badge.completed {
  color: #7bbdff;
  border-color: rgba(123, 189, 255, 0.4);
}

.status-badge.stopped {
  color: #ff9bab;
  border-color: rgba(255, 155, 171, 0.4);
}

.panel-message {
  min-height: 96px;
  display: grid;
  place-items: center;
  gap: 8px;
  padding: 16px;
  color: #718b9b;
  text-align: center;
  font-size: 10px;
}

.panel-message.error {
  color: #ff9bab;
}

@media (max-width: 760px) {
  .task-panel {
    width: min(430px, calc(100% - 24px));
  }
}
</style>
