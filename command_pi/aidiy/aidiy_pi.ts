// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
//
// aidiy_pi の起動入口。Pi 本体の CLI（packages/coding-agent/src/cli.ts）と同じ処理に、
// AiDiy 拡張（aidiy-providers.ts）と初期モデルの決定を加える。
//
// モデルの決め方（Hermes と同じ考え方）:
//   1. --model / --models / --provider を指定したら、その指定を使う
//      （--model same は前回選択の復元、--model auto は 3 の初期モデルから自動決定）
//   2. セッション再開（-c / -r / --session ...）は、そのセッションのモデルを使う
//   3. それ以外は前回選んだモデル（aidiy_model.json）、無ければ openai_oauth/gpt-6.1-sol
//      OpenAI OAuth が未ログインなら、FreeAI（Gemini）の先頭モデルへ退避する

import { setupCli } from "../packages/coding-agent/src/cli/setup.ts";
import { parseArgs } from "../packages/coding-agent/src/cli/args.ts";
import { main } from "../packages/coding-agent/src/main.ts";
import { aidiyModeArgs, aidiyModeExtension, PI_VALUE_FLAGS } from "./aidiy-mode.ts";
import { CLI_PROVIDERS } from "./aidiy-cli.ts";
import { codexLoggedIn } from "./aidiy-oauth.ts";
import { AIDIY_INITIAL_MODEL, aidiyExtension, readAidiyConfig, readPiModels, readSavedModel, SECTIONS, validKey } from "./aidiy-providers.ts";

const SUBCOMMANDS = new Set(["auth", "mcp", "update", "install", "remove", "uninstall", "list", "config"]);
const NO_SESSION_FLAGS = new Set(["--version", "-v", "--help", "-h", "--list-models", "--export"]);
const MODEL_FLAGS = new Set(["--model", "--models", "--provider"]);
const RESUME_FLAGS = new Set(["-c", "--continue", "-r", "--resume", "--session", "--session-id", "--fork"]);

const flagName = (arg: string) => arg.split("=", 1)[0] ?? arg;

/** 区分が使える（一覧にあり、資格情報がありそう）かを通信なしで判定する。 */
function usable(provider: string, models: Record<string, Record<string, string>>): boolean {
	if (CLI_PROVIDERS.includes(provider)) return Boolean(models[provider]);
	const section = SECTIONS[provider];
	if (!section || !models[provider]) return false;
	if (section.oauth === "codex") return codexLoggedIn();
	if (section.oauth) return true;
	return Boolean(section.fixedKey || (section.keyName && validKey(readAidiyConfig()[section.keyName])));
}

export function initialModel({ restore = true } = {}): string | undefined {
	const models = readPiModels();
	const saved = restore ? readSavedModel() : undefined;
	if (saved && usable(saved.provider, models) && Object.hasOwn(models[saved.provider] ?? {}, saved.model)) {
		return `${saved.provider}/${saved.model}`;
	}
	const [provider, model] = AIDIY_INITIAL_MODEL.split("/");
	if (provider && model && usable(provider, models)) return AIDIY_INITIAL_MODEL;
	// 別 PC の初回起動や OAuth 未ログインでは、Hermes と同じく FreeAI へ退避する。
	for (const fallback of ["freeai_chat", "gemini_chat", "openrt_free"]) {
		const first = Object.keys(models[fallback] ?? {})[0];
		if (first && usable(fallback, models)) return `${fallback}/${first}`;
	}
	// 一覧が無い場合も初期値を渡す（Pi が見つからない旨を表示する）。
	return Object.keys(models).length ? undefined : AIDIY_INITIAL_MODEL;
}

/** Hermes と同じ指定: same（same/same）は前回選択の復元、auto（auto/auto）は初期モデルからの自動決定。 */
function replaceModelKeyword(args: string[]): string[] {
	const result = [...args];
	const externalProvider = CLI_PROVIDERS.includes(parseArgs(args).provider ?? "");
	for (let index = 0; index < result.length; index++) {
		const arg = result[index] ?? "";
		if (arg === "--") break;
		const inline = arg.startsWith("--model=");
		if (arg !== "--model" && !inline) {
			if (PI_VALUE_FLAGS.has(arg)) index++;
			continue;
		}
		if (inline) result.splice(index, 1, "--model", arg.slice("--model=".length));
		const valueIndex = index + 1;
		const value = (result[valueIndex] ?? "").trim().toLowerCase();
		if (!["same", "same/same", "auto", "auto/auto"].includes(value)) { index++; continue; }
		if (externalProvider) {
			result[valueIndex] = value.split("/")[0];
			index++;
			continue;
		}
		const model = initialModel({ restore: value.startsWith("same") });
		if (!model) return result.filter((_, position) => position !== index && position !== valueIndex);
		result[valueIndex] = model;
		index++;
	}
	return result;
}

export function aidiyArgs(input: string[]): string[] {
	if (input.length && SUBCOMMANDS.has(input[0] ?? "")) return input;
	const args = replaceModelKeyword(input);
	const names = args.map(flagName);
	if (names.some((name) => NO_SESSION_FLAGS.has(name) || MODEL_FLAGS.has(name) || RESUME_FLAGS.has(name))) return args;
	const model = initialModel();
	return model ? ["--model", model, ...args] : args;
}

setupCli();
// 実行中の Pi から見た作業フォルダは、aidiy_pi を起動したフォルダ（プロジェクト）のまま。
let mode: ReturnType<typeof aidiyModeArgs>;
let startupArgs: string[];
try {
	mode = aidiyModeArgs(process.argv.slice(2));
	startupArgs = aidiyArgs(mode.args);
	const parsed = parseArgs(startupArgs);
	if (mode.readOnly && (CLI_PROVIDERS.includes(parsed.provider ?? "") || CLI_PROVIDERS.includes(parsed.model?.split("/")[0] ?? ""))) {
		throw new Error("Pi の外部CLIモデルは read-only では使えません。API / OAuth モデルを選択してください。");
	}
} catch (error) {
	console.error(`[aidiy_pi] ${error instanceof Error ? error.message : String(error)}`);
	process.exit(2);
}
await main(startupArgs, {
	extensionFactories: [{
		name: "aidiy",
		factory: (pi) => {
			aidiyModeExtension(pi, mode.readOnly);
			aidiyExtension(pi, { readOnly: mode.readOnly });
		},
	}],
});
