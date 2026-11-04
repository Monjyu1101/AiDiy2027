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

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
const props = defineProps({
  isOpen: { type: Boolean, required: true },
  sessionId: { type: String, required: true },
  request: { type: Function, required: true }
});
const emit = defineEmits(["close", "saved", "busy"]);
const loading = ref(false);
const writing = ref(false);
watch(writing, value => emit("busy", value), { flush: "sync" });
const browsingCodeBase = ref(false);
const errorMessage = ref("");
const availableModels = ref({});
const currentSettings = ref({});
const codeBaseOptions = ref({});
const notice = ref("");
let revision = 0;
let disposed = false;
const canSave = computed(() => props.isOpen && Boolean(props.sessionId) && hasLoadedConfig.value && !loading.value && !browsingCodeBase.value);
function current(run) {
  return !disposed && props.isOpen && run === revision;
}
const isInitializing = ref(false);
const hasLoadedConfig = ref(false);
let loadedFormSettings = {};
const selections = reactive({
  chatAi: "",
  chatModel: "",
  predictionAi: "auto",
  decisionAi: "auto",
  liveAi: "",
  liveModel: "",
  liveVoice: "",
  codeAi1: "",
  codeModel1: "",
  codeAi2: "",
  codeModel2: "",
  codeAi3: "",
  codeModel3: "",
  codeAi4: "",
  codeModel4: "",
  codeAi5: "",
  codeModel5: "",
  codeAi6: "",
  codeModel6: "",
  codeBasePath: "",
  codePermissions: "auto",
  taskAi: "",
  taskModelPlan: "",
  taskModelDo: "",
  taskModelCheck: "",
  teamAi: "",
  teamModelPlan: "",
  teamModelDo: "",
  teamModelCheck: ""
});
const CHAT_MODEL_KEYS = {
  gemini_chat: "CHAT_GEMINI_MODEL",
  freeai_chat: "CHAT_FREEAI_MODEL",
  openrt_chat: "CHAT_OPENRT_MODEL",
  openai_chat: "CHAT_OPENAI_MODEL",
  openai_oauth: "CHAT_OPENAI_MODEL",
  ollama_chat: "CHAT_OLLAMA_MODEL",
  local_chat: "CHAT_LOCAL_MODEL"
};
const LIVE_MODEL_KEYS = {
  gemini_live: "LIVE_GEMINI_MODEL",
  freeai_live: "LIVE_FREEAI_MODEL",
  openai_live: "LIVE_OPENAI_MODEL"
};
const LIVE_VOICE_KEYS = {
  gemini_live: "LIVE_GEMINI_VOICE",
  freeai_live: "LIVE_FREEAI_VOICE",
  openai_live: "LIVE_OPENAI_VOICE"
};
const CODE_MODEL_KEYS = {
  claude_sdk: "CODE_CLAUDE_SDK_MODEL",
  claude_cli: "CODE_CLAUDE_CLI_MODEL",
  copilot_cli: "CODE_COPILOT_CLI_MODEL",
  antigravity_cli: "CODE_ANTIGRAVITY_CLI_MODEL",
  codex_cli: "CODE_CODEX_CLI_MODEL",
  grok_cli: "CODE_GROK_CLI_MODEL",
  opencode_cli: "CODE_OPENCODE_CLI_MODEL",
  aidiy_hermes: "CODE_AIDIY_HERMES_MODEL",
  claude_ollama: "CODE_CLAUDE_OLLAMA_MODEL",
  codex_ollama: "CODE_CODEX_OLLAMA_MODEL"
};
const chatAiOptions = computed(() => Object.keys(availableModels.value?.chat_models || {}));
const predictionProviders = ["openai_oauth", "freeai_chat", "openai_chat", "gemini_chat", "codex_cli", "copilot_cli", "aidiy_hermes"];
const predictionAutoProviders = ["codex_cli", "copilot_cli", "aidiy_hermes", "openai_oauth", "freeai_chat", "openai_chat", "gemini_chat"];
const predictionAiOptions = computed(() => [.../* @__PURE__ */ new Set(["auto", ...predictionProviders, selections.predictionAi])].filter(Boolean));
const predictionCatalog = computed(() => {
  const catalog = {};
  for (const provider of predictionProviders) {
    const models = availableModels.value?.prediction_models?.[provider];
    if (!models || typeof models !== "object" || Array.isArray(models)) continue;
    catalog[provider] = Object.fromEntries(Object.entries(models).filter(
      ([model, label]) => model.length > 0 && model.length <= 200 && model.trim() === model && !/[\x00-\x1f\x7f]/.test(model) && !["auto", "same"].includes(model) && typeof label === "string"
    ));
  }
  return catalog;
});
const predictionResolvedAi = computed(() => selections.predictionAi === "auto" ? predictionAutoProviders.find((provider) => Object.keys(predictionCatalog.value[provider] || {}).length > 0) || "" : selections.predictionAi);
const predictionFields = [
  { key: "PREDICTION_OPENAI_MODEL", provider: "openai_chat" },
  { key: "PREDICTION_OAUTH_MODEL", provider: "openai_oauth" },
  { key: "PREDICTION_GEMINI_MODEL", provider: "gemini_chat" },
  { key: "PREDICTION_FREEAI_MODEL", provider: "freeai_chat" },
  { key: "PREDICTION_CODEX_CLI_MODEL", provider: "codex_cli" },
  { key: "PREDICTION_COPILOT_CLI_MODEL", provider: "copilot_cli" },
  { key: "PREDICTION_AIDIY_HERMES_MODEL", provider: "aidiy_hermes" }
];
const predictionModels = reactive({});
const predictionHasCandidates = computed(() => Object.keys(predictionCatalog.value[predictionResolvedAi.value] || {}).length > 0);
const predictionModelOptions = (field) => {
  const choices = {
    auto: "auto（方式の先頭候補）",
    ...predictionCatalog.value[field.provider]
  };
  const current2 = predictionModels[field.key];
  if (current2 && !Object.prototype.hasOwnProperty.call(choices, current2)) {
    choices[current2] = current2 + "（保持値・Diag一覧外／未確認）";
  }
  return Object.entries(choices).map(([value, label]) => ({ value, label: label || value }));
};
const decisionAiOptions = computed(() => [.../* @__PURE__ */ new Set([
  "auto",
  "openai_oauth",
  "freeai_chat",
  "openai_decisions",
  "gemini_chat",
  selections.decisionAi
])].filter(Boolean));
const decisionFields = [
  { key: "DECISION_OPENAI_MODEL", provider: "openai_decisions" },
  { key: "DECISION_OAUTH_MODEL", provider: "openai_oauth" },
  { key: "DECISION_GEMINI_MODEL", provider: "gemini_chat" },
  { key: "DECISION_FREEAI_MODEL", provider: "freeai_chat" }
];
const decisionModels = reactive({});
const decisionHasCandidates = computed(() => decisionFields.some((field) => Object.keys(availableModels.value?.decision_models?.[field.provider] || {}).some((model) => model !== "auto")));
const decisionModelOptions = (field) => {
  const choices = {
    auto: "auto（方式別の既定モデル）",
    ...availableModels.value?.decision_models?.[field.provider]
  };
  const current2 = decisionModels[field.key];
  if (current2 && !choices[current2]) choices[current2] = current2 + "（保持値・Diag一覧外／未確認）";
  return Object.entries(choices).map(([value, label]) => ({ value, label }));
};
const liveAiOptions = computed(() => Object.keys(availableModels.value?.live_models || {}));
const codeAiOptions = computed(() => Object.keys(availableModels.value?.code_models || {}));
const codeBaseOptionsList = computed(() => Object.entries(codeBaseOptions.value || {}).map(([value, label]) => ({ value, label })));
const codePermissionOptions = ["auto", "full", "none"];
const chatModelOptions = computed(() => {
  const models = availableModels.value?.chat_models?.[selections.chatAi] || {};
  return Object.entries(models).map(([value, label]) => ({ value, label: label || value }));
});
const liveModelOptions = computed(() => {
  const models = availableModels.value?.live_models?.[selections.liveAi] || {};
  return Object.entries(models).map(([value, label]) => ({ value, label: label || value }));
});
const liveVoiceOptions = computed(() => {
  const voices = availableModels.value?.live_voices?.[selections.liveAi] || {};
  return Object.entries(voices).map(([value, label]) => ({ value, label: label || value }));
});
const codeModelOptions1 = computed(() => buildCodeModelOptions(selections.codeAi1));
const codeModelOptions2 = computed(() => buildCodeModelOptions(selections.codeAi2));
const codeModelOptions3 = computed(() => buildCodeModelOptions(selections.codeAi3));
const codeModelOptions4 = computed(() => buildCodeModelOptions(selections.codeAi4));
const codeModelOptions5 = computed(() => buildCodeModelOptions(selections.codeAi5));
const codeModelOptions6 = computed(() => buildCodeModelOptions(selections.codeAi6));
const taskModelOptions = computed(() => buildCodeModelOptions(selections.taskAi));
const teamModelOptions = computed(() => buildCodeModelOptions(selections.teamAi));
function buildCodeModelOptions(aiName) {
  const models = availableModels.value?.code_models?.[aiName] || {};
  return Object.entries(models).map(([value, label]) => ({ value, label: label || value }));
}
function chooseAvailable(current2, candidates) {
  const value = String(current2 || "");
  return value && candidates.includes(value) ? value : candidates[0] || "";
}
function normalizeCodeBasePath(path) {
  return path.trim().replace(/\\/g, "/");
}
async function handleBrowseCodeBasePath() {
  if (!canSave.value) return;
  const run = revision;
  browsingCodeBase.value = true;
  errorMessage.value = "";
  try {
    const response = await props.request("/core/AIコア/フォルダ参照", {
      初期パス: selections.codeBasePath || currentSettings.value?.CODE_BASE_PATH || ""
    });
    if (!current(run)) return;
    if (response?.data?.status !== "OK") {
      errorMessage.value = "フォルダ参照に失敗しました";
      return;
    }
    const selectedPath = normalizeCodeBasePath(response?.data?.data?.選択パス || "");
    if (selectedPath) {
      selections.codeBasePath = selectedPath;
    }
  } catch {
    if (!current(run)) return;
    errorMessage.value = "AIコアとの通信に失敗しました。接続状態を確認して再読み込みしてください。";
  } finally {
    if (current(run)) browsingCodeBase.value = false;
  }
}
async function loadConfig() {
  if (loading.value || !props.isOpen || !props.sessionId) return;
  const run = ++revision;
  hasLoadedConfig.value = false;
  notice.value = "";
  loading.value = true;
  errorMessage.value = "";
  try {
    if (!props.sessionId) {
      errorMessage.value = "セッションIDが見つかりません。画面をリロードしてください。";
      return;
    }
    const response = await props.request("/core/AIコア/モデル情報/取得", {
      セッションID: props.sessionId
    });
    if (!current(run)) return;
    if (response?.data?.status !== "OK") {
      errorMessage.value = "取得に失敗しました";
      return;
    }
    const data = response.data.data;
    availableModels.value = data.available_models || {};
    currentSettings.value = data.モデル設定 || {};
    codeBaseOptions.value = data.external_root_dic || {};
    isInitializing.value = true;
    selections.chatAi = chooseAvailable(currentSettings.value.CHAT_AI_NAME, chatAiOptions.value);
    selections.predictionAi = String(currentSettings.value.PREDICTION_AI_NAME ?? "auto") || "auto";
    for (const { key } of predictionFields) {
      predictionModels[key] = String(currentSettings.value[key] ?? "auto").trim() || "auto";
    }
    selections.decisionAi = String(currentSettings.value.DECISION_AI_NAME || "auto").trim() || "auto";
    for (const { key } of decisionFields) {
      decisionModels[key] = String(currentSettings.value[key] ?? "auto").trim() || "auto";
    }
    selections.liveAi = chooseAvailable(currentSettings.value.LIVE_AI_NAME, liveAiOptions.value);
    selections.codeAi1 = chooseAvailable(currentSettings.value.CODE_AI1_NAME, codeAiOptions.value);
    selections.codeAi2 = chooseAvailable(currentSettings.value.CODE_AI2_NAME, codeAiOptions.value);
    selections.codeAi3 = chooseAvailable(currentSettings.value.CODE_AI3_NAME, codeAiOptions.value);
    selections.codeAi4 = chooseAvailable(currentSettings.value.CODE_AI4_NAME, codeAiOptions.value);
    selections.codeAi5 = chooseAvailable(currentSettings.value.CODE_AI5_NAME, codeAiOptions.value);
    selections.codeAi6 = chooseAvailable(currentSettings.value.CODE_AI6_NAME, codeAiOptions.value);
    selections.codeBasePath = currentSettings.value.CODE_BASE_PATH || Object.keys(codeBaseOptions.value || {})[0] || "";
    selections.codePermissions = currentSettings.value.CODE_PERMISSIONS || "auto";
    selections.taskAi = chooseAvailable(currentSettings.value.TASK_AI_NAME || "codex_cli", codeAiOptions.value);
    selections.teamAi = chooseAvailable(currentSettings.value.TEAM_AI_NAME || "codex_cli", codeAiOptions.value);
    const chatKey = CHAT_MODEL_KEYS[selections.chatAi];
    const liveKey = LIVE_MODEL_KEYS[selections.liveAi];
    const voiceKey = LIVE_VOICE_KEYS[selections.liveAi];
    selections.chatModel = chooseAvailable(chatKey && currentSettings.value[chatKey], Object.keys(availableModels.value?.chat_models?.[selections.chatAi] || {}));
    selections.liveModel = chooseAvailable(liveKey && currentSettings.value[liveKey], Object.keys(availableModels.value?.live_models?.[selections.liveAi] || {}));
    selections.liveVoice = chooseAvailable(voiceKey && currentSettings.value[voiceKey], Object.keys(availableModels.value?.live_voices?.[selections.liveAi] || {}));
    selections.codeModel1 = chooseAvailable(currentSettings.value.CODE_AI1_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi1] || {}));
    selections.codeModel2 = chooseAvailable(currentSettings.value.CODE_AI2_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi2] || {}));
    selections.codeModel3 = chooseAvailable(currentSettings.value.CODE_AI3_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi3] || {}));
    selections.codeModel4 = chooseAvailable(currentSettings.value.CODE_AI4_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi4] || {}));
    selections.codeModel5 = chooseAvailable(currentSettings.value.CODE_AI5_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi5] || {}));
    selections.codeModel6 = chooseAvailable(currentSettings.value.CODE_AI6_MODEL, Object.keys(availableModels.value?.code_models?.[selections.codeAi6] || {}));
    const taskModelKeys = Object.keys(availableModels.value?.code_models?.[selections.taskAi] || {});
    selections.taskModelPlan = chooseAvailable(currentSettings.value.TASK_AI_MODEL_plan || "auto", taskModelKeys);
    selections.taskModelDo = chooseAvailable(currentSettings.value.TASK_AI_MODEL_do || "auto", taskModelKeys);
    selections.taskModelCheck = chooseAvailable(currentSettings.value.TASK_AI_MODEL_check || "auto", taskModelKeys);
    const teamModelKeys = Object.keys(availableModels.value?.code_models?.[selections.teamAi] || {});
    selections.teamModelPlan = chooseAvailable(currentSettings.value.TEAM_AI_MODEL_plan || "auto", teamModelKeys);
    selections.teamModelDo = chooseAvailable(currentSettings.value.TEAM_AI_MODEL_do || "auto", teamModelKeys);
    selections.teamModelCheck = chooseAvailable(currentSettings.value.TEAM_AI_MODEL_check || "auto", teamModelKeys);
    await nextTick();
    if (!current(run)) return;
    loadedFormSettings = buildFormSettings();
    hasLoadedConfig.value = true;
  } catch {
    if (!current(run)) return;
    errorMessage.value = "AIコアとの通信に失敗しました。接続状態を確認して再読み込みしてください。";
  } finally {
    if (current(run)) {
      isInitializing.value = false;
      loading.value = false;
    }
  }
}
function handleCancel() {
  if (writing.value) return;
  revision++;
  hasLoadedConfig.value = false;
  currentSettings.value = {};
  loadedFormSettings = {};
  notice.value = "";
  emit("close");
}
function buildFormSettings() {
  const nextSettings = { ...currentSettings.value };
  nextSettings.CHAT_AI_NAME = selections.chatAi;
  nextSettings.PREDICTION_AI_NAME = selections.predictionAi || "auto";
  for (const { key } of predictionFields) nextSettings[key] = predictionModels[key] || "auto";
  nextSettings.DECISION_AI_NAME = selections.decisionAi || "auto";
  for (const { key } of decisionFields) nextSettings[key] = decisionModels[key] || "auto";
  nextSettings.LIVE_AI_NAME = selections.liveAi;
  nextSettings.CODE_AI1_NAME = selections.codeAi1;
  nextSettings.CODE_AI1_MODEL = selections.codeModel1;
  nextSettings.CODE_AI2_NAME = selections.codeAi2;
  nextSettings.CODE_AI2_MODEL = selections.codeModel2;
  nextSettings.CODE_AI3_NAME = selections.codeAi3;
  nextSettings.CODE_AI3_MODEL = selections.codeModel3;
  nextSettings.CODE_AI4_NAME = selections.codeAi4;
  nextSettings.CODE_AI4_MODEL = selections.codeModel4;
  nextSettings.CODE_AI5_NAME = selections.codeAi5;
  nextSettings.CODE_AI5_MODEL = selections.codeModel5;
  nextSettings.CODE_AI6_NAME = selections.codeAi6;
  nextSettings.CODE_AI6_MODEL = selections.codeModel6;
  nextSettings.TASK_AI_NAME = selections.taskAi;
  nextSettings.TASK_AI_MODEL_plan = selections.taskModelPlan;
  nextSettings.TASK_AI_MODEL_do = selections.taskModelDo;
  nextSettings.TASK_AI_MODEL_check = selections.taskModelCheck;
  nextSettings.TEAM_AI_NAME = selections.teamAi;
  nextSettings.TEAM_AI_MODEL_plan = selections.teamModelPlan;
  nextSettings.TEAM_AI_MODEL_do = selections.teamModelDo;
  nextSettings.TEAM_AI_MODEL_check = selections.teamModelCheck;
  const normalizedCodeBasePath = normalizeCodeBasePath(selections.codeBasePath);
  if (normalizedCodeBasePath) {
    nextSettings.CODE_BASE_PATH = normalizedCodeBasePath;
  }
  nextSettings.CODE_PERMISSIONS = selections.codePermissions || "auto";
  const chatKey = CHAT_MODEL_KEYS[selections.chatAi];
  const liveKey = LIVE_MODEL_KEYS[selections.liveAi];
  const voiceKey = LIVE_VOICE_KEYS[selections.liveAi];
  if (chatKey) nextSettings[chatKey] = selections.chatModel;
  if (liveKey) nextSettings[liveKey] = selections.liveModel;
  if (voiceKey) nextSettings[voiceKey] = selections.liveVoice;
  return nextSettings;
}
function buildNextSettings() {
  const next = buildFormSettings();
  for (const key of Object.keys(next)) {
    if (key === "DECISION_AI_NAME" || decisionFields.some((field) => field.key === key)) continue;
    if (next[key] === loadedFormSettings[key]) {
      if (Object.prototype.hasOwnProperty.call(currentSettings.value, key)) next[key] = currentSettings.value[key];
      else if (key !== "PREDICTION_AI_NAME" && !predictionFields.some((field) => field.key === key)) delete next[key];
    }
  }
  return next;
}
async function handleSaveOnly() {
  if (!canSave.value) return;
  const run = revision;
  loading.value = true;
  writing.value = true;
  errorMessage.value = "";
  try {
    if (!props.sessionId) {
      errorMessage.value = "セッションIDが見つかりません。画面をリロードしてください。";
      return;
    }
    const nextSettings = buildNextSettings();
    const response = await props.request("/core/AIコア/モデル情報/設定", {
      セッションID: props.sessionId,
      モデル設定: nextSettings,
      再起動要求: { reboot_core: false, reboot_apps: false, reboot_tools: false, reboot_local: false, reboot_task: false, reboot_team: false },
      save: true
    });
    if (!current(run)) return;
    if (response?.data?.status !== "OK") {
      errorMessage.value = "保存に失敗しました";
      return;
    }
    currentSettings.value = nextSettings;
    notice.value = "モデル情報を保存しました。";
    loadedFormSettings = buildFormSettings();
  } catch {
    if (!current(run)) return;
    errorMessage.value = "AIコアとの通信に失敗しました。接続状態を確認して再読み込みしてください。";
  } finally {
    writing.value = false;
    if (current(run)) loading.value = false;
  }
}
async function handleResetReboot() {
  if (!canSave.value) return;
  const run = revision;
  const confirmed = window.confirm("保存済みの設定でAIコアと各AI処理を再起動（リセット）します。初期値へ戻す操作ではありません。未保存の編集は反映されません。よろしいですか？");
  if (!confirmed) return;
  loading.value = true;
  writing.value = true;
  errorMessage.value = "";
  try {
    if (!props.sessionId) {
      errorMessage.value = "セッションIDが見つかりません。画面をリロードしてください。";
      return;
    }
    const response = await props.request("/core/AIコア/モデル情報/設定", {
      セッションID: props.sessionId,
      モデル設定: {},
      再起動要求: { reboot_core: true, reboot_apps: true, reboot_tools: true, reboot_local: true, reboot_task: true, reboot_team: true },
      save: false
    });
    if (!current(run)) return;
    if (response?.data?.status !== "OK") {
      errorMessage.value = "リセット再起動に失敗しました";
      return;
    }
    emit("saved", 60);
  } catch {
    if (!current(run)) return;
    errorMessage.value = "AIコアとの通信に失敗しました。接続状態を確認して再読み込みしてください。";
  } finally {
    writing.value = false;
    if (current(run)) loading.value = false;
  }
}
watch(() => [props.isOpen, props.sessionId], () => {
  revision++;
  loading.value = false;
  browsingCodeBase.value = false;
  isInitializing.value = false;
  hasLoadedConfig.value = false;
  errorMessage.value = "";
  notice.value = "";
  availableModels.value = {};
  currentSettings.value = {};
  codeBaseOptions.value = {};
  loadedFormSettings = {};
  if (props.isOpen && props.sessionId) void loadConfig();
}, { immediate: true, flush: "sync" });
onBeforeUnmount(() => {
  disposed = true;
  revision++;
});
watch(() => selections.chatAi, (newValue) => {
  const models = availableModels.value?.chat_models?.[newValue] || {};
  const key = CHAT_MODEL_KEYS[newValue];
  selections.chatModel = chooseAvailable(key && currentSettings.value[key], Object.keys(models));
});
watch(() => selections.liveAi, (newValue) => {
  const models = availableModels.value?.live_models?.[newValue] || {};
  const voices = availableModels.value?.live_voices?.[newValue] || {};
  const modelKey = LIVE_MODEL_KEYS[newValue];
  const voiceKey = LIVE_VOICE_KEYS[newValue];
  selections.liveModel = chooseAvailable(modelKey && currentSettings.value[modelKey], Object.keys(models));
  selections.liveVoice = chooseAvailable(voiceKey && currentSettings.value[voiceKey], Object.keys(voices));
});
function copyCode4Settings() {
  const models = Object.keys(availableModels.value?.code_models?.[selections.codeAi4] || {});
  selections.codeModel4 = chooseAvailable(selections.codeModel4, models);
  selections.codeAi5 = selections.codeAi4;
  selections.codeAi6 = selections.codeAi4;
  selections.codeModel5 = selections.codeModel4;
  selections.codeModel6 = selections.codeModel4;
}
function copyTaskSettingsToTeam() {
  selections.teamAi = selections.taskAi;
  selections.teamModelPlan = selections.taskModelPlan;
  selections.teamModelDo = selections.taskModelDo;
  selections.teamModelCheck = selections.taskModelCheck;
}
function handleTaskAiChange() {
  const model = codeDefaultModel(selections.taskAi);
  selections.taskModelPlan = model;
  selections.taskModelDo = model;
  selections.taskModelCheck = model;
  copyTaskSettingsToTeam();
}
function handleTaskPlanChange() {
  selections.taskModelDo = selections.taskModelPlan;
  selections.taskModelCheck = selections.taskModelPlan;
  copyTaskSettingsToTeam();
}
function handleTeamPlanChange() {
  selections.teamModelDo = selections.teamModelPlan;
  selections.teamModelCheck = selections.teamModelPlan;
}
function codeDefaultModel(aiName) {
  const models = Object.keys(availableModels.value?.code_models?.[aiName] || {});
  const key = CODE_MODEL_KEYS[aiName];
  return chooseAvailable(key && currentSettings.value[key], models);
}
function copyCode1Settings() {
  for (const index of [2, 3, 4, 5, 6]) {
    selections[`codeAi${index}`] = selections.codeAi1;
    selections[`codeModel${index}`] = selections.codeModel1;
  }
}
function handleCodeAiChange(index) {
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
</script>

<template>
  <div
    v-if="isOpen"
    class="config-panel-embedded"
    role="region"
    aria-labelledby="configPanelTitle"
  >
    <div class="config-panel">
      <div class="config-panel-header" id="configPanelTitle">
        <button class="config-panel-close" type="button" :disabled="writing" @click="handleCancel">×</button>
        <div class="config-panel-title">モデル設定 / 再起動</div>
        <button type="button" :disabled="loading || browsingCodeBase" @click="loadConfig">再読込</button>
      </div>
      <div class="config-panel-body">
        <p v-if="errorMessage" class="config-panel-error" role="alert">{{ errorMessage }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <p v-if="loading && !hasLoadedConfig">設定を読み込み中…</p>
        <fieldset v-if="hasLoadedConfig" class="config-panel-content" :disabled="loading || browsingCodeBase">
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
                <div v-if="codeBaseOptionsList.length > 0" class="config-panel-field">
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
                      type="text"
                      class="config-panel-input"
                      placeholder="../ または C:/project/"
                    />
                    <button
                      type="button"
                      class="config-panel-browse"
                      :disabled="loading || browsingCodeBase"
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
        </fieldset>
      </div>
      <div class="config-panel-actions">
        <div class="config-panel-actions-edge">
          <button type="button" class="save" :disabled="!canSave" @click="handleSaveOnly">書込み</button>
        </div>
        <div class="config-panel-actions-center">
          <button type="button" :disabled="writing" @click="handleCancel">キャンセル</button>
        </div>
        <div class="config-panel-actions-edge">
          <button type="button" class="danger" :disabled="!canSave" @click="handleResetReboot">再起動（リセット）</button>
        </div>
      </div>
    </div>
  </div>


</template>

