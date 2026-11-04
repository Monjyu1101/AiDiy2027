// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 設定モデルの固定試行と、AIモデルの編集可能な初期入力を共通化する。
export const TRIAL_PROMPT='おはよう';
export const DECISION_CHOICES=Object.freeze(['high','medium','low']);
export const decisionQuestions=()=>[{type:'choice',name:'politeness',instructions:'入力の挨拶としての丁寧さをhigh（丁寧）、medium（普通）、low（くだけた表現）から選んでください。',choices:DECISION_CHOICES.map(value=>({value}))}];

export const TRIAL_FAMILIES=Object.freeze(['CHAT','LIVE','PREDICTION','DECISION','CODE']);
export const PREDICTION_PROVIDERS=Object.freeze(['openai_oauth','freeai_chat','openai_chat','gemini_chat','codex_cli','copilot_cli','aidiy_hermes']);
// autoは候補がある方式をCLI優先（codex → copilot → hermes）、次にChat（OAuth → FreeAI → OpenAI API → Gemini）の順で選ぶ。
export const PREDICTION_AUTO_PROVIDERS=Object.freeze(['codex_cli','copilot_cli','aidiy_hermes','openai_oauth','freeai_chat','openai_chat','gemini_chat']);
export const PREDICTION_MODEL_KEYS=Object.freeze({openai_chat:'PREDICTION_OPENAI_MODEL',openai_oauth:'PREDICTION_OAUTH_MODEL',gemini_chat:'PREDICTION_GEMINI_MODEL',freeai_chat:'PREDICTION_FREEAI_MODEL',codex_cli:'PREDICTION_CODEX_CLI_MODEL',copilot_cli:'PREDICTION_COPILOT_CLI_MODEL',aidiy_hermes:'PREDICTION_AIDIY_HERMES_MODEL'});
export const PREDICTION_CLI_PROVIDERS=Object.freeze(['codex_cli','copilot_cli','aidiy_hermes']);
// 予測の試行は、Chat試行でOKになったモデルで昔話の書き出し2ターンを履歴へ残してから実行する。
export const PREDICTION_STORY_PROMPTS=Object.freeze(['昔々、あるところに','おじいさんと']);
// 「おばあさん」が続けば完璧。それ以外でも非空の応答はOK。
export const predictionPerfect=answer=>/おばあさん/.test(answer);
