// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import type { Message, Tool, ToolCall } from "../packages/ai/src/types.ts";

export type CliMode = "chat" | "passthrough";
export type ChatMessage = { role: string; content: string | null; tool_call_id?: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] };
export type CliAnswer = { content: string; toolCalls: ToolCall[] };

/** Preserve call/result IDs. Unsupported modalities fail rather than silently losing context. */
export function chatPayload(messages: Message[], systemPrompt: string, tools: Tool[]) {
	const result: ChatMessage[] = [{ role: "system", content: systemPrompt }];
	for (const message of messages) {
		if (message.role === "system") continue;
		if (Array.isArray(message.content) && message.content.some((part) => part.type === "image")) {
			throw new Error("CLI chat は画像入力に未対応です。");
		}
		const content = typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
		if (message.role === "toolResult") result.push({ role: "tool", tool_call_id: message.toolCallId, content: message.isError ? `[tool error]\n${content}` : content });
		else if (message.role === "assistant") {
			const calls = message.content.filter((part) => part.type === "toolCall").map((part) => ({ id: part.id, type: "function" as const, function: { name: part.name, arguments: JSON.stringify(part.arguments) } }));
			result.push({ role: "assistant", content: content || null, ...(calls.length ? { tool_calls: calls } : {}) });
		} else result.push({ role: "user", content });
	}
	return { messages: result, tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) };
}

export function parseChatAnswer(value: unknown, allowedTools: string[]): CliAnswer {
	if (!value || typeof value !== "object") throw new Error("CLI chat の応答が不正です。");
	const message = value as Record<string, unknown>;
	if (message.role !== "assistant" || (message.content !== null && typeof message.content !== "string")) throw new Error("CLI chat の応答が不正です。");
	if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) throw new Error("CLI chat のツール要求が不正です。");
	const ids = new Set<string>();
	const toolCalls: ToolCall[] = [];
	for (const item of (message.tool_calls ?? []) as Record<string, unknown>[]) {
		const fn = item?.function as Record<string, unknown> | undefined;
		if (item?.type !== "function" || typeof item.id !== "string" || !item.id || ids.has(item.id) || !fn || typeof fn.name !== "string" || !allowedTools.includes(fn.name) || typeof fn.arguments !== "string") throw new Error("CLI chat のツール要求が不正です。");
		const args = JSON.parse(fn.arguments);
		if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("CLI chat のツール引数が不正です。");
		ids.add(item.id);
		toolCalls.push({ type: "toolCall", id: item.id, name: fn.name, arguments: args });
	}
	if (!String(message.content ?? "").trim() && !toolCalls.length) throw new Error("CLI chat の応答が空です。");
	return { content: String(message.content ?? ""), toolCalls };
}
