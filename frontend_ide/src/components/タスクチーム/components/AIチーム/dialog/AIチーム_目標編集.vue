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
// Aチーム目標の保守: 左に登録済パス一覧、右にパス選択・パス入力・チーム作業入力
import { computed, ref, watch } from 'vue';
import apiClient, { taskClient, teamClient } from '@taskteam/api/client';
import { qConfirm, qMessage } from '@taskteam/utils/qAlert';
import type { チーム目標, チーム要員 } from '../AIチーム_型';

const props = defineProps<{
  isOpen: boolean;
  利用者ID: string;
  利用者名: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [item: チーム目標];
}>();

const 既定パス = '../';
const 既定動員要員数 = 2;
const 既定パターン: 'SPDCA' | 'PlanDo' = 'PlanDo';
const パターン選択肢: { value: 'SPDCA' | 'PlanDo'; label: string }[] = [
  { value: 'SPDCA', label: 'SPDCA（相談→計画→実行→評価→改善）' },
  { value: 'PlanDo', label: 'PlanDo（計画→実行）' },
];
const パターン正規化 = (値: unknown): 'SPDCA' | 'PlanDo' =>
  値 === 'SPDCA' || 値 === 'PlanDo' ? 値 : 既定パターン;
// AI選択肢が読めなかったときに使う最終フォールバック
const 既定AI = {
  TEAM_AI_NAME: 'claude_cli',
  TASK_AI_NAME: 'claude_cli',
  // plan / do / check の3種とも、選択肢が読めないときは auto を最終フォールバックにする
  モデル: 'auto',
};
const 利用者ID = computed(() => props.利用者ID || 'admin');
const 利用者名 = computed(() => props.利用者名 || props.利用者ID || 'admin');

const 目標一覧 = ref<チーム目標[]>([]);
const プロジェクト選択肢 = ref<{ value: string; label: string }[]>([]);
const 選択パス = ref('');
const 入力パス = ref(既定パス);
const 入力テーマ = ref('');
const 入力自動作業設定 = ref(false);
const 入力目標 = ref('');
const 入力作業ループ = ref(false);
const 入力作業ループ回数 = ref(1);
const 入力動員要員数 = ref(既定動員要員数);
const 入力パターン = ref<'SPDCA' | 'PlanDo'>(既定パターン);
const 入力TEAM_AI_NAME = ref(既定AI.TEAM_AI_NAME);
const 入力TEAM_AI_MODEL_plan = ref(既定AI.モデル);
const 入力TEAM_AI_MODEL_do = ref(既定AI.モデル);
const 入力TEAM_AI_MODEL_check = ref(既定AI.モデル);
const 入力TASK_AI_NAME = ref(既定AI.TASK_AI_NAME);
const 入力TASK_AI_MODEL_plan = ref(既定AI.モデル);
const 入力TASK_AI_MODEL_do = ref(既定AI.モデル);
const 入力TASK_AI_MODEL_check = ref(既定AI.モデル);
// AIコアが返す利用可能モデルと、AiDiy_key.json 側の規定値
const 利用可能モデル = ref<Record<string, any>>({ code_models: {} });
const 規定設定 = ref<Record<string, any>>({});
// AI設定の一括反映中は、名称変更に連動するモデル補正を止める
const AI反映中 = ref(false);
const 作業ループ回数選択肢 = Array.from({ length: 99 }, (_, index) => index + 1);
// 相談へ動員できるのは admin 以外の有効要員だけなので、その人数を動員要員数の上限にする
const 有効要員数 = ref(1);
const 動員要員数選択肢 = computed(() =>
  Array.from({ length: Math.max(1, 有効要員数.value) }, (_, index) => index + 1),
);
const 動員要員数を丸める = (人数: unknown) =>
  Math.min(Math.max(1, 有効要員数.value), Math.max(1, Number(人数 ?? 既定動員要員数)));
const AI名称選択肢 = computed(() => Object.keys(利用可能モデル.value?.code_models || {}));
const モデル選択肢 = (AI名称: string) =>
  Object.entries(利用可能モデル.value?.code_models?.[AI名称] || {}).map(([value, label]) => ({
    value,
    label: String(label || value),
  }));
const TEAMモデル選択肢 = computed(() => モデル選択肢(入力TEAM_AI_NAME.value));
const TASKモデル選択肢 = computed(() => モデル選択肢(入力TASK_AI_NAME.value));
// 選択肢に無い値は先頭へ寄せる（環境ごとに使えるAIが違うため）
const 選択可能な値 = (値: unknown, 候補: string[]) => {
  const 文字列 = String(値 || '');
  return 文字列 && 候補.includes(文字列) ? 文字列 : 候補[0] || '';
};

// モデルは plan（相談・計画 = S・P）/ do（実施 = D）/ check（評価・改善 = C・A）の3種
const AIモデルフェーズ = ['plan', 'do', 'check'] as const;
const TEAMモデル入力 = [入力TEAM_AI_MODEL_plan, 入力TEAM_AI_MODEL_do, 入力TEAM_AI_MODEL_check];
const TASKモデル入力 = [入力TASK_AI_MODEL_plan, 入力TASK_AI_MODEL_do, 入力TASK_AI_MODEL_check];

// 目標の値 → AiDiy_key.json の規定値 → 既定AI の順で、選択中AIの候補へ寄せて入れる
const モデル反映 = (接頭辞: 'TEAM' | 'TASK', 元: Partial<チーム目標> | null) => {
  const 規定 = 規定設定.value;
  const 既定値 = 既定AI.モデル;
  const 候補 = (接頭辞 === 'TEAM' ? TEAMモデル選択肢.value : TASKモデル選択肢.value).map(
    (項目) => 項目.value,
  );
  const 入力一覧 = 接頭辞 === 'TEAM' ? TEAMモデル入力 : TASKモデル入力;
  AIモデルフェーズ.forEach((フェーズ, 位置) => {
    const キー = `${接頭辞}_AI_MODEL_${フェーズ}`;
    const 値 =
      (元 as Record<string, any> | null)?.[キー] || 規定[キー] || 既定値;
    入力一覧[位置]!.value = 選択可能な値(値, 候補) || 既定値;
  });
};

const 読込中 = ref(false);
const 参照中 = ref(false);
const 保存中 = ref(false);
const 削除中 = ref(false);

const 選択中か = (パス: string) => 入力パス.value.trim() === パス;
const 既定パス選択中 = computed(() => 入力パス.value.trim() === 既定パス);
const 登録済み = computed(() =>
  目標一覧.value.some((項目) => 項目.CODE_BASE_PATH === 入力パス.value.trim()),
);

// 利用者が自動作業を新たに開始するときは、前回のチーム作業をそのまま再利用させない。
// 一覧・プロジェクト選択によるフォーム反映ではこの処理を通さず、保存済み内容を維持する。
const 自動作業設定を変更 = (event: Event) => {
  const 次の設定 = (event.target as HTMLInputElement).checked;
  if (!入力自動作業設定.value && 次の設定) 入力目標.value = '';
  入力自動作業設定.value = 次の設定;
};

const 目標一覧読込 = async () => {
  読込中.value = true;
  try {
    const response = await teamClient.post('/team/目標/一覧', {});
    if (response.data?.status !== 'OK') {
      void qMessage(response.data?.message || 'チーム目標一覧を取得できませんでした。', 'error');
      return;
    }
    目標一覧.value = (response.data.data?.items ?? []) as チーム目標[];
  } catch {
    void qMessage('チーム目標一覧の取得でエラーが発生しました。backend_taskteam (8093) を確認してください。', 'error');
  } finally {
    読込中.value = false;
  }
};

const プロジェクト選択肢読込 = async () => {
  try {
    const response = await taskClient.post('/task/プロジェクト選択肢', {});
    const options = response.data?.status === 'OK' ? response.data.data?.選択肢 ?? {} : {};
    プロジェクト選択肢.value = Object.entries(options).map(([value, label]) => ({
      value,
      label: `${String(label)} (${value})`,
    }));
  } catch {
    プロジェクト選択肢.value = [];
  }
};

const モデル選択肢読込 = async () => {
  try {
    const [モデル応答, 設定応答] = await Promise.all([
      apiClient.post('/core/AIコア/モデル情報/TASK選択肢', {}),
      teamClient.post('/team/設定/取得', {}),
    ]);
    if (モデル応答.data?.status !== 'OK' || 設定応答.data?.status !== 'OK') throw new Error();
    利用可能モデル.value = モデル応答.data.data?.available_models || { code_models: {} };
    規定設定.value = 設定応答.data.data || {};
  } catch {
    利用可能モデル.value = { code_models: { claude_cli: { auto: 'auto' } } };
    規定設定.value = { ...既定AI };
  }
};

// 目標のAI設定をフォームへ入れる。値が無い項目は AiDiy_key.json の規定値で埋める
const AI設定を反映 = (元: Partial<チーム目標> | null) => {
  AI反映中.value = true;
  const 規定 = 規定設定.value;
  入力TEAM_AI_NAME.value =
    選択可能な値(元?.TEAM_AI_NAME || 規定.TEAM_AI_NAME || 既定AI.TEAM_AI_NAME, AI名称選択肢.value) ||
    既定AI.TEAM_AI_NAME;
  モデル反映('TEAM', 元);
  入力TASK_AI_NAME.value =
    選択可能な値(元?.TASK_AI_NAME || 規定.TASK_AI_NAME || 既定AI.TASK_AI_NAME, AI名称選択肢.value) ||
    既定AI.TASK_AI_NAME;
  モデル反映('TASK', 元);
  AI反映中.value = false;
};

// AI名称を変えたとき、そのAIに無いモデルが残らないよう先頭へ寄せる
watch(入力TEAM_AI_NAME, (value) => {
  if (AI反映中.value) return;
  const models = Object.keys(利用可能モデル.value?.code_models?.[value] || {});
  if (!models.length) return;
  // plan / do / check は同じ AI の候補から選ぶため、AI名変更時はまとめて寄せ直す
  for (const モデル of TEAMモデル入力) {
    if (!models.includes(モデル.value)) モデル.value = models[0]!;
  }
}, { flush: 'sync' });

watch(入力TASK_AI_NAME, (value) => {
  if (AI反映中.value) return;
  const models = Object.keys(利用可能モデル.value?.code_models?.[value] || {});
  if (!models.length) return;
  for (const モデル of TASKモデル入力) {
    if (!models.includes(モデル.value)) モデル.value = models[0]!;
  }
}, { flush: 'sync' });

const フォルダ参照 = async () => {
  参照中.value = true;
  try {
    const response = await apiClient.post('/core/AIコア/フォルダ参照', {
      初期パス: 入力パス.value,
    });
    if (response.data?.status === 'OK') {
      const path = String(response.data.data?.選択パス ?? '').replace(/\\/g, '/');
      if (path) {
        入力パス.value = path;
        選択パス.value = プロジェクト選択肢.value.some((option) => option.value === path)
          ? path
          : '';
      }
    } else {
      void qMessage(response.data?.message || 'フォルダ参照に失敗しました。', 'error');
    }
  } catch {
    void qMessage('フォルダ参照でエラーが発生しました。', 'error');
  } finally {
    参照中.value = false;
  }
};

const 有効要員数読込 = async () => {
  try {
    const response = await teamClient.post('/team/要員/一覧', { 無効も表示: false });
    const items = (response.data?.status === 'OK' ? response.data.data?.items ?? [] : []) as チーム要員[];
    // admin は相談の動員対象外なので数に含めない
    有効要員数.value = Math.max(1, items.filter((要員) => 要員.要員ID !== 'admin').length);
  } catch {
    有効要員数.value = 1;
  }
};

const 一覧から選ぶ = (項目: チーム目標) => {
  選択パス.value = プロジェクト選択肢.value.some((option) => option.value === 項目.CODE_BASE_PATH)
    ? 項目.CODE_BASE_PATH
    : '';
  入力パス.value = 項目.CODE_BASE_PATH;
  入力テーマ.value = 項目.チーム目標;
  入力自動作業設定.value = Boolean(項目.自動作業設定);
  入力目標.value = 項目.チーム作業;
  入力作業ループ.value = Boolean(項目.作業ループ);
  入力作業ループ回数.value = Math.min(99, Math.max(1, Number(項目.作業ループ回数 ?? 1)));
  入力動員要員数.value = 動員要員数を丸める(項目.動員要員数);
  入力パターン.value = パターン正規化(項目.パターン);
  AI設定を反映(項目);
};

watch(選択パス, (value) => {
  if (!value) return;
  入力パス.value = value;
  const 既存 = 目標一覧.value.find((項目) => 項目.CODE_BASE_PATH === value);
  if (既存) {
    入力テーマ.value = 既存.チーム目標;
    入力自動作業設定.value = Boolean(既存.自動作業設定);
    入力目標.value = 既存.チーム作業;
    入力作業ループ.value = Boolean(既存.作業ループ);
    入力作業ループ回数.value = Math.min(99, Math.max(1, Number(既存.作業ループ回数 ?? 1)));
    入力動員要員数.value = 動員要員数を丸める(既存.動員要員数);
    入力パターン.value = パターン正規化(既存.パターン);
    AI設定を反映(既存);
  } else {
    // 未登録パス（新規）は、掲示板に出ている最終目標のAI設定を引き継ぐ
    AI設定を反映(目標一覧.value[0] ?? null);
  }
});

watch(
  () => props.isOpen,
  async (open) => {
    if (!open) return;
    選択パス.value = '';
    入力パス.value = 既定パス;
    入力テーマ.value = '';
    入力自動作業設定.value = false;
    入力目標.value = '';
    入力作業ループ.value = false;
    入力作業ループ回数.value = 1;
    入力パターン.value = 既定パターン;
    // 選択肢の上限は有効要員数に依存するため、読込後に丸め直す
    await Promise.all([目標一覧読込(), プロジェクト選択肢読込(), 有効要員数読込(), モデル選択肢読込()]);
    入力動員要員数.value = 動員要員数を丸める(既定動員要員数);
    // 最終更新の 1 件を初期表示にする（掲示板に出ている目標をそのまま編集できる）
    const 先頭 = 目標一覧.value[0];
    if (先頭) 一覧から選ぶ(先頭);
    // 1件も無ければ規定値をそのまま出す
    else AI設定を反映(null);
  },
  { immediate: true },
);

const 保存 = async () => {
  const パス = 入力パス.value.trim();
  const 目標 = 入力目標.value.trim();
  const テーマ = 入力テーマ.value.trim();
  if (!パス) {
    void qMessage('CODE_BASE_PATH を入力してください。', 'error');
    return;
  }
  if (!目標 && !入力自動作業設定.value) {
    void qMessage('チーム作業を入力してください。', 'error');
    return;
  }
  if (!テーマ) {
    void qMessage('チーム目標を入力してください。', 'error');
    return;
  }
  保存中.value = true;
  try {
    const response = await teamClient.post('/team/目標/保存', {
      CODE_BASE_PATH: パス,
      チーム目標: テーマ,
      自動作業設定: 入力自動作業設定.value,
      チーム作業: 目標,
      作業ループ: 入力作業ループ.value,
      作業ループ回数: 入力作業ループ回数.value,
      動員要員数: 入力動員要員数.value,
      パターン: 入力パターン.value,
      TEAM_AI_NAME: 入力TEAM_AI_NAME.value,
      TEAM_AI_MODEL_plan: 入力TEAM_AI_MODEL_plan.value,
      TEAM_AI_MODEL_do: 入力TEAM_AI_MODEL_do.value,
      TEAM_AI_MODEL_check: 入力TEAM_AI_MODEL_check.value,
      TASK_AI_NAME: 入力TASK_AI_NAME.value,
      TASK_AI_MODEL_plan: 入力TASK_AI_MODEL_plan.value,
      TASK_AI_MODEL_do: 入力TASK_AI_MODEL_do.value,
      TASK_AI_MODEL_check: 入力TASK_AI_MODEL_check.value,
      操作利用者ID: 利用者ID.value,
      操作利用者名: 利用者名.value,
      操作端末ID: 'aidiy_team',
    });
    if (response.data?.status !== 'OK') {
      void qMessage(response.data?.message || 'チーム作業を保存できませんでした。', 'error');
      return;
    }
    const item = response.data.data?.item as チーム目標 | undefined;
    // 保存した内容をそのまま親へ渡す（作業状況パネルの表示・非表示はこの値で切り替わる）
    emit('saved', {
      ...(item ?? { CODE_BASE_PATH: パス, チーム目標: テーマ, チーム作業: 目標, 更新日時: '' }),
      チーム目標: テーマ,
      自動作業設定: 入力自動作業設定.value,
      チーム作業: 目標,
      作業ループ: 入力作業ループ.value,
      作業ループ回数: 入力作業ループ回数.value,
      動員要員数: 入力動員要員数.value,
      パターン: 入力パターン.value,
      TEAM_AI_NAME: 入力TEAM_AI_NAME.value,
      TEAM_AI_MODEL_plan: 入力TEAM_AI_MODEL_plan.value,
      TEAM_AI_MODEL_do: 入力TEAM_AI_MODEL_do.value,
      TEAM_AI_MODEL_check: 入力TEAM_AI_MODEL_check.value,
      TASK_AI_NAME: 入力TASK_AI_NAME.value,
      TASK_AI_MODEL_plan: 入力TASK_AI_MODEL_plan.value,
      TASK_AI_MODEL_do: 入力TASK_AI_MODEL_do.value,
      TASK_AI_MODEL_check: 入力TASK_AI_MODEL_check.value,
    });
    // 1件保存したら用は済むのでダイアログを閉じる
    emit('close');
  } catch {
    void qMessage('チーム作業の保存でエラーが発生しました。backend_taskteam (8093) を確認してください。', 'error');
  } finally {
    保存中.value = false;
  }
};

const 削除 = async () => {
  const パス = 入力パス.value.trim();
  if (!パス || 既定パス選択中.value) return;
  if (!(await qConfirm(`${パス} のチーム作業を削除しますか？`))) return;
  削除中.value = true;
  try {
    const response = await teamClient.post('/team/目標/削除', {
      CODE_BASE_PATH: パス,
      操作利用者ID: 利用者ID.value,
      操作利用者名: 利用者名.value,
      操作端末ID: 'aidiy_team',
    });
    if (response.data?.status !== 'OK') {
      void qMessage(response.data?.message || 'チーム作業を削除できませんでした。', 'error');
      return;
    }
    void qMessage(response.data.message || 'チーム作業を削除しました。');
    await 目標一覧読込();
    const 先頭 = 目標一覧.value[0];
    if (先頭) {
      一覧から選ぶ(先頭);
      emit('saved', 先頭);
    }
  } catch {
    void qMessage('チーム作業の削除でエラーが発生しました。backend_taskteam (8093) を確認してください。', 'error');
  } finally {
    削除中.value = false;
  }
};
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="dialog-overlay" @click.self="emit('close')">
      <section class="dialog-content" role="dialog" aria-modal="true" aria-label="チーム目標保守">
        <header class="dialog-header">
          <h3>【チーム目標】保守</h3>
          <button type="button" class="dialog-close" aria-label="閉じる" @click="emit('close')">×</button>
        </header>

        <div class="dialog-body">
          <div class="goal-layout">
            <aside class="goal-list">
              <div class="goal-list-head">
                <span>登録済パス</span>
                <b>{{ 目標一覧.length }}</b>
              </div>
              <p v-if="読込中" class="goal-list-empty">読み込み中…</p>
              <p v-else-if="目標一覧.length === 0" class="goal-list-empty">登録がありません</p>
              <ul v-else class="goal-list-body">
                <li v-for="項目 in 目標一覧" :key="項目.CODE_BASE_PATH">
                  <button
                    type="button"
                    class="goal-list-item"
                    :class="{ active: 選択中か(項目.CODE_BASE_PATH) }"
                    @click="一覧から選ぶ(項目)"
                  >
                    <span class="goal-list-path">{{ 項目.CODE_BASE_PATH }}</span>
                    <span class="goal-list-text">{{ 項目.チーム作業 }}</span>
                    <span class="goal-list-date">{{ 項目.更新日時 }}</span>
                  </button>
                </li>
              </ul>
            </aside>

            <div class="goal-form">
              <div class="detail-row one-line-row">
                <div class="detail-label">プロジェクト</div>
                <div class="detail-value">
                  <select v-model="選択パス" class="detail-select">
                    <option value="">（選択してください）</option>
                    <option v-for="option in プロジェクト選択肢" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </div>
              </div>
              <div class="detail-row one-line-row">
                <div class="detail-label">
                  フォルダ指定<span class="required-mark">*</span>
                </div>
                <div class="detail-value value-inline">
                  <input v-model.trim="入力パス" type="text" class="detail-input" placeholder="../" />
                  <button type="button" class="dialog-button browse" :disabled="参照中" @click="フォルダ参照">
                    {{ 参照中 ? '参照中…' : '参照' }}
                  </button>
                </div>
              </div>
              <div class="detail-row one-line-row">
                <div class="detail-label">
                  チーム目標<span class="required-mark">*</span>
                </div>
                <div class="detail-value">
                  <input
                    v-model.trim="入力テーマ"
                    type="text"
                    class="detail-input"
                  />
                </div>
              </div>
              <section
                class="loop-panel simple-loop-panel"
                :class="{ active: 入力自動作業設定 }"
                aria-labelledby="self-loop-panel-title"
              >
                <div class="loop-panel-head">
                  <div class="loop-panel-title-wrap">
                    <span class="loop-panel-icon" aria-hidden="true">↻</span>
                    <div>
                      <h4 id="self-loop-panel-title">自動作業設定</h4>
                    </div>
                  </div>
                  <label class="loop-switch">
                    <input
                      :checked="入力自動作業設定"
                      type="checkbox"
                      aria-label="自動作業設定の切り替え"
                      @change="自動作業設定を変更"
                    />
                    <span class="loop-switch-track" aria-hidden="true">
                      <span class="loop-switch-thumb"></span>
                    </span>
                    <span class="loop-switch-status">
                      {{ 入力自動作業設定 ? '実行する' : '停止中' }}
                    </span>
                  </label>
                </div>
              </section>
              <div class="detail-row request-row">
                <div class="detail-label">
                  チーム作業<span v-if="!入力自動作業設定" class="required-mark">*</span>
                </div>
                <div class="detail-value">
                  <textarea
                    v-model="入力目標"
                    class="detail-textarea"
                  ></textarea>
                </div>
              </div>
              <section
                class="loop-panel"
                :class="{ active: 入力作業ループ }"
                aria-labelledby="loop-panel-title"
              >
                <div class="loop-panel-head">
                  <div class="loop-panel-title-wrap">
                    <span class="loop-panel-icon" aria-hidden="true">↻</span>
                    <div>
                      <h4 id="loop-panel-title">作業ループ</h4>
                      <p>目標達成に向けた自動サイクルの実行条件</p>
                    </div>
                  </div>
                  <label class="loop-switch">
                    <input
                      v-model="入力作業ループ"
                      type="checkbox"
                      aria-label="作業ループの切り替え"
                    />
                    <span class="loop-switch-track" aria-hidden="true">
                      <span class="loop-switch-thumb"></span>
                    </span>
                    <span class="loop-switch-status">
                      {{ 入力作業ループ ? '実行する' : '停止中' }}
                    </span>
                  </label>
                </div>

                <div class="loop-config-grid">
                  <label class="loop-config-item loop-pattern-setting" for="パターン">
                    <span class="loop-config-label">進行パターン</span>
                    <select id="パターン" v-model="入力パターン" class="loop-config-select">
                      <option v-for="option in パターン選択肢" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </select>
                    <span class="loop-config-help">
                      {{ 入力パターン === 'SPDCA' ? '相談から改善までの5段階' : '計画と実行を繰り返す2段階' }}
                    </span>
                  </label>

                  <label class="loop-config-item" for="作業ループ回数">
                    <span class="loop-config-label">作業ループ回数</span>
                    <select id="作業ループ回数" v-model.number="入力作業ループ回数" class="loop-config-select">
                      <option v-for="回数 in 作業ループ回数選択肢" :key="回数" :value="回数">
                        {{ 回数 === 99 ? '99（無制限）' : `${回数} 回` }}
                      </option>
                    </select>
                    <span class="loop-config-help">99を選ぶと無制限</span>
                  </label>

                  <label class="loop-config-item" for="動員要員数">
                    <span class="loop-config-label">相談の参加人数</span>
                    <select id="動員要員数" v-model.number="入力動員要員数" class="loop-config-select">
                      <option v-for="人数 in 動員要員数選択肢" :key="人数" :value="人数">
                        {{ 人数 }} 人
                      </option>
                    </select>
                    <span class="loop-config-help">有効な要員から動員</span>
                  </label>
                </div>

                <div class="loop-config-grid ai-config-grid">
                  <label class="loop-config-item" for="TEAM_AI_NAME">
                    <span class="loop-config-label">TEAM_AI_NAME</span>
                    <select id="TEAM_AI_NAME" v-model="入力TEAM_AI_NAME" class="loop-config-select">
                      <option v-for="name in AI名称選択肢" :key="name" :value="name">{{ name }}</option>
                    </select>
                    <span class="loop-config-help">各段を実行するAI</span>
                  </label>

                  <label class="loop-config-item" for="TEAM_AI_MODEL_plan">
                    <span class="loop-config-label">TEAM_AI_MODEL_plan</span>
                    <select id="TEAM_AI_MODEL_plan" v-model="入力TEAM_AI_MODEL_plan" class="loop-config-select">
                      <option v-for="model in TEAMモデル選択肢" :key="model.value" :value="model.value">
                        {{ model.label }}
                      </option>
                    </select>
                    <span class="loop-config-help">相談・計画（S・P）</span>
                  </label>

                  <label class="loop-config-item" for="TEAM_AI_MODEL_do">
                    <span class="loop-config-label">TEAM_AI_MODEL_do</span>
                    <select id="TEAM_AI_MODEL_do" v-model="入力TEAM_AI_MODEL_do" class="loop-config-select">
                      <option v-for="model in TEAMモデル選択肢" :key="model.value" :value="model.value">
                        {{ model.label }}
                      </option>
                    </select>
                    <span class="loop-config-help">実施（D）</span>
                  </label>

                  <label class="loop-config-item" for="TEAM_AI_MODEL_check">
                    <span class="loop-config-label">TEAM_AI_MODEL_check</span>
                    <select id="TEAM_AI_MODEL_check" v-model="入力TEAM_AI_MODEL_check" class="loop-config-select">
                      <option v-for="model in TEAMモデル選択肢" :key="model.value" :value="model.value">
                        {{ model.label }}
                      </option>
                    </select>
                    <span class="loop-config-help">評価・改善（C・A）</span>
                  </label>

                  <label class="loop-config-item" for="TASK_AI_NAME">
                    <span class="loop-config-label">TASK_AI_NAME</span>
                    <select id="TASK_AI_NAME" v-model="入力TASK_AI_NAME" class="loop-config-select">
                      <option v-for="name in AI名称選択肢" :key="name" :value="name">{{ name }}</option>
                    </select>
                    <span class="loop-config-help">Aタスク側のAI</span>
                  </label>

                  <label class="loop-config-item" for="TASK_AI_MODEL_plan">
                    <span class="loop-config-label">TASK_AI_MODEL_plan</span>
                    <select id="TASK_AI_MODEL_plan" v-model="入力TASK_AI_MODEL_plan" class="loop-config-select">
                      <option v-for="model in TASKモデル選択肢" :key="model.value" :value="model.value">
                        {{ model.label }}
                      </option>
                    </select>
                    <span class="loop-config-help">相談・計画（S・P）</span>
                  </label>

                  <label class="loop-config-item" for="TASK_AI_MODEL_do">
                    <span class="loop-config-label">TASK_AI_MODEL_do</span>
                    <select id="TASK_AI_MODEL_do" v-model="入力TASK_AI_MODEL_do" class="loop-config-select">
                      <option v-for="model in TASKモデル選択肢" :key="model.value" :value="model.value">
                        {{ model.label }}
                      </option>
                    </select>
                    <span class="loop-config-help">実施（D）</span>
                  </label>

                  <label class="loop-config-item" for="TASK_AI_MODEL_check">
                    <span class="loop-config-label">TASK_AI_MODEL_check</span>
                    <select id="TASK_AI_MODEL_check" v-model="入力TASK_AI_MODEL_check" class="loop-config-select">
                      <option v-for="model in TASKモデル選択肢" :key="model.value" :value="model.value">
                        {{ model.label }}
                      </option>
                    </select>
                    <span class="loop-config-help">評価・改善（C・A）</span>
                  </label>
                </div>
              </section>
              <p class="goal-note">
                CODE_BASE_PATH ごとに 1 件です。同じパスを保存すると上書きされ、
                更新日時が最新の目標がチーム空間の掲示板に表示されます。
              </p>
            </div>
          </div>
        </div>

        <footer class="dialog-footer">
          <button type="button" class="dialog-button primary" :disabled="保存中" @click="保存">
            {{ 保存中 ? '保存中…' : 登録済み ? '更新' : '登録' }}
          </button>
          <button
            type="button"
            class="dialog-button danger"
            :disabled="削除中 || 既定パス選択中 || !登録済み"
            @click="削除"
          >
            {{ 削除中 ? '削除中…' : '削除' }}
          </button>
          <button type="button" class="dialog-button" @click="emit('close')">閉じる</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.72);
}

.dialog-content {
  width: min(980px, 96vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(143, 104, 221, 0.75);
  border-radius: 4px;
  color: #e5e7eb;
  background: #07080c;
  box-shadow: 0 0 24px rgba(60, 42, 128, 0.65);
}

.dialog-header {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 14px;
  background: linear-gradient(135deg, #4668cd, #6c4ec4, #8f68dd);
}

.dialog-header h3 {
  margin: 0;
  color: #fff;
  font-size: 13px;
  letter-spacing: 1px;
}

.dialog-close {
  border: 0;
  color: #fff;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
}

.dialog-body {
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
}

.goal-layout {
  display: grid;
  grid-template-columns: 268px minmax(0, 1fr);
  gap: 12px;
}

.goal-list {
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #4b5563;
  border-radius: 4px;
  background: #10131a;
}

.goal-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  color: #fff;
  background: linear-gradient(135deg, #37474f, rgba(70, 104, 205, 0.74));
  font-size: 12px;
  font-weight: 600;
}

.goal-list-head b { color: #9dffce; }

.goal-list-empty {
  margin: 0;
  padding: 12px 10px;
  color: #8b98a5;
  font-size: 11px;
}

.goal-list-body {
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.goal-list-item {
  width: 100%;
  display: grid;
  gap: 2px;
  padding: 7px 10px;
  border: 0;
  border-bottom: 1px solid rgba(75, 85, 99, 0.6);
  color: #d7dee6;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.goal-list-item:hover { background: rgba(70, 104, 205, 0.18); }
.goal-list-item.active { background: rgba(143, 104, 221, 0.28); }

.goal-list-path {
  color: #9ceaff;
  font-size: 12px;
  font-weight: 700;
  word-break: break-all;
}

.goal-list-text {
  overflow: hidden;
  color: #cbd5e1;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.goal-list-date { color: #7f8b99; font-size: 10px; }

.goal-form {
  min-width: 0;
}

.detail-row {
  display: flex;
  width: 100%;
  margin-top: -1px;
  flex: 0 0 auto;
}

.detail-label {
  width: 120px;
  min-height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 6px 10px;
  border: 1px solid rgba(93, 68, 168, 0.85);
  color: #fff;
  background: linear-gradient(135deg, #37474f, rgba(70, 104, 205, 0.74));
  box-sizing: border-box;
  font-size: 13px;
  font-weight: 600;
  z-index: 1;
}

.detail-value {
  min-width: 0;
  min-height: 34px;
  flex: 1;
  display: flex;
  align-items: center;
  padding: 3px 10px;
  border: 1px solid #4b5563;
  border-left: 0;
  background: #10131a;
  box-sizing: border-box;
  font-size: 13px;
}

.request-row .detail-value { align-items: stretch; }

.detail-input,
.detail-select,
.detail-textarea {
  width: 100%;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid #4b5563;
  border-radius: 4px;
  color: #f3f4f6;
  background: #05070b;
  box-sizing: border-box;
  font: inherit;
}

.detail-input,
.detail-select { height: 26px; }

.detail-input {
  flex: 1 1 auto;
  width: auto;
  margin: 0;
  padding: 0 8px;
}

.detail-select {
  max-width: 100%;
  min-height: 26px;
  display: block;
  align-self: center;
  margin: 0;
  padding: 0 28px 0 8px;
  line-height: normal;
  appearance: auto;
}

.one-line-row,
.one-line-row .detail-label,
.one-line-row .detail-value {
  height: 34px;
  min-height: 34px;
}

.detail-textarea {
  min-height: 190px;
  resize: vertical;
}

.value-inline { gap: 8px; }

.required-mark {
  margin-left: 2px;
  color: #dc2626;
}

.loop-panel {
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid rgba(82, 94, 119, 0.9);
  border-radius: 8px;
  background: linear-gradient(145deg, rgba(18, 23, 34, 0.98), rgba(10, 13, 20, 0.98));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
  transition: border-color 180ms ease, box-shadow 180ms ease;
}

.loop-panel.active {
  border-color: rgba(113, 92, 211, 0.95);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 0 0 1px rgba(106, 85, 207, 0.1),
    0 8px 24px rgba(35, 24, 82, 0.18);
}

.loop-panel-head {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(75, 85, 99, 0.72);
  background: linear-gradient(90deg, rgba(70, 104, 205, 0.15), rgba(143, 104, 221, 0.08));
  box-sizing: border-box;
}

.loop-panel-title-wrap {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.loop-panel-icon {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(143, 104, 221, 0.48);
  border-radius: 9px;
  color: #b7a4ff;
  background: rgba(91, 68, 168, 0.2);
  font-size: 21px;
  line-height: 1;
}

.loop-panel-title-wrap h4 {
  margin: 0;
  color: #f4f1ff;
  font-size: 13px;
  letter-spacing: 0.04em;
}

.loop-panel-title-wrap p {
  margin: 3px 0 0;
  color: #8f9baa;
  font-size: 10px;
  line-height: 1.35;
}

.loop-switch {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.loop-switch input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.loop-switch-track {
  width: 42px;
  height: 22px;
  position: relative;
  display: block;
  border: 1px solid #5b6473;
  border-radius: 999px;
  background: #252b35;
  box-sizing: border-box;
  transition: border-color 180ms ease, background 180ms ease;
}

.loop-switch-thumb {
  width: 16px;
  height: 16px;
  position: absolute;
  top: 2px;
  left: 3px;
  border-radius: 50%;
  background: #a8b0bd;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  transition: transform 180ms ease, background 180ms ease;
}

.loop-switch input:checked + .loop-switch-track {
  border-color: #7e69d8;
  background: linear-gradient(135deg, #4668cd, #8f68dd);
}

.loop-switch input:checked + .loop-switch-track .loop-switch-thumb {
  transform: translateX(18px);
  background: #fff;
}

.loop-switch input:focus-visible + .loop-switch-track {
  outline: 2px solid rgba(174, 151, 255, 0.72);
  outline-offset: 2px;
}

.loop-switch-status {
  min-width: 42px;
  color: #9aa5b4;
  font-size: 11px;
  font-weight: 700;
}

.loop-panel.active .loop-switch-status { color: #bdaeff; }

.loop-config-grid {
  display: grid;
  grid-template-columns: minmax(220px, 1.8fr) minmax(130px, 0.9fr) minmax(130px, 0.9fr);
  gap: 8px;
  padding: 10px;
}

/* AI設定は4項目そろって1組なので、ループ条件とは別の等幅グリッドにする */
.ai-config-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding-top: 0;
}

.loop-config-item {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid rgba(72, 82, 101, 0.78);
  border-radius: 6px;
  background: rgba(5, 7, 11, 0.62);
  box-sizing: border-box;
}

.loop-config-item:focus-within {
  border-color: rgba(143, 104, 221, 0.8);
  box-shadow: 0 0 0 2px rgba(143, 104, 221, 0.1);
}

.loop-config-label {
  color: #cbd5e1;
  font-size: 11px;
  font-weight: 700;
}

.loop-config-select {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 28px 0 8px;
  border: 1px solid #4b5563;
  border-radius: 5px;
  color: #f3f4f6;
  background: #080b11;
  box-sizing: border-box;
  font: inherit;
  font-size: 12px;
}

.loop-config-select:focus {
  border-color: #8f68dd;
  outline: none;
}

.loop-config-help {
  overflow: hidden;
  color: #758192;
  font-size: 9px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.goal-note {
  margin: 9px 1px 0;
  padding: 7px 10px;
  border-left: 2px solid rgba(70, 104, 205, 0.72);
  border-radius: 0 4px 4px 0;
  color: #8895a5;
  background: rgba(70, 104, 205, 0.06);
  font-size: 11px;
  line-height: 1.6;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(75, 85, 99, 0.8);
  background: #0a0c12;
}

.dialog-button {
  min-width: 96px;
  height: 30px;
  padding: 0 14px;
  border: 1px solid #4b5563;
  border-radius: 4px;
  color: #e5e7eb;
  background: #151a24;
  cursor: pointer;
  font-size: 13px;
}

.dialog-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dialog-button.primary {
  border-color: rgba(143, 104, 221, 0.9);
  background: linear-gradient(135deg, #4668cd, #8f68dd);
  font-weight: 700;
}

.dialog-button.danger {
  border-color: rgba(220, 38, 38, 0.7);
  color: #ffd9d9;
  background: rgba(120, 30, 30, 0.55);
}

.dialog-button.browse {
  min-width: 58px;
  height: 26px;
  flex: 0 0 auto;
  padding: 0 12px;
  border-radius: 0;
}

@media (max-width: 760px) {
  .goal-layout { grid-template-columns: minmax(0, 1fr); }
  .goal-list-body { max-height: 180px; }
  .loop-config-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ai-config-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .loop-pattern-setting { grid-column: 1 / -1; }
}

@media (max-width: 520px) {
  .dialog-overlay { padding: 10px; }
  .loop-panel-head { align-items: flex-start; }
  .loop-panel-title-wrap p { display: none; }
  .loop-config-grid { grid-template-columns: minmax(0, 1fr); }
  .ai-config-grid { grid-template-columns: minmax(0, 1fr); }
  .loop-pattern-setting { grid-column: auto; }
}
</style>
