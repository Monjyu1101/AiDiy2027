import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import "../packages/coding-agent/src/experimental/source-resolver.ts";
const { createGrepToolDefinition } = await import("../packages/coding-agent/src/core/tools/grep.ts");
const { createFindToolDefinition } = await import("../packages/coding-agent/src/core/tools/find.ts");
const { CombinedAutocompleteProvider } = await import("../packages/tui/src/autocomplete.ts");
const { walkSearchEntries } = await import("../packages/tui/src/file-search.ts");

const root = await mkdtemp(path.join(tmpdir(), "aidiy-node-search-"));
// Workers inherit this preload too: an attempted download or external executable fails the tests.
const guard = path.join(root, "no-external.mjs");
await writeFile(guard, `import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = () => { throw new Error('External process forbidden: ' + key); };
syncBuiltinESMExports();
globalThis.fetch = () => { throw new Error('Network forbidden'); };
`);
const originalExecArgv = process.execArgv.slice();
process.execArgv.push("--import", new URL("../packages/coding-agent/src/experimental/source-resolver.ts", import.meta.url).href, "--import", pathToFileURL(guard).href);
await import(pathToFileURL(guard).href);
after(async () => {
	process.execArgv.splice(0, process.execArgv.length, ...originalExecArgv);
	assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
	assert.ok(path.basename(root).startsWith("aidiy-node-search-"));
	await rm(root, { recursive: true, force: true });
});

async function fixture(name, files) {
	const directory = path.join(root, name);
	await mkdir(directory, { recursive: true });
	for (const [name, contents] of Object.entries(files)) {
		const file = path.join(directory, name);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, contents);
	}
	return directory;
}
const text = (result) => result.content[0].text;
const grep = (directory, input, signal) => createGrepToolDefinition(directory).execute("check", input, signal);
const find = (directory, input, signal) => createFindToolDefinition(directory).execute("check", input, signal);

test("grep: Japanese, regex, literal, case and CRLF line numbers", async () => {
	const dir = await fixture("grep", { "日本語 空白.txt": "前\r\n日本語 Foo.bar\r\nFOOXBAR\r\n後\r\n" });
	assert.equal(text(await grep(dir, { pattern: "日本語" })), "日本語 空白.txt:2: 日本語 Foo.bar");
	assert.equal(text(await grep(dir, { pattern: "foo.bar", ignoreCase: true, literal: true })), "日本語 空白.txt:2: 日本語 Foo.bar");
	assert.equal(text(await grep(dir, { pattern: "^FOO.BAR$" })), "日本語 空白.txt:3: FOOXBAR");
	assert.equal(text(await grep(dir, { pattern: "absent" })), "No matches found");
	await assert.rejects(grep(dir, { pattern: "[" }), /Invalid JavaScript regular expression/);
});

test("grep: merged context and exact/overflow limits", async () => {
	const dir = await fixture("context", { "a.txt": "before\nhit\nhit\nafter\nend\n" });
	const exact = await grep(dir, { pattern: "hit", context: 1, limit: 2 });
	assert.equal(text(exact), "a.txt-1- before\na.txt:2: hit\na.txt:3: hit\na.txt-4- after");
	assert.equal(exact.details, undefined);
	const limited = await grep(dir, { pattern: "hit", context: 2, limit: 1 });
	assert.match(text(limited), /a.txt:2: hit\na.txt-3- hit\na.txt-4- after/);
	assert.equal(limited.details.matchLimitReached, 1);
	assert.doesNotMatch(text(limited), /a.txt-5-/);
});

test("grep: line and byte truncation retain truthful totals", async () => {
	const dir = await fixture("truncation", { "a.txt": Array(150).fill("hit" + "あ".repeat(600)).join("\n") });
	const result = await grep(dir, { pattern: "hit", limit: 200 });
	assert.equal(result.details.linesTruncated, true);
	assert.equal(result.details.truncation.truncatedBy, "bytes");
	assert.equal(result.details.truncation.totalLines, 150);
	assert.ok(result.details.truncation.totalBytes > 50 * 1024);
});

test("grep: binary exclusion, UTF-16 BOM and no-final-newline", async () => {
	const dir = await fixture("encoding", {
		"binary.bin": Buffer.from("hit\0hit"),
		"utf16.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("日本語 hit\r\n", "utf16le")]),
		"last.txt": "hit",
	});
	const result = text(await grep(dir, { pattern: "hit" }));
	assert.doesNotMatch(result, /binary/);
	assert.match(result, /utf16.txt:1: 日本語 hit/);
	assert.match(result, /last.txt:1: hit/);
});

test("find and grep: nested ignore, negation, hidden files, .git exclusion", async () => {
	const dir = await fixture("ignore", {
		".git/info/exclude": "excluded.txt\n",
		".git/secret": "hit",
		".gitignore": "*.log\nignored/\n",
		".hidden.txt": "hit",
		"excluded.txt": "hit",
		"ignored/a.txt": "hit",
		"sub/.gitignore": "!keep.log\n",
		"sub/drop.log": "hit",
		"sub/keep.log": "hit",
	});
	const result = text(await grep(dir, { pattern: "hit" }));
	assert.match(result, /\.hidden.txt/);
	assert.match(result, /sub\/keep.log/);
	assert.doesNotMatch(result, /drop.log|excluded.txt|ignored|secret/);
	assert.equal(text(await find(dir, { pattern: "*.log" })), "sub/keep.log");
	assert.equal(text(await find(path.join(dir, "sub"), { pattern: "*.log" })), "keep.log");
	assert.match(text(await grep(dir, { pattern: "hit", glob: "ignored/*.txt" })), /ignored\/a.txt/);
});

test("find: repo boundaries and tool-specific ignore files", async () => {
	const dir = await fixture("boundaries", {
		".git/HEAD": "", ".gitignore": "*.log\n", ".fdignore": "fd.txt\n", ".rgignore": "rg.txt\n",
		"fd.txt": "hit", "rg.txt": "hit", "outer.log": "hit", "nested/.git/HEAD": "", "nested/inner.log": "hit",
	});
	const found = text(await find(dir, { pattern: "*" }));
	assert.doesNotMatch(found, /fd.txt|outer.log/);
	assert.match(found, /rg.txt/);
	assert.match(found, /nested\/inner.log/);
	const result = text(await grep(dir, { pattern: "hit" }));
	assert.match(result, /fd.txt/);
	assert.doesNotMatch(result, /rg.txt|outer.log/);
});

test("find: basename/path globs, smart case, braces and directory results", async () => {
	const dir = await fixture("glob", { "src/Alpha.ts": "hit", "src/b.js": "hit", "pkg/src/c.ts": "hit", ".hidden.ts": "hit" });
	assert.equal(text(await find(dir, { pattern: "./src/*.ts" })), "src/Alpha.ts");
	assert.equal(text(await find(dir, { pattern: "alpha.ts" })), "src/Alpha.ts");
	assert.equal(text(await find(dir, { pattern: "ALPHA.ts" })), "No files found matching pattern");
	assert.equal(text(await find(dir, { pattern: "src/*.{ts,js}" })).split("\n").length, 2);
	assert.match(text(await find(dir, { pattern: "*.ts" })), /\.hidden.ts/);
	assert.match(text(await find(dir, { pattern: "src" })), /src\//);
	assert.doesNotMatch(text(await grep(dir, { pattern: "hit", glob: "src/*.ts" })), /pkg/);
	assert.doesNotMatch(text(await grep(dir, { pattern: "hit", glob: "!*.ts" })), /\.ts/);
	if (process.platform === "win32") assert.equal(text(await find(dir, { pattern: "src\\*.ts" })), "src/Alpha.ts");
});

test("find: exact/overflow limits and extension operations", async () => {
	const dir = await fixture("limits", { "a.txt": "", "b.txt": "" });
	assert.equal((await find(dir, { pattern: "*.txt", limit: 2 })).details, undefined);
	assert.equal((await find(dir, { pattern: "*.txt", limit: 1 })).details.resultLimitReached, 1);
	const custom = createFindToolDefinition(dir, { operations: { exists: () => true, glob: () => [path.join(dir, "remote.txt")] } });
	assert.equal(text(await custom.execute("check", { pattern: "*" })), "remote.txt");
});

test("search: missing paths, pre-abort and running regex cancellation", async () => {
	const dir = await fixture("abort", { "slow.txt": "a".repeat(100_000) + "!" });
	await assert.rejects(find(dir, { pattern: "*", path: "missing" }), /Path not found/);
	await assert.rejects(grep(dir, { pattern: "a", path: "missing" }), /Path not found/);
	const aborted = AbortSignal.abort();
	await assert.rejects(find(dir, { pattern: "*" }, aborted), /aborted/);
	await assert.rejects(grep(dir, { pattern: "a" }, aborted), /aborted/);
	const controller = new AbortController();
	const pending = grep(dir, { pattern: "(a+)+$" }, controller.signal);
	const timer = setTimeout(() => controller.abort(), 750);
	try { await assert.rejects(pending, /aborted/); }
	finally { clearTimeout(timer); }
});

test("completion: recursive matches, ignored directories, spaces and no fd argument", async () => {
	const dir = await fixture("completion", { ".gitignore": "ignored/\n", "ignored/needle.txt": "", "src/needle file.txt": "" });
	const provider = new CombinedAutocompleteProvider([], dir);
	const result = await provider.getSuggestions(["@needle"], 0, 7, { signal: new AbortController().signal });
	assert.equal(result.items.length, 1);
	assert.equal(result.items[0].value, '@"src/needle file.txt"');
	assert.equal(await provider.getSuggestions(["@needle"], 0, 7, { signal: AbortSignal.abort() }), null);
});

test("completion: following a directory symlink cannot recurse forever", async () => {
	const dir = await fixture("links", { "a/needle.txt": "" });
	await symlink(dir, path.join(dir, "a", "loop"), process.platform === "win32" ? "junction" : "dir");
	const entries = [];
	for await (const entry of walkSearchEntries(dir, { followSymlinks: true })) entries.push(entry.path);
	assert.equal(entries.filter((value) => value.endsWith("needle.txt")).length, 1);
	assert.ok(entries.length <= 3);
});

test("startup and search sources contain no managed executable download path", async () => {
	const base = new URL("../", import.meta.url);
	for (const file of ["packages/coding-agent/src/modes/interactive/interactive-mode.ts", "packages/coding-agent/src/core/tools/grep.ts", "packages/coding-agent/src/core/tools/find.ts", "packages/tui/src/autocomplete.ts"]) {
		assert.doesNotMatch(await readFile(new URL(file, base), "utf8"), /ensureTool|tools-manager/, file);
	}
	await assert.rejects(readFile(new URL("packages/coding-agent/src/utils/tools-manager.ts", base)), { code: "ENOENT" });
});
