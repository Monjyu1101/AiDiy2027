// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseArgs } from "../packages/coding-agent/src/cli/args.ts";

const READ_TOOLS = ["read", "grep", "find", "ls"];
const READ_ONLY_PROMPT = "読み取り専用モードです：調査・説明だけを行い、ファイルの作成・変更・削除、コマンド実行、外部サービスへの変更操作を行わないでください。";
// Pi の値付きオプションの値を、AiDiy のモード指定と取り違えない。
export const PI_VALUE_FLAGS = new Set([
	"--mode", "--provider", "--model", "--api-key", "--system-prompt", "--append-system-prompt",
	"--name", "-n", "--session", "--session-id", "--fork", "--session-dir", "--models",
	"--tools", "-t", "--exclude-tools", "-xt", "--thinking", "--export", "--extension", "-e",
	"--skill", "--prompt-template", "--theme", "--use-theme", "--tui-mode",
]);
const SUBCOMMANDS = new Set(["auth", "mcp", "update", "install", "remove", "uninstall", "list", "config"]);

/** AiDiy 独自のモード指定を取り出し、read-only の起動制約を Pi に渡す。 */
export function aidiyModeArgs(input: string[]): { args: string[]; readOnly: boolean } {
	const args: string[] = [];
	let readOnly = false;
	let endOfOptions = -1;
	let missingValue: string | undefined;
	for (let index = 0; index < input.length; index++) {
		const arg = input[index];
		if (arg === "--") {
			endOfOptions = args.length;
			args.push(...input.slice(index));
			break;
		}
		if (arg === "--read-only") {
			readOnly = true;
		} else if (arg === "--yolo") {
			// Pi 標準が確認なし。両指定の場合も read-only は解除しない。
		} else if (arg.startsWith("--read-only=") || arg.startsWith("--yolo=")) {
			throw new Error("--read-only / --yolo は値を付けずに指定してください。");
		} else {
			const equal = arg.indexOf("=");
			if (equal > 0 && PI_VALUE_FLAGS.has(arg.slice(0, equal))) {
				args.push(arg.slice(0, equal), arg.slice(equal + 1));
				continue;
			}
			args.push(arg);
			if (PI_VALUE_FLAGS.has(arg)) {
				if (index + 1 < input.length) args.push(input[++index]);
				else missingValue = arg;
			}
		}
	}
	if (readOnly) {
		// 不完全な末尾オプションに、後から足す制約フラグを値として消費させない。
		if (missingValue) throw new Error(`${missingValue} の値を指定してください。`);
		const parsed = parseArgs(args);
		if (SUBCOMMANDS.has(args[0]) || parsed.export || parsed.extensions?.length) {
			throw new Error("--read-only では管理サブコマンド・--export・追加拡張（-e / --extension）は使えません。");
		}
		// 設定・拡張・MCP から変更ツールを追加させず、既存 --tools より後で確定する。
		args.splice(endOfOptions < 0 ? args.length : endOfOptions, 0, "--no-extensions", "--no-mcp", "--tools", READ_TOOLS.join(","));
	}
	return { args, readOnly };
}

/** 表示上のツール制限だけに頼らず、実行直前にも読取ツール以外を拒否する。 */
export function aidiyModeExtension(pi: ExtensionAPI, readOnly: boolean): void {
	pi.registerFlag("yolo", { description: "確認なしで実行（Pi 標準の動作）", type: "boolean" });
	pi.registerFlag("read-only", { description: "調査・説明のみ。read / grep / find / ls 以外を禁止", type: "boolean" });
	if (!readOnly) return;
	pi.on("before_agent_start", async (event) => ({ systemPrompt: `${event.systemPrompt}\n\n${READ_ONLY_PROMPT}` }));
	pi.on("tool_call", async (event) => {
		if (!READ_TOOLS.includes(event.toolName)) {
			return { block: true, reason: `read-only モードでは ${event.toolName} を実行できません。` };
		}
		return undefined;
	});
	// 対話画面の ! / !! と RPC の bash も同じ制限にする。
	pi.on("user_bash", async () => ({
		result: { output: "read-only モードではシェルを実行できません。", exitCode: 1, cancelled: false, truncated: false },
	}));
}
