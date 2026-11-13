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
// AIタスク_要求編集ダイアログ: マスタ保守と同じラベル/内容の行レイアウト
// 新規: AI登録 API で仮タスク（準備開始）を作成する
// 修正: 更新登録 API で実行中プロセスを停止してからタスク要求を更新する（準備開始で再分解）
import { inject, ref, computed, watch } from 'vue';
import type { PropType } from 'vue';
import apiClient, { taskClient } from '@taskteam/api/client';
import { qMessage } from '@taskteam/utils/qAlert';

const 固定プロジェクト = inject<string>('taskTeamFixedProject', '');
const props = defineProps({
  isOpen: { type: Boolean, default: false },
  利用者ID: { type: String, default: '' },
  編集タスク: { type: Object as PropType<Record<string, any> | null>, default: null },
  最終タスク: { type: Object as PropType<Record<string, any> | null>, default: null }
});
const emit = defineEmits(['close', 'registered']);

const プロジェクト選択肢 = ref<{ value: string; label: string }[]>([]);
const 選択プロジェクト = ref('');
const 入力プロジェクト = ref('');
const 入力要求内容 = ref('');
const 入力TASK_AI_NAME = ref('codex_cli');
const 入力TASK_AI_MODEL_plan = ref('auto');
const 入力TASK_AI_MODEL_do = ref('auto');
const 入力TASK_AI_MODEL_check = ref('auto');
const 入力実行有効 = ref(true);
const 入力状況 = ref('準備開始');
const 状況選択肢 = ['準備開始', '中止'];
// 状況欄には遷移し得る全状態を表示し、選択可能なのは 状況選択肢 の2つだけに絞る
const 状況表示リスト = ['準備開始', '準備中', '準備完了', '待機', '実行中', 'エラー', '完了', '中止'];
// 新規時は準備開始で固定、修正時は切替可能
const 状況変更可 = ref(false);
const 登録中 = ref(false);
const 参照中 = ref(false);
const TASK_CODE_MODELS既定 = {
  claude_sdk: { auto: 'auto' },
  claude_cli: { auto: 'auto' },
  copilot_cli: { auto: 'auto' },
  codex_cli: { auto: 'auto' },
  antigravity_cli: { auto: 'auto' },
  grok_cli: { auto: 'auto' },
  opencode_cli: { auto: 'auto' },
  aidiy_hermes: { auto: 'auto' },
  aidiy_pi: { auto: 'auto' },
};
const availableModels = ref<Record<string, any>>({ code_models: { ...TASK_CODE_MODELS既定 } });
const currentSettings = ref<Record<string, any>>({});
const 新規既定値 = ref<Record<string, any>>({});
const taskAiOptions = computed(() => Object.keys(availableModels.value?.code_models || {}));
const taskModelOptions = computed(() => {
  const models = availableModels.value?.code_models?.[入力TASK_AI_NAME.value] || {};
  return Object.entries(models).map(([value, label]) => ({ value, label: label || value }));
});

// plan（準備）/ do（各ステップ）/ check（終了時の最終確認）を、選択中 AI の候補へ寄せて入れる
const モデル初期化 = (値取得: (フェーズ: string) => unknown) => {
  const 候補 = Object.keys(availableModels.value?.code_models?.[入力TASK_AI_NAME.value] || {});
  const 入力 = {
    plan: 入力TASK_AI_MODEL_plan,
    do: 入力TASK_AI_MODEL_do,
    check: 入力TASK_AI_MODEL_check,
  };
  for (const [フェーズ, ref入力] of Object.entries(入力)) {
    ref入力.value = chooseAvailable(String(値取得(フェーズ) || 'auto'), 候補) || 'auto';
  }
};

const 修正モード = computed(() => !!props.編集タスク);
const タスクID表示 = computed(() => 修正モード.value ? String(props.編集タスク?.タスクID ?? '') : '(新規)');
// 更新系のキーはタスクID単独。利用者IDは所有者の表示と、新規登録時の所有者指定にだけ使う。
// 修正時は対象タスクの所有者（admin が他利用者のタスクを開く場合がある）、新規時はログインID。
const 対象利用者ID = computed(() =>
  props.編集タスク ? String(props.編集タスク.利用者ID ?? '') : props.利用者ID
);
const 利用者ID表示 = computed(() => 対象利用者ID.value || props.利用者ID);
// 押せるのは 状況選択肢 と更新前の状態。更新前の状態を選ぶと状態を変えずに内容だけ更新する
// タスク明細があるタスクは 準備完了 にも戻せる（実行有効の状態に関わらず明細は待機に戻して再起動可能にする）
const 現状態 = computed(() => String(props.編集タスク?.状態 ?? ''));
const 明細あり = ref(false);
const 状況選択可 = (状況: string) =>
  状況選択肢.includes(状況)
  || 状況 === 現状態.value
  || (状況 === '準備完了' && 明細あり.value);

const 明細有無読込 = async () => {
  明細あり.value = false;
  if (!props.編集タスク) return;
  try {
    const res = await taskClient.post('/task/タスク明細/一覧', {
      タスクID: String(props.編集タスク?.タスクID ?? '')
    });
    明細あり.value = res.data.status === 'OK' && (res.data.data?.items ?? []).length > 0;
  } catch (e) {
    明細あり.value = false;
  }
};

// 実行開始条件（右側パネル）。現状は登録のみ対応で、実行は即時のまま
const 実行区分選択肢 = ['即時', '時間指定', '間隔実行', '定時実行'];
const 間隔区分選択肢 = ['分', '時', '日'];
const 定時区分選択肢 = ['毎日', '毎週', '毎月'];
const 曜日選択肢 = ['日', '月', '火', '水', '木', '金', '土'];
const 実行条件選択肢 = ['無し', 'フォルダ変化'];
const 間隔上限: Record<string, number> = { 分: 600, 時: 24, 日: 7 };
const 入力実行区分 = ref('即時');
const 入力間隔区分 = ref('分');
const 入力間隔値 = ref(10);
const 入力定時区分 = ref('毎日');
const 入力実行曜日 = ref('月');
const 入力実行日 = ref(1);
const 入力開始時刻 = ref('09:00');
const 入力実行条件 = ref('無し');
const 入力監視フォルダ = ref('');
const 監視参照中 = ref(false);

const 間隔値上限 = computed(() => 間隔上限[入力間隔区分.value] ?? 600);
const 開始時刻要 = computed(() =>
  入力実行区分.value === '時間指定'
  || (入力実行区分.value === '間隔実行' && 入力間隔区分.value === '日')
  || 入力実行区分.value === '定時実行');

const 実行条件初期化 = () => {
  入力実行区分.value = '即時';
  入力間隔区分.value = '分';
  入力間隔値.value = 10;
  入力定時区分.value = '毎日';
  入力実行曜日.value = '月';
  入力実行日.value = 1;
  入力開始時刻.value = '09:00';
  入力実行条件.value = '無し';
  入力監視フォルダ.value = '';
};

const 実行条件読込 = async () => {
  if (!props.編集タスク) return;
  try {
    const res = await taskClient.post('/task/タスク実行条件/取得', {
      タスクID: String(props.編集タスク?.タスクID ?? '')
    });
    const item = res.data.status === 'OK' ? res.data.data?.item : null;
    if (item && item.実行区分) {
      入力実行区分.value = 実行区分選択肢.includes(item.実行区分) ? String(item.実行区分) : '即時';
      if (間隔区分選択肢.includes(item.間隔区分)) 入力間隔区分.value = String(item.間隔区分);
      if (Number(item.間隔値) >= 1) 入力間隔値.value = Number(item.間隔値);
      if (定時区分選択肢.includes(item.定時区分)) 入力定時区分.value = String(item.定時区分);
      if (曜日選択肢.includes(item.実行曜日)) 入力実行曜日.value = String(item.実行曜日);
      if (Number(item.実行日) >= 1) 入力実行日.value = Number(item.実行日);
      if (item.開始時刻) 入力開始時刻.value = String(item.開始時刻);
      if (実行条件選択肢.includes(item.実行条件)) 入力実行条件.value = String(item.実行条件);
      入力監視フォルダ.value = String(item.監視フォルダ ?? '');
    }
  } catch (e) {
    // 未設定・サーバー未対応時は既定値（即時）のまま開く
  }
};

const 実行条件ペイロード = () => ({
  実行区分: 入力実行区分.value,
  間隔区分: 入力実行区分.value === '間隔実行' ? 入力間隔区分.value : '',
  間隔値: 入力実行区分.value === '間隔実行' ? Number(入力間隔値.value) || 0 : 0,
  定時区分: 入力実行区分.value === '定時実行' ? 入力定時区分.value : '',
  実行曜日: 入力実行区分.value === '定時実行' && 入力定時区分.value === '毎週' ? 入力実行曜日.value : '',
  実行日: 入力実行区分.value === '定時実行' && 入力定時区分.value === '毎月' ? Number(入力実行日.value) || 0 : 0,
  開始時刻: 開始時刻要.value ? 入力開始時刻.value : '',
  実行条件: 入力実行条件.value,
  監視フォルダ: 入力実行条件.value === 'フォルダ変化' ? 入力監視フォルダ.value.trim() : ''
});

const 実行条件検証 = (): string => {
  if (開始時刻要.value && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(入力開始時刻.value)) {
    return '開始時刻を HH:MM 形式で入力してください。';
  }
  if (入力実行区分.value === '間隔実行') {
    const v = Number(入力間隔値.value);
    if (!(v >= 1 && v <= 間隔値上限.value)) {
      return `間隔値（${入力間隔区分.value}）は 1〜${間隔値上限.value} で入力してください。`;
    }
  }
  if (入力実行区分.value === '定時実行' && 入力定時区分.value === '毎月') {
    const d = Number(入力実行日.value);
    if (!(d >= 1 && d <= 31)) return '毎月の実行日は 1〜31 で入力してください。';
  }
  if (入力実行条件.value === 'フォルダ変化' && !入力監視フォルダ.value.trim()) {
    return '監視フォルダを指定してください。';
  }
  return '';
};

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
    currentSettings.value = { CODE_BASE_PATH: '../', TASK_AI_NAME: 'codex_cli', TASK_AI_MODEL_do: 'auto' };
  }
}

async function 新規既定値読込() {
  if (props.編集タスク) {
    新規既定値.value = {};
    return;
  }
  try {
    const res = await taskClient.post('/task/タスク要求/新規既定値', {
      利用者ID: 対象利用者ID.value,
    });
    新規既定値.value = res.data.status === 'OK' ? (res.data.data || {}) : {};
  } catch {
    新規既定値.value = {};
  }
}

const 選択肢読込 = async () => {
  try {
    const res = await taskClient.post('/task/プロジェクト選択肢', {});
    if (res.data.status === 'OK') {
      const 選択肢 = res.data.data?.選択肢 ?? {};
      プロジェクト選択肢.value = Object.entries(選択肢).map(([value, label]) => ({
        value,
        label: `${label} (${value})`
      }));
    }
  } catch (e) {
    プロジェクト選択肢.value = [];
  }
};

const 入力初期化 = () => {
  if (!props.isOpen) return;
  const 編集 = props.編集タスク;
  選択プロジェクト.value = '';
  入力プロジェクト.value = 編集 ? String(編集.プロジェクト ?? '') : 固定プロジェクト || String(props.最終タスク?.プロジェクト ?? '');
  入力要求内容.value = 編集 ? String(編集.要求内容 ?? '') : '';
  入力実行有効.value = 編集 ? Boolean(編集.実行有効) : true;
  // 修正時は更新前の状態を初期選択にする（何も触らず登録しても状態を変えない）
  const 編集状態 = String(編集?.状態 ?? '');
  入力状況.value = 編集 && 状況表示リスト.includes(編集状態) ? 編集状態 : '準備開始';
  状況変更可.value = !!編集;
  実行条件初期化();
  明細あり.value = false;
  if (編集) {
    void 実行条件読込();
    void 明細有無読込();
  }
  void Promise.all([モデル選択肢読込(), 新規既定値読込()]).then(() => {
    const ai候補 = taskAiOptions.value;
    if (編集) {
      入力TASK_AI_NAME.value = chooseAvailable(編集.TASK_AI_NAME || 'codex_cli', ai候補) || 'codex_cli';
      モデル初期化((フェーズ) => 編集[`TASK_AI_MODEL_${フェーズ}`]);
    } else {
      入力プロジェクト.value = 固定プロジェクト || String(
        新規既定値.value.プロジェクト
        ?? props.最終タスク?.プロジェクト
        ?? currentSettings.value.CODE_BASE_PATH
        ?? '../',
      );
      const lastAi = 新規既定値.value.TASK_AI_NAME
        || props.最終タスク?.TASK_AI_NAME
        || currentSettings.value.TASK_AI_NAME
        || 'codex_cli';
      入力TASK_AI_NAME.value = chooseAvailable(lastAi, ai候補) || 'codex_cli';
      // 新規は 新規既定値（更新最終レコード）→ 直前タスク → 共通設定 の順にフェーズ別の値を引く
      モデル初期化((フェーズ) =>
        新規既定値.value[`TASK_AI_MODEL_${フェーズ}`]
        || props.最終タスク?.[`TASK_AI_MODEL_${フェーズ}`]
        || currentSettings.value[`TASK_AI_MODEL_${フェーズ}`],
      );
    }
  });
  void 選択肢読込();
};

watch([() => props.isOpen, () => props.編集タスク], 入力初期化, { immediate: true });

watch(選択プロジェクト, (value) => {
  if (value && !固定プロジェクト) 入力プロジェクト.value = value;
});

watch(入力TASK_AI_NAME, (newValue) => {
  const models = Object.keys(availableModels.value?.code_models?.[newValue] || {});
  if (models.length === 0) return;
  // plan / do / check は同じ AI の候補から選ぶため、AI名変更時はまとめて寄せ直す
  for (const モデル of [入力TASK_AI_MODEL_plan, 入力TASK_AI_MODEL_do, 入力TASK_AI_MODEL_check]) {
    if (!models.includes(モデル.value)) {
      モデル.value = models[0]!;
    }
  }
});

const フォルダ参照 = async () => {
  if (固定プロジェクト) return;
  参照中.value = true;
  try {
    const res = await apiClient.post('/core/AIコア/フォルダ参照', {
      初期パス: 入力プロジェクト.value || ''
    });
    if (res.data.status === 'OK') {
      const 選択パス = String(res.data.data?.選択パス ?? '').replace(/\\/g, '/');
      if (選択パス) 入力プロジェクト.value = 選択パス;
    } else {
      void qMessage(res.data.message || 'フォルダ参照に失敗しました。', 'error');
    }
  } catch (e) {
    void qMessage('フォルダ参照でエラーが発生しました。', 'error');
  } finally {
    参照中.value = false;
  }
};

const 監視フォルダ参照 = async () => {
  監視参照中.value = true;
  try {
    const res = await apiClient.post('/core/AIコア/フォルダ参照', {
      初期パス: 入力監視フォルダ.value || ''
    });
    if (res.data.status === 'OK') {
      const 選択パス = String(res.data.data?.選択パス ?? '').replace(/\\/g, '/');
      if (選択パス) 入力監視フォルダ.value = 選択パス;
    } else {
      void qMessage(res.data.message || 'フォルダ参照に失敗しました。', 'error');
    }
  } catch (e) {
    void qMessage('フォルダ参照でエラーが発生しました。', 'error');
  } finally {
    監視参照中.value = false;
  }
};

const 登録 = async () => {
  if (!入力要求内容.value.trim()) {
    void qMessage('要求内容を入力してください。', 'error');
    return;
  }
  const 条件エラー = 実行条件検証();
  if (条件エラー) {
    void qMessage(条件エラー, 'error');
    return;
  }
  登録中.value = true;
  try {
    const res = 修正モード.value
      ? await taskClient.post('/task/タスク要求/更新登録', {
          タスクID: String(props.編集タスク?.タスクID ?? ''),
          プロジェクト: 入力プロジェクト.value.trim(),
          要求内容: 入力要求内容.value.trim(),
          TASK_AI_NAME: 入力TASK_AI_NAME.value.trim() || 'codex_cli',
          TASK_AI_MODEL_plan: 入力TASK_AI_MODEL_plan.value.trim() || 'auto',
          TASK_AI_MODEL_do: 入力TASK_AI_MODEL_do.value.trim() || 'auto',
          TASK_AI_MODEL_check: 入力TASK_AI_MODEL_check.value.trim() || 'auto',
          実行有効: 入力実行有効.value,
          状況: 入力状況.value,
          実行条件: 実行条件ペイロード()
        })
      : await taskClient.post('/task/タスク要求/AI登録', {
          利用者ID: 対象利用者ID.value,
          プロジェクト: 入力プロジェクト.value.trim(),
          要求内容: 入力要求内容.value.trim(),
          TASK_AI_NAME: 入力TASK_AI_NAME.value.trim() || 'codex_cli',
          TASK_AI_MODEL_plan: 入力TASK_AI_MODEL_plan.value.trim() || 'auto',
          TASK_AI_MODEL_do: 入力TASK_AI_MODEL_do.value.trim() || 'auto',
          TASK_AI_MODEL_check: 入力TASK_AI_MODEL_check.value.trim() || 'auto',
          実行有効: 入力実行有効.value,
          実行条件: 実行条件ペイロード()
        });
    if (res.data.status === 'OK') {
      void qMessage(res.data.message || 'タスクを準備開始として登録しました。');
      emit('registered', res.data.data?.item ?? null);
      emit('close');
    } else {
      void qMessage(res.data.message || 'タスクの登録に失敗しました。', 'error');
    }
  } catch (e) {
    void qMessage('タスクの登録でエラーが発生しました。backend_taskteam (8093) の起動を確認してください。', 'error');
  } finally {
    登録中.value = false;
  }
};
</script>

<template>
  <div v-if="props.isOpen" class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-content">
      <header class="dialog-header">
        <h3>【タスク要求】{{ 修正モード ? '(修正)' : '(新規)' }}</h3>
        <button class="dialog-close" @click="emit('close')">×</button>
      </header>
      <div class="dialog-body">
        <div class="dialog-left">
        <div class="detail-row split-row">
          <div class="detail-half">
            <div class="detail-label">タスクID</div>
            <div class="detail-value">
              <span class="value-text">{{ タスクID表示 }}</span>
            </div>
          </div>
          <div class="detail-half">
            <div class="detail-label">利用者ID</div>
            <div class="detail-value">
              <span class="value-text">{{ 利用者ID表示 }}</span>
            </div>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">プロジェクト</div>
          <div class="detail-value">
            <select :value="固定プロジェクト || 選択プロジェクト" @change="選択プロジェクト = ($event.target as HTMLSelectElement).value" :disabled="!!固定プロジェクト" class="detail-select">
              <option v-if="固定プロジェクト" :value="固定プロジェクト">IDEのプロジェクト（変更不可）</option><option v-else value="">候補から選択してください</option>
              <option v-for="opt in プロジェクト選択肢" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">フォルダ指定</div>
          <div class="detail-value">
            <div class="value-inline">
              <input
                v-model.trim="入力プロジェクト" :readonly="!!固定プロジェクト"
                type="text"
                class="detail-input"
                placeholder="../ または C:/project/"
              />
              <button class="dialog-button" :disabled="参照中 || !!固定プロジェクト" @click="フォルダ参照">参照</button>
            </div>
          </div>
        </div>
        <div class="detail-row textarea-row">
          <div class="detail-label">要求内容<span class="required-mark">*</span></div>
          <div class="detail-value">
            <textarea
              v-model="入力要求内容"
              class="detail-textarea"
              rows="6"
              placeholder="AI に依頼する要求内容を記入してください"
            ></textarea>
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
          <div class="detail-label">TASK_AI_MODEL_plan</div>
          <div class="detail-value">
            <select v-model="入力TASK_AI_MODEL_plan" class="detail-select">
              <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
            </select>
            <span class="model-phase-note">準備（AIによる明細分解）</span>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">TASK_AI_MODEL_do</div>
          <div class="detail-value">
            <select v-model="入力TASK_AI_MODEL_do" class="detail-select">
              <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
            </select>
            <span class="model-phase-note">各ステップの実行</span>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">TASK_AI_MODEL_check</div>
          <div class="detail-value">
            <select v-model="入力TASK_AI_MODEL_check" class="detail-select">
              <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
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
              <span class="valid-checkbox-mark" :class="{ 'valid-checkbox-inactive': !入力実行有効 }">{{ 入力実行有効 ? '✅' : '☐' }}</span>
            </label>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">状況</div>
          <div class="detail-value">
            <div class="status-segment">
              <template v-for="(状況, i) in 状況表示リスト" :key="状況">
                <span v-if="i > 0" class="segment-sep">/</span>
                <button
                  type="button"
                  class="segment-btn"
                  :class="{ active: 入力状況 === 状況 }"
                  :disabled="!状況選択可(状況) || !状況変更可"
                  @click="入力状況 = 状況"
                >{{ 状況 }}</button>
              </template>
            </div>
          </div>
        </div>
        </div>
        <div class="dialog-right">
          <div class="panel-title">実行開始条件</div>
          <div class="detail-row">
            <div class="detail-label">実行区分</div>
            <div class="detail-value">
              <div class="status-segment wrap-segment">
                <button
                  v-for="区分 in 実行区分選択肢"
                  :key="区分"
                  type="button"
                  class="segment-btn"
                  :class="{ active: 入力実行区分 === 区分 }"
                  @click="入力実行区分 = 区分"
                >{{ 区分 }}</button>
              </div>
            </div>
          </div>
          <div v-if="入力実行区分 === '間隔実行'" class="detail-row">
            <div class="detail-label">間隔単位</div>
            <div class="detail-value">
              <div class="status-segment">
                <button
                  v-for="単位 in 間隔区分選択肢"
                  :key="単位"
                  type="button"
                  class="segment-btn"
                  :class="{ active: 入力間隔区分 === 単位 }"
                  @click="入力間隔区分 = 単位"
                >{{ 単位 }}</button>
              </div>
            </div>
          </div>
          <div v-if="入力実行区分 === '間隔実行'" class="detail-row">
            <div class="detail-label">間隔値</div>
            <div class="detail-value">
              <div class="value-inline">
                <input
                  v-model.number="入力間隔値"
                  type="number"
                  class="detail-input number-input"
                  :min="1"
                  :max="間隔値上限"
                />
                <span class="unit-text">{{ 入力間隔区分 }}（1〜{{ 間隔値上限 }}）</span>
              </div>
            </div>
          </div>
          <div v-if="入力実行区分 === '定時実行'" class="detail-row">
            <div class="detail-label">定時区分</div>
            <div class="detail-value">
              <div class="status-segment">
                <button
                  v-for="区分 in 定時区分選択肢"
                  :key="区分"
                  type="button"
                  class="segment-btn"
                  :class="{ active: 入力定時区分 === 区分 }"
                  @click="入力定時区分 = 区分"
                >{{ 区分 }}</button>
              </div>
            </div>
          </div>
          <div v-if="入力実行区分 === '定時実行' && 入力定時区分 === '毎週'" class="detail-row">
            <div class="detail-label">実行曜日</div>
            <div class="detail-value">
              <select v-model="入力実行曜日" class="detail-select">
                <option v-for="曜 in 曜日選択肢" :key="曜" :value="曜">{{ 曜 }}曜日</option>
              </select>
            </div>
          </div>
          <div v-if="入力実行区分 === '定時実行' && 入力定時区分 === '毎月'" class="detail-row">
            <div class="detail-label">実行日</div>
            <div class="detail-value">
              <div class="value-inline">
                <input
                  v-model.number="入力実行日"
                  type="number"
                  class="detail-input number-input"
                  min="1"
                  max="31"
                />
                <span class="unit-text">日（1〜31）</span>
              </div>
            </div>
          </div>
          <div v-if="開始時刻要" class="detail-row">
            <div class="detail-label">開始時刻</div>
            <div class="detail-value">
              <input v-model="入力開始時刻" type="time" class="detail-input time-input" />
            </div>
          </div>
          <div class="detail-row">
            <div class="detail-label">実行条件</div>
            <div class="detail-value">
              <div class="status-segment">
                <button
                  v-for="条件 in 実行条件選択肢"
                  :key="条件"
                  type="button"
                  class="segment-btn"
                  :class="{ active: 入力実行条件 === 条件 }"
                  @click="入力実行条件 = 条件"
                >{{ 条件 }}</button>
              </div>
            </div>
          </div>
          <div v-if="入力実行条件 === 'フォルダ変化'" class="detail-row">
            <div class="detail-label">監視フォルダ</div>
            <div class="detail-value">
              <div class="value-inline">
                <input
                  v-model.trim="入力監視フォルダ"
                  type="text"
                  class="detail-input"
                  placeholder="C:/watch/folder/"
                />
                <button class="dialog-button" :disabled="監視参照中" @click="監視フォルダ参照">参照</button>
              </div>
            </div>
          </div>
          <div class="condition-note">※ 条件は毎分確認し、成立すると明細と要求を待機に戻して実行します（実行途中は開始しません）。</div>
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
  width: 1280px;
  max-width: 96vw;
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
  flex-direction: row;
  gap: 10px;
  background: #07080c;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

/* 幅が足りない時だけ右の実行開始条件パネルを下に回す（横スクロールバー防止） */
@media (max-width: 1000px) {
  .dialog-body {
    flex-direction: column;
  }

  .dialog-right {
    width: 100%;
  }
}

/* 左: タスク要求本体 / 右: 実行開始条件パネル */
.dialog-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.dialog-right {
  width: 400px;
  max-width: 100%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  align-self: flex-start;
}

.panel-title {
  color: #ffffff;
  font-weight: 600;
  font-size: 13px;
  text-align: center;
  padding: 8px 12px;
  border: 1px solid rgba(93, 68, 168, 0.85);
  background: linear-gradient(135deg, rgba(108, 78, 196, 0.9), rgba(70, 104, 205, 0.74));
  box-sizing: border-box;
}

.dialog-right .detail-label {
  width: 96px;
}

.wrap-segment {
  flex-wrap: wrap;
}

.number-input {
  width: 90px;
  flex: 0 0 auto;
}

.time-input {
  width: 120px;
}

.unit-text {
  font-size: 13px;
  color: #9ca3af;
  white-space: nowrap;
}

.condition-note {
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
}

/* マスタ保守と同じラベル / 内容の行レイアウト */
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

/* 1 行を左右 50% ずつに割って、ラベル+内容の組を 2 つ並べる（タスクID / 利用者ID） */
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
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: #ffffff;
  font-weight: 600;
  font-size: 13px;
  text-align: right;
  overflow-wrap: anywhere;
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

.value-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  flex-wrap: nowrap;
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
  min-width: 0;
}

.model-phase-note {
  margin-left: 8px;
  font-size: 12px;
  color: #6b7280;
}

.detail-select {
  height: 28px;
  /* 長い選択肢（プロジェクトパス等）で親を押し広げない */
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

/* マスタ保守と同じ実行有効欄（入力欄風ボックス + 中央の ✅/☐） */
.valid-checkbox-label {
  width: 320px;
  max-width: 100%;
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
  flex-wrap: wrap;
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
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s ease;
}

.value-inline .dialog-button {
  flex: 0 0 56px;
  height: 28px;
  padding: 0 10px;
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
