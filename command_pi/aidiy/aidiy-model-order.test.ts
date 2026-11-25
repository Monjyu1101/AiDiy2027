import assert from "node:assert/strict";
import test from "node:test";
import { setAidiyModelOrder, sortAidiyModels } from "../packages/coding-agent/src/core/aidiy-model-order.ts";

test("AGY follows Antigravity in the Diag catalog, without inventing other candidates", () => {
	const models = [
		{ provider: "agy_cli", id: "alpha" },
		{ provider: "codex_cli", id: "same" },
		{ provider: "antigravity_cli", id: "same" },
		{ provider: "agy_cli", id: "same" },
	];
	assert.equal(sortAidiyModels(models)[0]?.provider, "agy_cli");
	setAidiyModelOrder(() => ({
		codex_cli: { same: "Keep" },
		antigravity_cli: { same: "Legacy" },
		agy_cli: { same: "Keep", alpha: "AGY", unregistered: "Not available" },
	}));
	assert.deepEqual(sortAidiyModels(models).map(({ provider, id }) => `${provider}/${id}`), [
		"codex_cli/same", "antigravity_cli/same", "agy_cli/same", "agy_cli/alpha",
	]);
});
