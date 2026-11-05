// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import type { ModelSettings } from '@/types'

const PORT_CORE = 8091

function resolveHttpBaseUrl(): string {
  if (import.meta.env.VITE_CORE_BASE_URL) {
    return import.meta.env.VITE_CORE_BASE_URL
  }

  if (import.meta.env.DEV) {
    return '/'
  }

  return `http://127.0.0.1:${PORT_CORE}`
}

function resolveWebSocketEndpoint(): string {
  if (import.meta.env.VITE_CORE_WS_URL) {
    return import.meta.env.VITE_CORE_WS_URL
  }

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/core/ws/AIコア`
  }

  return `ws://127.0.0.1:${PORT_CORE}/core/ws/AIコア`
}


export const CORE_BASE_URL = resolveHttpBaseUrl()
export const AI_WS_ENDPOINT = resolveWebSocketEndpoint()
export const DEFAULT_VRM_MODEL_URL = '/vrm/VRM_AiDiy.vrm'
export const SAMPLE_VRMA_FOLDER_NAME = 'サンプル'
export const STANDARD_VRMA_FOLDER_NAME = '標準'
export const SAMPLE_VRMA_FILES = [
  '/vrma/サンプル/VRMA_01.vrma',
  '/vrma/サンプル/VRMA_02.vrma',
  '/vrma/サンプル/VRMA_03.vrma',
  '/vrma/サンプル/VRMA_04.vrma',
  '/vrma/サンプル/VRMA_05.vrma',
  '/vrma/サンプル/VRMA_06.vrma',
  '/vrma/サンプル/VRMA_07.vrma',
]
export const STANDARD_VRMA_FILES = [
  '/vrma/標準/VRMA_01.vrma',
  '/vrma/標準/VRMA_02.vrma',
  '/vrma/標準/VRMA_03.vrma',
  '/vrma/標準/VRMA_04.vrma',
  '/vrma/標準/VRMA_05.vrma',
]

export function defaultModelSettings(): ModelSettings {
  return {
    CHAT_AI_NAME: 'freeai_chat',
    CHAT_GEMINI_MODEL: 'gemini-3.1-flash-image',
    CHAT_FREEAI_MODEL: 'gemini-3.8-flash',
    CHAT_OPENRT_MODEL: 'google/gemini-3.1-flash-image',
    CHAT_OPENRT_FREE_MODEL: 'auto',
    CHAT_OPENAI_MODEL: 'gpt-6.1-sol',
    CHAT_OLLAMA_MODEL: 'deepseek-v4-flash:cloud',
    CHAT_LOCAL_MODEL: 'google/gemma-4-E2B-it',
    CHAT_LOCAL_DTYPE: 'bfloat16',
    LIVE_AI_NAME: 'freeai_live',
    LIVE_GEMINI_MODEL: 'gemini-2.5-flash-native-audio-preview-12-2025',
    LIVE_GEMINI_VOICE: 'Zephyr',
    LIVE_FREEAI_MODEL: 'gemini-2.5-flash-native-audio-preview-09-2025',
    LIVE_FREEAI_VOICE: 'Zephyr',
    LIVE_OPENAI_MODEL: 'gpt-realtime-2.1-mini',
    LIVE_OPENAI_VOICE: 'marin',
    PREDICTION_AI_NAME: 'auto',
    PREDICTION_OPENAI_MODEL: 'auto',
    PREDICTION_OAUTH_MODEL: 'auto',
    PREDICTION_GEMINI_MODEL: 'auto',
    PREDICTION_FREEAI_MODEL: 'auto',
    PREDICTION_CODEX_CLI_MODEL: 'gpt-6-luna',
    PREDICTION_COPILOT_CLI_MODEL: 'gpt-6-luna',
    PREDICTION_AIDIY_HERMES_MODEL: 'openai_oauth/gpt-6-luna',
    DECISION_AI_NAME: 'auto',
    DECISION_OPENAI_MODEL: 'auto',
    DECISION_OAUTH_MODEL: 'auto',
    DECISION_GEMINI_MODEL: 'auto',
    DECISION_FREEAI_MODEL: 'auto',
    CODE_BASE_PATH: '../',
    CODE_PERMISSIONS: 'auto',
    CODE_AI1_NAME: 'codex_cli',
    CODE_AI1_MODEL: 'auto',
    CODE_AI2_NAME: 'copilot_cli',
    CODE_AI2_MODEL: 'auto',
    CODE_AI3_NAME: 'claude_cli',
    CODE_AI3_MODEL: 'auto',
    CODE_AI4_NAME: 'antigravity_cli',
    CODE_AI4_MODEL: 'same',
    CODE_AI5_NAME: 'opencode_cli',
    CODE_AI5_MODEL: 'auto',
    CODE_AI6_NAME: 'aidiy_hermes',
    CODE_AI6_MODEL: 'auto',
    CODE_CLAUDE_SDK_MODEL: 'auto',
    CODE_CLAUDE_CLI_MODEL: 'auto',
    CODE_CLAUDE_OLLAMA_MODEL: 'auto',
    CODE_COPILOT_CLI_MODEL: 'auto',
    CODE_ANTIGRAVITY_CLI_MODEL: 'auto',
    CODE_CODEX_CLI_MODEL: 'auto',
    CODE_CODEX_OLLAMA_MODEL: 'auto',
    CODE_GROK_CLI_MODEL: 'same',
    CODE_AIDIY_HERMES_MODEL: 'auto',
    CODE_OPENCODE_CLI_MODEL: 'auto',
    CODE_MAX_TURNS: 999,
    CODE_PLAN: 'auto',
    CODE_VERIFY: 'auto',
    CODE_SELF_CHECK_LOOP: 1,
    TASK_AI_NAME: 'codex_cli',
    TASK_AI_MODEL_plan: 'auto',
    TASK_AI_MODEL_do: 'auto',
    TASK_AI_MODEL_check: 'auto',
    TEAM_AI_NAME: 'codex_cli',
    TEAM_AI_MODEL_plan: 'auto',
    TEAM_AI_MODEL_do: 'auto',
    TEAM_AI_MODEL_check: 'auto',
  }
}
