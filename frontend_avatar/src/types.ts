// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

export interface AuthUser {
  利用者ID: string;
  利用者名?: string;
  権限ID?: string;
  [key: string]: unknown;
}

export type MessageKind =
  | 'system'
  | 'user'
  | 'assistant'
  | 'recognition-user'
  | 'recognition-assistant'
  | 'input-request'
  | 'output-request'
  | 'input-file'
  | 'output-file'
  | 'stream'

export interface ChatMessage {
  id: string;
  kind: MessageKind;
  text: string;
  timestamp: string;
  fileName?: string | null;
  thumbnail?: string | null;
  isStream?: boolean;
  isCollapsed?: boolean;
}

// qTublerFrame の列定義（frontend_web の types/qTubler.ts と同じ）
export interface Column {
  key: string;
  label: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
}

export interface ModelSettings {
  CHAT_GEMINI_MODEL?: string;
  CHAT_FREEAI_MODEL?: string;
  CHAT_OPENRT_MODEL?: string;
  CHAT_OPENRT_FREE_MODEL?: string;
  CHAT_OPENAI_MODEL?: string;
  CHAT_OLLAMA_MODEL?: string;
  CHAT_LOCAL_MODEL?: string;
  CHAT_LOCAL_DTYPE?: string;
  LIVE_GEMINI_MODEL?: string;
  LIVE_GEMINI_VOICE?: string;
  LIVE_FREEAI_MODEL?: string;
  LIVE_FREEAI_VOICE?: string;
  LIVE_OPENAI_MODEL?: string;
  LIVE_OPENAI_VOICE?: string;
  CODE_AI1_MODEL?: string;
  CODE_AI2_MODEL?: string;
  CODE_AI3_MODEL?: string;
  CODE_AI4_MODEL?: string;
  CODE_AI5_MODEL?: string;
  CODE_AI6_MODEL?: string;
  CODE_CLAUDE_SDK_MODEL?: string;
  CODE_CLAUDE_CLI_MODEL?: string;
  CODE_CLAUDE_OLLAMA_MODEL?: string;
  CODE_COPILOT_CLI_MODEL?: string;
  CODE_ANTIGRAVITY_CLI_MODEL?: string;
  CODE_CODEX_CLI_MODEL?: string;
  CODE_CODEX_OLLAMA_MODEL?: string;
  CODE_GROK_CLI_MODEL?: string;
  CODE_AIDIY_HERMES_MODEL?: string;
  CODE_OPENCODE_CLI_MODEL?: string;
  CODE_MAX_TURNS?: number;
  CODE_PLAN?: string;
  CODE_VERIFY?: string;
  CODE_SELF_CHECK_LOOP?: number;
  CODE_BASE_PATH?: string;
  CHAT_AI_NAME: string;
  LIVE_AI_NAME: string;
  PREDICTION_AI_NAME?: string;
  PREDICTION_OPENAI_MODEL?: string;
  PREDICTION_OAUTH_MODEL?: string;
  PREDICTION_GEMINI_MODEL?: string;
  PREDICTION_FREEAI_MODEL?: string;
  PREDICTION_CODEX_CLI_MODEL?: string;
  PREDICTION_COPILOT_CLI_MODEL?: string;
  PREDICTION_AIDIY_HERMES_MODEL?: string;
  DECISION_AI_NAME?: string;
  DECISION_OPENAI_MODEL?: string;
  DECISION_OAUTH_MODEL?: string;
  DECISION_GEMINI_MODEL?: string;
  DECISION_FREEAI_MODEL?: string;
  CODE_AI1_NAME: string;
  CODE_AI2_NAME: string;
  CODE_AI3_NAME: string;
  CODE_AI4_NAME: string;
  CODE_AI5_NAME: string;
  CODE_AI6_NAME: string;
  CODE_PERMISSIONS: string;
  TASK_AI_NAME: string;
  // TASK / TEAM のモデルは plan（計画）/ do（実施）/ check（検証）の3種指定
  TASK_AI_MODEL_plan: string;
  TASK_AI_MODEL_do: string;
  TASK_AI_MODEL_check: string;
  TEAM_AI_NAME: string;
  TEAM_AI_MODEL_plan: string;
  TEAM_AI_MODEL_do: string;
  TEAM_AI_MODEL_check: string;
}
