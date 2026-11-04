<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { teamClient } from '@taskteam/api/client';
import AiTeamMemberSummon from '../dialog/AIチーム_要員召喚.vue';
import type { エージェント, チーム状況, チーム要員, 状態表示 } from '../AIチーム_型';
import { use自由配置パネル } from '../use自由配置パネル';
import { use表示連動ポーリング } from '../use表示連動ポーリング';

const props = defineProps<{
  エージェント一覧: エージェント[];
  選択中ID: string;
  選択中エージェント: エージェント | null;
  排除中ID: string;
  状態情報: 状態表示;
  召喚可能要員一覧: チーム要員[];
  召喚対象ID: string;
  召喚中: boolean;
  要員読込中: boolean;
  要員読込エラー: string;
  召喚実行: () => Promise<boolean>;
  要員再読込: () => Promise<void>;
}>();

const emit = defineEmits<{
  select: [id: string];
  /** その要員の一人称視点へ切り替える */
  視点: [id: string];
  /** その要員との会話ダイアログを開く */
  会話: [id: string];
  /** 草原の生き物の一人称視点へ切り替える */
  生き物視点: [名前: string];
  expel: [];
  'update:summonTarget': [id: string];
}>();

// 草原にいる NPC のうち、一人称で動かせる生き物
const 生き物一覧 = ['馬', 'イヌ', 'ネコ', 'うさぎ', 'カモ'];

// 押したボタンにフォーカスが残っていると、一人称の矢印キー操作がボタン側へ渡ってしまう
const フォーカスを外す = (event: Event) => {
  (event.currentTarget as HTMLElement | null)?.blur();
};

const 生き物視点を選ぶ = (名前: string, event: Event) => {
  フォーカスを外す(event);
  emit('生き物視点', 名前);
};

// ダブルクリック（会話）でも 1 回目の click が先に来るため、視点の切り替えだけ少し待って、
// ダブルクリックだと分かった時点で取り消す
let 視点待ちタイマー = 0;

const 要員をクリック = (id: string, event: Event) => {
  フォーカスを外す(event);
  emit('select', id);
  window.clearTimeout(視点待ちタイマー);
  視点待ちタイマー = window.setTimeout(() => emit('視点', id), 260);
};

const 要員をダブルクリック = (id: string) => {
  window.clearTimeout(視点待ちタイマー);
  emit('select', id);
  emit('会話', id);
};

const 召喚ダイアログ表示 = ref(false);
const {
  panelRef,
  位置,
  zIndex,
  開いている,
  開閉を切替,
  ドラッグ開始,
  ドラッグ中,
  ドラッグ終了,
} = use自由配置パネル('AIチーム_メンバー位置', 'left');

const 召喚ダイアログを開く = () => {
  召喚ダイアログ表示.value = true;
};

const 状況一覧 = ref<チーム状況[]>([]);
// 開いている間は10秒、折り畳み中は20秒ごとに更新確認し、非表示中は停止する
const 更新確認間隔ミリ秒 = 10_000;
const 強制更新間隔ミリ秒 = 30_000;
let 状況最大更新日時 = '';
let 状況最終読込時刻 = 0;

const 選択中状況 = computed(
  () => 状況一覧.value.find((item) => item.要員ID === props.選択中エージェント?.id) ?? null,
);

const 要員別状況 = computed(
  () => new Map(状況一覧.value.map((item) => [item.要員ID, item])),
);

const 最大更新日時を取得する = async (): Promise<string> => {
  const response = await teamClient.post('/team/状況/最大更新日時', {});
  if (response.data?.status !== 'OK') return 状況最大更新日時;
  return String(response.data?.data?.最大更新日時 ?? '');
};

const 状況を読み込む = async (確認済み最大更新日時?: string) => {
  try {
    const response = await teamClient.post('/team/状況/一覧', {});
    if (response.data?.status !== 'OK') return;
    const items = response.data?.data?.items;
    if (Array.isArray(items)) 状況一覧.value = items as チーム状況[];
    状況最終読込時刻 = Date.now();
    状況最大更新日時 = 確認済み最大更新日時 ?? await 最大更新日時を取得する();
  } catch {
    // 自動更新確認の失敗は、通常操作を邪魔しない。
  }
};

const 状況更新を確認する = async () => {
  try {
    const 最大更新日時 = await 最大更新日時を取得する();
    const 元データ変更あり = 最大更新日時 !== 状況最大更新日時;
    const 三十秒経過 = Date.now() - 状況最終読込時刻 >= 強制更新間隔ミリ秒;
    if (元データ変更あり || 三十秒経過) await 状況を読み込む(最大更新日時);
  } catch {
    // 自動更新確認の失敗は、通常操作を邪魔しない。
  }
};

use表示連動ポーリング(状況更新を確認する, 更新確認間隔ミリ秒, 開いている);

onMounted(async () => {
  await 状況を読み込む();
});

onBeforeUnmount(() => {
  window.clearTimeout(視点待ちタイマー);
  状況最大更新日時 = '';
  状況最終読込時刻 = 0;
});
</script>

<template>
  <aside
    ref="panelRef"
    class="agent-panel"
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
      <span class="panel-title">【要員状況】</span>
      <span class="panel-count">{{ エージェント一覧.length }}名</span>
      <button type="button" class="new-button" @pointerdown.stop @click="召喚ダイアログを開く">召喚</button>
    </div>

    <div v-if="開いている" class="agent-list">
      <button
        v-for="agent in エージェント一覧"
        :key="agent.id"
        type="button"
        class="agent-card"
        :class="{
          selected: agent.id === 選択中ID,
          'state-working': agent.状態 === '作業中',
          'state-meditating': agent.状態 === '瞑想中',
          'state-resting': agent.状態 === '休憩中',
        }"
        :title="`クリックで ${agent.名前} の視点へ / ダブルクリックで会話`"
        @click="要員をクリック(agent.id, $event)"
        @dblclick="要員をダブルクリック(agent.id)"
      >
        <span class="agent-avatar" :style="{ '--agent-color': agent.色CSS }">
          {{ agent.名前.slice(0, 1) }}
        </span>
        <span class="agent-copy">
          <span class="agent-name-row">
            <strong>{{ agent.名前 }} - {{ agent.状態 }}</strong>
          </span>
          <span class="agent-role-row">
            <span class="agent-role">{{ agent.役割 }}</span>
            <span class="agent-counts">
              <span class="agent-running-count">実行 {{ 要員別状況.get(agent.id)?.実行数 ?? 0 }}</span>
              <span class="agent-summary-count">まとめ {{ 要員別状況.get(agent.id)?.まとめ中数 ?? 0 }}</span>
            </span>
          </span>
        </span>
      </button>
    </div>

    <!-- 草原の生き物の視点。要員と同じく、選ぶとその目線に切り替わる -->
    <div v-if="開いている" class="creature-row">
      <button
        v-for="生き物 in 生き物一覧"
        :key="生き物"
        type="button"
        class="creature-button"
        :title="`${生き物}の視点へ`"
        @click="生き物視点を選ぶ(生き物, $event)"
      >{{ 生き物 }}</button>
    </div>

    <div v-if="開いている && 選択中エージェント" class="agent-detail">
      <div class="detail-top">
        <span class="detail-pulse" :style="{ background: 選択中エージェント.色CSS }"></span>
        <span>{{ 選択中エージェント.状態 }}</span>
      </div>
      <strong>{{ 選択中エージェント.作業内容 }}</strong>
      <p v-if="選択中エージェント.ひとこと">「{{ 選択中エージェント.ひとこと }}」</p>
      <div v-if="選択中状況" class="status-summary">
        <div class="status-row">
          <span class="status-chip status-waiting">待機 {{ 選択中状況.待機数 }}</span>
          <span class="status-chip status-done">完了 {{ 選択中状況.完了数 }}</span>
          <span class="status-chip status-error">エラー {{ 選択中状況.エラー数 }}</span>
        </div>
        <small>最終更新: {{ 選択中状況.最終更新日時 || '-' }}</small>
      </div>
      <small v-else class="status-empty">直近24時間のAIタスク実績はありません</small>
      <div class="member-action">
        <span v-if="選択中エージェント.id === 'admin'">初期メンバー・退場不可</span>
        <button
          v-else
          type="button"
          :disabled="排除中ID === 選択中エージェント.id"
          @click="emit('expel')"
        >
          {{ 排除中ID === 選択中エージェント.id ? '退場中' : '要員を退場' }}
        </button>
      </div>
    </div>
  </aside>

  <component
    :is="AiTeamMemberSummon"
    :isOpen="召喚ダイアログ表示"
    :召喚可能要員一覧="召喚可能要員一覧"
    :召喚対象ID="召喚対象ID"
    :召喚中="召喚中"
    :要員読込中="要員読込中"
    :要員読込エラー="要員読込エラー"
    :召喚実行="召喚実行"
    :要員再読込="要員再読込"
    @close="召喚ダイアログ表示 = false"
    @update:summon-target="emit('update:summonTarget', $event)"
  />
</template>

<style scoped>
.agent-panel {
  width: 240px;
  /* 画面縦幅の 80% までに収め、あふれる分は要員一覧側で縦スクロールさせる。
     縦の狭い画面では画面割合が置き場所（.workspace）を超えてしまうので、そちらも上限にする */
  max-height: min(80vh, calc(100% - 36px));
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
  z-index: 8;
  will-change: transform;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
}

.agent-panel:hover {
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
.agent-panel.collapsed {
  padding-bottom: 0;
  opacity: 0.34;
}

.agent-panel.collapsed:hover,
.agent-panel.collapsed:focus-within {
  opacity: 1;
}

.agent-panel.collapsed .panel-header {
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

.agent-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 5px;
  /* grid の子が内容幅で膨らんでスクロールバーと重ならないようにする */
  align-content: start;
}

.agent-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: #dceaf1;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.agent-card:hover {
  background: rgba(75, 125, 151, 0.1);
}

.agent-card.selected {
  border-color: rgba(83, 200, 235, 0.3);
  background: linear-gradient(90deg, rgba(48, 146, 184, 0.2), rgba(50, 78, 111, 0.08));
}

.agent-card.state-working {
  border-color: rgba(70, 190, 255, 0.78);
  animation: working-blink 1.8s ease-in-out infinite;
}

.agent-card.state-meditating {
  border-color: rgba(72, 235, 164, 0.76);
  animation: meditating-blink 2.2s ease-in-out infinite;
}

.agent-card.state-resting {
  border-color: rgba(132, 145, 153, 0.24);
  background: rgba(82, 91, 97, 0.1);
  filter: saturate(0.58);
  opacity: 0.82;
}

@keyframes working-blink {
  0%, 100% {
    background: rgba(49, 145, 211, 0.14);
    box-shadow: inset 0 0 5px rgba(70, 190, 255, 0.12);
  }
  50% {
    border-color: rgba(105, 215, 255, 1);
    background: rgba(42, 159, 232, 0.4);
    box-shadow: inset 0 0 16px rgba(91, 210, 255, 0.34), 0 0 8px rgba(70, 190, 255, 0.25);
  }
}

@keyframes meditating-blink {
  0%, 100% {
    background: rgba(51, 160, 117, 0.13);
    box-shadow: inset 0 0 5px rgba(72, 235, 164, 0.11);
  }
  50% {
    border-color: rgba(112, 255, 195, 1);
    background: rgba(45, 185, 128, 0.38);
    box-shadow: inset 0 0 16px rgba(91, 255, 185, 0.31), 0 0 8px rgba(72, 235, 164, 0.23);
  }
}



.agent-avatar {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--agent-color) 65%, transparent);
  border-radius: 10px;
  color: var(--agent-color);
  background: color-mix(in srgb, var(--agent-color) 13%, #10202c);
  font-size: 13px;
  font-weight: 800;
}

.agent-copy {
  min-width: 0;
  flex: 1;
}

.agent-name-row {
  display: flex;
  align-items: center;
}

.agent-name-row strong {
  font-size: 12px;
}

.agent-role {
  display: block;
  overflow: hidden;
  color: #718a9d;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.creature-row {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.creature-button {
  flex: 1 1 auto;
  padding: 5px 6px;
  border: 1px solid rgba(123, 227, 176, 0.3);
  border-radius: 7px;
  color: #a9dcc2;
  background: rgba(45, 96, 74, 0.22);
  cursor: pointer;
  font-size: 10px;
  line-height: 1.3;
  white-space: nowrap;
}

.creature-button:hover {
  border-color: rgba(123, 227, 176, 0.7);
  color: #e2f7ec;
  background: rgba(45, 130, 94, 0.4);
}

.agent-detail {
  flex: none;
  margin-top: 16px;
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(12, 27, 41, 0.75);
}

.detail-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
  color: #8ba3b2;
  font-size: 9px;
}

.detail-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.agent-detail strong {
  display: block;
  color: #dcebf2;
  font-size: 11px;
  line-height: 1.5;
}

.agent-detail p {
  margin: 6px 0 0;
  color: #88a9ba;
  font-size: 10px;
  line-height: 1.5;
}

.status-summary {
  margin: 12px 0 6px;
}

.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 6px;
}

.status-chip {
  padding: 3px 7px;
  border: 1px solid rgba(120, 151, 169, 0.3);
  border-radius: 999px;
  color: #b7c9d3;
  background: rgba(120, 151, 169, 0.12);
  font-size: 9px;
  font-weight: 700;
}

.status-chip.status-waiting {
  border-color: rgba(139, 184, 255, 0.4);
  color: #8bb8ff;
  background: rgba(139, 184, 255, 0.12);
}

.status-chip.status-running {
  border-color: rgba(101, 232, 183, 0.4);
  color: #65e8b7;
  background: rgba(101, 232, 183, 0.12);
}

.agent-role-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  min-width: 0;
}

.agent-summary-count {
  padding: 1px 5px;
  border: 1px solid rgba(255, 207, 115, 0.44);
  border-radius: 999px;
  color: #ffcf73;
  background: rgba(255, 207, 115, 0.12);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.35;
}

.agent-counts {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
}

.agent-running-count {
  padding: 1px 5px;
  border: 1px solid rgba(101, 232, 183, 0.4);
  border-radius: 999px;
  color: #65e8b7;
  background: rgba(101, 232, 183, 0.12);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.35;
}

.status-chip.status-done {
  border-color: rgba(120, 151, 169, 0.4);
  color: #9fb4c0;
  background: rgba(120, 151, 169, 0.12);
}

.status-chip.status-error {
  border-color: rgba(255, 107, 129, 0.4);
  color: #ff8fa3;
  background: rgba(255, 107, 129, 0.12);
}

.status-empty {
  display: block;
  margin: 12px 0 6px;
  color: #5f7686;
  font-size: 9px;
}

.agent-detail small {
  color: #5f7686;
  font-size: 8px;
}

.member-action {
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 10px;
}

.member-action span {
  color: #6f8797;
  font-size: 9px;
}

.member-action button {
  padding: 6px 9px;
  border: 1px solid rgba(232, 108, 128, 0.38);
  border-radius: 7px;
  color: #ff9bab;
  background: rgba(117, 31, 50, 0.18);
  cursor: pointer;
  font-size: 9px;
}

@media (max-width: 760px) {
  .agent-panel {
    width: min(240px, calc(100% - 24px));
  }

  .agent-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
