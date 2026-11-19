// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../packages/coding-agent/src/experimental/source-resolver.ts";
const { registerCliProviders } = await import("../aidiy/aidiy-cli.ts");

const skip = process.platform === "win32";
async function fixture(run, { readOnly = false, hang = false } = {}) {
	const root = mkdtempSync(join(tmpdir(), "pi-cli-delegate-"));
	try {
		const bin = join(root, "backend_tools/.venv/bin");
		mkdirSync(bin, { recursive: true });
		writeFileSync(join(bin, "python"), `#!/bin/sh
echo invoked >> calls.txt
cat > request.json
cat answer.json
${hang ? "exec sleep 30" : ""}
`, { mode: 0o700 });
		let config, before;
		registerCliProviders({
			on(_name, callback) { before = callback; },
			registerProvider(_name, value) { config = value; },
		}, root, { copilot_cli: { same: "same" } }, readOnly);
		await before({}, { cwd: root });
		const model = { id: "same", api: "aidiy-copilot_cli", provider: "copilot_cli" };
		const context = { messages: [
			{ role: "system", content: "outer instructions", toolsAdded: [{ name: "read", description: "read", parameters: { type: "object" } }], timestamp: 0 },
			{ role: "user", content: "昨日の更新ファイルを確認して報告", timestamp: 0 },
		] };
		const answer = (events) => writeFileSync(join(root, "answer.json"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
		const request = () => JSON.parse(readFileSync(join(root, "request.json"), "utf8"));
		const calls = () => existsSync(join(root, "calls.txt")) ? readFileSync(join(root, "calls.txt"), "utf8").trim().split("\n").length : 0;
		await run({ config, model, context, root, answer, request, calls });
	} finally { rmSync(root, { recursive: true, force: true }); }
}

test("external CLI runs once, returns text verbatim and never turns JSON into Pi tool calls", { skip }, async () => {
	await fixture(async ({ config, model, context, root, answer, request, calls }) => {
		const text = '説明\n{"content":"","tool_calls":[{"name":"read","arguments":{"path":"README.md"}}]}\n完了';
		answer([{ type: "progress", text: "調査中" }, { type: "result", ok: true, text }]);
		const events = [];
		for await (const event of config.streamSimple(model, context, {})) events.push(event);
		assert.equal(events.at(-1).message.stopReason, "stop");
		assert.equal(events.at(-1).message.content.at(-1).text, text);
		assert.ok(events.some((event) => event.type === "thinking_delta" && event.delta === "調査中\n"));
		assert.ok(!events.some((event) => event.type.startsWith("toolcall")));
		const sent = request();
		assert.deepEqual(Object.keys(sent).sort(), ["mode", "model", "project", "prompt", "provider"]);
		assert.equal(sent.provider, "copilot_cli");
		assert.equal(sent.model, "same");
		assert.equal(sent.project, root);
		assert.equal(sent.mode, "yolo");
		assert.match(sent.prompt, /outer instructions/);
		assert.match(sent.prompt, /昨日の更新ファイルを確認して報告/);
		assert.equal(calls(), 1);
	});
});

test("read-only is sent to the delegated CLI, including with a modified prompt", { skip }, async () => {
	await fixture(async ({ config, model, context, answer, request, calls }) => {
		answer([{ type: "result", ok: true, text: "done" }]);
		const final = await config.streamSimple(model, context, {
			onPayload: (payload) => ({ prompt: payload.prompt + "\n追記", mode: "yolo", tools: [] }),
		}).result();
		assert.equal(final.content.at(-1).text, "done");
		assert.equal(calls(), 1);
		assert.equal(request().mode, "read-only");
		assert.match(request().prompt, /追記$/);
		assert.equal("tools" in request(), false);
	}, { readOnly: true });
});

test("failed or invalid transport replies are errors and never trigger a retry", { skip }, async () => {
	for (const [{ expected }, event] of [
		[{ expected: /authentication failed/ }, { type: "result", ok: false, text: "authentication failed" }],
		[{ expected: /応答形式/ }, { type: "unknown" }],
		[{ expected: /応答形式/ }, { type: "result", ok: true, text: "   " }],
	]) await fixture(async ({ config, model, context, answer, calls }) => {
		answer([event]);
		const final = await config.streamSimple(model, context, {}).result();
		assert.equal(final.stopReason, "error");
		assert.match(final.errorMessage, expected);
		assert.equal(calls(), 1);
	});
});

test("abort stops a delegated launch and does not emit a final answer", { skip }, async () => {
	await fixture(async ({ config, model, context, answer, calls }) => {
		answer([{ type: "progress", text: "待機中" }]);
		const controller = new AbortController();
		const events = [];
		for await (const event of config.streamSimple(model, context, { signal: controller.signal, timeoutMs: 3000 })) {
			events.push(event);
			if (event.type === "thinking_delta") controller.abort();
		}
		assert.equal(events.at(-1).error.stopReason, "aborted");
		assert.ok(!events.some((event) => event.type === "done"));
		assert.equal(calls(), 1);
	}, { hang: true });
});
