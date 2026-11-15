// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import assert from "node:assert/strict";
import test from "node:test";
import "../packages/coding-agent/src/experimental/source-resolver.ts";
const { aidiyModeExtension, aidiyModeArgs } = await import("../aidiy/aidiy-mode.ts");

test("read-only keeps Pi shell/write blocked while describing delegated read-only tools", async () => {
	const handlers = new Map();
	aidiyModeExtension({ registerFlag() {}, on(event, handler) { handlers.set(event, handler); } }, true);
	for (const toolName of ["bash", "write", "edit", "mcp_write"]) {
		assert.equal((await handlers.get("tool_call")({ toolName })).block, true);
	}
	for (const toolName of ["read", "grep", "find", "ls"]) {
		assert.equal(await handlers.get("tool_call")({ toolName }), undefined);
	}
	assert.equal((await handlers.get("user_bash")({})).result.exitCode, 1);
	const { systemPrompt } = await handlers.get("before_agent_start")({ systemPrompt: "user constraints" });
	assert.ok(systemPrompt.startsWith("user constraints"));
	assert.match(systemPrompt, /外部 CLI.*read-only/);
	assert.match(systemPrompt, /権限昇格/);
});

test("yolo never cancels explicit read-only", () => {
	const result = aidiyModeArgs(["--read-only", "--yolo", "--model", "codex_cli/gpt-6-luna"]);
	assert.equal(result.readOnly, true);
	assert.ok(result.args.includes("--no-mcp"));
	assert.equal(result.args.at(-1), "read,grep,find,ls");
});
