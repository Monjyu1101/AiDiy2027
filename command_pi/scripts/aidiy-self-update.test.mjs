import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import {
	getConfiguredSelfUpdateArgv,
	getSelfUpdateCommand,
	SELF_UPDATE_DISABLED_MESSAGE,
	SELF_UPDATE_ENABLED,
} from "../packages/coding-agent/src/config.ts";
import {
	checkForNewPiVersion,
	getLatestPiRelease,
	getLatestPiVersion,
} from "../packages/coding-agent/src/utils/version-check.ts";

// Exercise the real parser and command handler with isolated dependencies. Model catalog
// JSON is generated during setup and is deliberately not needed by these regression tests.
const source = stripTypeScriptTypes(
	readFileSync(new URL("../packages/coding-agent/src/package-manager-cli.ts", import.meta.url), "utf8"),
)
	.replace(/^import[\s\S]*?;\s*$/gm, "")
	.replace(/^export /gm, "");

function commandHarness() {
	const messages = [];
	const state = { exitCode: undefined, cwd: () => "isolated-test-project" };
	const unexpected = () => { throw new Error("Unexpected side effect"); };
	const context = {
		APP_NAME: "pi", CONFIG_DIR_NAME: ".pi", SELF_UPDATE_ENABLED, SELF_UPDATE_DISABLED_MESSAGE,
		chalk: new Proxy({}, { get: () => (text) => text }),
		console: { log: (text) => messages.push(text), error: (text) => messages.push(text) },
		process: state,
		SettingsManager: { create: () => { throw new Error("EXTENSION_SETTINGS_REACHED"); } },
		ModelRuntime: { create: async () => { throw new Error("MODEL_REFRESH_REACHED"); } },
		getAgentDir: () => "isolated-test-agent",
		join: (...parts) => parts.join("/"),
		AbortController, Error, setTimeout, clearTimeout,
		fetch: unexpected, spawnProcess: unexpected, spawnProcessSync: unexpected,
		getConfiguredSelfUpdateArgv: unexpected, getSelfUpdateCommand: unexpected,
	};
	const { handlePackageCommand } = vm.runInNewContext(`${source}\n;({ handlePackageCommand });`, context);
	return { handlePackageCommand, state, messages };
}

test("all self-update aliases are rejected before settings, network or commands", async () => {
	for (const args of [
		["update"], ["update", "--self"], ["update", "self"], ["update", "pi"],
		["update", "--force"], ["update", "--self", "--force"], ["update", "--all"],
		["update", "--all", "--force"], ["update", "--self", "--extensions"],
		["update", "self", "--extensions"],
	]) {
		const h = commandHarness();
		assert.equal(await h.handlePackageCommand(args), true, args.join(" "));
		assert.equal(h.state.exitCode, 1, args.join(" "));
		assert.ok(h.messages.includes(SELF_UPDATE_DISABLED_MESSAGE), args.join(" "));
	}
});

test("environment and settings cannot enable self-update", (t) => {
	const previous = process.env.PI_SELF_UPDATE_COMMAND;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_SELF_UPDATE_COMMAND;
		else process.env.PI_SELF_UPDATE_COMMAND = previous;
	});
	process.env.PI_SELF_UPDATE_COMMAND = "should-never-run --update";
	assert.equal(SELF_UPDATE_ENABLED, false);
	assert.equal(getConfiguredSelfUpdateArgv(["also-never-run"]), undefined);
	assert.equal(getSelfUpdateCommand("@earendil-works/pi-coding-agent", ["should-never-run"]), undefined);
});

test("version checks perform no fetch and produce no update notification", async (t) => {
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Network forbidden"); });
	assert.equal(await getLatestPiRelease("0.0.0", { retry: true }), undefined);
	assert.equal(await getLatestPiVersion("0.0.0"), undefined);
	assert.equal(await checkForNewPiVersion("0.0.0"), undefined);
	assert.equal(calls, 0);
});

test("extension update routes remain available", async () => {
	for (const args of [
		["update", "--extensions"], ["update", "--extension", "npm:example"], ["update", "npm:example"],
	]) {
		const h = commandHarness();
		await assert.rejects(h.handlePackageCommand(args), /EXTENSION_SETTINGS_REACHED/);
		assert.ok(!h.messages.includes(SELF_UPDATE_DISABLED_MESSAGE));
	}
});

test("model refresh route remains available", async () => {
	const h = commandHarness();
	await h.handlePackageCommand(["update", "--models"]);
	assert.ok(h.messages.some((message) => message.includes("MODEL_REFRESH_REACHED")));
	assert.ok(!h.messages.includes(SELF_UPDATE_DISABLED_MESSAGE));
});

test("update help explains the disabled operation without executing it", async () => {
	const h = commandHarness();
	assert.equal(await h.handlePackageCommand(["update", "--help"]), true);
	assert.equal(h.state.exitCode, undefined);
	assert.match(h.messages.join("\n"), /本体の自己更新は無効/);
	assert.match(h.messages.join("\n"), /--extensions/);
	assert.match(h.messages.join("\n"), /--models/);
});
