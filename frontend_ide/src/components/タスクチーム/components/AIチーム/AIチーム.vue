<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { teamClient } from '@taskteam/api/client';
import AiTeamMembers from './components/AIチーム_要員状況.vue';
import AiTeamViewer from './components/AIチーム_空間表示.vue';
import AiTeamWorkList from './components/AIチーム_依頼状況.vue';
import AiTeamExpList from './components/AIチーム_経験状況.vue';
import AiTeamPdcaList from './components/AIチーム_作業状況.vue';
import AiTeamTalkList from './components/AIチーム_会話状況.vue';
import AiTeamGoalEdit from './dialog/AIチーム_目標編集.vue';
import { use表示連動ポーリング } from './use表示連動ポーリング';
import {
  type エージェント,
  type エージェント状態,
  type チーム目標,
  type チーム要員,
  type 稼働要員,
  状態情報,
  要員色一覧,
} from './AIチーム_型';

const props = defineProps<{
  利用者ID: string;
  利用者名: string;
}>();

const 稼働要員を変換 = (要員: 稼働要員, index: number): エージェント => {
  const state: エージェント状態 = 要員.状態 in 状態情報 ? 要員.状態 : '召喚中';
  const 色設定 = 要員色一覧[index % 要員色一覧.length] ?? 要員色一覧[0];
  return {
    id: 要員.エージェントID,
    名前: 要員.エージェント名,
    役割: 要員.役割,
    人格情報: 要員.人格情報,
    ...色設定,
    状態: state,
    作業内容: 要員.作業内容 || '次の行動を考えています',
    ひとこと: 要員.ひとこと || '',
    状態更新時刻: 8 + Math.random() * 8,
  };
};

// カメラと会話ダイアログは空間表示が持っているため、【要員状況】の操作をここから中継する
const 空間表示Ref = ref<InstanceType<typeof AiTeamViewer> | null>(null);
const エージェント一覧 = ref<エージェント[]>([]);
const 召喚要員一覧 = ref<チーム要員[]>([]);
const 選択中ID = ref('');
const 召喚対象ID = ref('');
const 要員読込中 = ref(false);
const 要員読込エラー = ref('');
const 召喚中 = ref(false);
const 排除中ID = ref('');
let 要員取得中 = false;
// チーム空間の掲示板に出す「最終更新のチーム目標」と、その保守ダイアログ
const チーム目標 = ref<チーム目標 | null>(null);
// 作業ループがオンかつチーム作業入力済みか（掲示板と同じ5秒周期で更新。赤ネオンに使う）
const 作業実行中 = ref(false);
const 目標編集表示 = ref(false);

const 選択中エージェント = computed(
  () => エージェント一覧.value.find((agent) => agent.id === 選択中ID.value) ?? null,
);
const 召喚可能要員一覧 = computed(() => {
  const summonedIds = new Set(エージェント一覧.value.map((agent) => agent.id));
  return 召喚要員一覧.value.filter((member) => !summonedIds.has(member.要員ID));
});

const 召喚対象を補正 = (preferredId = '') => {
  if (preferredId && 召喚可能要員一覧.value.some((member) => member.要員ID === preferredId)) {
    召喚対象ID.value = preferredId;
    return;
  }
  if (!召喚可能要員一覧.value.some((member) => member.要員ID === 召喚対象ID.value)) {
    召喚対象ID.value = 召喚可能要員一覧.value[0]?.要員ID ?? '';
  }
};

const 要員一覧を読み込む = async (読込表示 = true) => {
  if (要員取得中) return;
  要員取得中 = true;
  if (読込表示) {
    要員読込中.value = true;
    要員読込エラー.value = '';
  }
  try {
    const [activeResponse, summonResponse] = await Promise.all([
      teamClient.post('/team/エージェント/一覧', {}),
      teamClient.post('/team/召喚要員/一覧', {}),
    ]);
    if (activeResponse.data?.status !== 'OK') {
      throw new Error(activeResponse.data?.message || '稼働要員を取得できませんでした');
    }
    if (summonResponse.data?.status !== 'OK') {
      throw new Error(summonResponse.data?.message || '召喚要員一覧を取得できませんでした');
    }
    const activeItems = activeResponse.data?.data?.items;
    const summonItems = summonResponse.data?.data?.items;
    if (!Array.isArray(activeItems) || !Array.isArray(summonItems)) {
      throw new Error('要員一覧の応答形式が正しくありません');
    }
    召喚要員一覧.value = summonItems as チーム要員[];
    const 現在選択ID = 選択中ID.value;
    エージェント一覧.value = (activeItems as 稼働要員[]).map(稼働要員を変換);
    選択中ID.value = エージェント一覧.value.some((agent) => agent.id === 現在選択ID)
      ? 現在選択ID
      : エージェント一覧.value[0]?.id ?? '';
    召喚対象を補正();
    要員読込エラー.value = '';
  } catch (error) {
    // 5秒ごとの自動更新失敗では、現在の空間表示を黒いエラー表示に差し替えない。
    if (読込表示) {
      要員読込エラー.value = error instanceof Error ? error.message : '要員一覧を取得できませんでした';
    }
  } finally {
    if (読込表示) 要員読込中.value = false;
    要員取得中 = false;
  }
};

const 選択要員を召喚 = async () => {
  if (召喚中.value || !召喚対象ID.value) return false;
  召喚中.value = true;
  要員読込エラー.value = '';
  try {
    const response = await teamClient.post('/team/エージェント/召喚', {
      要員ID: 召喚対象ID.value,
    });
    if (response.data?.status !== 'OK') {
      throw new Error(response.data?.message || '要員を召喚できませんでした');
    }
    const item = response.data?.data as 稼働要員 | undefined;
    if (!item?.エージェントID) {
      throw new Error('召喚結果の応答形式が正しくありません');
    }
    const agent = 稼働要員を変換(item, エージェント一覧.value.length);
    エージェント一覧.value.push(agent);
    選択中ID.value = agent.id;
    召喚対象を補正();
    return true;
  } catch (error) {
    要員読込エラー.value = error instanceof Error ? error.message : '要員を召喚できませんでした';
    return false;
  } finally {
    召喚中.value = false;
  }
};

const 選択要員を排除 = async () => {
  const agent = 選択中エージェント.value;
  if (!agent || agent.id === 'admin' || 排除中ID.value) return;
  排除中ID.value = agent.id;
  要員読込エラー.value = '';
  try {
    const response = await teamClient.post('/team/エージェント/排除', {
      要員ID: agent.id,
    });
    if (response.data?.status !== 'OK') {
      throw new Error(response.data?.message || '要員を排除できませんでした');
    }
    エージェント一覧.value = エージェント一覧.value.filter((item) => item.id !== agent.id);
    選択中ID.value = エージェント一覧.value[0]?.id ?? '';
    召喚対象を補正(agent.id);
  } catch (error) {
    要員読込エラー.value = error instanceof Error ? error.message : '要員を排除できませんでした';
  } finally {
    排除中ID.value = '';
  }
};

const チーム目標を読み込む = async () => {
  try {
    const response = await teamClient.post('/team/目標/最終', {});
    if (response.data?.status !== 'OK') return;
    const item = response.data.data?.item as チーム目標 | undefined;
    チーム目標.value = item && item.CODE_BASE_PATH ? item : null;
    作業実行中.value = Boolean(チーム目標.value) && Boolean(response.data.data?.作業実行中);
  } catch {
    // 掲示板は表示だけなので、取得できないときは未登録扱いにする
    チーム目標.value = null;
    作業実行中.value = false;
  }
};

const 目標保存後 = (item: チーム目標) => {
  チーム目標.value = item;
  // 保存で作業ループのON/OFFやループ回数が変わるため、実行中かどうかを取り直す
  void チーム目標を読み込む();
};

// 掲示板に出ているプロジェクト。経験状況・作業状況はこのパスの分だけを表示する
const 掲示板プロジェクト = computed(() => String(チーム目標.value?.CODE_BASE_PATH ?? ''));
// 作業状況は、掲示板の目標で作業ループがオンのときだけ出す（オフなら表示しない）
const 作業ループ有効 = computed(() => Boolean(チーム目標.value?.作業ループ));
// 会話状況は、目標を入力して自動作業をオンにし、まだチーム作業を決めていない協議中だけ出す
const チーム会話表示中 = computed(() => (
  Boolean(String(チーム目標.value?.チーム目標 ?? '').trim())
  && Boolean(チーム目標.value?.自動作業設定)
  && !String(チーム目標.value?.チーム作業 ?? '').trim()
));

const 全体更新 = () => {
  void 要員一覧を読み込む(false);
  void チーム目標を読み込む();
};

use表示連動ポーリング(全体更新, 5000);

onMounted(() => {
  void 要員一覧を読み込む();
  void チーム目標を読み込む();
});
</script>

<template>
  <section class="team-page">
    <div class="panel-header">
      <span class="panel-title">【AIチーム】</span>
    </div>

    <div class="workspace">
      <AiTeamMembers
        :エージェント一覧="エージェント一覧"
        :選択中ID="選択中ID"
        :選択中エージェント="選択中エージェント"
        :排除中ID="排除中ID"
        :状態情報="状態情報"
        :召喚可能要員一覧="召喚可能要員一覧"
        :召喚対象ID="召喚対象ID"
        :召喚中="召喚中"
        :要員読込中="要員読込中"
        :要員読込エラー="要員読込エラー"
        :召喚実行="選択要員を召喚"
        :要員再読込="要員一覧を読み込む"
        @select="選択中ID = $event"
        @視点="空間表示Ref?.一人称へ入る($event)"
        @会話="空間表示Ref?.会話を開く($event)"
        @生き物視点="空間表示Ref?.生き物視点へ入る($event)"
        @expel="選択要員を排除"
        @update:summon-target="召喚対象ID = $event"
      />
      <AiTeamViewer
        ref="空間表示Ref"
        :エージェント一覧="エージェント一覧"
        :選択中ID="選択中ID"
        :要員読込中="要員読込中"
        :要員読込エラー="要員読込エラー"
        :チーム目標="チーム目標"
        :作業実行中="作業実行中"
        @retry="要員一覧を読み込む"
        @目標クリック="目標編集表示 = true"
      />
      <AiTeamWorkList :利用者ID="props.利用者ID" :利用者名="props.利用者名" />
      <AiTeamExpList :プロジェクト="掲示板プロジェクト" />
      <AiTeamPdcaList v-if="作業ループ有効" :プロジェクト="掲示板プロジェクト" />
      <AiTeamTalkList v-if="チーム会話表示中" :プロジェクト="掲示板プロジェクト" />
    </div>

    <AiTeamGoalEdit
      :isOpen="目標編集表示"
      :利用者ID="props.利用者ID"
      :利用者名="props.利用者名"
      @close="目標編集表示 = false"
      @saved="目標保存後"
    />
  </section>
</template>

<style scoped>
.team-page {
  --panel: rgba(11, 24, 37, 0.94);
  --line: rgba(139, 206, 231, 0.14);
  --muted: #7891a3;
  min-height: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #edf8ff;
  background: radial-gradient(circle at 48% -20%, rgba(50, 163, 203, 0.16), transparent 42%), #07111d;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 28px;
  box-sizing: border-box;
  background: linear-gradient(135deg, rgba(108, 78, 196, 0.78), rgba(143, 104, 221, 0.72));
  border-bottom: 1px solid rgba(93, 68, 168, 0.95);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(44, 24, 101, 0.3);
  z-index: 4;
  flex-shrink: 0;
}

.panel-title {
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  white-space: nowrap;
}

.workspace {
  min-height: 0;
  flex: 1;
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

@media (max-width: 1180px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .team-page {
    height: auto;
    overflow: visible;
  }

  .workspace {
    display: flex;
    flex-direction: column;
  }
}
</style>
