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
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import apiClient, { taskClient, teamClient } from '@taskteam/api/client';
import { qMessage } from '../../../utils/qAlert';
import type { エージェント, チーム目標 } from '../AIチーム_型';

type 選択肢 = { value: string; label: string };
type モデル情報 = { code_models?: Record<string, Record<string, string>> };

const props = defineProps<{
  isOpen: boolean;
  エージェント: エージェント | null;
  チーム目標: チーム目標 | null;
}>();

const emit = defineEmits<{ close: [] }>();

// 会話は調査モード（team_chat.py）で依頼する。AIが対象プロジェクトのソースを読んでから
// 回答するため、backend_taskteam 側は CodeAgent 300秒 / HTTP 360秒で待つ。画面もそれに合わせる。
const 最大待機秒 = 360;
const 最大待機ミリ秒 = 最大待機秒 * 1000;
const プロジェクト選択肢 = ref<選択肢[]>([]);
const 選択プロジェクト = ref('');
const 入力プロジェクト = ref('');
const 入力TASK_AI_NAME = ref('claude_cli');
const 入力TASK_AI_MODEL_plan = ref('auto');
const 入力要求内容 = ref('');
const 応答内容 = ref('');
const エラー内容 = ref('');
const availableModels = ref<モデル情報>({ code_models: {} });
const currentSettings = ref<Record<string, string>>({});
const 読込中 = ref(false);
const 参照中 = ref(false);
const 送信中 = ref(false);
const 経過秒 = ref(0);
let 経過Timer: ReturnType<typeof setInterval> | null = null;

const 掲示板プロジェクト = computed(() => String(props.チーム目標?.CODE_BASE_PATH ?? '').trim());
const taskAiOptions = computed(() => Object.keys(availableModels.value.code_models ?? {}));
const taskModelOptions = computed(() => {
  const models = availableModels.value.code_models?.[入力TASK_AI_NAME.value] ?? {};
  return Object.entries(models).map(([value, label]) => ({ value, label: String(label || value) }));
});
const 待機表示 = computed(() => `応答待機中… ${経過秒.value}秒 / 最大${最大待機秒}秒`);

const chooseAvailable = (current: unknown, candidates: string[]) => {
  const value = String(current ?? '');
  return value && candidates.includes(value) ? value : candidates[0] ?? '';
};

const 経過計測停止 = () => {
  if (経過Timer) clearInterval(経過Timer);
  経過Timer = null;
};

const 経過計測開始 = () => {
  経過計測停止();
  const 開始 = Date.now();
  経過秒.value = 0;
  経過Timer = setInterval(() => {
    経過秒.value = Math.min(最大待機秒, Math.floor((Date.now() - 開始) / 1000));
  }, 1000);
};

const 選択肢読込 = async () => {
  読込中.value = true;
  try {
    const [projectResponse, modelResponse, settingResponse] = await Promise.all([
      taskClient.post('/task/プロジェクト選択肢', {}),
      apiClient.post('/core/AIコア/モデル情報/TASK選択肢', {}),
      teamClient.post('/team/設定/取得', {}),
    ]);
    const projectOptions = projectResponse.data?.status === 'OK'
      ? projectResponse.data.data?.選択肢 ?? {}
      : {};
    プロジェクト選択肢.value = Object.entries(projectOptions).map(([value, label]) => ({
      value,
      label: `${String(label)} (${value})`,
    }));
    const boardPath = 掲示板プロジェクト.value;
    if (boardPath && !プロジェクト選択肢.value.some((option) => option.value === boardPath)) {
      プロジェクト選択肢.value.unshift({ value: boardPath, label: `掲示板のプロジェクト (${boardPath})` });
    }
    if (modelResponse.data?.status !== 'OK' || settingResponse.data?.status !== 'OK') {
      throw new Error('AIモデル設定を取得できませんでした');
    }
    availableModels.value = modelResponse.data.data?.available_models ?? { code_models: {} };
    currentSettings.value = settingResponse.data.data ?? {};
  } catch {
    availableModels.value = { code_models: { claude_cli: { auto: 'auto' } } };
    currentSettings.value = {
      CODE_BASE_PATH: '../',
      TASK_AI_NAME: 'claude_cli',
      TASK_AI_MODEL_plan: 'auto',
    };
  } finally {
    読込中.value = false;
  }
};

const フォーム初期化 = async () => {
  応答内容.value = '';
  エラー内容.value = '';
  入力要求内容.value = '';
  経過秒.value = 0;
  await 選択肢読込();

  const initialProject = 掲示板プロジェクト.value || currentSettings.value.CODE_BASE_PATH || '../';
  入力プロジェクト.value = initialProject;
  選択プロジェクト.value = プロジェクト選択肢.value.some(
    (option) => option.value === initialProject,
  ) ? initialProject : '';

  入力TASK_AI_NAME.value = chooseAvailable(
    currentSettings.value.TASK_AI_NAME || 'claude_cli',
    taskAiOptions.value,
  ) || 'claude_cli';
  const modelCandidates = Object.keys(
    availableModels.value.code_models?.[入力TASK_AI_NAME.value] ?? {},
  );
  // 会話は Aタスクを作らない1回きりの調査なので、モデルは plan 用の1つだけ使う
  入力TASK_AI_MODEL_plan.value = chooseAvailable(
    currentSettings.value.TASK_AI_MODEL_plan || 'auto',
    modelCandidates,
  ) || 'auto';
};

watch(
  () => [props.isOpen, props.エージェント?.id],
  ([open]) => {
    if (open) void フォーム初期化();
  },
);

watch(選択プロジェクト, (value) => {
  if (value) 入力プロジェクト.value = value;
});

watch(入力TASK_AI_NAME, (value) => {
  const models = Object.keys(availableModels.value.code_models?.[value] ?? {});
  if (models.length && !models.includes(入力TASK_AI_MODEL_plan.value)) {
    入力TASK_AI_MODEL_plan.value = models[0] ?? 'auto';
  }
});

const フォルダ参照 = async () => {
  if (送信中.value) return;
  参照中.value = true;
  try {
    const response = await apiClient.post('/core/AIコア/フォルダ参照', {
      初期パス: 入力プロジェクト.value,
    });
    if (response.data?.status === 'OK') {
      const path = String(response.data.data?.選択パス ?? '').replace(/\\/g, '/');
      if (path) {
        入力プロジェクト.value = path;
        選択プロジェクト.value = プロジェクト選択肢.value.some(
          (option) => option.value === path,
        ) ? path : '';
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

const 会話送信 = async () => {
  const agent = props.エージェント;
  const project = 入力プロジェクト.value.trim();
  const requestText = 入力要求内容.value.trim();
  if (!agent?.id) return;
  if (!project) {
    void qMessage('プロジェクトフォルダを指定してください。', 'error');
    return;
  }
  if (!requestText) {
    void qMessage('要求内容を入力してください。', 'error');
    return;
  }

  送信中.value = true;
  応答内容.value = '';
  エラー内容.value = '';
  経過計測開始();
  try {
    const response = await teamClient.post('/team/エージェント/会話', {
      要員ID: agent.id,
      プロジェクト: project,
      TASK_AI_NAME: 入力TASK_AI_NAME.value,
      TASK_AI_MODEL_plan: 入力TASK_AI_MODEL_plan.value,
      要求内容: requestText,
    }, { timeout: 最大待機ミリ秒 });
    if (response.data?.status !== 'OK') {
      エラー内容.value = response.data?.message || 'エージェントから応答を取得できませんでした。';
      return;
    }
    応答内容.value = String(response.data.data?.応答内容 ?? '').trim();
    if (!応答内容.value) エラー内容.value = 'エージェントから応答がありませんでした。';
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? '');
    エラー内容.value = code === 'ECONNABORTED'
      ? `${最大待機秒}秒以内に応答が完了しませんでした。時間をおいて再度お試しください。`
      : '会話通信でエラーが発生しました。backend_taskteam (8093) と backend_tools (8095) を確認してください。';
  } finally {
    経過計測停止();
    送信中.value = false;
  }
};

const 閉じる = () => {
  if (!送信中.value) emit('close');
};

onBeforeUnmount(() => 経過計測停止());
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="dialog-overlay" @click.self="閉じる">
      <section class="dialog-content" role="dialog" aria-modal="true" aria-label="AIチーム要員との会話">
        <header class="dialog-header">
          <h3>【AIチーム会話】{{ エージェント?.名前 || エージェント?.id }}</h3>
          <button type="button" class="dialog-close" :disabled="送信中" aria-label="閉じる" @click="閉じる">×</button>
        </header>

        <div class="dialog-body">
          <div class="agent-card" :style="{ '--agent-color': エージェント?.色CSS || '#8f68dd' }">
            <span class="agent-mark"></span>
            <div>
              <strong>{{ エージェント?.名前 }}</strong>
              <span>{{ エージェント?.役割 || '役割未設定' }}</span>
            </div>
            <small>ダブルクリックした要員のpersonaで回答します</small>
          </div>

          <div class="board-base">
            <span>掲示板基準</span>
            <b>{{ 掲示板プロジェクト || '未設定（共通設定を使用）' }}</b>
          </div>

          <div class="detail-row one-line-row">
            <label class="detail-label">プロジェクト</label>
            <div class="detail-value">
              <select v-model="選択プロジェクト" class="detail-select" :disabled="読込中 || 送信中">
                <option value="">候補から選択してください</option>
                <option v-for="option in プロジェクト選択肢" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <label class="detail-label">フォルダ指定</label>
            <div class="detail-value value-inline">
              <input v-model="入力プロジェクト" class="detail-input" type="text" :disabled="送信中" />
              <button type="button" class="dialog-button browse" :disabled="参照中 || 送信中" @click="フォルダ参照">
                {{ 参照中 ? '参照中…' : '参照' }}
              </button>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <label class="detail-label">TASK_AI_NAME</label>
            <div class="detail-value">
              <select v-model="入力TASK_AI_NAME" class="detail-select" :disabled="読込中 || 送信中">
                <option v-for="name in taskAiOptions" :key="name" :value="name">{{ name }}</option>
              </select>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <label class="detail-label">TASK_AI_MODEL_plan</label>
            <div class="detail-value">
              <select v-model="入力TASK_AI_MODEL_plan" class="detail-select" :disabled="読込中 || 送信中">
                <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">
                  {{ model.label }}
                </option>
              </select>
            </div>
          </div>
          <div class="detail-row request-row">
            <label class="detail-label">要求内容<span class="required-mark">*</span></label>
            <div class="detail-value">
              <textarea
                v-model="入力要求内容"
                class="detail-textarea"
                rows="6"
                :disabled="送信中"
                placeholder="このエージェントに聞きたいことを入力してください"
              ></textarea>
            </div>
          </div>

          <div v-if="送信中" class="waiting-panel" role="status" aria-live="polite">
            <div class="waiting-orbit"><i></i><i></i><i></i></div>
            <div>
              <strong>{{ 待機表示 }}</strong>
              <span>personaを設定し、プロジェクトのソースを調べたうえで回答します</span>
            </div>
          </div>
          <div v-else-if="エラー内容" class="response-panel error" role="alert">
            <strong>通信結果</strong>
            <pre>{{ エラー内容 }}</pre>
          </div>
          <div v-else-if="応答内容" class="response-panel" aria-live="polite">
            <strong>{{ エージェント?.名前 }}からの応答</strong>
            <pre>{{ 応答内容 }}</pre>
          </div>
        </div>

        <footer class="dialog-footer">
          <button type="button" class="dialog-button primary" :disabled="読込中 || 送信中" @click="会話送信">
            {{ 送信中 ? '応答待機中…' : 応答内容 ? 'もう一度送信' : '送信' }}
          </button>
          <button type="button" class="dialog-button" :disabled="送信中" @click="閉じる">閉じる</button>
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
  background: rgba(0, 0, 0, 0.74);
}

.dialog-content {
  width: min(900px, 96vw);
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

.dialog-header h3 { margin: 0; color: #fff; font-size: 13px; letter-spacing: 1px; }
.dialog-close { border: 0; color: #fff; background: transparent; cursor: pointer; font-size: 18px; }
.dialog-close:disabled { opacity: 0.4; cursor: default; }
.dialog-body { min-height: 0; padding: 12px; overflow-y: auto; }

.agent-card {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--agent-color) 45%, #273043);
  border-radius: 6px;
  background: color-mix(in srgb, var(--agent-color) 8%, #0b0f16);
}
.agent-mark { width: 12px; height: 12px; border-radius: 50%; background: var(--agent-color); box-shadow: 0 0 14px var(--agent-color); }
.agent-card div { display: flex; flex-direction: column; gap: 2px; }
.agent-card strong { color: var(--agent-color); font-size: 14px; }
.agent-card span { color: #b8c4d1; font-size: 11px; }
.agent-card small { margin-left: auto; color: #75879a; font-size: 10px; }

.board-base {
  display: flex;
  gap: 10px;
  margin-bottom: 8px;
  padding: 7px 10px;
  border-left: 3px solid #5ce3a1;
  color: #8fa5b7;
  background: rgba(92, 227, 161, 0.07);
  font-size: 11px;
}
.board-base b { color: #c9f8df; font-weight: 600; word-break: break-all; }

.detail-row {
  width: 100%;
  display: flex;
  margin-top: -1px;
  flex: 0 0 auto;
}
.detail-label {
  width: 180px;
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
  overflow-wrap: anywhere;
  text-align: right;
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
.detail-input, .detail-select, .detail-textarea {
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
.detail-input, .detail-select { height: 26px; }
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
  height: auto;
  min-height: 34px;
}
.one-line-row .detail-value {
  align-items: center;
  padding-top: 4px;
  padding-bottom: 4px;
}
.detail-textarea { font-size: 12px; min-height: 170px; resize: vertical; line-height: 1.55; }
.detail-input:disabled, .detail-select:disabled, .detail-textarea:disabled { opacity: 0.65; }
.value-inline { gap: 8px; }
.required-mark { margin-left: 2px; color: #ff7eb6; }

.waiting-panel, .response-panel {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid rgba(91, 217, 255, 0.25);
  border-radius: 6px;
  background: rgba(30, 78, 99, 0.14);
}
.waiting-panel { min-height: 74px; display: flex; align-items: center; justify-content: center; gap: 18px; }
.waiting-panel > div:last-child { display: flex; flex-direction: column; gap: 5px; }
.waiting-panel strong, .response-panel strong { color: #a8efff; font-size: 12px; }
.waiting-panel span { color: #789aaa; font-size: 10px; }
.waiting-orbit { position: relative; width: 48px; height: 48px; flex: 0 0 48px; animation: orbit-spin 1.25s linear infinite; }
.waiting-orbit i { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: #5bd9ff; box-shadow: 0 0 12px #5bd9ff; }
.waiting-orbit i:nth-child(1) { top: 0; left: 19px; }
.waiting-orbit i:nth-child(2) { right: 3px; bottom: 8px; background: #8f68dd; box-shadow: 0 0 12px #8f68dd; }
.waiting-orbit i:nth-child(3) { left: 3px; bottom: 8px; background: #5ce3a1; box-shadow: 0 0 12px #5ce3a1; }
@keyframes orbit-spin { to { transform: rotate(360deg); } }
.response-panel.error { border-color: rgba(255, 126, 182, 0.4); background: rgba(120, 35, 70, 0.14); }
.response-panel.error strong { color: #ff9cc6; }
.response-panel pre {
  max-height: 260px;
  margin: 7px 0 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid #343d4c;
  border-radius: 4px;
  color: #edf5fa;
  background: #05070b;
  font-family: inherit;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.dialog-footer { display: flex; justify-content: center; gap: 8px; padding: 8px 12px; border-top: 1px solid rgba(93, 68, 168, 0.85); }
.dialog-button { padding: 6px 16px; border: 1px solid #4b5563; border-radius: 0; color: #f3f4f6; background: #1f2937; cursor: pointer; }
.dialog-button.browse { height: 26px; flex: 0 0 auto; padding: 0 12px; }
.dialog-button.primary { border-color: #28a745; color: #fff; background: #28a745; }
.dialog-button:disabled { opacity: 0.5; cursor: default; }

@media (max-width: 680px) {
  .dialog-overlay { padding: 8px; }
  .detail-label { width: 112px; }
  .agent-card small { display: none; }
}
</style>
