<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup lang="ts">
import { inject, computed, ref, watch } from 'vue';
import apiClient, { taskClient, teamClient } from '@taskteam/api/client';
import { qMessage } from '@taskteam/utils/qAlert';
import type { チーム依頼 } from '../AIチーム_型';

const 固定プロジェクト = inject<string>('taskTeamFixedProject', '');
const props = defineProps<{
  isOpen: boolean;
  編集依頼: チーム依頼 | null;
  最終依頼: チーム依頼 | null;
  利用者ID: string;
  利用者名: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [item: チーム依頼];
}>();

const 利用者ID = computed(() => props.利用者ID || 'admin');
const 利用者名 = computed(() => props.利用者名 || props.利用者ID || 'admin');
const 修正モード = computed(() => props.編集依頼 !== null);
// 新規は依頼の担当としてログイン利用者IDを使う。修正は対象依頼の要員IDをそのまま引き継ぐ
const 対象要員ID = computed(() =>
  props.編集依頼 ? String(props.編集依頼.要員ID ?? '') || 利用者ID.value : 利用者ID.value
);
const 状況選択肢 = ['準備開始', '準備完了', '済', '中止'];
const 状況表示リスト = ['準備開始', '準備中', '準備完了', '待機', '実行中', 'エラー', '完了', '済', '中止'];
const 現状態 = computed(() => String(props.編集依頼?.状態 ?? ''));
const 状況選択可 = (status: string) =>
  状況選択肢.includes(status) || status === 現状態.value;

const プロジェクト選択肢 = ref<{ value: string; label: string }[]>([]);
const 選択プロジェクト = ref('');
const 入力プロジェクト = ref('');
const 入力要求内容 = ref('');
const 入力TEAM_AI_NAME = ref('codex_cli');
const 入力TEAM_AI_MODEL_plan = ref('auto');
const 入力TEAM_AI_MODEL_do = ref('auto');
const 入力TEAM_AI_MODEL_check = ref('auto');
const 入力TASK_AI_NAME = ref('codex_cli');
const 入力TASK_AI_MODEL_plan = ref('auto');
const 入力TASK_AI_MODEL_do = ref('auto');
const 入力TASK_AI_MODEL_check = ref('auto');
const 入力実行有効 = ref(true);
const 入力状況 = ref('準備開始');
const 状況変更可 = ref(false);
const availableModels = ref<Record<string, any>>({ code_models: {} });
const currentSettings = ref<Record<string, any>>({});
const 登録中 = ref(false);
const 参照中 = ref(false);
const フォーム初期化中 = ref(false);

const teamAiOptions = computed(() => Object.keys(availableModels.value?.code_models || {}));
const teamModelOptions = computed(() => {
  const models = availableModels.value?.code_models?.[入力TEAM_AI_NAME.value] || {};
  return Object.entries(models).map(([value, label]) => ({ value, label: String(label || value) }));
});
const taskAiOptions = computed(() => Object.keys(availableModels.value?.code_models || {}));
const taskModelOptions = computed(() => {
  const models = availableModels.value?.code_models?.[入力TASK_AI_NAME.value] || {};
  return Object.entries(models).map(([value, label]) => ({ value, label: String(label || value) }));
});

const chooseAvailable = (current: unknown, candidates: string[]) => {
  const value = String(current || '');
  return value && candidates.includes(value) ? value : candidates[0] || '';
};

// モデルは3種ずつ。TEAM 側は作業ループの段（S・P / D / C・A）、
// TASK 側は投入する Aタスクの内部フェーズ（準備 / 各ステップ / 最終確認）に対応する
const AIモデルフェーズ = ['plan', 'do', 'check'] as const;
const TEAMモデル入力 = [入力TEAM_AI_MODEL_plan, 入力TEAM_AI_MODEL_do, 入力TEAM_AI_MODEL_check];
const TASKモデル入力 = [入力TASK_AI_MODEL_plan, 入力TASK_AI_MODEL_do, 入力TASK_AI_MODEL_check];

// 依頼の値 → 共通設定の順に、選択中AIの候補へ寄せて入れる
const モデル反映 = (接頭辞: 'TEAM' | 'TASK', 元: Record<string, any> | null | undefined) => {
  const AI名 = 接頭辞 === 'TEAM' ? 入力TEAM_AI_NAME.value : 入力TASK_AI_NAME.value;
  const 候補 = Object.keys(availableModels.value?.code_models?.[AI名] || {});
  const 入力一覧 = 接頭辞 === 'TEAM' ? TEAMモデル入力 : TASKモデル入力;
  AIモデルフェーズ.forEach((フェーズ, 位置) => {
    const キー = `${接頭辞}_AI_MODEL_${フェーズ}`;
    const 値 = 元?.[キー] || currentSettings.value[キー] || 'auto';
    入力一覧[位置]!.value = chooseAvailable(値, 候補) || 'auto';
  });
};

// AI名を変えたとき、そのAIに無いモデルが残らないよう先頭へ寄せる
const 候補へ寄せる = (接頭辞: 'TEAM' | 'TASK', AI名: string) => {
  const models = Object.keys(availableModels.value?.code_models?.[AI名] || {});
  if (!models.length) return;
  for (const モデル of 接頭辞 === 'TEAM' ? TEAMモデル入力 : TASKモデル入力) {
    if (!models.includes(モデル.value)) モデル.value = models[0]!;
  }
};

const モデル選択肢読込 = async () => {
  try {
    const [modelResponse, settingResponse] = await Promise.all([
      apiClient.post('/core/AIコア/モデル情報/TASK選択肢', {}),
      teamClient.post('/team/設定/取得', {}),
    ]);
    if (modelResponse.data?.status !== 'OK' || settingResponse.data?.status !== 'OK') {
      throw new Error();
    }
    availableModels.value = modelResponse.data.data?.available_models || { code_models: {} };
    currentSettings.value = settingResponse.data.data || {};
  } catch {
    availableModels.value = { code_models: { codex_cli: { auto: 'auto' } } };
    currentSettings.value = {
      CODE_BASE_PATH: '../',
      TEAM_AI_NAME: 'codex_cli',
      TASK_AI_NAME: 'codex_cli',
      TEAM_AI_MODEL_plan: 'auto',
      TEAM_AI_MODEL_do: 'auto',
      TEAM_AI_MODEL_check: 'auto',
      TASK_AI_MODEL_plan: 'auto',
      TASK_AI_MODEL_do: 'auto',
      TASK_AI_MODEL_check: 'auto',
    };
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

const フォーム初期化 = async () => {
  const work = props.編集依頼;
  入力要求内容.value = work?.要求内容 ?? '';
  入力実行有効.value = work ? Boolean(work.実行有効) : true;
  const currentStatus = String(work?.状態 ?? '');
  入力状況.value = work && 状況表示リスト.includes(currentStatus)
    ? currentStatus
    : '準備開始';
  状況変更可.value = Boolean(work);
  await Promise.all([モデル選択肢読込(), プロジェクト選択肢読込()]);
  const initialProject = work
    ? work.プロジェクト
    : props.最終依頼
      ? props.最終依頼.プロジェクト
      : String(currentSettings.value.CODE_BASE_PATH || '../');
  入力プロジェクト.value = !work && 固定プロジェクト ? 固定プロジェクト : initialProject;
  選択プロジェクト.value = プロジェクト選択肢.value.some(
    (option) => option.value === initialProject,
  )
    ? initialProject
    : '';
  フォーム初期化中.value = true;
  const aiCandidates = teamAiOptions.value;
  const initialWork = work ?? props.最終依頼;
  const teamAiName = initialWork?.TEAM_AI_NAME || currentSettings.value.TEAM_AI_NAME || 'codex_cli';
  入力TEAM_AI_NAME.value = chooseAvailable(teamAiName, aiCandidates) || 'codex_cli';
  モデル反映('TEAM', initialWork);
  const taskAiName = initialWork?.TASK_AI_NAME || currentSettings.value.TASK_AI_NAME || 'codex_cli';
  入力TASK_AI_NAME.value = chooseAvailable(taskAiName, taskAiOptions.value) || 'codex_cli';
  モデル反映('TASK', initialWork);
  フォーム初期化中.value = false;
};

watch(
  () => props.isOpen,
  (open) => {
    if (open) void フォーム初期化();
  },
);

watch(選択プロジェクト, (value) => {
  if (value && !固定プロジェクト) 入力プロジェクト.value = value;
});

watch(入力TEAM_AI_NAME, (value) => {
  候補へ寄せる('TEAM', value);
  // TEAM を変えたら TASK 側も同じ選択に追従させる（別々に選び直すこともできる）
  if (!フォーム初期化中.value) {
    入力TASK_AI_NAME.value = value;
    AIモデルフェーズ.forEach((_, 位置) => {
      TASKモデル入力[位置]!.value = TEAMモデル入力[位置]!.value;
    });
  }
}, { flush: 'sync' });

TEAMモデル入力.forEach((モデル, 位置) => {
  watch(モデル, (value) => {
    // TASK の AI を別に選び直した後は、別 AI のモデルを流し込まない。
    if (!フォーム初期化中.value && 入力TEAM_AI_NAME.value === 入力TASK_AI_NAME.value) {
      TASKモデル入力[位置]!.value = value;
    }
  }, { flush: 'sync' });
});

watch(入力TASK_AI_NAME, (value) => {
  候補へ寄せる('TASK', value);
}, { flush: 'sync' });

const フォルダ参照 = async () => {
  if (固定プロジェクト) return;
  参照中.value = true;
  try {
    const response = await apiClient.post('/core/AIコア/フォルダ参照', {
      初期パス: 入力プロジェクト.value,
    });
    if (response.data?.status === 'OK') {
      const path = String(response.data.data?.選択パス ?? '').replace(/\\/g, '/');
      if (path) 入力プロジェクト.value = path;
    } else {
      void qMessage(response.data?.message || 'フォルダ参照に失敗しました。', 'error');
    }
  } catch {
    void qMessage('フォルダ参照でエラーが発生しました。', 'error');
  } finally {
    参照中.value = false;
  }
};

const 登録 = async () => {
  if (!入力要求内容.value.trim()) {
    void qMessage('要求内容を入力してください。', 'error');
    return;
  }
  登録中.value = true;
  try {
    const response = await teamClient.post(
      修正モード.value ? '/team/依頼/変更' : '/team/依頼/登録',
      {
        要員ID: 対象要員ID.value,
        依頼ID: props.編集依頼?.依頼ID ?? '',
        プロジェクト: 入力プロジェクト.value.trim(),
        要求内容: 入力要求内容.value.trim(),
        TEAM_AI_NAME: 入力TEAM_AI_NAME.value,
        TEAM_AI_MODEL_plan: 入力TEAM_AI_MODEL_plan.value,
        TEAM_AI_MODEL_do: 入力TEAM_AI_MODEL_do.value,
        TEAM_AI_MODEL_check: 入力TEAM_AI_MODEL_check.value,
        TASK_AI_NAME: 入力TASK_AI_NAME.value,
        TASK_AI_MODEL_plan: 入力TASK_AI_MODEL_plan.value,
        TASK_AI_MODEL_do: 入力TASK_AI_MODEL_do.value,
        TASK_AI_MODEL_check: 入力TASK_AI_MODEL_check.value,
        実行有効: 入力実行有効.value,
        状態: 入力状況.value,
        操作利用者ID: 利用者ID.value,
        操作利用者名: 利用者名.value,
        操作端末ID: 'aidiy_team',
      },
    );
    if (response.data?.status !== 'OK') {
      void qMessage(response.data?.message || 'チーム依頼を登録できませんでした。', 'error');
      return;
    }
    const item = response.data?.data?.item as チーム依頼 | undefined;
    if (!item?.依頼ID) {
      void qMessage('登録結果の応答形式が正しくありません。', 'error');
      return;
    }
    emit('saved', item);
    emit('close');
  } catch {
    void qMessage('チーム依頼の登録でエラーが発生しました。backend_taskteam (8093) を確認してください。', 'error');
  } finally {
    登録中.value = false;
  }
};
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="dialog-overlay" @click.self="emit('close')">
      <section class="dialog-content" role="dialog" aria-modal="true" aria-label="チーム依頼編集">
        <header class="dialog-header">
          <h3>【チーム依頼】{{ 修正モード ? '(修正)' : '(新規)' }}</h3>
          <button type="button" class="dialog-close" aria-label="閉じる" @click="emit('close')">×</button>
        </header>

        <div class="dialog-body">
          <div class="detail-row split-row">
            <div class="detail-half">
              <div class="detail-label">依頼ID</div>
              <div class="detail-value">{{ 編集依頼?.依頼ID || '(新規)' }}</div>
            </div>
            <div class="detail-half">
              <div class="detail-label">要員ID</div>
              <div class="detail-value">{{ 対象要員ID }}</div>
            </div>
          </div>
          <div class="detail-row">
            <div class="detail-label">プロジェクト</div>
            <div class="detail-value">
              <select :value="固定プロジェクト || 選択プロジェクト" @change="選択プロジェクト = ($event.target as HTMLSelectElement).value" :disabled="!!固定プロジェクト" class="detail-select">
                <option v-if="固定プロジェクト" :value="固定プロジェクト">IDEのプロジェクト（変更不可）</option><option v-else value="">候補から選択してください</option>
                <option v-for="option in プロジェクト選択肢" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
          </div>
          <div class="detail-row">
            <div class="detail-label">フォルダ指定</div>
            <div class="detail-value value-inline">
              <input v-model.trim="入力プロジェクト" :readonly="!!固定プロジェクト" class="detail-input" type="text" />
              <button type="button" class="dialog-button browse" :disabled="参照中 || !!固定プロジェクト" @click="フォルダ参照">
                参照
              </button>
            </div>
          </div>
          <div class="detail-row request-row">
            <div class="detail-label">要求内容<span class="required-mark">*</span></div>
            <div class="detail-value">
              <textarea
                v-model="入力要求内容"
                class="detail-textarea"
                rows="9"
                placeholder="AIチームへ依頼する依頼内容を入力してください"
              ></textarea>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <div class="detail-label">TEAM_AI_NAME</div>
            <div class="detail-value">
              <select v-model="入力TEAM_AI_NAME" class="detail-select">
                <option v-for="name in teamAiOptions" :key="name" :value="name">{{ name }}</option>
              </select>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <div class="detail-label">TEAM_AI_MODEL_plan</div>
            <div class="detail-value">
              <select v-model="入力TEAM_AI_MODEL_plan" class="detail-select">
                <option v-for="model in teamModelOptions" :key="model.value" :value="model.value">
                  {{ model.label }}
                </option>
              </select>
              <span class="model-phase-note">相談・計画（S・P）</span>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <div class="detail-label">TEAM_AI_MODEL_do</div>
            <div class="detail-value">
              <select v-model="入力TEAM_AI_MODEL_do" class="detail-select">
                <option v-for="model in teamModelOptions" :key="model.value" :value="model.value">
                  {{ model.label }}
                </option>
              </select>
              <span class="model-phase-note">実施（D）</span>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <div class="detail-label">TEAM_AI_MODEL_check</div>
            <div class="detail-value">
              <select v-model="入力TEAM_AI_MODEL_check" class="detail-select">
                <option v-for="model in teamModelOptions" :key="model.value" :value="model.value">
                  {{ model.label }}
                </option>
              </select>
              <span class="model-phase-note">評価・改善（C・A）</span>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <div class="detail-label">TASK_AI_NAME</div>
            <div class="detail-value">
              <select v-model="入力TASK_AI_NAME" class="detail-select">
                <option v-for="name in taskAiOptions" :key="name" :value="name">{{ name }}</option>
              </select>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <div class="detail-label">TASK_AI_MODEL_plan</div>
            <div class="detail-value">
              <select v-model="入力TASK_AI_MODEL_plan" class="detail-select">
                <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">
                  {{ model.label }}
                </option>
              </select>
              <span class="model-phase-note">Aタスクの準備</span>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <div class="detail-label">TASK_AI_MODEL_do</div>
            <div class="detail-value">
              <select v-model="入力TASK_AI_MODEL_do" class="detail-select">
                <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">
                  {{ model.label }}
                </option>
              </select>
              <span class="model-phase-note">各ステップの実行</span>
            </div>
          </div>
          <div class="detail-row one-line-row">
            <div class="detail-label">TASK_AI_MODEL_check</div>
            <div class="detail-value">
              <select v-model="入力TASK_AI_MODEL_check" class="detail-select">
                <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">
                  {{ model.label }}
                </option>
              </select>
              <span class="model-phase-note">終了時の最終確認</span>
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
                <span
                  class="valid-checkbox-mark"
                  :class="{ 'valid-checkbox-inactive': !入力実行有効 }"
                >{{ 入力実行有効 ? '✅' : '☐' }}</span>
              </label>
            </div>
          </div>
          <div class="detail-row">
            <div class="detail-label">状況</div>
            <div class="detail-value">
              <div class="status-segment">
                <template v-for="(status, index) in 状況表示リスト" :key="status">
                  <span v-if="index > 0" class="segment-sep">/</span>
                  <button
                    type="button"
                    class="segment-btn"
                    :class="{ active: 入力状況 === status }"
                    :disabled="!状況選択可(status) || !状況変更可"
                    @click="入力状況 = status"
                  >
                    {{ status }}
                  </button>
                </template>
              </div>
            </div>
          </div>
        </div>

        <footer class="dialog-footer">
          <button type="button" class="dialog-button primary" :disabled="登録中" @click="登録">
            {{ 登録中 ? '登録中…' : '登録' }}
          </button>
          <button type="button" class="dialog-button" @click="emit('close')">キャンセル</button>
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

.detail-row {
  display: flex;
  width: 100%;
  margin-top: -1px;
  flex: 0 0 auto;
}

/* 1 行を左右 50% ずつに割って、ラベル+内容の組を 2 つ並べる（依頼ID / 要員ID） */
.detail-row.split-row {
  gap: 0;
}

.split-row .detail-half {
  display: flex;
  flex: 1 1 50%;
  min-width: 0;
}

.split-row .detail-half + .detail-half {
  margin-left: -1px;
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

.request-row .detail-value {
  align-items: stretch;
}

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
.model-phase-note {
  margin-left: 8px;
  font-size: 12px;
  color: #6b7280;
}

.detail-select {
  height: 26px;
}

.detail-input {
  min-width: 0;
  margin: 0;
  padding: 0 8px;
}

.detail-select {
  min-width: 0;
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

.detail-textarea {
  font-size: 12px;
  min-height: 170px;
  resize: vertical;
}

.value-inline {
  gap: 8px;
}

.required-mark {
  margin-left: 2px;
  color: #dc2626;
}

.valid-checkbox-label {
  width: 320px;
  max-width: 100%;
  height: 26px;
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid #4b5563;
  border-radius: 4px;
  color: #16a34a;
  background: #05070b;
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  user-select: none;
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
  color: #16a34a;
  font-size: 16px;
  line-height: 1;
}

.valid-checkbox-inactive {
  color: #d1d5db;
}

.status-segment {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.segment-sep {
  flex-shrink: 0;
  color: #4b5563;
  font-size: 13px;
}

.segment-btn {
  padding: 4px 10px;
  border: 1px solid #4b5563;
  border-radius: 4px;
  color: #cbd5e1;
  background: #05070b;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  transition: all 0.2s ease;
}

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
  padding: 8px 12px;
  border-top: 1px solid rgba(93, 68, 168, 0.85);
}

.dialog-button {
  padding: 6px 16px;
  border: 1px solid #4b5563;
  border-radius: 0;
  color: #f3f4f6;
  background: #1f2937;
  cursor: pointer;
}

.dialog-button.browse {
  height: 26px;
  flex: 0 0 auto;
  padding: 0 12px;
}

.dialog-button.primary {
  border-color: #28a745;
  color: #fff;
  background: #28a745;
}

.dialog-button:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (max-width: 680px) {
  .detail-label {
    width: 112px;
  }
}
</style>
