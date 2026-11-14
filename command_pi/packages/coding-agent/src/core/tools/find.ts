import { checkSearchAbort, walkSearchEntries } from "@earendil-works/pi-tui";
import { Minimatch } from "minimatch";
import path from "path";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { pathExists, resolveToCwd } from "./path-utils.ts";
import { findRenderers } from "./renderers/find.ts";
import { type TypeBoxAgentTool, wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "./truncate.ts";

/** Relativize a find result against the search root and normalize it to posix separators. */
export function relativizeFindResultPath(
	resultPath: string,
	searchPath: string,
	pathModule: path.PlatformPath = path,
): string {
	const hadTrailingSeparator =
		resultPath.endsWith(pathModule.sep) || (pathModule.sep === "\\" && resultPath.endsWith("/"));
	const relativePath = pathModule.isAbsolute(resultPath) ? pathModule.relative(searchPath, resultPath) : resultPath;
	const posixPath = relativePath.split(pathModule.sep).join("/");
	return hadTrailingSeparator && !posixPath.endsWith("/") ? `${posixPath}/` : posixPath;
}

const findSchema = Type.Object({
	pattern: Type.String({
		description:
			"Glob pattern relative to the search directory, e.g. 'src/**/*.ts'. Without '/', e.g. '*.ts', it matches file names at any depth",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

export const findToolSystemPromptContribution = {
	snippet: "Find files by glob pattern (respects .gitignore)",
	guidelines: [],
} as const;

export type FindToolInput = Static<typeof findSchema>;

const DEFAULT_LIMIT = 1000;

export interface FindToolDetails {
	truncation?: TruncationResult;
	resultLimitReached?: number;
}

/**
 * Pluggable operations for the find tool.
 * Override these to delegate file search to remote systems (for example SSH).
 */
export interface FindOperations {
	/** Check if path exists */
	exists: (absolutePath: string) => Promise<boolean> | boolean;
	/** Find files matching glob pattern. Returns relative or absolute paths. */
	glob: (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => Promise<string[]> | string[];
}

export interface FindToolOptions {
	/** Custom operations for find. Default: local filesystem and Node.js search */
	operations?: FindOperations;
}

export function createFindToolDefinition(
	cwd: string,
	options?: FindToolOptions,
): ToolDefinition<typeof findSchema, FindToolDetails | undefined> {
	const customOps = options?.operations;
	return {
		name: "find",
		label: "find",
		description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
		promptSnippet: findToolSystemPromptContribution.snippet,
		parameters: findSchema,
		async execute(
			_toolCallId,
			{ pattern, path: searchDir, limit }: { pattern: string; path?: string; limit?: number },
			signal?: AbortSignal,
			_onUpdate?,
			ctx?: ExtensionContext,
		) {
			checkSearchAbort(signal);
			const searchPath = resolveToCwd(searchDir || ".", ctx?.cwd || cwd);
			const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit!)) : DEFAULT_LIMIT;
			if (!(await (customOps?.exists ?? pathExists)(searchPath))) throw new Error(`Path not found: ${searchPath}`);
			const results: string[] = [];
			let count = 0;
			let outputBytes = 0;
			let resultLimitReached = false;
			const add = (value: string) => {
				checkSearchAbort(signal);
				if (count === effectiveLimit) {
					resultLimitReached = true;
					return false;
				}
				const relative = relativizeFindResultPath(value, searchPath);
				if (outputBytes - 1 <= DEFAULT_MAX_BYTES) results.push(relative);
				outputBytes += Buffer.byteLength(relative, "utf8") + 1;
				count++;
				return true;
			};
			if (customOps?.glob) {
				const found = await customOps.glob(pattern, searchPath, {
					ignore: ["**/node_modules/**", "**/.git/**"],
					limit: effectiveLimit + 1,
				});
				checkSearchAbort(signal);
				for (const value of found) if (!add(value)) break;
			} else {
				const normalized = (process.platform === "win32" ? pattern.replaceAll("\\", "/") : pattern).replace(
					/^(?:\.\/)+/,
					"",
				);
				const matcher = new Minimatch(normalized.replace(/\/\*\*$/, "/**/*"), {
					dot: true,
					noext: true,
					nonegate: true,
					nocomment: true,
					nocase: normalized === normalized.toLowerCase(),
					matchBase: !normalized.includes("/"),
				});
				for await (const entry of walkSearchEntries(searchPath, {
					signal,
					ignoreFiles: [".gitignore", ".ignore", ".fdignore"],
				})) {
					const candidate = path.isAbsolute(normalized)
						? entry.absolutePath.split(path.sep).join("/")
						: entry.path.replace(/\/$/, "");
					if (matcher.match(candidate) && !add(entry.path)) break;
				}
			}
			checkSearchAbort(signal);
			if (count === 0)
				return { content: [{ type: "text", text: "No files found matching pattern" }], details: undefined };
			const truncation = {
				...truncateHead(results.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER }),
				totalLines: count,
				totalBytes: outputBytes - 1,
			};
			let output = truncation.content;
			const details: FindToolDetails = {};
			const notices: string[] = [];
			if (resultLimitReached) {
				notices.push(
					`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
				);
				details.resultLimitReached = effectiveLimit;
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
				details.truncation = truncation;
			}
			if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
			return {
				content: [{ type: "text", text: output }],
				details: Object.keys(details).length > 0 ? details : undefined,
			};
		},
		...findRenderers,
	};
}

export function createFindTool(cwd: string, options?: FindToolOptions): TypeBoxAgentTool<typeof findSchema> {
	return wrapToolDefinition(createFindToolDefinition(cwd, options));
}
