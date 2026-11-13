// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type AssistantMessage, type AssistantMessageEventStream, type SimpleStreamOptions,
	createAssistantMessageEventStream, getCurrentSystemPrompt,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

export const CLI_PROVIDERS = ["claude_cli", "antigravity_cli", "codex_cli", "copilot_cli", "opencode_cli", "grok_cli"];

/** 同梱Pythonと共通CodeAIへ委譲する。キャンセル時は監視ラッパーが子孫も回収する。 */
async function runCli(root: string, request: { provider: string; model: string; project: string; prompt: string },
	options: SimpleStreamOptions | undefined, progress: (text: string) => void): Promise<string> {
	const suffix = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
	const python = ["backend_tools", "backend_server"].map((name) => join(root, name, ".venv", suffix)).find(existsSync);
	if (!python) throw new Error("外部CLI委譲には backend_tools または backend_server のPython環境が必要です。");
	options?.signal?.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(python, ["-B", join(root, "backend_tools", "tools_proc", "process_lifetime.py"),
			"--parent-pid", String(process.pid), "--", python, "-B", join(root, "command_pi", "aidiy", "aidiy-cli.py")], {
			cwd: request.project, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], signal: options?.signal,
			env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
		});
		let pending = "", answer: string | undefined, failure: Error | undefined;
		const timer = setTimeout(() => {
			failure = new Error("外部CLIからの出力が途絶えたため終了しました。");
			child.kill();
		}, options?.timeoutMs ?? 900_000);
		const consume = (line: string) => {
			if (!line.trim()) return;
			try {
				const value: unknown = JSON.parse(line);
				if (!value || typeof value !== "object") throw new Error("外部CLIの応答形式が不正です。");
				const event = value as Record<string, unknown>;
				if (event.type === "progress" && typeof event.text === "string") progress(event.text);
				else if (event.type === "result" && typeof event.text === "string" && typeof event.ok === "boolean") {
					if (event.ok) answer = event.text;
					else failure = new Error(event.text);
				} else throw new Error("外部CLIの応答形式が不正です。");
			} catch (error) {
				failure = error instanceof Error ? error : new Error(String(error));
				child.kill();
			}
		};
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			timer.refresh();
			pending += chunk;
			if (pending.length > 16 * 1024 * 1024) {
				failure = new Error("外部CLIの応答が大きすぎます。");
				child.kill();
				return;
			}
			let end: number;
			while ((end = pending.indexOf("\n")) >= 0) {
				consume(pending.slice(0, end));
				pending = pending.slice(end + 1);
			}
		});
		child.stderr.on("data", () => timer.refresh());
		child.stdin.on("error", () => {});
		child.once("error", (error) => { clearTimeout(timer); reject(error); });
		child.once("close", (code) => {
			clearTimeout(timer);
			consume(pending);
			if (failure) reject(failure);
			else if (code !== 0 || !answer?.trim()) reject(new Error("外部CLIの最終回答を取得できませんでした。"));
			else resolve(answer);
		});
		child.stdin.end(JSON.stringify(request));
	});
}

/** CLI区分をPiのモデル選択へ登録する。外部CLIもPiの会話・JSONイベント経路で扱う。 */
export function registerCliProviders(pi: ExtensionAPI, root: string, models: Record<string, Record<string, string>>): void {
	let cwd = process.cwd();
	pi.on("before_agent_start", async (_event, ctx) => { cwd = ctx.cwd; });
	for (const provider of CLI_PROVIDERS) {
		const entries = Object.entries(models[provider] ?? {});
		if (!entries.length) continue;
		const streamSimple: NonNullable<ProviderConfig["streamSimple"]> = (model, context, options): AssistantMessageEventStream => {
			const stream = createAssistantMessageEventStream();
			const output: AssistantMessage = {
				role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [],
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "pending", timestamp: Date.now(),
			};
			void (async () => {
				try {
					const history = context.messages.filter((message) => message.role !== "system").map((message) => {
						const text = typeof message.content === "string" ? message.content : message.content
							.filter((part) => part.type === "text").map((part) => part.text).join("\n");
						return `[${message.role}]\n${text}`;
					}).join("\n\n");
					let payload: unknown = { prompt: `以下はPiから委譲された会話です。最後のユーザー依頼を自身のツールで実行し、最終回答を返してください。\n\n${getCurrentSystemPrompt(context.messages)}\n\n${history}` };
					payload = await options?.onPayload?.(payload, model) ?? payload;
					if (!payload || typeof payload !== "object" || !("prompt" in payload) || typeof payload.prompt !== "string") {
						throw new Error("外部CLIへのプロンプト形式が不正です。");
					}
					stream.push({ type: "start", partial: output });
					output.content.push({ type: "thinking", thinking: "" });
					stream.push({ type: "thinking_start", contentIndex: 0, partial: output });
					const text = await runCli(root, { provider, model: model.id, project: cwd, prompt: payload.prompt }, options, (text) => {
						const part = output.content[0];
						if (part.type !== "thinking") return;
						const delta = text + "\n";
						part.thinking += delta;
						stream.push({ type: "thinking_delta", contentIndex: 0, delta, partial: output });
					});
					const part = output.content[0];
					stream.push({ type: "thinking_end", contentIndex: 0, content: part.type === "thinking" ? part.thinking : "", partial: output });
					output.content.push({ type: "text", text: "" });
					stream.push({ type: "text_start", contentIndex: 1, partial: output });
					output.content[1] = { type: "text", text };
					stream.push({ type: "text_delta", contentIndex: 1, delta: text, partial: output });
					stream.push({ type: "text_end", contentIndex: 1, content: text, partial: output });
					output.stopReason = "stop";
					stream.push({ type: "done", reason: "stop", message: output });
				} catch (error) {
					output.stopReason = options?.signal?.aborted ? "aborted" : "error";
					output.errorMessage = error instanceof Error ? error.message : String(error);
					stream.push({ type: "error", reason: output.stopReason, error: output });
				} finally { stream.end(); }
			})();
			return stream;
		};
		pi.registerProvider(provider, {
			name: `AiDiy ${provider}`, api: `aidiy-${provider}`, apiKey: "local-cli", baseUrl: "local://aidiy-cli",
			models: entries.map(([id, name]) => ({ id, name, reasoning: false, input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 32768 })),
			streamSimple,
		});
	}
}
