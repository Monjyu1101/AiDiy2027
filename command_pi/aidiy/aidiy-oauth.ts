// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
//
// AiDiy Pi: OAuth 資格情報を Hermes と同じ共有ログインから読む。
// - openai_oauth: Codex CLI の `${CODEX_HOME:-~/.codex}/auth.json`
// - xai_oauth   : Grok Build CLI の `${GROK_HOME:-~/.grok}/auth.json`
// 期限切れ（5分前）ならリフレッシュし、同じファイルへ書き戻す。トークンは表示・ログ出力しない。

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REFRESH_SKEW_MS = 5 * 60 * 1000;

// Pi 組込みの OpenAI Codex / xAI OAuth と同じクライアント（Codex CLI / Grok CLI と共通）。
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_ISSUER = "https://auth.x.ai";
const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const GROK_ENTRY_KEY = `${XAI_ISSUER}::${XAI_CLIENT_ID}`;

type Json = Record<string, unknown>;

export function codexAuthPath(): string {
	return join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "auth.json");
}

export function grokAuthPath(): string {
	return join(process.env.GROK_HOME?.trim() || join(homedir(), ".grok"), "auth.json");
}

function readJson(path: string): Json | undefined {
	if (!existsSync(path)) return undefined;
	const value: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

/** 一時ファイル経由で置き換える（途中で壊れたファイルを残さない）。 */
function writeJson(path: string, value: Json): void {
	const temporary = `${path}.tmp.${process.pid}.${Date.now()}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, path);
}

function jwtExpiryMs(token: string): number | undefined {
	try {
		const payload = token.split(".")[1];
		if (!payload) return undefined;
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
		return typeof claims.exp === "number" ? claims.exp * 1000 : undefined;
	} catch {
		return undefined;
	}
}

const fresh = (expiresMs: number | undefined) => expiresMs === undefined || expiresMs - Date.now() > REFRESH_SKEW_MS;

async function postToken(url: string, body: Record<string, string>, signal: AbortSignal | undefined, label: string) {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body: new URLSearchParams(body),
		signal,
	});
	if (!response.ok) {
		throw new Error(`${label} のトークン更新に失敗しました（HTTP ${response.status}）。ログインし直してください。`);
	}
	const json = (await response.json()) as Json;
	if (typeof json.access_token !== "string" || !json.access_token) {
		throw new Error(`${label} のトークン更新応答にアクセストークンがありません。`);
	}
	return json;
}

// 同時に複数の要求が来ても、更新は 1 回にまとめる。
let codexRefresh: Promise<string | undefined> | undefined;
let grokRefresh: Promise<string | undefined> | undefined;

/** OpenAI OAuth（ChatGPT サブスク）のアクセストークン。未ログインなら undefined。 */
export async function codexAccessToken(signal?: AbortSignal): Promise<string | undefined> {
	const data = readJson(codexAuthPath());
	const tokens = data?.tokens as Json | undefined;
	const access = typeof tokens?.access_token === "string" ? tokens.access_token : "";
	const refresh = typeof tokens?.refresh_token === "string" ? tokens.refresh_token : "";
	if (!access) return undefined;
	if (fresh(jwtExpiryMs(access)) || !refresh) return access;
	codexRefresh ??= (async () => {
		try {
			const body = await postToken(
				CODEX_TOKEN_URL,
				{ grant_type: "refresh_token", refresh_token: refresh, client_id: CODEX_CLIENT_ID },
				signal,
				"OpenAI OAuth（codex login）",
			);
			// 更新中に Codex CLI 側が書き換えた内容を消さないよう、読み直してから更新する。
			const latest = readJson(codexAuthPath()) ?? {};
			const latestTokens = { ...((latest.tokens as Json | undefined) ?? {}) };
			latestTokens.access_token = body.access_token;
			if (typeof body.refresh_token === "string" && body.refresh_token) latestTokens.refresh_token = body.refresh_token;
			if (typeof body.id_token === "string" && body.id_token) latestTokens.id_token = body.id_token;
			writeJson(codexAuthPath(), { ...latest, tokens: latestTokens, last_refresh: new Date().toISOString() });
			return body.access_token as string;
		} finally {
			codexRefresh = undefined;
		}
	})();
	return codexRefresh;
}

/** xAI OAuth（SuperGrok / X Premium+）のアクセストークン。未ログインなら undefined。 */
export async function grokAccessToken(signal?: AbortSignal): Promise<string | undefined> {
	const data = readJson(grokAuthPath());
	const entry = data?.[GROK_ENTRY_KEY] as Json | undefined;
	const access = typeof entry?.key === "string" ? entry.key : "";
	const refresh = typeof entry?.refresh_token === "string" ? entry.refresh_token : "";
	if (!access) return undefined;
	const stored = typeof entry?.expires_at === "string" ? Date.parse(entry.expires_at) : Number.NaN;
	const expires = Number.isFinite(stored) ? stored : jwtExpiryMs(access);
	if (fresh(expires) || !refresh) return access;
	grokRefresh ??= (async () => {
		try {
			const body = await postToken(
				XAI_TOKEN_URL,
				{ grant_type: "refresh_token", client_id: XAI_CLIENT_ID, refresh_token: refresh },
				signal,
				"xAI OAuth（grok login）",
			);
			const latest = readJson(grokAuthPath()) ?? {};
			const next: Json = { ...((latest[GROK_ENTRY_KEY] as Json | undefined) ?? {}) };
			next.key = body.access_token;
			// xAI はローテーションしない場合 refresh_token を省略する。
			if (typeof body.refresh_token === "string" && body.refresh_token) next.refresh_token = body.refresh_token;
			const expiry = jwtExpiryMs(body.access_token as string);
			if (expiry) next.expires_at = new Date(expiry).toISOString().replace(/\.\d{3}Z$/, "Z");
			writeJson(grokAuthPath(), { ...latest, [GROK_ENTRY_KEY]: next });
			return body.access_token as string;
		} finally {
			grokRefresh = undefined;
		}
	})();
	return grokRefresh;
}

/** 起動時の初期モデル判定用。ファイルとトークンの有無だけを見る（通信しない）。 */
export function codexLoggedIn(): boolean {
	try {
		const tokens = readJson(codexAuthPath())?.tokens as Json | undefined;
		return typeof tokens?.access_token === "string" && tokens.access_token.length > 0;
	} catch {
		return false;
	}
}
