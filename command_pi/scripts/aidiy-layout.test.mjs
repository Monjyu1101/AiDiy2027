import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(resolve(root, name), "utf8");

test("AiDiy launch/setup inputs remain available", () => {
	for (const name of ["_setup.py", "_cleanup.py", "aidiy/aidiy_pi.ts", "aidiy/aidiy-providers.ts", "aidiy/aidiy-mode.ts", "aidiy/aidiy-oauth.ts", "aidiy/aidiy-cli.ts", "aidiy/aidiy-cli.py", "packages/coding-agent/src/cli.ts", "packages/coding-agent/src/experimental/source-resolver.ts", "packages/ai/scripts/hydrate-model-catalog.ts"]) {
		assert.ok(existsSync(resolve(root, name)), name);
	}
});

test("upstream developer auto-loads and Git hook installation are not bundled", () => {
	for (const name of [".pi", ".husky", "CONTRIBUTING.md", "pi-test.sh", "pi-test.ps1", "pi-test.bat"]) {
		assert.equal(existsSync(resolve(root, name)), false, name);
	}
	const pkg = JSON.parse(read("package.json"));
	const lock = JSON.parse(read("package-lock.json"));
	assert.equal(pkg.scripts.prepare, undefined);
	assert.equal(pkg.devDependencies.husky, undefined);
	assert.equal(lock.packages[""].devDependencies.husky, undefined);
	assert.equal(lock.packages["node_modules/husky"], undefined);
	assert.deepEqual(pkg.workspaces, lock.packages[""].workspaces);
	assert.ok(pkg.scripts["hydrate:model-data"]);
});

test("AiDiy entry documents retain valid local links and the MIT attribution", () => {
	for (const name of ["README.md", "AGENTS.md", "SECURITY.md"]) {
		const text = read(name);
		assert.match(text, /AiDiy/);
		for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) {
			if (/^https?:/.test(link)) continue;
			assert.ok(existsSync(resolve(root, link.split("#")[0])), `${name}: ${link}`);
		}
	}
	assert.match(read("LICENSE"), /MIT License/);
	assert.match(read("LICENSE"), /Copyright \(c\) 2025 Mario Zechner/);
	assert.doesNotMatch(read("_setup.py"), /pi-test\.(?:sh|ps1|bat)/);
});
