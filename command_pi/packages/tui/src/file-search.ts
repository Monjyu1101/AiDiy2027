import { lstat, opendir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

/** Node-only directory traversal shared by search tools and interactive completion. */
export interface SearchEntry {
	absolutePath: string;
	path: string;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}

export interface WalkSearchOptions {
	signal?: AbortSignal;
	maxDepth?: number;
	followSymlinks?: boolean;
	ignoreFiles?: string[];
	/** Explicit positive grep globs override ignore files, but never expose .git internals. */
	includeIgnored?: boolean;
	/** Completion is best effort; tools surface unreadable directories. */
	tolerateErrors?: boolean;
}

interface IgnoreLayer {
	root: string;
	matcher: Ignore;
	git: boolean;
}

export function checkSearchAbort(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("Operation aborted");
}

async function optionalText(file: string): Promise<string | undefined> {
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
		throw error;
	}
}

async function gitDirectory(directory: string): Promise<string | undefined> {
	const marker = path.join(directory, ".git");
	try {
		if ((await stat(marker)).isDirectory()) return marker;
		const text = await optionalText(marker);
		const target = text?.match(/^gitdir:\s*(.+)/m)?.[1];
		return target ? path.resolve(directory, target.trim()) : undefined;
	} catch (error) {
		if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
		throw error;
	}
}

export async function* walkSearchEntries(
	searchRoot: string,
	options: WalkSearchOptions = {},
): AsyncGenerator<SearchEntry> {
	const root = path.resolve(searchRoot);
	const ignoreFiles = options.ignoreFiles ?? [".gitignore", ".ignore"];
	const posix = (value: string) => value.split(path.sep).join("/");
	checkSearchAbort(options.signal);

	async function addLayer(layers: IgnoreLayer[], directory: string, file: string, git: boolean) {
		const text = await optionalText(file);
		if (text) layers.push({ root: directory, matcher: ignore({ ignorecase: false }).add(text), git });
	}

	async function layersFor(directory: string, inherited: IgnoreLayer[]): Promise<IgnoreLayer[]> {
		if (options.includeIgnored) return [];
		let layers = inherited.slice();
		const gitDir = await gitDirectory(directory);
		if (gitDir) {
			// A nested repository has its own git ignore scope. .ignore/.fdignore still apply.
			layers = layers.filter((layer) => !layer.git);
			await addLayer(
				layers,
				directory,
				path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "git", "ignore"),
				true,
			);
			const commonDir = await optionalText(path.join(gitDir, "commondir"));
			await addLayer(
				layers,
				directory,
				path.join(commonDir ? path.resolve(gitDir, commonDir.trim()) : gitDir, "info", "exclude"),
				true,
			);
		}
		for (const name of ignoreFiles) {
			await addLayer(layers, directory, path.join(directory, name), name === ".gitignore");
		}
		return layers;
	}

	function ignored(absolutePath: string, isDirectory: boolean, layers: IgnoreLayer[]): boolean {
		let excluded = false;
		// Non-git ignore files override git rules, then the closest directory wins.
		for (const git of [true, false]) {
			for (const layer of layers) {
				if (layer.git !== git) continue;
				const relative = posix(path.relative(layer.root, absolutePath));
				if (!relative || relative.startsWith("../")) continue;
				const result = layer.matcher.test(relative + (isDirectory ? "/" : ""));
				if (result.ignored) excluded = true;
				else if (result.unignored) excluded = false;
			}
		}
		return excluded;
	}

	// Include ignore rules above a subdirectory search, up to the repository boundary.
	const parents: string[] = [];
	for (let directory = root; ; directory = path.dirname(directory)) {
		parents.unshift(directory);
		if (await gitDirectory(directory)) break;
		if (path.dirname(directory) === directory) break;
	}
	let inherited: IgnoreLayer[] = [];
	for (const directory of parents.slice(0, -1)) inherited = await layersFor(directory, inherited);

	async function* visit(
		directory: string,
		layers: IgnoreLayer[],
		depth: number,
		ancestors: Set<string>,
	): AsyncGenerator<SearchEntry> {
		checkSearchAbort(options.signal);
		try {
			const canonical = await realpath(directory);
			if (ancestors.has(canonical)) return;
			const nextAncestors = new Set(ancestors).add(canonical);
			const localLayers = await layersFor(directory, layers);
			const entries = await opendir(directory);
			for await (const entry of entries) {
				checkSearchAbort(options.signal);
				if (entry.name === ".git") continue;
				const absolutePath = path.join(directory, entry.name);
				const isSymbolicLink = entry.isSymbolicLink();
				let isDirectory = entry.isDirectory();
				if (isSymbolicLink && options.followSymlinks) {
					try {
						isDirectory = (await stat(absolutePath)).isDirectory();
					} catch (error) {
						if (["ENOENT", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
						throw error;
					}
				}
				if (ignored(absolutePath, isDirectory, localLayers)) continue;
				// FIFOs/devices are never opened by content search.
				if (!isDirectory && !isSymbolicLink && !entry.isFile()) continue;
				yield {
					absolutePath,
					path: posix(path.relative(root, absolutePath)) + (isDirectory ? "/" : ""),
					isDirectory,
					isSymbolicLink,
				};
				if (isDirectory && depth < (options.maxDepth ?? Infinity)) {
					yield* visit(absolutePath, localLayers, depth + 1, nextAncestors);
				}
			}
		} catch (error) {
			checkSearchAbort(options.signal);
			if (!options.tolerateErrors) throw error;
		}
	}
	if (!(await lstat(root)).isDirectory() && !(await stat(root)).isDirectory())
		throw new Error(`Not a directory: ${root}`);
	yield* visit(root, inherited, 1, new Set());
}
