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
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import apiClient from '@/api/client'
import RebootDialog from '@/dialog/再起動カウントダウン.vue'
import { qAlert, qConfirm } from '@/utils/qAlert'

const props = defineProps<{
  isOpen: boolean
  sessionId: string
  fixedProjectPath?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', waitSeconds: number, resetSession?: boolean): void
}>()

const loading = ref(false)
const browsingCodeBase = ref(false)
const errorMessage = ref('')
const availableModels = ref<Record<string, any>>({})
const currentSettings = ref<Record<string, any>>({})
const codeBaseOptions = ref<Record<string, string>>({})
const showRebootDialog = ref(false)
const rebootWaitSeconds = ref(15)
const isInitializing = ref(false)
const hasLoadedConfig = ref(false)

let loadedFormSettings: Record<string, any> = {};

const selections = reactive({
  chatAi: '',
  chatModel: '',
  predictionAi: 'auto',
  decisionAi: 'auto',
  liveAi: '',
  liveModel: '',
  liveVoice: '',
  codeAi1: '',
  codeModel1: '',
  codeAi2: '',
  codeModel2: '',
  codeAi3: '',
  codeModel3: '',
  codeAi4: '',
  codeModel4: '',
  codeAi5: '',
  codeModel5: '',
  codeAi6: '',
  codeModel6: '',
  codeBasePath: '',
  codePermissions: 'auto',
  taskAi: '',
  taskModelPlan: '',
  taskModelDo: '',
  taskModelCheck: '',
  teamAi: '',
  teamModelPlan: '',
  teamModelDo: '',
  teamModelCheck: '',
})

const CHAT_MODEL_KEYS: Record<string, string> = {
  gemini_chat: 'CHAT_GEMINI_MODEL',
  freeai_chat: 'CHAT_FREEAI_MODEL',
  openrt_chat: 'CHAT_OPENRT_MODEL',
  openrt_free: 'CHAT_OPENRT_FREE_MODEL',
  openai_chat: 'CHAT_OPENAI_MODEL',
  openai_oauth: 'CHAT_OPENAI_MODEL',
  ollama_chat: 'CHAT_OLLAMA_MODEL',
  local_chat: 'CHAT_LOCAL_MODEL',
}

const LIVE_MODEL_KEYS: Record<string, string> = {
  gemini_live: 'LIVE_GEMINI_MODEL',
  freeai_live: 'LIVE_FREEAI_MODEL',
  openai_live: 'LIVE_OPENAI_MODEL',
}

const LIVE_VOICE_KEYS: Record<string, string> = {
  gemini_live: 'LIVE_GEMINI_VOICE',
  freeai_live: 'LIVE_FREEAI_VOICE',
  openai_live: 'LIVE_OPENAI_VOICE',
}

const CODE_MODEL_KEYS: Record<string, string> = {
  claude_sdk: 'CODE_CLAUDE_SDK_MODEL',
  claude_cli: 'CODE_CLAUDE_CLI_MODEL',
  copilot_cli: 'CODE_COPILOT_CLI_MODEL',
  antigravity_cli: 'CODE_ANTIGRAVITY_CLI_MODEL',
  codex_cli: 'CODE_CODEX_CLI_MODEL',
  grok_cli: 'CODE_GROK_CLI_MODEL',
  opencode_cli: 'CODE_OPENCODE_CLI_MODEL',
  aidiy_hermes: 'CODE_AIDIY_HERMES_MODEL',
  claude_ollama: 'CODE_CLAUDE_OLLAMA_MODEL',
  codex_ollama: 'CODE_CODEX_OLLAMA_MODEL',
}

const chatAiOptions = computed(() => Object.keys(availableModels.value?.chat_models || {}))
// 予測候補はDiag取得値だけ。autoは実行側と同じ優先順の1方式に絞る。
const predictionProviders = ['openai_oauth', 'freeai_chat', 'openai_chat', 'gemini_chat', 'codex_cli', 'copilot_cli', 'aidiy_hermes'];
const predictionAutoProviders = ['codex_cli', 'copilot_cli', 'aidiy_hermes', 'openai_oauth', 'freeai_chat', 'openai_chat', 'gemini_chat'];
const predictionAiOptions = computed(() => [...new Set(['auto', ...predictionProviders, selections.predictionAi])].filter(Boolean));
const predictionCatalog = computed<Record<string, Record<string, string>>>(() => {
  const catalog: Record<string, Record<string, string>> = {};
  for (const provider of predictionProviders) {
    const models = availableModels.value?.prediction_models?.[provider];
    if (!models || typeof models !== 'object' || Array.isArray(models)) continue;
    catalog[provider] = Object.fromEntries(Object.entries(models).filter(([model, label]) =>
      model.length > 0 && model.length <= 200 && model.trim() === model &&
      !/[\x00-\x1f\x7f]/.test(model) && !['auto', 'same'].includes(model) && typeof label === 'string'
    )) as Record<string, string>;
  }
  return catalog;
});
const predictionResolvedAi = computed(() => selections.predictionAi === 'auto'
  ? predictionAutoProviders.find(provider => Object.keys(predictionCatalog.value[provider] || {}).length > 0) || ''
  : selections.predictionAi);
const predictionFields = [
  { key: 'PREDICTION_OPENAI_MODEL', provider: 'openai_chat' },
  { key: 'PREDICTION_OAUTH_MODEL', provider: 'openai_oauth' },
  { key: 'PREDICTION_GEMINI_MODEL', provider: 'gemini_chat' },
  { key: 'PREDICTION_FREEAI_MODEL', provider: 'freeai_chat' },
  { key: 'PREDICTION_CODEX_CLI_MODEL', provider: 'codex_cli' },
  { key: 'PREDICTION_COPILOT_CLI_MODEL', provider: 'copilot_cli' },
  { key: 'PREDICTION_AIDIY_HERMES_MODEL', provider: 'aidiy_hermes' },
];
const predictionModels = reactive<Record<string, string>>({});
const predictionHasCandidates = computed(() => Object.keys(predictionCatalog.value[predictionResolvedAi.value] || {}).length > 0);
const predictionModelOptions = (field: { key: string; provider: string }) => {
  const choices: Record<string, string> = {
    auto: 'auto（方式の先頭候補）',
    ...predictionCatalog.value[field.provider],
  };
  const current = predictionModels[field.key];
  if (current && !Object.prototype.hasOwnProperty.call(choices, current)) {
    choices[current] = current + '（保持値・Diag一覧外／未確認）';
  }
  return Object.entries(choices).map(([value, label]) => ({ value, label: label || value }));
};

// 判断の候補はDiag取得値だけ。方式・モデルの保存値は一覧外でも失わない。
const decisionAiOptions = computed(() => [...new Set([
  'auto', 'openai_oauth', 'freeai_chat', 'openai_decisions', 'gemini_chat', selections.decisionAi,
])].filter(Boolean));
const decisionFields = [
  { key: 'DECISION_OPENAI_MODEL', provider: 'openai_decisions' },
  { key: 'DECISION_OAUTH_MODEL', provider: 'openai_oauth' },
  { key: 'DECISION_GEMINI_MODEL', provider: 'gemini_chat' },
  { key: 'DECISION_FREEAI_MODEL', provider: 'freeai_chat' },
];
const decisionModels = reactive<Record<string, string>>({});
const decisionHasCandidates = computed(() => decisionFields.some(field =>
  Object.keys(availableModels.value?.decision_models?.[field.provider] || {}).some(model => model !== 'auto')));
const decisionModelOptions = (field: { key: string; provider: string }) => {
  const choices: Record<string, string> = {
    auto: 'auto（方式別の既定モデル）',
    ...availableModels.value?.decision_models?.[field.provider],
  };
  const current = decisionModels[field.key];
  if (current && !choices[current]) choices[current] = current + '（保持値・Diag一覧外／未確認）';
  return Object.entries(choices).map(([value, label]) => ({ value, label }));
};

const liveAiOptions = computed(() => Object.keys(availableModels.value?.live_models || {}))
const codeAiOptions = computed(() => Object.keys(availableModels.value?.code_models || {}))
const codeBaseOptionsList = computed(() => Object.entries(codeBaseOptions.value || {}).map(([value, label]) => ({ value, label })))
const codePermissionOptions = ['auto', 'full', 'none']

const chatModelOptions = computed(() => {
  const models = availableModels.value?.chat_models?.[selections.chatAi] || {}
  return Object.entries(models).map(([value, label]) => ({ value, label: label || value }))
})

const liveModelOptions = computed(() => {
  const models = availableModels.value?.live_models?.[selections.liveAi] || {}
  return Object.entries(models).map(([value, label]) => ({ value, label: label || value }))
})

const liveVoiceOptions = computed(() => {
  const voices = availableModels.value?.live_voices?.[selections.liveAi] || {}
  return Object.entries(voices).map(([value, label]) => ({ value, label: label || value }))
})

const codeModelOptions1 = computed(() => buildCodeModelOptions(selections.codeAi1))
const codeModelOptions2 = computed(() => buildCodeModelOptions(selections.codeAi2))
const codeModelOptions3 = computed(() => buildCodeModelOptions(selections.codeAi3))
const codeModelOptions4 = computed(() => buildCodeModelOptions(selections.codeAi4))
const codeModelOptions5 = computed(() => buildCodeModelOptions(selections.codeAi5))
const codeModelOptions6 = computed(() => buildCodeModelOptions(selections.codeAi6))
const taskModelOptions = computed(() => buildCodeModelOptions(selections.taskAi))
const teamModelOptions = computed(() => buildCodeModelOptions(selections.teamAi))

function buildCodeModelOptions(aiName: string) {
  const models = availableModels.value?.code_models?.[aiName] || {}
  return Object.entries(models).map(([value, label]) => ({ value, label: label || value }))
}

function chooseAvailable(current: any, candidates: string[]) {
  const value = String(current || '')
  return value && candidates.includes(value) ? value : candidates[0] || ''
}

function normalizeCodeBasePath(path: string) {
  return path.trim().replace(/\\/g, '/')
}

async function handleBrowseCodeBasePath() {
  if (props.fixedProjectPath) return
  browsingCodeBase.value = true
  errorMessage.value = ''

  try {
    const response = await apiClient.post('/core/AIコア/フォルダ参照', {
      初期パス: selections.codeBasePath || currentSettings.value?.CODE_BASE_PATH || '',
    })

    if (response?.data?.status !== 'OK') {
      errorMessage.value = response?.data?.message || 'フォルダ参照に失敗しました'
      return
    }

    const selectedPath = normalizeCodeBasePath(response?.data?.data?.選択パス || '')
    if (selectedPath) {
      selections.codeBasePath = selectedPath
    }
  } catch (error: any) {
    errorMessage.value = `フォルダ参照エラー: ${error?.response?.data?.message || error?.message || error}`
  } finally {
    browsingCodeBase.value = false
  }
}

async function loadConfig() {
  loading.value = true
  errorMessage.value = ''

  try {
    if (!props.sessionId) {
      errorMessage.value = 'セッションIDが見つかりません。画面をリロードしてください。'
      return
    }

    const response = await apiClient.post('/core/AIコア/モデル情報/取得', {
      セッションID: props.sessionId,
    })

    if (response?.data?.status !== 'OK') {
      errorMessage.value = response?.data?.message || '取得に失敗しました'
      return
    }

    const data = response.data.data
    availableModels.value = data.available_models || {}
    currentSettings.value = data.モデル設定 || {}
    codeBaseOptions.value = data.external_root_dic || {}

    isInitializing.value = true

    selections.chatAi = chooseAvailable(currentSettings.value.CHAT_AI_NAME, chatAiOptions.value)
    selections.predictionAi = String(currentSettings.value.PREDICTION_AI_NAME ?? 'auto') || 'auto';
    for (const { key } of predictionFields) {
      predictionModels[key] = String(currentSettings.value[key] ?? 'auto').trim() || 'auto';
    }
    selections.decisionAi = String(currentSettings.value.DECISION_AI_NAME || 'auto').trim() || 'auto'
      for (const { key } of decisionFields) {
        decisionModels[key] = String(currentSettings.value[key] ?? 'auto').trim() || 'auto';
      }
    selections.liveAi = chooseAvailable(currentSettings.value.LIVE_AI_NAME, liveAiOptions.value)
    selections.codeAi1 = chooseAvailable(currentSettings.value.CODE_AI1_NAME, codeAiOptions.value)
    selections.codeAi2 = chooseAvailable(currentSettings.value.CODE_AI2_NAME, codeAiOptions.value)
    selections.codeAi3 = chooseAvailable(currentSettings.value.CODE_AI3_NAME, codeAiOptions.value)
    selections.codeAi4 = chooseAvailable(currentSettings.value.CODE_AI4_NAME, codeAiOptions.value)
    selections.codeAi5 = chooseAvailable(currentSettings.value.CODE_AI5_NAME, codeAiOptions.value)
    selections.codeAi6 = chooseAvailable(currentSettings.value.CODE_AI6_NAME, codeAiOptions.value)
    selections.codeBasePath = props.fixedProjectPath || currentSettings.value.CODE_BASE_PATH || Object.keys(codeBaseOptions.value || {})[0] || ''
    selections.codePermissions = currentSettings.value.CODE_PERMISSIONS || 'auto'
    selections.taskAi = chooseAvailable(currentSettings.value.TASK_AI_NAME || 'codex_cli', codeAiOptions.value)
    selections.teamAi = chooseAvailable(currentSettings.value.TEAM_AI_NAME || 'codex_cli', codeAiOptions.value)

    const chatKey = CHAT_MODEL_KEYS[selections.chatAi]
    const liveKey = LIVE_MODEL_KEYS[selections.liveAi]
    const voiceKey = LIVE_VOICE_KEYS[selections.liveAi]

    selections.chatModel = chooseAvailable(chatKey && currentSettings.value[chatKey], Object.keys(availableModels.value?.chat_models?.[selections.chatAi] || {}))
    selections.liveModel = chooseAvailable(liveKey && currentSettings.value[liveKey], Object.keys(availableModels.value?.live_models?.[selections.liveAi] || {}))
    selections.liveVoice = chooseAvailable(voiceKey && currentSettings.value[voiceKey], Object.keys(availableModels.value?.live_voices?.[selections.liveAi] || {}))
    selections.codeModel1 = chooseAvailable(currentSettings.value.CODE_AI1_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi1] || {}))
    selections.codeModel2 = chooseAvailable(currentSettings.value.CODE_AI2_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi2] || {}))
    selections.codeModel3 = chooseAvailable(currentSettings.value.CODE_AI3_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi3] || {}))
    selections.codeModel4 = chooseAvailable(currentSettings.value.CODE_AI4_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi4] || {}))
    selections.codeModel5 = chooseAvailable(currentSettings.value.CODE_AI5_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi5] || {}))
    selections.codeModel6 = chooseAvailable(currentSettings.value.CODE_AI6_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi6] || {}))
    const taskModelKeys = Object.keys(availableModels.value?.code_models?.[selections.taskAi] || {})
    selections.taskModelPlan = chooseAvailable(currentSettings.value.TASK_AI_MODEL_plan || 'auto', taskModelKeys)
    selections.taskModelDo = chooseAvailable(currentSettings.value.TASK_AI_MODEL_do || 'auto', taskModelKeys)
    selections.taskModelCheck = chooseAvailable(currentSettings.value.TASK_AI_MODEL_check || 'auto', taskModelKeys)
    const teamModelKeys = Object.keys(availableModels.value?.code_models?.[selections.teamAi] || {})
    selections.teamModelPlan = chooseAvailable(currentSettings.value.TEAM_AI_MODEL_plan || 'auto', teamModelKeys)
    selections.teamModelDo = chooseAvailable(currentSettings.value.TEAM_AI_MODEL_do || 'auto', teamModelKeys)
    selections.teamModelCheck = chooseAvailable(currentSettings.value.TEAM_AI_MODEL_check || 'auto', teamModelKeys)

    await nextTick()
    loadedFormSettings = buildFormSettings();
      hasLoadedConfig.value = true
  } catch (error: any) {
    errorMessage.value = `取得エラー: ${error?.response?.data?.message || error?.message || error}`
  } finally {
    isInitializing.value = false
    loading.value = false
  }
}

function handleCancel() {
  emit('close')
}

function buildFormSettings() {
  const nextSettings = { ...currentSettings.value }
  nextSettings.CHAT_AI_NAME = selections.chatAi
  nextSettings.PREDICTION_AI_NAME = selections.predictionAi || 'auto';
  for (const { key } of predictionFields) nextSettings[key] = predictionModels[key] || 'auto';
  nextSettings.DECISION_AI_NAME = selections.decisionAi || 'auto'
    for (const { key } of decisionFields) nextSettings[key] = decisionModels[key] || 'auto';
  nextSettings.LIVE_AI_NAME = selections.liveAi
  nextSettings.CODE_AI1_NAME = selections.codeAi1
  nextSettings.CODE_AI1_MODEL = selections.codeModel1
  nextSettings.CODE_AI2_NAME = selections.codeAi2
  nextSettings.CODE_AI2_MODEL = selections.codeModel2
  nextSettings.CODE_AI3_NAME = selections.codeAi3
  nextSettings.CODE_AI3_MODEL = selections.codeModel3
  nextSettings.CODE_AI4_NAME = selections.codeAi4
  nextSettings.CODE_AI4_MODEL = selections.codeModel4
  nextSettings.CODE_AI5_NAME = selections.codeAi5
  nextSettings.CODE_AI5_MODEL = selections.codeModel5
  nextSettings.CODE_AI6_NAME = selections.codeAi6
  nextSettings.CODE_AI6_MODEL = selections.codeModel6
  nextSettings.TASK_AI_NAME = selections.taskAi
  nextSettings.TASK_AI_MODEL_plan = selections.taskModelPlan
  nextSettings.TASK_AI_MODEL_do = selections.taskModelDo
  nextSettings.TASK_AI_MODEL_check = selections.taskModelCheck
  nextSettings.TEAM_AI_NAME = selections.teamAi
  nextSettings.TEAM_AI_MODEL_plan = selections.teamModelPlan
  nextSettings.TEAM_AI_MODEL_do = selections.teamModelDo
  nextSettings.TEAM_AI_MODEL_check = selections.teamModelCheck

  const normalizedCodeBasePath = normalizeCodeBasePath(props.fixedProjectPath || selections.codeBasePath)
  if (normalizedCodeBasePath) {
    nextSettings.CODE_BASE_PATH = normalizedCodeBasePath
  }
  nextSettings.CODE_PERMISSIONS = selections.codePermissions || 'auto'

  const chatKey = CHAT_MODEL_KEYS[selections.chatAi]
  const liveKey = LIVE_MODEL_KEYS[selections.liveAi]
  const voiceKey = LIVE_VOICE_KEYS[selections.liveAi]

  if (chatKey) nextSettings[chatKey] = selections.chatModel
  if (liveKey) nextSettings[liveKey] = selections.liveModel
  if (voiceKey) nextSettings[voiceKey] = selections.liveVoice

  return nextSettings
}

// 未編集のフィールドは取得した保存値を維持する（候補なしでも空欄を書き戻さない）。
function buildNextSettings() {
  const next = buildFormSettings();
  for (const key of Object.keys(next)) {
    if (key === 'DECISION_AI_NAME' || decisionFields.some(field => field.key === key)) continue;
    if (next[key] === loadedFormSettings[key]) {
      if (Object.prototype.hasOwnProperty.call(currentSettings.value, key)) next[key] = currentSettings.value[key];
      else if (key !== 'PREDICTION_AI_NAME' && !predictionFields.some(field => field.key === key)) delete next[key];
    }
  }
  return next;
}

async function submitSettings(
  再起動要求: { reboot_core: boolean; reboot_apps: boolean; reboot_tools?: boolean; reboot_local?: boolean; reboot_task?: boolean; reboot_team?: boolean },
  waitSeconds = 15,
  save = false,
) {
  loading.value = true
  errorMessage.value = ''

  try {
    if (!props.sessionId) {
      errorMessage.value = 'セッションIDが見つかりません。画面をリロードしてください。'
      return
    }

    const response = await apiClient.post('/core/AIコア/モデル情報/設定', {
      セッションID: props.sessionId,
      モデル設定: buildNextSettings(),
      再起動要求,
      save,
    })

    if (response?.data?.status !== 'OK') {
      errorMessage.value = response?.data?.message || '保存に失敗しました'
      return
    }

    emit('saved', waitSeconds)
  } catch (error: any) {
    errorMessage.value = `保存エラー: ${error?.response?.data?.message || error?.message || error}`
  } finally {
    loading.value = false
  }
}

function handleSave() {
  void submitSettings({ reboot_core: false, reboot_apps: true, reboot_tools: true, reboot_local: false, reboot_task: false, reboot_team: false }, 15, true)
}

async function handleSaveOnly() {
  loading.value = true
  errorMessage.value = ''
  try {
    if (!props.sessionId) {
      errorMessage.value = 'セッションIDが見つかりません。画面をリロードしてください。'
      return
    }
    const response = await apiClient.post('/core/AIコア/モデル情報/設定', {
      セッションID: props.sessionId,
      モデル設定: buildNextSettings(),
      再起動要求: { reboot_core: false, reboot_apps: false, reboot_tools: false, reboot_local: false, reboot_task: false, reboot_team: false },
      save: true,
    })
    if (response?.data?.status !== 'OK') {
      errorMessage.value = response?.data?.message || '保存に失敗しました'
      return
    }
    void qAlert('モデル情報を保存しました')
  } catch (error: any) {
    errorMessage.value = `保存エラー: ${error?.response?.data?.message || error?.message || error}`
  } finally {
    loading.value = false
  }
}

async function handleResetReboot() {
  const confirmed = await qConfirm('現在のAI設定をすべてリセットし、システムを再起動します。よろしいですか？')
  if (!confirmed) return

  loading.value = true
  errorMessage.value = ''

  try {
    if (!props.sessionId) {
      errorMessage.value = 'セッションIDが見つかりません。画面をリロードしてください。'
      return
    }

    const response = await apiClient.post('/core/AIコア/モデル情報/設定', {
      セッションID: props.sessionId,
      モデル設定: {},
      再起動要求: { reboot_core: true, reboot_apps: true, reboot_tools: true, reboot_local: true, reboot_task: true, reboot_team: true },
      リセット: true,
    })

    if (response?.data?.status !== 'OK') {
      errorMessage.value = response?.data?.message || 'リセット再起動に失敗しました'
      return
    }

    rebootWaitSeconds.value = 60
    emit('saved', 60, Boolean(props.fixedProjectPath))
  } catch (error: any) {
    errorMessage.value = `リセット再起動エラー: ${error?.response?.data?.message || error?.message || error}`
  } finally {
    loading.value = false
  }
}

watch(() => props.isOpen, (isOpen) => {
  if (isOpen && props.sessionId) {
    void loadConfig()
  }
}, { immediate: true })

watch(() => selections.chatAi, (newValue) => {
  const models = availableModels.value?.chat_models?.[newValue] || {}
  const key = CHAT_MODEL_KEYS[newValue]
  selections.chatModel = chooseAvailable(key && currentSettings.value[key], Object.keys(models))
})

watch(() => selections.liveAi, (newValue) => {
  const models = availableModels.value?.live_models?.[newValue] || {}
  const voices = availableModels.value?.live_voices?.[newValue] || {}
  const modelKey = LIVE_MODEL_KEYS[newValue]
  const voiceKey = LIVE_VOICE_KEYS[newValue]
  selections.liveModel = chooseAvailable(modelKey && currentSettings.value[modelKey], Object.keys(models))
  selections.liveVoice = chooseAvailable(voiceKey && currentSettings.value[voiceKey], Object.keys(voices))
})

// 画面での変更時だけコピーし、読み込み時は保存済みの個別設定を維持する
function copyCode4Settings() {
  const models = Object.keys(availableModels.value?.code_models?.[selections.codeAi4] || {})
  selections.codeModel4 = chooseAvailable(selections.codeModel4, models)
  selections.codeAi5 = selections.codeAi4
  selections.codeAi6 = selections.codeAi4
  selections.codeModel5 = selections.codeModel4
  selections.codeModel6 = selections.codeModel4
}

function copyTaskSettingsToTeam() {
  selections.teamAi = selections.taskAi
  selections.teamModelPlan = selections.taskModelPlan
  selections.teamModelDo = selections.taskModelDo
  selections.teamModelCheck = selections.taskModelCheck
}

function handleTaskAiChange() {
  const model = codeDefaultModel(selections.taskAi);
  selections.taskModelPlan = model;
  selections.taskModelDo = model;
  selections.taskModelCheck = model;
  copyTaskSettingsToTeam();
}

function handleTaskPlanChange() {
  selections.taskModelDo = selections.taskModelPlan
  selections.taskModelCheck = selections.taskModelPlan
  copyTaskSettingsToTeam()
}

function handleTeamPlanChange() {
  selections.teamModelDo = selections.teamModelPlan
  selections.teamModelCheck = selections.teamModelPlan
}

// プロバイダの手動変更時だけ規定モデルを選ぶ。読込・連動コピーでは個別値を上書きしない。
function codeDefaultModel(aiName: string) {
  const models = Object.keys(availableModels.value?.code_models?.[aiName] || {});
  const key = CODE_MODEL_KEYS[aiName];
  return chooseAvailable(key && currentSettings.value[key], models);
}

function copyCode1Settings() {
  for (const index of [2, 3, 4, 5, 6] as const) {
    selections[`codeAi${index}`] = selections.codeAi1;
    selections[`codeModel${index}`] = selections.codeModel1;
  }
}

function handleCodeAiChange(index: 1 | 2 | 3 | 4 | 5 | 6) {
  if (isInitializing.value) return;
  selections[`codeModel${index}`] = codeDefaultModel(selections[`codeAi${index}`]);
  if (index === 1) copyCode1Settings();
  if (index === 4) copyCode4Settings();
}

function handleTeamAiChange() {
  const model = codeDefaultModel(selections.teamAi);
  selections.teamModelPlan = model;
  selections.teamModelDo = model;
  selections.teamModelCheck = model;
}

onMounted(() => {
  if (props.isOpen && !hasLoadedConfig.value) {
    void loadConfig()
  }
})
</script>

<template>
  <div
    v-if="isOpen"
    class="config-panel-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="configPanelTitle"
    @click.self="handleCancel"
  >
    <div class="config-panel" role="document">
      <div class="config-panel-header" id="configPanelTitle">
        <button class="config-panel-close" type="button" @click="handleCancel">×</button>
        <div class="config-panel-title">モデル設定 / 再起動</div>
        <div class="config-panel-spacer" aria-hidden="true"></div>
      </div>
      <div class="config-panel-body">
        <p v-if="errorMessage" class="config-panel-error">{{ errorMessage }}</p>
        <div v-else class="config-panel-content">
          <p class="config-panel-description">AI設定を選択してください。</p>
          <div class="config-panel-form">
            <div class="config-panel-section">
              <div class="config-panel-section-header">Chat AI Model</div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-chat-ai-select">CHAT_AI_NAME:</label>
                <div class="config-panel-control">
                  <select id="config-chat-ai-select" v-model="selections.chatAi" class="config-panel-select">
                    <option v-for="ai in chatAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                  </select>
                </div>
              </div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-chat-model-select">CHAT_MODEL:</label>
                <div class="config-panel-control">
                  <select id="config-chat-model-select" v-model="selections.chatModel" class="config-panel-select">
                    <option v-for="model in chatModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="config-panel-section">
              <div class="config-panel-section-header">Live AI Model</div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-live-ai-select">LIVE_AI_NAME:</label>
                <div class="config-panel-control">
                  <select id="config-live-ai-select" v-model="selections.liveAi" class="config-panel-select">
                    <option v-for="ai in liveAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                  </select>
                </div>
              </div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-live-model-select">LIVE_MODEL:</label>
                <div class="config-panel-control">
                  <select id="config-live-model-select" v-model="selections.liveModel" class="config-panel-select">
                    <option v-for="model in liveModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
              </div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-live-voice-select">LIVE_VOICE:</label>
                <div class="config-panel-control">
                  <select id="config-live-voice-select" v-model="selections.liveVoice" class="config-panel-select">
                    <option v-for="voice in liveVoiceOptions" :key="voice.value" :value="voice.value">{{ voice.label }}</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="config-panel-section">
              <div class="config-panel-section-header">Prediction AI Model（入力予測）</div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-prediction-ai-select">PREDICTION_AI_NAME:</label>
                <div class="config-panel-control">
                  <select id="config-prediction-ai-select" v-model="selections.predictionAi" aria-describedby="config-prediction-note" class="config-panel-select">
                    <option v-for="ai in predictionAiOptions" :key="ai" :value="ai">{{ ai === 'auto' || predictionProviders.includes(ai) ? ai : ai + '（保持値・未対応）' }}</option>
                  </select>
                </div>
              </div>
              <div v-for="field in predictionFields" :key="field.key" class="config-panel-field">
                <label class="config-panel-label" :for="'config-' + field.key">{{ field.key }}:</label>
                <div class="config-panel-control">
                  <select :id="'config-' + field.key" v-model="predictionModels[field.key]" aria-describedby="config-prediction-note" class="config-panel-select">
                    <option v-for="model in predictionModelOptions(field)" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
              </div>
              <div id="config-prediction-note" class="config-model-note" role="note">
                <p>方式のautoはDiag候補がある codex_cli → copilot_cli → aidiy_hermes → OAuth → FreeAI → OpenAI API → Gemini の順です。</p>
                <p v-if="!predictionHasCandidates">選択方式のDiag候補はありません。現在設定とautoを保持しています。候補をDiagで取得・書き出してから画面を開き直してください。</p>
                <p v-else>候補はDiagの取得済み一覧です。各方式のモデルautoはその方式の先頭候補を使います。候補掲載は現在の利用可否を保証しません。</p>
              </div>
            </div>

            <div class="config-panel-section">
              <div class="config-panel-section-header">Decision AI Model（判断）</div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-decision-ai-select">DECISION_AI_NAME:</label>
                <div class="config-panel-control">
                  <select id="config-decision-ai-select" v-model="selections.decisionAi" class="config-panel-select">
                    <option v-for="ai in decisionAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                  </select>
                </div>
              </div>
              <div v-for="field in decisionFields" :key="field.key" class="config-panel-field">
                <label class="config-panel-label" :for="'config-' + field.key">{{ field.key }}:</label>
                <div class="config-panel-control">
                  <select :id="'config-' + field.key" v-model="decisionModels[field.key]" aria-describedby="config-decision-note" class="config-panel-select">
                    <option v-for="model in decisionModelOptions(field)" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
              </div>
                <div id="config-decision-note" class="config-decision-note" role="note">
                  <p>autoは起動チェック成功の方式からOAuth → FreeAI → Decisions API → Geminiの順で選びます。</p>

                  <p v-if="!decisionHasCandidates">Diagの取得済み候補はありません。現在設定とautoを保持しています。設定値は利用可能の保証ではありません。</p>
                  <p v-else>候補はDiagの取得済み一覧です。モデルを変更するときはDiagの書き出し候補を調整してください。現在の利用可否はToolsの判断チェックで確認します。</p>
                </div>
            </div>

            <div class="config-panel-section">
              <div class="config-panel-section-header">Code AI Setting</div>
              <div class="config-panel-code-base-field">
                <div v-if="!props.fixedProjectPath && codeBaseOptionsList.length > 0" class="config-panel-field">
                  <label class="config-panel-label" for="config-code-base-path">CODE_BASE_PATH:</label>
                  <div class="config-panel-control">
                    <select
                      id="config-code-base-path"
                      v-model="selections.codeBasePath"
                      class="config-panel-select"
                    >
                      <option value="">候補から選択してください</option>
                      <option v-for="opt in codeBaseOptionsList" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                    </select>
                  </div>
                </div>
                <div class="config-panel-field">
                  <label class="config-panel-label" for="config-code-permissions">CODE_PERMISSIONS:</label>
                  <div class="config-panel-control">
                    <select
                      id="config-code-permissions"
                      v-model="selections.codePermissions"
                      class="config-panel-select"
                    >
                      <option v-for="permission in codePermissionOptions" :key="permission" :value="permission">
                        {{ permission }}
                      </option>
                    </select>
                  </div>
                </div>
                <div class="config-panel-field">
                  <label class="config-panel-label" for="config-code-base-path-input">フォルダ:</label>
                  <div class="config-panel-control config-panel-control-inline">
                    <input
                      id="config-code-base-path-input"
                      v-model.trim="selections.codeBasePath"
                      :readonly="!!props.fixedProjectPath"
                      :title="props.fixedProjectPath ? '起動時のプロジェクトに固定されています' : undefined"
                      type="text"
                      class="config-panel-input"
                      placeholder="../ または C:/project/"
                    />
                    <button
                      type="button"
                      class="config-panel-browse"
                      :disabled="!!props.fixedProjectPath || loading || browsingCodeBase"
                      @click="handleBrowseCodeBasePath"
                    >
                      参照
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="config-panel-section">
              <div class="config-panel-section-header">Code AI Model</div>
              <div class="config-panel-code-grid">
                <div class="config-panel-code-col">
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-ai1-select">CODE_AI1_NAME:</label>
                    <div class="config-panel-control">
                      <select id="config-code-ai1-select" v-model="selections.codeAi1" class="config-panel-select" @change="handleCodeAiChange(1)">
                        <option v-for="ai in codeAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-model1-select">CODE_MODEL1:</label>
                    <div class="config-panel-control">
                      <select id="config-code-model1-select" v-model="selections.codeModel1" class="config-panel-select" @change="copyCode1Settings">
                        <option v-for="model in codeModelOptions1" :key="model.value" :value="model.value">{{ model.label }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-ai2-select">CODE_AI2_NAME:</label>
                    <div class="config-panel-control">
                      <select id="config-code-ai2-select" v-model="selections.codeAi2" class="config-panel-select" @change="handleCodeAiChange(2)">
                        <option v-for="ai in codeAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-model2-select">CODE_MODEL2:</label>
                    <div class="config-panel-control">
                      <select id="config-code-model2-select" v-model="selections.codeModel2" class="config-panel-select">
                        <option v-for="model in codeModelOptions2" :key="model.value" :value="model.value">{{ model.label }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-ai3-select">CODE_AI3_NAME:</label>
                    <div class="config-panel-control">
                      <select id="config-code-ai3-select" v-model="selections.codeAi3" class="config-panel-select" @change="handleCodeAiChange(3)">
                        <option v-for="ai in codeAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-model3-select">CODE_MODEL3:</label>
                    <div class="config-panel-control">
                      <select id="config-code-model3-select" v-model="selections.codeModel3" class="config-panel-select">
                        <option v-for="model in codeModelOptions3" :key="model.value" :value="model.value">{{ model.label }}</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div class="config-panel-code-col">
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-ai4-select">CODE_AI4_NAME:</label>
                    <div class="config-panel-control">
                      <select id="config-code-ai4-select" v-model="selections.codeAi4" class="config-panel-select" @change="handleCodeAiChange(4)">
                        <option v-for="ai in codeAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-model4-select">CODE_MODEL4:</label>
                    <div class="config-panel-control">
                      <select id="config-code-model4-select" v-model="selections.codeModel4" class="config-panel-select" @change="copyCode4Settings">
                        <option v-for="model in codeModelOptions4" :key="model.value" :value="model.value">{{ model.label }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-ai5-select">CODE_AI5_NAME:</label>
                    <div class="config-panel-control">
                      <select id="config-code-ai5-select" v-model="selections.codeAi5" class="config-panel-select" @change="handleCodeAiChange(5)">
                        <option v-for="ai in codeAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-model5-select">CODE_MODEL5:</label>
                    <div class="config-panel-control">
                      <select id="config-code-model5-select" v-model="selections.codeModel5" class="config-panel-select">
                        <option v-for="model in codeModelOptions5" :key="model.value" :value="model.value">{{ model.label }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-ai6-select">CODE_AI6_NAME:</label>
                    <div class="config-panel-control">
                      <select id="config-code-ai6-select" v-model="selections.codeAi6" class="config-panel-select" @change="handleCodeAiChange(6)">
                        <option v-for="ai in codeAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="config-panel-field">
                    <label class="config-panel-label" for="config-code-model6-select">CODE_MODEL6:</label>
                    <div class="config-panel-control">
                      <select id="config-code-model6-select" v-model="selections.codeModel6" class="config-panel-select">
                        <option v-for="model in codeModelOptions6" :key="model.value" :value="model.value">{{ model.label }}</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="config-panel-section">
              <div class="config-panel-section-header">Task AI Model</div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-task-ai-select">TASK_AI_NAME:</label>
                <div class="config-panel-control">
                  <select id="config-task-ai-select" v-model="selections.taskAi" class="config-panel-select" @change="handleTaskAiChange">
                    <option v-for="ai in codeAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                  </select>
                </div>
              </div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-task-model-plan-select">TASK_AI_MODEL_plan:</label>
                <div class="config-panel-control">
                  <select id="config-task-model-plan-select" v-model="selections.taskModelPlan" class="config-panel-select" @change="handleTaskPlanChange">
                    <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
              </div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-task-model-do-select">TASK_AI_MODEL_do:</label>
                <div class="config-panel-control">
                  <select id="config-task-model-do-select" v-model="selections.taskModelDo" class="config-panel-select" @change="copyTaskSettingsToTeam">
                    <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
              </div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-task-model-check-select">TASK_AI_MODEL_check:</label>
                <div class="config-panel-control">
                  <select id="config-task-model-check-select" v-model="selections.taskModelCheck" class="config-panel-select" @change="copyTaskSettingsToTeam">
                    <option v-for="model in taskModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="config-panel-section">
              <div class="config-panel-section-header">Team AI Model</div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-team-ai-select">TEAM_AI_NAME:</label>
                <div class="config-panel-control">
                  <select id="config-team-ai-select" v-model="selections.teamAi" class="config-panel-select" @change="handleTeamAiChange">
                    <option v-for="ai in codeAiOptions" :key="ai" :value="ai">{{ ai }}</option>
                  </select>
                </div>
              </div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-team-model-plan-select">TEAM_AI_MODEL_plan:</label>
                <div class="config-panel-control">
                  <select id="config-team-model-plan-select" v-model="selections.teamModelPlan" class="config-panel-select" @change="handleTeamPlanChange">
                    <option v-for="model in teamModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
              </div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-team-model-do-select">TEAM_AI_MODEL_do:</label>
                <div class="config-panel-control">
                  <select id="config-team-model-do-select" v-model="selections.teamModelDo" class="config-panel-select">
                    <option v-for="model in teamModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
              </div>
              <div class="config-panel-field">
                <label class="config-panel-label" for="config-team-model-check-select">TEAM_AI_MODEL_check:</label>
                <div class="config-panel-control">
                  <select id="config-team-model-check-select" v-model="selections.teamModelCheck" class="config-panel-select">
                    <option v-for="model in teamModelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="config-panel-actions">
        <div class="config-panel-actions-edge">
          <button type="button" class="save" :disabled="loading" @click="handleSaveOnly">保存(json書換)</button>
        </div>
        <div class="config-panel-actions-center">
          <button type="button" @click="handleCancel">キャンセル</button>
          <button type="button" class="primary" :disabled="loading" @click="handleSave">設定/再起動</button>
        </div>
        <div class="config-panel-actions-edge">
          <button type="button" class="danger" :disabled="loading" @click="handleResetReboot">リセット/再起動</button>
        </div>
      </div>
    </div>
  </div>

  <RebootDialog v-if="false" :show="false" :wait-seconds="0" />
</template>

<style scoped>
.config-model-note,
.config-decision-note { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; opacity: 0.85; }
.config-model-note p,
.config-decision-note p { margin: 6px 0; }
.config-panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.config-panel {
  --config-title-background: #f8fafc;
  width: min(720px, 92vw);
  max-height: 90vh;
  background: #ffffff;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.25);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--config-title-background);
  min-width: 0;
}

.config-panel-header {
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  background: var(--config-title-background);
  border-bottom: 1px solid #e2e8f0;
  letter-spacing: 0.02em;
  display: grid;
  grid-template-columns: 28px 1fr 28px;
  align-items: center;
}

.config-panel-title {
  text-align: center;
}

.config-panel-close {
  width: 24px;
  height: 24px;
  border: 1px solid #cbd5f5;
  background: #ffffff;
  color: #0f172a;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.config-panel-close:hover {
  background: #eff6ff;
}

.config-panel-spacer {
  width: 24px;
  height: 24px;
}

.config-panel-body {
  padding: 8px 12px;
  background: #ffffff;
  overflow-y: auto;
  flex: 1;
}

.config-panel-error {
  margin: 0;
  padding: 12px;
  background: #fee2e2;
  border: 1px solid #dc2626;
  border-radius: 6px;
  color: #b91c1c;
  font-size: 14px;
  font-weight: 600;
}

.config-panel-description {
  margin: 0 0 4px 0;
  color: #475569;
  font-size: 11px;
}

.config-panel-form {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.config-panel-section {
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 4px 8px 2px 8px;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: #eef2f7;
  min-width: 0;
}

.config-panel-section-header {
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 2px 0;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-left: 3px solid #2563eb;
  padding-left: 6px;
}

.config-panel-code-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 16px;
}

.config-panel-code-col {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.config-panel-field {
  display: grid;
  grid-template-columns: 25% 1fr;
  gap: 4px;
  align-items: center;
  padding: 0;
  margin: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  min-width: 0;
}

.config-panel-label {
  font-size: 11px;
  color: #334155;
  text-align: right;
  margin: 0;
  padding: 0;
}

.config-panel-control {
  width: 100%;
  margin: 0;
  padding: 0;
  min-width: 0;
}

.config-panel-control-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.config-panel-select {
  width: 100%;
  min-width: 0;
  height: 22px;
  border: 1px solid #cbd5f5;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 11px;
  background: #ffffff;
  color: #0f172a;
  box-sizing: border-box;
}

.config-panel-code-base-field {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.config-panel-control-inline {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.config-panel-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 22px;
  border: 1px solid #cbd5f5;
  border-radius: 3px;
  padding: 0 6px;
  font-size: 11px;
  background: #ffffff;
  color: #0f172a;
  margin: 0;
  box-sizing: border-box;
}

.config-panel-browse {
  flex: 0 0 40px;
  height: 22px;
  border: 1px solid #2563eb;
  border-radius: 3px;
  background: #ffffff;
  color: #2563eb;
  padding: 0 4px;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  width: 40px;
}

.config-panel-browse:hover:not(:disabled) {
  background: #eff6ff;
}

.config-panel-browse:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 500px) {
  .config-panel-field {
    grid-template-columns: 1fr;
  }

  .config-panel-control-inline {
    align-items: stretch;
  }
}

.config-panel-actions {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

.config-panel-actions-edge {
  flex: 1;
  display: flex;
}

.config-panel-actions-edge:last-child {
  justify-content: flex-end;
}

.config-panel-actions-center {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.config-panel-actions button {
  border: 1px solid #cbd5f5;
  background: #ffffff;
  color: #0f172a;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.config-panel-actions button:hover:not(:disabled) {
  background: #eff6ff;
}

.config-panel-actions button.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}

.config-panel-actions button.primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.config-panel-actions button.danger {
  background: #dc2626;
  border-color: #dc2626;
  color: #ffffff;
}

.config-panel-actions button.danger:hover:not(:disabled) {
  background: #b91c1c;
}

.config-panel-actions button.save {
  background: #f97316;
  border-color: #f97316;
  color: #ffffff;
}

.config-panel-actions button.save:hover:not(:disabled) {
  background: #ea580c;
}

.config-panel-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.config-panel-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

</style>
