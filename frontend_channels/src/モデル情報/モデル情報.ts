// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { Coreモデル要求, type Core復旧設定 } from '../接続/Core認証';
import type { LiveCatalog } from '../../../frontend_ide/host/aidiy_live/src/model-catalog';

type Choices = Record<string, Record<string, string>>;
export type モデル初期情報 = {
  settings: Record<string, string>;
  catalog: LiveCatalog;
  chat: Choices;
  code: Choices;
};
const providerKeys: Record<string, [string, string, string]> = {
  freeai:['chat','freeai_chat','FreeAI'], gemini:['chat','gemini_chat','Gemini'],
  openai:['chat','openai_chat','OpenAI'], openai_oauth:['chat','openai_oauth','OpenAI OAuth'],
  openrt:['chat','openrt_chat','OpenRouter'], ollama:['chat','ollama_chat','Ollama'], local_chat:['chat','local_chat','Local'],
  'claude-code':['code','claude_cli','Claude Code (CLI)'], 'codex-cli':['code','codex_cli','Codex CLI'],
  'copilot-cli':['code','copilot_cli','Copilot CLI'], 'grok-cli':['code','grok_cli','Grok CLI'],
  opencode:['code','opencode_cli','OpenCode'], 'antigravity-cli':['code','antigravity_cli','Antigravity CLI'],
};

function choices(value: unknown): Choices {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  for (const entry of Object.values(value)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.values(entry).some(label=>typeof label!=='string')) throw new Error();
  }
  return value as Choices;
}

// Core停止中の単独実行を妨げないよう、失敗時は呼出側のファイル読込へ戻す。
export async function モデル情報取得(coreUrl: string, request: typeof fetch = fetch, root?: string, recovery: Core復旧設定 = {}): Promise<モデル初期情報 | undefined> {
  try {
    const response = await Coreモデル要求(coreUrl, request, root, recovery);
    if (!response?.ok) return;
    const value = await response.json();
    if (value.status !== 'OK' || !value.data?.モデル設定 || typeof value.data.モデル設定 !== 'object' || Array.isArray(value.data.モデル設定)) return;
    const available = value.data.available_models;
    return {settings:Object.fromEntries(Object.entries(value.data.モデル設定).filter(([,v])=>typeof v==='string')) as Record<string,string>,
      catalog:{models:choices(available?.live_models), voices:choices(available?.live_voices)},
      chat:choices(available?.chat_models), code:choices(available?.code_models)};
  } catch { return; }
}

export function APIコード候補(info: モデル初期情報, provider: string) {
  const entry = providerKeys[provider];
  if (provider) {
    if (!entry) return {models:[]};
    const [group,key] = entry;
    const values = (group==='chat'?info.chat:info.code)[key] || {};
    return {models:[...(group==='code'?[{id:'same',label:'same (変更なし)'}]:[]),
      ...Object.entries(values).filter(([id])=>!['auto','same'].includes(id)).map(([id,label])=>({id,label}))]};
  }
  return {providers:Object.entries(providerKeys).filter(([, [group,key]])=>Object.keys((group==='chat'?info.chat:info.code)[key]||{}).length)
    .map(([id,[,,label]])=>({id,label}))};
}

export function APIコード初期値(info: モデル初期情報 | undefined, fallback: {provider:string; model:string}) {
  const model = info?.settings.CODE_AIDIY_HERMES_MODEL;
  if (!model) return fallback;
  const oauth = /^(openai_oauth|xai-oauth)\/(.+)$/.exec(model);
  return {provider:oauth?.[1] || '', model:oauth?.[2] || model};
}
