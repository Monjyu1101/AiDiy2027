import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { walkSearchEntries } from "@earendil-works/pi-tui";
import { Minimatch } from "minimatch";
import { DEFAULT_MAX_BYTES, truncateLine } from "../core/tools/truncate.ts";

export interface NodeGrepOptions {
	searchPath: string;
	isDirectory: boolean;
	pattern: string;
	glob?: string;
	ignoreCase?: boolean;
	literal?: boolean;
	context: number;
	limit: number;
}

export interface NodeGrepResult {
	lines: string[];
	matchCount: number;
	matchLimitReached: boolean;
	linesTruncated: boolean;
	totalLines: number;
	totalBytes: number;
}

/** Decode incrementally; ignore binary data and recognize UTF-16 BOMs as ripgrep did. */
async function* textLines(file: string): AsyncGenerator<string> {
	const stream = createReadStream(file);
	let decoder: TextDecoder | undefined;
	let pending = "";
	let utf16 = false;
	try {
		for await (const chunk of stream) {
			const bytes = chunk as Buffer;
			if (!decoder) {
				utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
				decoder = new TextDecoder(utf16 ? (bytes[0] === 0xff ? "utf-16le" : "utf-16be") : "utf-8");
			}
			if (!utf16 && bytes.includes(0)) return;
			pending += decoder.decode(bytes, { stream: true });
			let start = 0;
			let newline = pending.indexOf("\n", start);
			while (newline !== -1) {
				yield pending.slice(start, newline).replace(/\r$/, "");
				start = newline + 1;
				newline = pending.indexOf("\n", start);
			}
			pending = pending.slice(start);
		}
		pending += decoder?.decode() ?? "";
		if (pending) yield pending;
	} finally {
		stream.destroy();
	}
}

async function search(options: NodeGrepOptions): Promise<NodeGrepResult> {
	const result: NodeGrepResult = {
		lines: [],
		matchCount: 0,
		matchLimitReached: false,
		linesTruncated: false,
		totalLines: 0,
		totalBytes: 0,
	};
	let regex: RegExp | undefined;
	if (!options.literal) {
		try {
			regex = new RegExp(options.pattern, options.ignoreCase ? "iu" : "u");
		} catch (error) {
			throw new Error(`Invalid JavaScript regular expression: ${(error as Error).message}`);
		}
	}
	const needle = options.ignoreCase ? options.pattern.toLowerCase() : options.pattern;
	const matches = (line: string) =>
		regex ? regex.test(line) : (options.ignoreCase ? line.toLowerCase() : line).includes(needle);
	const glob = options.glob?.replace(/^(!?)(?:\.\/)+/, "$1");
	const exclude = glob?.startsWith("!") ?? false;
	const globPattern = exclude ? glob!.slice(1) : glob;
	const matcher = globPattern
		? new Minimatch(globPattern, {
				dot: true,
				noext: true,
				nonegate: true,
				nocomment: true,
				matchBase: !globPattern.includes("/"),
			})
		: undefined;
	const accepts = (name: string) => !matcher || matcher.match(name) !== exclude;

	async function* files() {
		if (!options.isDirectory) {
			if (!(await stat(options.searchPath)).isFile()) throw new Error(`Not a regular file: ${options.searchPath}`);
			yield { absolutePath: options.searchPath, path: path.basename(options.searchPath) };
			return;
		}
		for await (const entry of walkSearchEntries(options.searchPath, {
			ignoreFiles: [".gitignore", ".ignore", ".rgignore"],
			includeIgnored: Boolean(matcher && !exclude),
		})) {
			if (!entry.isDirectory && !entry.isSymbolicLink && accepts(entry.path)) yield entry;
		}
	}

	function push(file: string, number: number, text: string, match: boolean) {
		const truncated = truncateLine(text);
		result.linesTruncated ||= truncated.wasTruncated;
		const line = match ? `${file}:${number}: ${truncated.text}` : `${file}-${number}- ${truncated.text}`;
		if (result.totalBytes - 1 <= DEFAULT_MAX_BYTES) result.lines.push(line);
		result.totalBytes += Buffer.byteLength(line, "utf8") + 1;
		result.totalLines++;
	}

	for await (const file of files()) {
		let number = 0;
		let lastEmitted = 0;
		let trailingEnd = 0;
		// Store only display-sized context lines; large files are never loaded in full.
		const before: Array<{ number: number; text: string; truncated: boolean }> = [];
		for await (const line of textLines(file.absolutePath)) {
			number++;
			const match = matches(line);
			if (match && result.matchCount < options.limit) {
				for (const previous of before) {
					if (previous.number <= lastEmitted) continue;
					result.linesTruncated ||= previous.truncated;
					push(file.path, previous.number, previous.text, false);
				}
				push(file.path, number, line, true);
				lastEmitted = number;
				result.matchCount++;
				trailingEnd = number + options.context;
			} else {
				if (number <= trailingEnd) {
					push(file.path, number, line, false);
					lastEmitted = number;
				}
				if (match) result.matchLimitReached = true;
			}
			if (result.matchLimitReached && number >= trailingEnd) break;
			if (options.context > 0 && result.matchCount < options.limit) {
				const display = truncateLine(line);
				before.push({ number, text: display.text, truncated: display.wasTruncated });
				if (before.length > options.context) before.shift();
			}
		}
		if (result.matchLimitReached) break;
	}
	result.totalBytes = Math.max(0, result.totalBytes - 1);
	return result;
}

// JS regexes can backtrack. A worker keeps the TUI responsive and can be terminated even
// while RegExp.test is running. It uses the current Node runtime, never an external exe.
export async function runNodeGrep(options: NodeGrepOptions, signal?: AbortSignal): Promise<NodeGrepResult> {
	if (signal?.aborted) throw new Error("Operation aborted");
	const worker = new Worker(new URL(import.meta.url), {
		workerData: { aidiyNodeGrep: options },
		// Forward module preloads (including the source resolver), not CLI/test/V8 flags.
		execArgv: process.execArgv.flatMap((argument, index, args) =>
			["--import", "--require", "-r", "--loader", "--experimental-loader"].includes(argument)
				? [argument, args[index + 1]!]
				: /^(?:--import|--require|--loader|--experimental-loader)=/.test(argument)
					? [argument]
					: [],
		),
	});
	let onAbort: () => void = () => {};
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await new Promise<NodeGrepResult>((resolve, reject) => {
			onAbort = () => reject(new Error("Operation aborted"));
			signal?.addEventListener("abort", onAbort, { once: true });
			if (signal?.aborted) onAbort();
			timer = setTimeout(
				() => reject(new Error("Search timed out after 60 seconds. Narrow the path or simplify the pattern.")),
				60_000,
			);
			worker.on("message", (message) => {
				if (message.type !== "aidiy-node-grep") return;
				if (message.error) reject(new Error(message.error));
				else resolve(message.result);
			});
			worker.once("error", reject);
			worker.once("exit", (code) => reject(new Error(`Search worker exited before returning results (${code})`)));
		});
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
		await worker.terminate();
	}
}

if (!isMainThread && workerData?.aidiyNodeGrep) {
	search(workerData.aidiyNodeGrep).then(
		(result) => parentPort?.postMessage({ type: "aidiy-node-grep", result }),
		(error) => parentPort?.postMessage({ type: "aidiy-node-grep", error: String(error.message ?? error) }),
	);
}
