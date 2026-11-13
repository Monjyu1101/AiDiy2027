// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
//
// AiDiy Pi 拡張: Hermes と同じ区分名（openai_oauth / gemini_chat など）で Pi にプロバイダを登録する。
// - モデル候補: aidiy_diag が生成する `_AIDIY/aidiy_diag/pi_models_info.json`
// - API キー  : `_config/AiDiy_key.json`（要求ごとに読み直す。キーは保存・表示しない）
// - OAuth     : Codex CLI / Grok CLI の共有ログイン（aidiy-oauth.ts）
// - MCP       : `_config/AiDiy_mcp.json` の AiDiy MCP 群（backend_tools の Streamable HTTP /mcp）
// - モデル選択: `/model` などで変えたモデルを `aidiy_model.json` に保存し、次回起動で復元する

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProvider } from "@earendil-works/pi-ai";
import {
	anthropicMessagesApi,
	googleGenerativeAIApi,
	openAICodexResponsesApi,
	openAICompletionsApi,
	openAIResponsesApi,
} from "@earendil-works/pi-ai/compat";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { codexAccessToken, grokAccessToken } from "./aidiy-oauth.ts";
import { CLI_PROVIDERS, registerCliProviders } from "./aidiy-cli.ts";

/** AiDiy プロジェクトのルート（command_pi の親）。 */
export const AIDIY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const AIDIY_KEY_JSON = join(AIDIY_ROOT, "_config", "AiDiy_key.json");
export const PI_MODELS_JSON = join(AIDIY_ROOT, "_AIDIY", "aidiy_diag", "pi_models_info.json");
/** backend_tools/_setup.py が書く AiDiy の MCP 一覧（Hermes と同じファイル）。 */
export const AIDIY_MCP_JSON = join(AIDIY_ROOT, "_config", "AiDiy_mcp.json");
/** Hermes と同じ初期モデル。 */
export const AIDIY_INITIAL_MODEL = "openai_oauth/gpt-6.1-sol";

type Json = Record<string, unknown>;

interface Section {
	name: string;
	/** メタデータ（コンテキスト長・推論対応など）を借りる Pi 組込みプロバイダ。 */
	builtin?: string;
	api: string;
	baseUrl: (config: Json) => string;
	/** AiDiy_key.json のキー名。 */
	keyName?: string;
	/** キー不要・固定値（backend_local / Ollama）。 */
	fixedKey?: string;
	oauth?: "codex" | "grok";
}

const GOOGLE = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER = "https://openrouter.ai/api/v1";

/** 区分名・並び順は hermes_models_info.json / pi_models_info.json と同じ。 */
export const SECTIONS: Record<string, Section> = {
	gemini_chat: { name: "Google Gemini", builtin: "google", api: "google-generative-ai", baseUrl: () => GOOGLE, keyName: "gemini_key_id" },
	freeai_chat: { name: "FreeAI Gemini", builtin: "google", api: "google-generative-ai", baseUrl: () => GOOGLE, keyName: "freeai_key_id" },
	openrt_chat: { name: "OpenRouter", builtin: "openrouter", api: "openai-completions", baseUrl: () => OPENROUTER, keyName: "openrt_key_id" },
	openrt_free: { name: "OpenRouter Free", builtin: "openrouter", api: "openai-completions", baseUrl: () => OPENROUTER, keyName: "openrt_key_id" },
	openai_chat: { name: "OpenAI API", builtin: "openai", api: "openai-responses", baseUrl: () => "https://api.openai.com/v1", keyName: "openai_key_id" },
	openai_oauth: { name: "OpenAI (OAuth)", builtin: "openai-codex", api: "openai-codex-responses", baseUrl: () => "https://chatgpt.com/backend-api", oauth: "codex" },
	xai_oauth: { name: "xAI Grok (OAuth)", builtin: "xai", api: "openai-responses", baseUrl: () => "https://api.x.ai/v1", oauth: "grok" },
	claude_chat: { name: "Claude Chat (Anthropic)", builtin: "anthropic", api: "anthropic-messages", baseUrl: () => "https://api.anthropic.com", keyName: "claude_key_id" },
	ollama_chat: {
		name: "Ollama",
		api: "openai-completions",
		baseUrl: (config) => `${String(config.ollama_host || "http://localhost:11434").trim().replace(/\/+$/, "")}/v1`,
		keyName: "ollama_key_id",
		fixedKey: "ollama",
	},
	local_chat: {
		name: "Local Chat (backend_local)",
		api: "openai-completions",
		baseUrl: (config) => `http://localhost:${String(config.PORT_LOCAL || "8096").trim() || "8096"}/v1`,
		fixedKey: "no-key-required",
	},
};

const API_IMPLEMENTATIONS = {
	"google-generative-ai": googleGenerativeAIApi,
	"openai-completions": openAICompletionsApi,
	"openai-responses": openAIResponsesApi,
	"openai-codex-responses": openAICodexResponsesApi,
	"anthropic-messages": anthropicMessagesApi,
} as const;
type SupportedApi = keyof typeof API_IMPLEMENTATIONS;
const supported = (api: unknown): api is SupportedApi => typeof api === "string" && Object.hasOwn(API_IMPLEMENTATIONS, api);

function readJsonFile(path: string): Json {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
	} catch {
		return {};
	}
}

export const readAidiyConfig = (): Json => readJsonFile(AIDIY_KEY_JSON);

/** Hermes の `_is_valid_key` と同じ: 空・`< your ... key >` の雛形は未設定扱い。 */
export function validKey(value: unknown): string | undefined {
	const key = typeof value === "string" ? value.trim() : "";
	return key && !key.startsWith("<") ? key : undefined;
}

/** pi_models_info.json の区分 → {モデルID: 表示名}。ファイル未作成・破損なら空。 */
export function readPiModels(path = PI_MODELS_JSON): Record<string, Record<string, string>> {
	const result: Record<string, Record<string, string>> = {};
	for (const [section, entry] of Object.entries(readJsonFile(path))) {
		const models = (entry as Json | undefined)?.models;
		if ((!Object.hasOwn(SECTIONS, section) && !CLI_PROVIDERS.includes(section)) || !models || typeof models !== "object" || Array.isArray(models)) continue;
		const valid = Object.entries(models as Json).filter(
			(pair): pair is [string, string] => Boolean(pair[0].trim()) && typeof pair[1] === "string",
		);
		if (valid.length) result[section] = Object.fromEntries(valid);
	}
	return result;
}

// ---------------------------------------------------------------------------
// 前回選択モデル（Hermes の ~/.hermes/aidiy_model.json に相当）
// ---------------------------------------------------------------------------
export function agentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	return configured ? configured.replace(/^~(?=$|[\\/])/, homedir()) : join(homedir(), ".pi", "agent");
}
export const savedModelPath = () => join(agentDir(), "aidiy_model.json");

export function readSavedModel(): { provider: string; model: string } | undefined {
	const saved = readJsonFile(savedModelPath());
	return typeof saved.provider === "string" && typeof saved.model === "string" && saved.provider && saved.model
		? { provider: saved.provider, model: saved.model }
		: undefined;
}

export function saveModel(provider: string, model: string): void {
	const path = savedModelPath();
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp.${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify({ provider, model }, null, 2)}\n`, "utf8");
	renameSync(temporary, path);
}

// ---------------------------------------------------------------------------
// プロバイダ登録
// ---------------------------------------------------------------------------
type ModelTemplate = Json & { id: string; api?: string; baseUrl?: string };

function builtinTemplates(provider: string | undefined): Map<string, ModelTemplate> {
	if (!provider) return new Map();
	try {
		const models = getBuiltinModels(provider as never) as unknown as ModelTemplate[];
		return new Map(models.map((model) => [model.id, model]));
	} catch {
		return new Map();
	}
}

/** 組込み情報が無いモデルの控えめな既定値。 */
const GENERIC = {
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16384,
};

function modelDefinitions(id: string, section: Section, models: Record<string, string>, config: Json): Json[] {
	const templates = builtinTemplates(section.builtin);
	const baseUrl = section.baseUrl(config);
	return Object.entries(models).map(([modelId, label]) => {
		const template = templates.get(modelId);
		// OpenRouter の一部（Anthropic 互換経路など）は組込み情報の API と接続先をそのまま使う。
		const useTemplateRoute = section.builtin === "openrouter" && template && supported(template.api);
		return {
			...GENERIC,
			...(template ?? {}),
			id: modelId,
			// 表示名は Hermes の /model と同じ AiDiy の表示名（日付 - モデルID）。
			name: label,
			provider: id,
			api: useTemplateRoute ? template.api : section.api,
			baseUrl: useTemplateRoute && template.baseUrl ? template.baseUrl : baseUrl,
		};
	});
}

function providerAuth(id: string, section: Section) {
	if (section.oauth) {
		const label = section.oauth === "codex" ? "Codex CLI の共有ログイン (~/.codex/auth.json)" : "Grok CLI の共有ログイン (~/.grok/auth.json)";
		return {
			apiKey: {
				name: `${section.name}（${label}）`,
				async resolve({ signal }: { signal: AbortSignal }) {
					const token = section.oauth === "codex" ? await codexAccessToken(signal) : await grokAccessToken(signal);
					return token ? { auth: { apiKey: token }, source: label } : undefined;
				},
			},
		};
	}
	return {
		apiKey: {
			name: `${section.name}（AiDiy_key.json${section.keyName ? ` ${section.keyName}` : ""}）`,
			async resolve() {
				// Hermes と同じく要求ごとに共通設定を読み直す（キー変更を再起動なしで反映）。
				const key = (section.keyName && validKey(readAidiyConfig()[section.keyName])) || section.fixedKey;
				return key ? { auth: { apiKey: key }, source: `AiDiy_key.json ${section.keyName ?? id}` } : undefined;
			},
		},
	};
}

export function aidiyProviders(piModels = readPiModels(), config = readAidiyConfig()) {
	const providers = [];
	for (const [id, models] of Object.entries(piModels)) {
		const section = SECTIONS[id];
		if (!section) continue;
		const definitions = modelDefinitions(id, section, models, config);
		const apis = [...new Set(definitions.map((model) => model.api as SupportedApi))];
		providers.push(
			createProvider({
				id,
				name: section.name,
				baseUrl: section.baseUrl(config),
				auth: providerAuth(id, section) as never,
				models: definitions as never,
				api: Object.fromEntries(apis.map((api) => [api, API_IMPLEMENTATIONS[api]()])) as never,
			}),
		);
	}
	return providers;
}

// ---------------------------------------------------------------------------
// AiDiy の MCP 群（Hermes と同じく AiDiy_mcp.json を起動のたびに読む。Pi の mcp.json には書かない）
// ---------------------------------------------------------------------------
/** Pi は旧 SSE 方式に未対応のため、AiDiy Tools が併せて公開する Streamable HTTP（/mcp）へ読み替える。 */
export function streamableUrl(url: string): string {
	return url.trim().replace(/\/sse\/?$/, "/mcp");
}

export function aidiyMcpServers(path = AIDIY_MCP_JSON): Record<string, Json> {
	const servers = readJsonFile(path).mcpServers;
	const result: Record<string, Json> = {};
	if (!servers || typeof servers !== "object" || Array.isArray(servers)) return result;
	for (const [name, value] of Object.entries(servers as Json)) {
		const entry = value as Json | undefined;
		if (!entry || typeof entry !== "object") continue;
		if (typeof entry.url === "string" && entry.url.trim()) {
			result[name] = { url: streamableUrl(entry.url) };
		} else if (typeof entry.command === "string" && entry.command.trim()) {
			const { command, args, env, cwd } = entry;
			result[name] = { command, ...(Array.isArray(args) ? { args } : {}), ...(env ? { env } : {}), ...(cwd ? { cwd } : {}) };
		}
	}
	return result;
}

function registerAidiyMcpServers(pi: ExtensionAPI): void {
	for (const [name, config] of Object.entries(aidiyMcpServers())) {
		try {
			pi.registerMcpServer(name, config as never);
		} catch (error) {
			console.error(`[aidiy_pi] MCP サーバー ${name} を登録できません: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

/** Pi へ渡すインライン拡張。 */
export function aidiyExtension(pi: ExtensionAPI, { readOnly = false } = {}): void {
	if (!readOnly) registerAidiyMcpServers(pi);
	if (!existsSync(PI_MODELS_JSON)) {
		console.error(
			`[aidiy_pi] モデル一覧がありません: ${PI_MODELS_JSON}\n` +
				"           aidiy_diag でモデル一覧を取得・保存してください（python _start.py でも生成されます）。",
		);
	}
	for (const provider of aidiyProviders()) pi.registerProvider(provider as never);
	if (readOnly) return;
	registerCliProviders(pi, AIDIY_ROOT, readPiModels());

	// /model・Ctrl+P などで選んだ AiDiy モデルを保存し、次回の起動で復元する。
	pi.on("model_select", async (event) => {
		const model = event.model as { provider?: string; id?: string } | undefined;
		if (!model?.provider || !model.id || (!Object.hasOwn(SECTIONS, model.provider) && !CLI_PROVIDERS.includes(model.provider))) return;
		try {
			saveModel(model.provider, model.id);
		} catch {
			// 保存できなくても会話は続ける。
		}
	});
}
