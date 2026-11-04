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
// AIタスク_明細編集ダイアログ: タスク明細 1 行の内容を修正する
import { ref, computed, watch } from 'vue';
import type { PropType } from 'vue';
import apiClient, { taskClient } from '@taskteam/api/client';
import { qMessage } from '@taskteam/utils/qAlert';

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  編集明細: { type: Object as PropType<Record<string, any> | null>, default: null }
});
const emit = defineEmits(['close', 'registered']);

const 入力タイプ = ref('do');
// 開始行(0)・終了行(9999)のタイプは明細SEQで確定するので選ばせない
const タイプ選択肢 = ['do', 'if', 'or'];
const 入力タイトル = ref('');
const 入力要求内容 = ref('');
const 入力先行SEQ = ref('');
const 入力TASK_AI_NAME = ref('codex_cli');
const 入力TASK_AI_MODEL_do = ref('auto');
const 入力操作検証 = ref(false);
const 入力実行有効 = ref(true);
const 入力状態 = ref('待機');
const 状態選択肢 = ['待機', '中止'];
// 状態欄には遷移し得る全状態を表示し、選択可能なのは 状態選択肢 の2つだけに絞る
const 状態表示リスト = ['待機', '実行中', 'エラー', '完了', '中止', 'パス'];
const 登録中 = ref(false);
const TASK_CODE_MODELS既定 = {
  claude_sdk: { auto: 'auto' },
  claude_cli: { auto: 'auto' },
  copilot_cli: { auto: 'auto' },
  codex_cli: { auto: 'auto' },
  antigravity_cli: { auto: 'auto' },
  grok_cli: { auto: 'auto' },
  opencode_cli: { auto: 'auto' },
  aidiy_hermes: { auto: 'auto' },
};
const availableModels = ref<Record<string, any>>({ code_models: { ...TASK_CODE_MODELS既定 } });
const currentSettings = ref<Record<string, any>>({});
const taskAiOptions = computed(() => Object.keys(availableModels.value?.code_models || {}));
const taskModelOptions = computed(() => {
  const models = availableModels.value?.code_models?.[入力TASK_AI_NAME.value] || {};
  return Object.entries(models).map(([value, label]) => ({ value, label: label || value }));
});

const タスクID表示 = computed(() => String(props.編集明細?.タスクID ?? ''));
const 明細SEQ表示 = computed(() => String(props.編集明細?.明細SEQ ?? ''));
// 開始行(0)は start、終了行(9999)は end で固定。その間だけ do / if / or を選べる
const タイプ固定 = computed(() => {
  const seq = Number(props.編集明細?.明細SEQ ?? -1);
  return seq === 0 || seq === 9999;
});
const タイプ表示 = computed(() => String(props.編集明細?.タイプ ?? ''));
// 押せるのは 状態選択肢 と更新前の状態。更新前の状態を選ぶと状態を変えずに内容だけ更新する
const 現状態 = computed(() => String(props.編集明細?.状態 ?? ''));
const 状態選択可 = (状態: string) => 状態選択肢.includes(状態) || 状態 === 現状態.value;

function chooseAvailable(current: any, candidates: string[]) {
  const value = String(current || '');
  return value && candidates.includes(value) ? value : candidates[0] || '';
}

async function モデル選択肢読込() {
  try {
    const res = await apiClient.post('/core/AIコア/モデル情報/TASK選択肢', {});
    if (res.data.status === 'OK') {
      availableModels.value = res.data.data?.available_models || { code_models: {} };
      currentSettings.value = res.data.data?.モデル設定 || {};
      const codeModels = { ...TASK_CODE_MODELS既定, ...(availableModels.value.code_models || {}) };
      for (const ai of Object.keys(codeModels)) {
        if (!codeModels[ai] || Object.keys(codeModels[ai]).length === 0) {
          codeModels[ai] = { auto: 'auto' };
        }
      }
      availableModels.value.code_models = codeModels;
    }
  } catch {
    availableModels.value = { code_models: { ...TASK_CODE_MODELS既定 } };
    currentSettings.value = { TASK_AI_NAME: 'codex_cli', TASK_AI_MODEL_do: 'auto' };
  }
}

const 入力初期化 = () => {
  if (!props.isOpen) return;
  const 編集 = props.編集明細 ?? {};
  入力タイプ.value = タイプ選択肢.includes(String(編集.タイプ ?? '')) ? String(編集.タイプ) : 'do';
  入力タイトル.value = String(編集.タイトル ?? '');
  入力要求内容.value = String(編集.要求内容 ?? '');
  入力先行SEQ.value = String(編集.先行SEQ ?? '');
  void モデル選択肢読込().then(() => {
    入力TASK_AI_NAME.value = chooseAvailable(編集.TASK_AI_NAME || currentSettings.value.TASK_AI_NAME || 'codex_cli', taskAiOptions.value) || 'codex_cli';
    入力TASK_AI_MODEL_do.value = chooseAvailable(編集.TASK_AI_MODEL_do || currentSettings.value.TASK_AI_MODEL_do || 'auto', Object.keys(availableModels.value?.code_models?.[入力TASK_AI_NAME.value] || {})) || 'auto';
  });
  入力操作検証.value = Boolean(編集.操作検証);
  入力実行有効.value = Boolean(編集.実行有効);
  入力状態.value = String(編集.状態 ?? '待機') || '待機';
};

watch([() => props.isOpen, () => props.編集明細], 入力初期化, { immediate: true });

watch(入力TASK_AI_NAME, (newValue) => {
  const models = Object.keys(availableModels.value?.code_models?.[newValue] || {});
  if (models.length > 0 && !models.includes(入力TASK_AI_MODEL_do.value)) {
    入力TASK_AI_MODEL_do.value = models[0]!;
  }
});

const 登録 = async () => {
  const タイトル = 入力タイトル.value.trim();
  if (!タイトル) {
    void qMessage('タイトルを入力してください。', 'error');
    return;
  }
  登録中.value = true;
  try {
    const res = await taskClient.post('/task/タスク明細/更新登録', {
      タスクID: タスクID表示.value,
      明細SEQ: Number(props.編集明細?.明細SEQ ?? 0),
      タイプ: 入力タイプ.value,
      タイトル,
      要求内容: 入力要求内容.value.trim(),
      先行SEQ: 入力先行SEQ.value.trim(),
      TASK_AI_NAME: 入力TASK_AI_NAME.value.trim() || 'codex_cli',
      TASK_AI_MODEL_do: 入力TASK_AI_MODEL_do.value.trim() || 'auto',
      操作検証: 入力操作検証.value,
      実行有効: 入力実行有効.value,
      状態: 入力状態.value
    });
    if (res.data.status === 'OK') {
      void qMessage(res.data.message || 'タスク明細を更新しました。');
      emit('registered', res.data.data?.item ?? null);
      emit('close');
    } else {
      void qMessage(res.data.message || 'タスク明細の更新に失敗しました。', 'error');
    }
  } catch (e) {
    void qMessage('タスク明細の更新でエラーが発生しました。backend_taskteam (8093) の起動を確認してください。', 'error');
  } finally {
    登録中.value = false;
  }
};
</script>

<template>
  <div v-if="props.isOpen" class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-content">
      <header class="dialog-header">
        <h3>【タスク明細】(修正)</h3>
        <button class="dialog-close" @click="emit('close')">×</button>
      </header>
      <div class="dialog-body">
        <div class="detail-row">
          <div class="detail-label">タスクID</div>
          <div class="detail-value">
            <span class="value-text">{{ タスクID表示 }}</span>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">SEQ</div>
          <div class="detail-value">
            <span class="value-text">{{ 明細SEQ表示 }}</span>
          </div>
        </div>
        <div class="detail-row" :class="{ 'one-line-row': !タイプ固定 }">
          <div class="detail-label">タイプ</div>
          <div class="detail-value">
            <span v-if="タイプ固定" class="value-text">{{ タイプ表示 }}</span>
            <select v-else v-model="入力タイプ" class="detail-select">
              <option v-for="t in タイプ選択肢" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">タイトル<span class="required-mark">*</span></div>
          <div class="detail-value">
            <input
              v-model.trim="入力タイトル"
              type="text"
              class="detail-input"
              placeholder="明細タイトル"
            />
          </div>
        </div>
        <div class="detail-row textarea-row">
          <div class="detail-label">要求内容</div>
          <div class="detail-value">
            <textarea
              v-model="入力要求内容"
              class="detail-textarea"
              rows="7"
              placeholder="この明細で実行する内容"
            ></textarea>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">先行SEQ</div>
          <div class="detail-value">
            <input
              v-model.trim="入力先行SEQ"
              type="text"
              class="detail-input"
              placeholder="0 または 1,2（分岐の後続は 2=Y / 2=N）"
            />
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">TASK_AI_NAME</div>
          <div class="detail-value">
            <select v-model="入力TASK_AI_NAME" class="detail-select">
              <option v-for="ai in taskAiOptions" :key="ai" :value="ai">{{ ai }}</option>
            </select>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">TASK_AI_MODEL_do</div>
          <div class="detail-value">
            <select v-model="入力TASK_AI_MODEL_do" class="detail-select">
              <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
            </select>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">操作検証</div>
          <div class="detail-value">
            <label class="valid-checkbox-label">
              <input
                v-model="入力操作検証"
                type="checkbox"
                class="valid-checkbox"
                aria-label="操作検証の切り替え"
              />
              <span class="valid-checkbox-mark" :class="{ 'valid-checkbox-inactive': !入力操作検証 }">{{ 入力操作検証 ? '✅' : '☐' }}</span>
            </label>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">実行有効</div>
          <div class="detail-value">
            <label class="valid-checkbox-label">
              <input
                v-model="入力実行有効"
                type="checkbox"
                class="valid-checkbox"
                aria-label="実行有効の切り替え"
              />
              <span class="valid-checkbox-mark" :class="{ 'valid-checkbox-inactive': !入力実行有効 }">{{ 入力実行有効 ? '✅' : '☐' }}</span>
            </label>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">状態</div>
          <div class="detail-value">
            <div class="status-segment">
              <template v-for="(状態, i) in 状態表示リスト" :key="状態">
                <span v-if="i > 0" class="segment-sep">/</span>
                <button
                  type="button"
                  class="segment-btn"
                  :class="{ active: 入力状態 === 状態 }"
                  :disabled="!状態選択可(状態)"
                  @click="入力状態 = 状態"
                >{{ 状態 }}</button>
              </template>
            </div>
          </div>
        </div>
      </div>
      <footer class="dialog-footer">
        <button class="dialog-button primary" :disabled="登録中" @click="登録">
          {{ 登録中 ? '登録中...' : '登録' }}
        </button>
        <button class="dialog-button" @click="emit('close')">キャンセル</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog-content {
  background: #07080c;
  color: #e5e7eb;
  width: 1000px;
  max-width: 94vw;
  height: 90vh;
  max-height: 90vh;
  border: 1px solid rgba(143, 104, 221, 0.75);
  border-radius: 4px;
  box-shadow: 0 0 24px rgba(60, 42, 128, 0.65);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 14px;
  height: 32px;
  box-sizing: border-box;
  background: linear-gradient(135deg, rgba(70, 104, 205, 0.96), rgba(108, 78, 196, 0.96), rgba(143, 104, 221, 0.92));
  border-bottom: 1px solid rgba(93, 68, 168, 0.95);
  border-radius: 4px 4px 0 0;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(18, 18, 38, 0.45);
}

.dialog-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: bold;
  color: #fff;
  letter-spacing: 1px;
}

.dialog-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.86);
  font-size: 18px;
  cursor: pointer;
}

.dialog-close:hover {
  color: #fff;
}

.dialog-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: #07080c;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.detail-row {
  display: flex;
  width: 100%;
  margin-top: -1px;
  flex: 0 0 auto;
}

.detail-row.textarea-row {
  flex: 1 1 auto;
  min-height: 0;
}

.textarea-row .detail-value {
  align-items: stretch;
}

.detail-label {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: #ffffff;
  font-weight: 600;
  font-size: 13px;
  text-align: right;
  padding: 8px 12px;
  border: 1px solid rgba(93, 68, 168, 0.85);
  background: linear-gradient(135deg, rgba(55, 71, 79, 0.98), rgba(70, 104, 205, 0.74));
  min-height: 40px;
  width: 120px;
  flex-shrink: 0;
  box-sizing: border-box;
  z-index: 1;
}

.detail-value {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  color: #e5e7eb;
  padding: 4px 12px;
  border: 1px solid rgba(75, 85, 99, 0.95);
  border-left: none;
  background: #10131a;
  min-height: 40px;
  box-sizing: border-box;
}

.required-mark {
  color: #dc2626;
  margin-left: 2px;
}

.value-text {
  font-size: 14px;
}

.detail-input,
.detail-select,
.detail-textarea {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid #4b5563;
  border-radius: 4px;
  background: #05070b;
  color: #f3f4f6;
  font-size: 14px;
  font-family: inherit;
  box-sizing: border-box;
}

.detail-input::placeholder,
.detail-textarea::placeholder {
  color: #6b7280;
}

.detail-input {
  height: 28px;
  padding: 0 8px;
}

.detail-select {
  height: 28px;
  /* 長い選択肢で親を押し広げない */
  min-width: 0;
  max-width: 100%;
}

.detail-textarea {
  font-size: 12px;
  margin: 4px 0;
  flex: 1;
  min-height: 92px;
  height: 100%;
  resize: vertical;
}

.detail-input:focus,
.detail-select:focus,
.detail-textarea:focus {
  outline: none;
  border-color: #8f68dd;
  box-shadow: inset 0 0 0 1px rgba(143, 104, 221, 0.35);
}

.valid-checkbox-label {
  width: 320px;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid #4b5563;
  border-radius: 4px;
  background: #05070b;
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
  user-select: none;
  color: #16a34a;
  font-weight: 700;
  gap: 0;
}

.valid-checkbox-label:focus-within {
  border-color: #8f68dd;
  box-shadow: inset 0 0 0 1px rgba(143, 104, 221, 0.35);
}

.valid-checkbox {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.valid-checkbox-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  font-size: 16px;
  color: #16a34a;
}

.valid-checkbox-inactive {
  color: #d1d5db;
}

.status-segment {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
}

.segment-sep {
  color: #4b5563;
  font-size: 13px;
  flex-shrink: 0;
}

.segment-btn {
  background: #05070b;
  color: #cbd5e1;
  border: 1px solid #4b5563;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s ease;
}

/* 押せるボタンは緑枠、選択中の値は緑文字で区別する */
.segment-btn:not(:disabled) {
  border-color: #16a34a;
}

.segment-btn.active {
  color: #22c55e;
  background: rgba(22, 163, 74, 0.16);
  font-weight: 700;
}

.segment-btn:disabled {
  cursor: default;
}

.segment-btn:disabled:not(.active) {
  opacity: 0.4;
}

.dialog-footer {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid rgba(93, 68, 168, 0.85);
  background: #07080c;
}

.dialog-button {
  background: #1f2937;
  color: #f3f4f6;
  border: 1px solid #4b5563;
  border-radius: 0;
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dialog-button:hover {
  border-color: #8f68dd;
}

.dialog-button.primary {
  background: #28a745;
  color: #fff;
  border-color: #28a745;
}

.dialog-button.primary:hover {
  background: #1e7e34;
  border-color: #1e7e34;
}

.dialog-button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
