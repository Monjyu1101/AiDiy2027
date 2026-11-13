/*! COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027 */

// ../runtime/model_probe.ts
import { open, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import https2 from "node:https";
import http2 from "node:http";

// ../runtime/transport_limit.ts
var DIAG_TRANSPORT_BYTE_LIMIT = 20 * 1024 * 1024;

// ../runtime/environment_proxy.ts
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { isIP } from "node:net";
function proxyRoute(address, env = process.env) {
  const host = address.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host)) return null;
  const secure = address.protocol === "https:", port = address.port || (secure ? "443" : "80");
  for (const entry of (env.no_proxy || env.NO_PROXY || "").toLowerCase().split(/[,\s]+/).filter(Boolean)) {
    if (entry === "*") return null;
    const match = entry.match(/^(.+):(\d+)$/);
    if (match && match[2] !== port) continue;
    const name = match?.[1] || entry;
    if (name.startsWith(".") || name.startsWith("*")) {
      if (host.endsWith(name.replace(/^\*/, ""))) return null;
    } else if (host === name) return null;
  }
  const httpProxy = env.http_proxy || env.HTTP_PROXY || "";
  const value = secure ? env.https_proxy || env.HTTPS_PROXY || httpProxy : httpProxy;
  if (!value) return null;
  try {
    const proxy = new URL(value);
    if (!["http:", "https:"].includes(proxy.protocol) || proxy.pathname !== "/" || proxy.search || proxy.hash) throw Error();
    decodeURIComponent(proxy.username);
    decodeURIComponent(proxy.password);
    return proxy;
  } catch {
    throw new Error("proxy-config");
  }
}
var MetadataProxyAgent = class extends https.Agent {
  constructor(proxy) {
    super({ keepAlive: false, maxCachedSessions: 0 });
    this.proxy = proxy;
  }
  pending = /* @__PURE__ */ new Set();
  tunnels = /* @__PURE__ */ new Set();
  closed = false;
  createConnection(options, callback) {
    let complete = false;
    const done = (error, socket) => {
      if (complete) return;
      complete = true;
      callback?.(error, socket);
    };
    if (this.closed) {
      done(new Error("stopped"));
      return;
    }
    const hostname = String(options.hostname || options.host), authority = `${hostname}:${options.port || 443}`;
    const headers = { Host: authority };
    if (this.proxy.username || this.proxy.password) headers["Proxy-Authorization"] = "Basic " + Buffer.from(decodeURIComponent(this.proxy.username) + ":" + decodeURIComponent(this.proxy.password)).toString("base64");
    const transport = this.proxy.protocol === "https:" ? https : http;
    const request = transport.request({ hostname: this.proxy.hostname.replace(/^\[|\]$/g, ""), port: this.proxy.port || (this.proxy.protocol === "https:" ? 443 : 80), method: "CONNECT", path: authority, headers, agent: false, rejectUnauthorized: true });
    this.pending.add(request);
    request.once("close", () => this.pending.delete(request));
    request.once("error", (error) => done(error));
    request.once("connect", (response, socket, head) => {
      this.pending.delete(request);
      if (this.closed) {
        socket.destroy();
        done(new Error("stopped"));
        return;
      }
      if (response.statusCode !== 200) {
        socket.destroy();
        done(new Error(response.statusCode === 407 ? "proxy-auth" : "proxy-connect"));
        return;
      }
      if (head.length) {
        socket.destroy();
        done(new Error("proxy-connect"));
        return;
      }
      this.tunnels.add(socket);
      socket.once("close", () => this.tunnels.delete(socket));
      const secured = tls.connect({ socket, servername: isIP(hostname) ? void 0 : hostname, rejectUnauthorized: true });
      this.tunnels.add(secured);
      secured.once("close", () => this.tunnels.delete(secured));
      secured.once("error", (error) => {
        socket.destroy();
        done(error);
      });
      secured.once("secureConnect", () => done(null, secured));
    });
    request.end();
  }
  destroy() {
    this.closed = true;
    for (const request of this.pending) request.destroy();
    for (const socket of this.tunnels) socket.destroy();
    this.pending.clear();
    this.tunnels.clear();
    super.destroy();
  }
};
function networkFailure(error) {
  const code = error?.code || "";
  const message = error instanceof Error ? error.message : "";
  if (["proxy-config", "proxy-auth", "proxy-connect", "stopped"].includes(message)) return message;
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "dns";
  if (["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code)) return "tls";
  return "network";
}

// ../runtime/model_catalog.ts
var DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function safeRouterMetadata(value, secrets = []) {
  const source = value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  if (Object.hasOwn(source, "pricing")) {
    const raw = source.pricing;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > 64 || Object.keys(raw).some((key) => !/^[a-z][a-z0-9_]{0,63}$/.test(key))) out.pricing = null;
    else out.pricing = Object.fromEntries(Object.entries(raw).map(([key, price]) => [
      key,
      ["overrides", "pricing_overrides"].includes(key) && Array.isArray(price) && price.length === 0 ? [] : typeof price === "number" && Number.isFinite(price) ? price : typeof price === "string" && price.length <= 64 && DECIMAL.test(price) && !secrets.some((secret) => price.includes(secret)) ? price : null
    ]));
  }
  const architecture = source.architecture !== null && typeof source.architecture === "object" && !Array.isArray(source.architecture) ? source.architecture : {};
  for (const name of ["output_modalities", "supported_parameters"]) {
    const owner = Object.hasOwn(source, name) ? source : name === "output_modalities" ? architecture : {};
    if (!Object.hasOwn(owner, name)) continue;
    const values = owner[name];
    out[name] = Array.isArray(values) && values.length <= 100 && values.every((item) => typeof item === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(item) && !secrets.some((secret) => item.includes(secret))) ? [...values] : [];
  }
  return out;
}
var empty = () => /* @__PURE__ */ Object.create(null);
var pythonString = (value) => value === null || value === void 0 ? "None" : value === true ? "True" : value === false ? "False" : String(value);
function dateLabel(date) {
  if (!Number.isFinite(date.getTime())) throw new Error("date");
  return `${String(date.getFullYear()).padStart(4, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}
function cutoff(now, days) {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date.getTime() / 1e3;
}
function row(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
  return value;
}
function entries(body) {
  const items = row(body).data ?? [];
  if (!Array.isArray(items)) throw new Error("shape");
  return items;
}
function number(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("number");
  return value;
}
function string(value) {
  if (typeof value !== "string") throw new Error("string");
  return value;
}
function openrouterCatalog(body, now = /* @__PURE__ */ new Date()) {
  const out = empty();
  for (const entry of entries(body)) {
    const item = row(entry);
    const id = string(item.id ?? ""), provider = id.includes("/") ? id.split("/")[0].toLowerCase() : "";
    const days = provider === "perplexity" ? 365 : ["google", "openai", "anthropic", "x-ai"].includes(provider) ? 240 : 90;
    const created = number(Object.hasOwn(item, "created") ? item.created : 0);
    if (created < cutoff(now, days)) continue;
    out[id] = { model_id: id, \u30C8\u30FC\u30AF\u30F3\u6570: pythonString(Object.hasOwn(item, "context_length") ? item.context_length : 0), \u30E2\u30C0\u30EA\u30C6\u30A3: Object.hasOwn(row(Object.hasOwn(item, "architecture") ? item.architecture : {}), "modality") ? row(item.architecture).modality : "unknown", \u4F5C\u6210\u65E5: dateLabel(new Date(created * 1e3)), ...safeRouterMetadata(item) };
  }
  return out;
}
var GEMINI_CHAT_MODEL_ORDER = Object.freeze(["gemini-4-carbon", "gemini-4-argon", "gemini-4-hydrogen", "gemini-3.8-flash"]);
function googleCatalog(models, router = {}) {
  const out = empty();
  for (const model of models) {
    if (!model.supported_actions.includes("generateContent")) continue;
    const id = model.name.replaceAll("models/", "");
    out[id] = { model_id: id, \u30C8\u30FC\u30AF\u30F3\u6570: pythonString(Object.hasOwn(model, "input_token_limit") ? model.input_token_limit : 0), \u30E2\u30C0\u30EA\u30C6\u30A3: model.supported_actions.join(","), \u4F5C\u6210\u65E5: null };
  }
  if (Object.keys(router).length) for (const id of Object.keys(out)) {
    const key = `google/${id}`;
    if (Object.hasOwn(router, key)) out[id].\u4F5C\u6210\u65E5 = router[key].\u4F5C\u6210\u65E5;
    else if (!id.toLowerCase().includes("live") && !GEMINI_CHAT_MODEL_ORDER.includes(id)) delete out[id];
  }
  return out;
}
function openaiCatalog(models, router = {}, now = /* @__PURE__ */ new Date()) {
  const out = empty();
  for (const model of models) {
    if (model.created < cutoff(now, 240)) continue;
    out[model.id] = { model_id: model.id, \u30C8\u30FC\u30AF\u30F3\u6570: "0", \u30E2\u30C0\u30EA\u30C6\u30A3: null, \u4F5C\u6210\u65E5: dateLabel(new Date(model.created * 1e3)) };
  }
  if (Object.keys(router).length) for (const id of Object.keys(out)) {
    const key = `openai/${id}`;
    if (Object.hasOwn(router, key)) {
      out[id].\u30C8\u30FC\u30AF\u30F3\u6570 = router[key].\u30C8\u30FC\u30AF\u30F3\u6570;
      out[id].\u30E2\u30C0\u30EA\u30C6\u30A3 = router[key].\u30E2\u30C0\u30EA\u30C6\u30A3;
    }
    if (!id.toLowerCase().includes("realtime") && out[id].\u30C8\u30FC\u30AF\u30F3\u6570 === "0") delete out[id];
  }
  return out;
}
function claudeDate(value) {
  if (!value) return { timestamp: null, label: null };
  try {
    if (value instanceof Date) return { timestamp: value.getTime() / 1e3, label: dateLabel(value) };
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) throw new Error("date");
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error("date");
    const parsed = new Date(value.length === 10 ? value + "T00:00:00" : value);
    if (!Number.isFinite(parsed.getTime())) throw new Error("date");
    return { timestamp: parsed.getTime() / 1e3, label: value.slice(0, 10).replaceAll("-", "/") };
  } catch {
    return { timestamp: null, label: null };
  }
}
function claudeCatalog(models, router = {}, now = /* @__PURE__ */ new Date()) {
  const out = empty();
  for (const model of models.data) {
    const created = claudeDate(model.created_at);
    if (created.timestamp !== null && created.timestamp < cutoff(now, 240)) continue;
    out[model.id] = { model_id: model.id, \u30C8\u30FC\u30AF\u30F3\u6570: "0", \u30E2\u30C0\u30EA\u30C6\u30A3: null, \u4F5C\u6210\u65E5: created.label };
  }
  if (Object.keys(router).length) for (const id of Object.keys(out)) {
    let normalized = id;
    if (normalized.length >= 9 && normalized.slice(-9, -8) === "-" && normalized.slice(-8, -6) === "20") normalized = normalized.slice(0, -9);
    if (normalized.length >= 3 && normalized.at(-2) === "-" && ["3", "4", "5"].includes(normalized.at(-3)) && new RegExp("^\\p{Nd}$", "u").test(normalized.at(-1))) normalized = normalized.slice(0, -3) + normalized.at(-3) + "." + normalized.at(-1);
    const key = `anthropic/${normalized}`;
    if (Object.hasOwn(router, key)) {
      out[id].\u30C8\u30FC\u30AF\u30F3\u6570 = router[key].\u30C8\u30FC\u30AF\u30F3\u6570;
      out[id].\u30E2\u30C0\u30EA\u30C6\u30A3 = router[key].\u30E2\u30C0\u30EA\u30C6\u30A3;
    }
  }
  return out;
}
function ollamaCatalog(body, now = /* @__PURE__ */ new Date()) {
  const out = empty();
  const models = entries(body).filter((item) => item !== null && typeof item === "object" && !Array.isArray(item));
  models.sort((a, b) => number(b.created || 0) - number(a.created || 0));
  for (const model of models) {
    if (!model.id || !model.created || number(model.created) < cutoff(now, 240)) continue;
    const id = string(model.id);
    let label = "yyyy/mm/dd";
    try {
      label = dateLabel(new Date(Math.trunc(number(model.created)) * 1e3));
    } catch {
    }
    out[id] = { model_id: id, \u30C8\u30FC\u30AF\u30F3\u6570: "0", \u30E2\u30C0\u30EA\u30C6\u30A3: null, \u4F5C\u6210\u65E5: label };
  }
  return out;
}
function isRetiredOpenaiModel(id) {
  const slug = (id.trim().toLowerCase().split("/").at(-1) ?? "").replace(/^openai\./, "");
  return slug === "gpt-6-sol" || slug.startsWith("gpt-6-sol-") || slug.startsWith("gpt-6-sol.");
}
function withoutRetired(models) {
  const out = empty();
  for (const [id, model] of Object.entries(models)) if (!isRetiredOpenaiModel(id)) out[id] = model;
  return out;
}
var DEFAULT_CODEX_MODELS = Object.freeze(["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"]);
var OAUTH_FALLBACK_MODELS = Object.freeze(["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"]);
var FORWARD_COMPAT = [["gpt-6-astra", ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"]], ["gpt-6.1-sol", ["gpt-5.5", "gpt-5.4"]], ["gpt-6.1-terra", ["gpt-5.5", "gpt-5.4"]], ["gpt-6-luna", ["gpt-5.5", "gpt-5.4"]]];
function finalizeCodexModels(ids) {
  const ordered = [], seen = /* @__PURE__ */ new Set();
  for (const id of ids.filter((id2) => !isRetiredOpenaiModel(id2) && !/-900k$/i.test(id2))) if (!seen.has(id)) {
    ordered.push(id);
    seen.add(id);
  }
  for (const [synthetic, templates] of FORWARD_COMPAT) if (!seen.has(synthetic) && templates.some((template) => seen.has(template))) {
    ordered.push(synthetic);
    seen.add(synthetic);
  }
  return ordered;
}
function codexSlugs(body) {
  const items = row(body).models;
  if (!Array.isArray(items)) throw new Error("shape");
  const sortable = [];
  for (const entry of items) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry, slug = typeof item.slug === "string" ? item.slug.trim() : "";
    if (!slug) continue;
    if (typeof item.visibility === "string" && ["hide", "hidden"].includes(item.visibility.trim().toLowerCase())) continue;
    sortable.push([typeof item.priority === "number" && Number.isFinite(item.priority) ? Math.trunc(item.priority) : 1e4, slug]);
  }
  sortable.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return [...new Set(sortable.map(([, slug]) => slug))];
}
function idsCatalog(ids) {
  const out = empty();
  for (const id of ids) if (!isRetiredOpenaiModel(id) && !Object.hasOwn(out, id)) out[id] = { model_id: id, \u30C8\u30FC\u30AF\u30F3\u6570: null, \u30E2\u30C0\u30EA\u30C6\u30A3: null, \u4F5C\u6210\u65E5: null };
  return out;
}
function codexCatalog(body) {
  return idsCatalog(finalizeCodexModels(codexSlugs(body)));
}
function codexFallbackCatalog(defaultModel, cacheIds) {
  const ordered = [];
  for (const id of [...defaultModel ? [defaultModel] : [], ...cacheIds, ...DEFAULT_CODEX_MODELS]) if (!ordered.includes(id)) ordered.push(id);
  const ids = finalizeCodexModels(ordered);
  return idsCatalog(ids.length ? ids : OAUTH_FALLBACK_MODELS);
}
var GROK_CLI_MODELS = Object.freeze(["grok-4.7", "grok-4.6"]);
var LOCAL_CHAT_MODELS = Object.freeze(["google/gemma-4-E2B-it", "google/gemma-4-E4B-it", "google/gemma-4-E2B-it-qat-mobile-transformers", "google/gemma-4-E4B-it-qat-mobile-transformers"]);
function grokCatalog(body) {
  const source = row(body), list = Array.isArray(source.data) ? source.data : Array.isArray(source.models) ? source.models : null;
  if (!list) throw new Error("shape");
  const out = empty();
  for (const entry of list) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry, info = item.info !== null && typeof item.info === "object" && !Array.isArray(item.info) ? item.info : {};
    const id = [item.id, item.model, item.slug, info.id].find((value) => typeof value === "string" && !!value.trim())?.trim();
    if (!id || item.hidden === true || info.hidden === true || Object.hasOwn(out, id)) continue;
    const context = [item.context_window, item.context_length, info.context_window].find((value) => typeof value === "number");
    out[id] = { model_id: id, \u30C8\u30FC\u30AF\u30F3\u6570: typeof context === "number" ? String(context) : null, \u30E2\u30C0\u30EA\u30C6\u30A3: null, \u4F5C\u6210\u65E5: null };
  }
  return out;
}
function ollamaLocalCatalog(body) {
  const items = row(body).models;
  if (!Array.isArray(items)) throw new Error("shape");
  const rows = items.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item) && typeof item.name === "string" && !!item.name.trim());
  const time = (item) => {
    const value = Date.parse(String(item.modified_at ?? ""));
    return Number.isFinite(value) ? value : 0;
  };
  rows.sort((a, b) => time(b) - time(a));
  const out = empty();
  for (const item of rows) {
    const name = item.name.trim().split(/\s+/)[0];
    if (!Object.hasOwn(out, name)) out[name] = { model_id: name, \u30C8\u30FC\u30AF\u30F3\u6570: null, \u30E2\u30C0\u30EA\u30C6\u30A3: null, \u4F5C\u6210\u65E5: null };
  }
  return out;
}

// ../runtime/model_probe.ts
var CONFIG_LIMIT = 128 * 1024;
var RESPONSE_LIMIT = DIAG_TRANSPORT_BYTE_LIMIT;
var PUBLIC_RESPONSE_LIMIT = DIAG_TRANSPORT_BYTE_LIMIT;
var MODEL_CACHE_LIMIT = 1024 * 1024;
function connectionFailureDescription(error) {
  const reasons = { dns: "\u63A5\u7D9A\u5148\u307E\u305F\u306F\u30D7\u30ED\u30AD\u30B7\u306E\u540D\u524D\u89E3\u6C7A\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002", tls: "\u63A5\u7D9A\u5148\u307E\u305F\u306F\u30D7\u30ED\u30AD\u30B7\u306ETLS\u8A3C\u660E\u66F8\u3092\u691C\u8A3C\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002", network: "\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u3068\u30D7\u30ED\u30AD\u30B7\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "proxy-config": "HTTP_PROXY / HTTPS_PROXY \u306EURL\u8A2D\u5B9A\u304C\u7121\u52B9\u3067\u3059\u3002", "proxy-auth": "\u30D7\u30ED\u30AD\u30B7\u8A8D\u8A3C\u304C\u62D2\u5426\u3055\u308C\u307E\u3057\u305F\u3002", "proxy-connect": "\u30D7\u30ED\u30AD\u30B7\u304C\u63A5\u7D9A\u3092\u8A31\u53EF\u3057\u307E\u305B\u3093\u3067\u3057\u305F\u3002", auth: "HTTP\u8A8D\u8A3C\u307E\u305F\u306F\u30A2\u30AF\u30BB\u30B9\u6A29\u304C\u62D2\u5426\u3055\u308C\u307E\u3057\u305F\u3002", http: "\u6B63\u5E38\u306AHTTP\u5FDC\u7B54\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002", timeout: "\u901A\u4FE1\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F\u3002", stopped: "\u53D6\u5F97\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F\u3002", response: "\u53D7\u4FE1\u304C\u9014\u4E2D\u3067\u5207\u65AD\u3055\u308C\u307E\u3057\u305F\u3002", size: "\u53D7\u4FE1\u30B5\u30A4\u30BA\u304C\u4E0A\u9650\u3092\u8D85\u3048\u307E\u3057\u305F\u3002", json: "\u5FDC\u7B54\u3092JSON\u3068\u3057\u3066\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002", shape: "\u30E2\u30C7\u30EB\u30C7\u30FC\u30BF\u5F62\u5F0F\u304C\u60F3\u5B9A\u3068\u7570\u306A\u308A\u307E\u3059\u3002" };
  const reason = error instanceof Error ? error.message : "";
  return Object.hasOwn(reasons, reason) ? reasons[reason] : "\u30E2\u30C7\u30EB\u53D6\u5F97\u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002";
}
function publicFailureDescription(code) {
  if (typeof code === "string" && ["proxy-config", "proxy-auth", "proxy-connect", "auth"].includes(code)) return connectionFailureDescription(new Error(code));
  const reasons = { size: "\u516C\u958B\u4E00\u89A7\u306E\u53D7\u4FE1\u30B5\u30A4\u30BA\u304C\u4E0A\u9650\u3092\u8D85\u3048\u307E\u3057\u305F\u3002", output: "\u6574\u5F62\u3057\u305F\u516C\u958B\u4E00\u89A7\u304C\u51FA\u529B\u4E0A\u9650\u3092\u8D85\u3048\u307E\u3057\u305F\u3002", timeout: "\u516C\u958B\u4E00\u89A7\u306E\u901A\u4FE1\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F\u3002", dns: "\u516C\u958B\u4E00\u89A7\u30B5\u30FC\u30D0\u30FC\u307E\u305F\u306F\u30D7\u30ED\u30AD\u30B7\u306E\u540D\u524D\u89E3\u6C7A\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002", tls: "\u516C\u958B\u4E00\u89A7\u30B5\u30FC\u30D0\u30FC\u307E\u305F\u306F\u30D7\u30ED\u30AD\u30B7\u306ETLS\u8A3C\u660E\u66F8\u3092\u691C\u8A3C\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002", http: "\u516C\u958B\u4E00\u89A7\u30B5\u30FC\u30D0\u30FC\u304C\u6B63\u5E38\u306AHTTP\u5FDC\u7B54\u3092\u8FD4\u3057\u307E\u305B\u3093\u3067\u3057\u305F\u3002", json: "\u516C\u958B\u4E00\u89A7\u306E\u5FDC\u7B54\u3092JSON\u3068\u3057\u3066\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002", shape: "\u516C\u958B\u4E00\u89A7\u306E\u30C7\u30FC\u30BF\u5F62\u5F0F\u304C\u60F3\u5B9A\u3068\u7570\u306A\u308A\u307E\u3059\u3002", network: "\u516C\u958B\u4E00\u89A7\u30B5\u30FC\u30D0\u30FC\u3078\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u3084\u30D7\u30ED\u30AD\u30B7\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002", response: "\u516C\u958B\u4E00\u89A7\u306E\u53D7\u4FE1\u304C\u9014\u4E2D\u3067\u5207\u65AD\u3055\u308C\u307E\u3057\u305F\u3002", stopped: "\u516C\u958B\u4E00\u89A7\u306E\u53D6\u5F97\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F\u3002", busy: "\u5225\u306E\u30E2\u30C7\u30EB\u78BA\u8A8D\u304C\u5B9F\u884C\u4E2D\u3067\u3059\u3002" };
  return typeof code === "string" && Object.hasOwn(reasons, code) ? reasons[code] : "\u516C\u958B\u4E00\u89A7\u306E\u53D6\u5F97\u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002";
}
var CONFIG_PATH = fileURLToPath(new URL("../../_config/AiDiy_key.json", import.meta.url));
var KEY_PROVIDERS = Object.freeze([
  ["gemini", "Gemini", "gemini_key_id", "google"],
  ["freeai", "FreeAI\uFF08Gemini\uFF09", "freeai_key_id", "google"],
  ["claude", "Claude", "claude_key_id", "anthropic"],
  ["openai", "OpenAI API", "openai_key_id", "openai"],
  ["openai_oauth", "OpenAI OAuth", "~/.codex/auth.json", "codex"],
  ["grok", "Grok\uFF08xAI\uFF09", "~/.grok/auth.json", "grok"],
  ["azure", "Azure OpenAI", "azure_key_id", null],
  ["copilot", "GitHub Copilot", "copilot_key_id", null],
  ["openrt_chat", "OpenRouter", "openrt_key_id", "openrouter"],
  ["ollama", "Ollama\uFF08\u30ED\u30FC\u30AB\u30EB\uFF09", "ollama list", "ollama-local"],
  ["local", "\u30ED\u30FC\u30AB\u30EB\uFF08backend_local\uFF09", "\u56FA\u5B9A\u5019\u88DC", "local-fixed"],
  ["huggingface_read", "Hugging Face \u8AAD\u53D6", "huggingface_key_read", "huggingface"],
  ["huggingface_write", "Hugging Face \u66F8\u8FBC", "huggingface_key_write", "huggingface"],
  ["discord", "Discord Bot", "discord_bot_token", "discord"],
  ["slack", "Slack Bot", "slack_bot_token", "slack"]
].map(([id, \u540D\u524D, \u30AD\u30FC\u540D, probe2]) => Object.freeze({ id, \u540D\u524D, \u30AD\u30FC\u540D, probe: probe2, oauth: probe2 === "codex" || probe2 === "grok" ? probe2 : null })));
var SECRET_CONFIG_KEYS = Object.freeze(["gemini_key_id", "freeai_key_id", "claude_key_id", "openai_key_id", "azure_key_id", "copilot_key_id", "openrt_key_id", "ollama_key_id", "huggingface_key_read", "huggingface_key_write", "discord_bot_token", "slack_bot_token", "slack_app_token", "openai_organization"]);
var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
async function readLimited(file, limit = CONFIG_LIMIT) {
  const before = await stat(file);
  if (!before.isFile() || before.size > limit) throw new Error("file");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error("file");
    const bytes = Buffer.alloc(limit + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    return bytes.subarray(0, total);
  } finally {
    await handle.close();
  }
}
function parseJson(raw, limit = CONFIG_LIMIT) {
  const bytes = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw);
  if (bytes.length > limit) throw new Error("size");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""));
  if (!record(value)) throw new Error("shape");
  return value;
}
async function readConfig(reader) {
  try {
    return ["\u8AAD\u8FBC\u6E08\u307F", parseJson(reader ? await reader(CONFIG_PATH) : await readLimited(CONFIG_PATH))];
  } catch (error) {
    return [error?.code === "ENOENT" ? "\u672A\u4F5C\u6210" : "\u8AAD\u8FBC\u4E0D\u53EF", {}];
  }
}
function oauthPath(kind, env = process.env, home = os.homedir()) {
  return kind === "codex" ? path.join(env.CODEX_HOME?.trim() || path.join(home, ".codex"), "auth.json") : path.join(home, ".grok", "auth.json");
}
function jwtClaims(token) {
  try {
    const value = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return record(value) ? value : {};
  } catch {
    return {};
  }
}
async function readOAuth(kind, reader) {
  try {
    const value = parseJson(reader ? await reader(kind) : await readLimited(oauthPath(kind)));
    if (kind === "codex") {
      const tokens = value.tokens;
      if (!record(tokens) || typeof tokens.access_token !== "string" || !tokens.access_token.trim()) return null;
      const token = tokens.access_token.trim(), claims = jwtClaims(token), auth = record(claims["https://api.openai.com/auth"]) ? claims["https://api.openai.com/auth"] : {};
      const account = [tokens.account_id, auth.chatgpt_account_id].find((v) => typeof v === "string" && !!v.trim())?.trim() ?? null;
      return { token, account, expiresAt: typeof claims.exp === "number" ? claims.exp * 1e3 : null };
    }
    for (const [issuer, entry] of Object.entries(value)) {
      if (!issuer.startsWith("https://auth.x.ai") || !record(entry) || typeof entry.key !== "string" || !entry.key.trim()) continue;
      const expires = Date.parse(String(entry.expires_at ?? ""));
      return { token: entry.key.trim(), account: null, expiresAt: Number.isFinite(expires) ? expires : null };
    }
    return null;
  } catch {
    return null;
  }
}
var OAUTH_CLI = { codex: "codex", grok: "grok" };
async function readCodexLocal(reader, env = process.env, home = os.homedir()) {
  const folder = path.dirname(oauthPath("codex", env, home)), read = async (name) => reader ? await reader(name) : await readLimited(path.join(folder, name), MODEL_CACHE_LIMIT);
  let defaultModel = null, cacheIds = [];
  try {
    const text = Buffer.from(await read("config.toml")).toString("utf8"), top = text.split(/^\s*\[/m)[0];
    const match = /^\s*model\s*=\s*(["'])([^"'\r\n]+)\1/m.exec(top);
    if (match && match[2].trim()) defaultModel = match[2].trim();
  } catch {
  }
  try {
    cacheIds = codexSlugs(parseJson(await read("models_cache.json"), MODEL_CACHE_LIMIT));
  } catch {
  }
  return { defaultModel, cacheIds };
}
var INTEGRATION_PROBES = Object.freeze(["huggingface", "discord", "slack"]);
function configured(value, id) {
  return typeof value === "string" && (id !== "slack" || value.trim().length > 1 && !/\s/.test(value.trim())) && !!value.trim() && !value.trim().startsWith("<") && !(id === "ollama" && value.trim().toLowerCase() === "ollama");
}
async function status({ reader, oauthReader } = {}) {
  const [state, values] = await readConfig(reader);
  const oauth = { codex: !!await readOAuth("codex", oauthReader), grok: !!await readOAuth("grok", oauthReader) };
  return { \u8A2D\u5B9A\u72B6\u614B: state, \u9805\u76EE: KEY_PROVIDERS.map((p) => {
    if (p.probe === "local-fixed") return { id: p.id, \u540D\u524D: p.\u540D\u524D, \u30AD\u30FC\u540D: p.\u30AD\u30FC\u540D, \u8A2D\u5B9A\u6E08\u307F: null, \u30AD\u30FC\u4E0D\u8981: true, \u30ED\u30FC\u30AB\u30EB: true, \u72B6\u614B: "\u672A\u5B9F\u65BD", \u7406\u7531: "", \u30C6\u30B9\u30C8\u53EF\u80FD: true, \u8AAC\u660E: "\u672C\u4F53\u3068\u540C\u3058\u56FA\u5B9A\u5019\u88DC\uFF08CHAT_LOCAL_MODELS\uFF09\u3092\u4F7F\u3044\u307E\u3059\uFF08API \u53D6\u5F97\u306A\u3057\uFF09\u3002" };
    if (p.probe === "ollama-local") return { id: p.id, \u540D\u524D: p.\u540D\u524D, \u30AD\u30FC\u540D: p.\u30AD\u30FC\u540D, \u8A2D\u5B9A\u6E08\u307F: null, \u30AD\u30FC\u4E0D\u8981: true, \u30ED\u30FC\u30AB\u30EB: true, \u72B6\u614B: "\u672A\u5B9F\u65BD", \u7406\u7531: "", \u30C6\u30B9\u30C8\u53EF\u80FD: true, \u8AAC\u660E: "\u672C\u4F53\u3068\u540C\u3058\u304F\u3001\u30ED\u30FC\u30AB\u30EB\u306E Ollama\uFF08ollama list \u3068\u540C\u3058\u4E00\u89A7\uFF09\u3092\u78BA\u8A8D\u3057\u307E\u3059\u3002\u30AD\u30FC\u306F\u4F7F\u3044\u307E\u305B\u3093\u3002" };
    if (p.oauth) {
      const present2 = oauth[p.oauth];
      return { id: p.id, \u540D\u524D: p.\u540D\u524D, \u30AD\u30FC\u540D: p.\u30AD\u30FC\u540D, \u8A2D\u5B9A\u6E08\u307F: present2, \u30AD\u30FC\u4E0D\u8981: false, \u72B6\u614B: "\u672A\u5B9F\u65BD", \u7406\u7531: present2 ? "" : `\u30ED\u30B0\u30A4\u30F3\u60C5\u5831\u304C\u3042\u308A\u307E\u305B\u3093\u3002${OAUTH_CLI[p.oauth]} CLI \u3067\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002`, \u30C6\u30B9\u30C8\u53EF\u80FD: present2, \u8AAC\u660E: "\u30ED\u30B0\u30A4\u30F3\u60C5\u5831\uFF08OAuth\uFF09\u306E\u6709\u7121\u306E\u307F\u3002\u63A5\u7D9A\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002" };
    }
    const present = state === "\u8AAD\u8FBC\u4E0D\u53EF" ? null : configured(values[p.\u30AD\u30FC\u540D], p.id);
    const reason = state === "\u8AAD\u8FBC\u4E0D\u53EF" ? "\u8A2D\u5B9A\u3092\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093\u3002" : !present ? "\u30AD\u30FC\u304C\u672A\u8A2D\u5B9A\u3067\u3059\u3002" : !p.probe ? "\u3053\u306E\u9805\u76EE\u306E\u63A5\u7D9A\u30C6\u30B9\u30C8\u306F\u672A\u5BFE\u5FDC\u3067\u3059\u3002" : "";
    return { id: p.id, \u540D\u524D: p.\u540D\u524D, \u30AD\u30FC\u540D: p.\u30AD\u30FC\u540D, \u8A2D\u5B9A\u6E08\u307F: present, \u30AD\u30FC\u4E0D\u8981: false, \u72B6\u614B: "\u672A\u5B9F\u65BD", \u7406\u7531: reason, \u30C6\u30B9\u30C8\u53EF\u80FD: state !== "\u8AAD\u8FBC\u4E0D\u53EF" && !!p.probe && !!present, \u8AAC\u660E: p.id === "openrt_chat" ? "\u8A2D\u5B9A\u30AD\u30FC\u3092\u78BA\u8A8D\u3057\u3001\u516C\u958B\u30E2\u30C7\u30EB\u4E00\u89A7\u30AD\u30E3\u30C3\u30B7\u30E5\u304B\u3089\u5019\u88DC\u3092\u8868\u793A\u3057\u307E\u3059\u3002" : INTEGRATION_PROBES.includes(p.probe) ? "\u8A2D\u5B9A\u6709\u7121\u306E\u307F\u3002\u63A5\u7D9A\u306F\u30C6\u30B9\u30C8\u3067\u78BA\u8A8D\u3057\u307E\u3059\uFF08\u8AAD\u307F\u53D6\u308A\u5C02\u7528\u306E\u8A8D\u8A3C\u78BA\u8A8D\uFF09\u3002" : "\u8A2D\u5B9A\u6709\u7121\u306E\u307F\u3002\u63A5\u7D9A\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002" };
  }), \u30E2\u30C7\u30EB: [] };
}
var LOCAL_ENDPOINTS = { "ollama-local": ["127.0.0.1", 11434, "/api/tags"] };
var ENDPOINTS = { codex: ["chatgpt.com", "/backend-api/codex/models?client_version=1.0.0"], grok: ["cli-chat-proxy.grok.com", "/v1/models"], google: ["generativelanguage.googleapis.com", "/v1beta/models"], anthropic: ["api.anthropic.com", "/v1/models"], openai: ["api.openai.com", "/v1/models"], openrouter: ["openrouter.ai", "/api/v1/models"], "openrouter-key": ["openrouter.ai", "/api/v1/key"], ollama: ["ollama.com", "/v1/models"], huggingface: ["huggingface.co", "/api/whoami-v2"], discord: ["discord.com", "/api/v10/users/@me"], slack: ["slack.com", "/api/auth.test"] };
var fetchMetadata = (provider, headers, pageToken, signal) => new Promise((resolve, reject) => {
  const local = LOCAL_ENDPOINTS[provider], endpoint = local ? [local[0], local[2]] : ENDPOINTS[provider];
  if (!endpoint) return reject(new Error("provider"));
  let pathname = endpoint[1];
  if (pageToken) {
    if (provider !== "google" || typeof pageToken !== "string" || pageToken.length > 4096) return reject(new Error("pagination"));
    pathname += "?" + new URLSearchParams({ pageToken });
  }
  if (signal?.aborted) return reject(new Error("stopped"));
  const responseLimit = provider === "openrouter" && Object.keys(headers).length === 0 ? PUBLIC_RESPONSE_LIMIT : RESPONSE_LIMIT;
  let settled = false, size = 0;
  const chunks = [];
  let agent, request, incoming;
  try {
    const proxy = local ? null : proxyRoute(new URL(`https://${endpoint[0]}`));
    if (proxy) agent = new MetadataProxyAgent(proxy);
  } catch (error) {
    return reject(new Error(networkFailure(error)));
  }
  const respond = (response) => {
    incoming = response;
    if (settled) {
      response.destroy();
      return;
    }
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
      return finish(new Error([401, 403].includes(response.statusCode ?? 0) ? "auth" : "http"));
    }
    response.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > responseLimit) return finish(new Error("size"));
      chunks.push(chunk);
    });
    response.on("error", () => finish(new Error("response")));
    response.on("aborted", () => finish(new Error("response")));
    response.on("end", () => {
      if (settled) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!record(body)) return finish(new Error("shape"));
        finish(void 0, body);
      } catch {
        finish(new Error("json"));
      }
    });
  };
  const cancel = () => finish(new Error("stopped"));
  const timer = setTimeout(() => finish(new Error("timeout")), local ? 1e4 : 8e3);
  function finish(error, value) {
    if (settled) return;
    settled = true;
    chunks.length = 0;
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    incoming?.destroy();
    request?.destroy();
    agent?.destroy();
    if (error) reject(error);
    else resolve(value);
  }
  try {
    request = local ? http2.request({ hostname: local[0], port: local[1], path: pathname, method: "GET", agent: false, headers: { Accept: "application/json", ...headers } }, respond) : https2.request({ hostname: endpoint[0], path: pathname, port: 443, method: provider === "slack" ? "POST" : "GET", agent: agent ?? false, rejectUnauthorized: true, headers: { Accept: "application/json", ...headers } }, respond);
    signal?.addEventListener("abort", cancel, { once: true });
    request.on("error", (error) => finish(new Error(networkFailure(error))));
    request.end();
  } catch (error) {
    finish(new Error(networkFailure(error)));
  }
});
function secretValues(values) {
  return SECRET_CONFIG_KEYS.map((name) => values[name]).filter((value) => configured(value, "")).map((value) => value.trim());
}
function safeDetails(models, secrets, limit = 500) {
  const result = [];
  for (const [id, entry] of Object.entries(models)) {
    if (!/^~?[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,199}$/.test(id) || !record(entry)) continue;
    const values = { ...entry, model_id: id }, cleaned = {};
    for (const name of ["model_id", "\u4F5C\u6210\u65E5", "\u30C8\u30FC\u30AF\u30F3\u6570", "\u30E2\u30C0\u30EA\u30C6\u30A3"]) {
      const value = values[name];
      let val = value == null ? null : pythonString(value);
      if (val !== null && (val.length > 512 || secrets.some((secret) => val.includes(secret)))) val = null;
      cleaned[name] = val;
    }
    if (cleaned.model_id !== null) result.push({ ...cleaned, ...safeRouterMetadata(entry, secrets) });
  }
  return limit === null ? result : result.slice(0, limit);
}
function validatedCache(cache) {
  if (!record(cache) || cache.\u516C\u958B\u72B6\u614B !== "\u53D6\u5F97\u6E08" || !record(cache.\u516C\u958B\u30E2\u30C7\u30EB) || Object.values(cache.\u516C\u958B\u30E2\u30C7\u30EB).some((value) => !record(value))) return [{}, false];
  return [Object.fromEntries(safeDetails(cache.\u516C\u958B\u30E2\u30C7\u30EB, [], null).map((item) => [item.model_id, item])), true];
}
async function publicCatalog({ fetch = fetchMetadata, now, signal } = {}) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const body = await fetch("openrouter", {}, void 0, signal);
    if (!Array.isArray(body.data)) throw new Error("shape");
    const details = safeDetails(openrouterCatalog(body, now), [], null);
    const result = { \u72B6\u614B: "OK", \u516C\u958B\u30E2\u30C7\u30EB: Object.fromEntries(details.map((item) => [item.model_id, item])), \u78BA\u8A8D\u65E5\u6642: timestamp, \u8AAC\u660E: "\u516C\u958BOpenRouter\u4E00\u89A7\u306E\u533F\u540D\u53D6\u5F97\u6210\u529F\u3002\u30AD\u30FC\u306E\u6709\u52B9\u6027\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002" };
    if (Buffer.byteLength(JSON.stringify(result)) > RESPONSE_LIMIT) throw new Error("output");
    return result;
  } catch (error) {
    const candidate = error instanceof Error ? error.message : "";
    const code = ["size", "output", "timeout", "dns", "tls", "http", "auth", "proxy-config", "proxy-auth", "proxy-connect", "json", "network", "response", "stopped"].includes(candidate) ? candidate : "shape";
    return { \u72B6\u614B: "NG", \u516C\u958B\u30E2\u30C7\u30EB: {}, \u78BA\u8A8D\u65E5\u6642: timestamp, \u5931\u6557\u7406\u7531: code, \u8AAC\u660E: publicFailureDescription(code) };
  }
}
var ROUTER_PROOF = Symbol.for("aidiy.diag.openrouter-proof");
var DECISIONS_PROOF = Symbol.for("aidiy.diag.decisions-proof");
function decisionResult(result, id, models, valid) {
  return Object.defineProperty(result, DECISIONS_PROOF, { value: async (selected, reader, oauthReader) => selected === id && await valid(reader, oauthReader) ? models.map((row2) => ({ ...row2 })) : [] });
}
function authenticatedRouterResult(result, key) {
  return Object.defineProperty(result, ROUTER_PROOF, { value: async (reader) => {
    const [state, values] = await readConfig(reader);
    return state === "\u8AAD\u8FBC\u6E08\u307F" && configured(values.openrt_key_id, "openrt_chat") && values.openrt_key_id.trim() === key;
  } });
}
async function probe(id, { reader, oauthReader, codexLocalReader, fetch = fetchMetadata, now, cache, signal } = {}) {
  const output = { id, \u72B6\u614B: "\u672A\u5B9F\u65BD", \u8AAC\u660E: "\u672A\u5BFE\u5FDC\u306E\u9805\u76EE\u3067\u3059\u3002", \u30E2\u30C7\u30EB: [], \u30E2\u30C7\u30EB\u8A73\u7D30: [], \u78BA\u8A8D\u65E5\u6642: null, \u8B66\u544A: [] };
  const selected = KEY_PROVIDERS.find((row2) => row2.id === id);
  if (!selected?.probe) return output;
  if (selected.oauth) {
    const kind = selected.oauth, cli = OAUTH_CLI[kind], credential = await readOAuth(kind, oauthReader);
    if (!credential) return { ...output, \u8AAC\u660E: `\u30ED\u30B0\u30A4\u30F3\u60C5\u5831\u304C\u3042\u308A\u307E\u305B\u3093\u3002${cli} CLI \u3067\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002` };
    const timestamp2 = (/* @__PURE__ */ new Date()).toISOString(), expired = credential.expiresAt !== null && credential.expiresAt <= (now ?? /* @__PURE__ */ new Date()).getTime();
    const expiredNote = `\u30ED\u30B0\u30A4\u30F3\u60C5\u5831\u306E\u6709\u52B9\u671F\u9650\u304C\u5207\u308C\u3066\u3044\u307E\u3059\u3002${cli} CLI \u3092\u8D77\u52D5\u3057\u3066\u518D\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u8A3A\u65AD\u306F\u30C8\u30FC\u30AF\u30F3\u3092\u66F4\u65B0\u3057\u307E\u305B\u3093\uFF09\u3002`;
    try {
      const headers = { Authorization: "Bearer " + credential.token, "User-Agent": "aidiy-diag" };
      if (credential.account) headers["ChatGPT-Account-Id"] = credential.account;
      const body = await fetch(kind, headers, void 0, signal);
      const details = safeDetails(kind === "codex" ? codexCatalog(body) : grokCatalog(body), [credential.token, ...credential.account ? [credential.account] : []]);
      const result = { ...output, \u72B6\u614B: "OK", \u30E2\u30C7\u30EB: details.map((item) => item.model_id), \u30E2\u30C7\u30EB\u8A73\u7D30: details, \u78BA\u8A8D\u65E5\u6642: timestamp2, \u8B66\u544A: expired ? [expiredNote] : [], \u8AAC\u660E: "OAuth \u306E\u30ED\u30B0\u30A4\u30F3\u60C5\u5831\u3067\u30E2\u30C7\u30EB\u4E00\u89A7\u3092\u53D6\u5F97\u3057\u307E\u3057\u305F\u3002\u751F\u6210\u53EF\u5426\u30FB\u5229\u7528\u4E0A\u9650\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002", \u4E00\u89A7\u7BC4\u56F2: kind === "codex" ? "\u672C\u4F53\uFF08get_codex_model_ids\uFF09\u3068\u540C\u3058\u304F\u3001\u975E\u8868\u793A\u30FB\u5EC3\u6B62\u30E2\u30C7\u30EB\u3092\u9664\u3044\u3066\u512A\u5148\u5EA6\u9806\u306B\u4E26\u3079\u3001\u5C06\u6765\u7248\u3092\u88DC\u5B8C\u3057\u3001\u6A19\u6E96\u30E2\u30C7\u30EB\u540D\u3060\u3051\u3092\u8868\u793A\u3002\u8868\u793A\u306F\u6700\u5927500\u4EF6\u3002" : "\u672C\u4F53\u306B API \u4E00\u89A7\u306E\u7D5E\u308A\u8FBC\u307F\u306F\u7121\u3044\u305F\u3081\u3001\u975E\u8868\u793A\u30E2\u30C7\u30EB\u3060\u3051\u3092\u9664\u5916\u3002\u8868\u793A\u306F\u6700\u5927500\u4EF6\u3002" };
      return kind !== "codex" ? result : decisionResult(result, id, safeDetails(idsCatalog(codexSlugs(body)), [credential.token, ...credential.account ? [credential.account] : []]), async (_reader, currentOAuthReader) => {
        const current = await readOAuth(kind, currentOAuthReader);
        return current?.token === credential.token && current?.account === credential.account;
      });
    } catch (error) {
      const fallback = kind === "codex" ? await readCodexLocal(codexLocalReader).then((local) => codexFallbackCatalog(local.defaultModel, local.cacheIds)) : idsCatalog(GROK_CLI_MODELS);
      const details = safeDetails(fallback, [credential.token, ...credential.account ? [credential.account] : []]);
      const reason = expired ? expiredNote : "OAuth \u306E\u30E2\u30C7\u30EB\u4E00\u89A7\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002" + connectionFailureDescription(error);
      return { ...output, \u72B6\u614B: kind === "grok" ? "PASS" : "NG", \u8AAC\u660E: kind === "grok" ? `\u672C\u4F53\u3068\u540C\u3058\u56FA\u5B9A\u5019\u88DC\uFF08${GROK_CLI_MODELS.join(" / ")}\uFF09\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002API \u4E00\u89A7\u306F\u672A\u53D6\u5F97: ${reason}` : reason, \u78BA\u8A8D\u65E5\u6642: timestamp2, \u30E2\u30C7\u30EB: details.map((item) => item.model_id), \u30E2\u30C7\u30EB\u8A73\u7D30: details, \u8B66\u544A: [kind === "codex" ? "API \u304B\u3089\u53D6\u5F97\u3067\u304D\u306A\u3044\u305F\u3081\u3001\u672C\u4F53\u3068\u540C\u3058\u4EE3\u66FF\u5019\u88DC\uFF08~/.codex \u306E config.toml\u30FBmodels_cache.json\u30FB\u65E2\u5B9A\u5024\uFF09\u3092\u8868\u793A\u3057\u3066\u3044\u307E\u3059\u3002" : "API \u304B\u3089\u53D6\u5F97\u3067\u304D\u306A\u3044\u305F\u3081\u3001\u672C\u4F53\u3068\u540C\u3058\u56FA\u5B9A\u5019\u88DC\uFF08Grok Build CLI \u306E grok-4.7 / grok-4.6\uFF09\u3092\u8868\u793A\u3057\u3066\u3044\u307E\u3059\u3002"], \u4E00\u89A7\u7BC4\u56F2: "\u4EE3\u66FF\u5019\u88DC\uFF08\u672C\u4F53\u304C API \u53D6\u5F97\u5931\u6557\u6642\u306B\u4F7F\u3046\u4E00\u89A7\uFF09\u3002" };
    }
  }
  const [router, ready] = validatedCache(cache);
  if (selected.probe === "local-fixed") {
    const details = safeDetails(idsCatalog(LOCAL_CHAT_MODELS), []);
    return { ...output, \u72B6\u614B: "PASS", \u8AAC\u660E: "\u672C\u4F53\u3068\u540C\u3058\u56FA\u5B9A\u5019\u88DC\uFF08aidiy_diag \u306E\u5B9A\u7FA9\u3002\u672C\u4F53 CHAT_LOCAL_MODELS \u3068\u540C\u3058\uFF09\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002backend_local \u306F API \u3067\u30E2\u30C7\u30EB\u4E00\u89A7\u3092\u53D6\u5F97\u3057\u307E\u305B\u3093\u3002", \u30E2\u30C7\u30EB: details.map((item) => item.model_id), \u30E2\u30C7\u30EB\u8A73\u7D30: details, \u78BA\u8A8D\u65E5\u6642: (/* @__PURE__ */ new Date()).toISOString(), \u4E00\u89A7\u7BC4\u56F2: "\u56FA\u5B9A\u5019\u88DC\uFF08\u672C\u4F53\u306E local_chat\uFF09\u3002" };
  }
  if (selected.probe === "ollama-local") {
    const timestamp2 = (/* @__PURE__ */ new Date()).toISOString(), [, values2] = await readConfig(reader);
    try {
      const details = safeDetails(ollamaLocalCatalog(await fetch("ollama-local", {}, void 0, signal)), secretValues(values2));
      return { ...output, \u72B6\u614B: "OK", \u30E2\u30C7\u30EB: details.map((item) => item.model_id), \u30E2\u30C7\u30EB\u8A73\u7D30: details, \u78BA\u8A8D\u65E5\u6642: timestamp2, \u8AAC\u660E: "\u30ED\u30FC\u30AB\u30EB\u306E Ollama \u304B\u3089\u30E2\u30C7\u30EB\u4E00\u89A7\u3092\u53D6\u5F97\u3057\u307E\u3057\u305F\uFF08\u672C\u4F53\u306E ollama list \u3068\u540C\u3058\u4E00\u89A7\uFF09\u3002\u751F\u6210\u53EF\u5426\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002", \u4E00\u89A7\u7BC4\u56F2: "\u30A4\u30F3\u30B9\u30C8\u30FC\u30EB\u6E08\u307F\u306E\u30ED\u30FC\u30AB\u30EB\u30E2\u30C7\u30EB\uFF08\u65B0\u3057\u3044\u9806\uFF09\u3002\u8868\u793A\u306F\u6700\u5927500\u4EF6\u3002" };
    } catch {
      return { ...output, \u72B6\u614B: "NG", \u8AAC\u660E: "\u30ED\u30FC\u30AB\u30EB\u306E Ollama \u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3002Ollama \u304C\u8D77\u52D5\u3057\u3066\u3044\u308B\u304B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u672C\u4F53\u3067\u306F\u3053\u306E\u5834\u5408 Ollama \u306E\u5019\u88DC\u304C\u7A7A\u306B\u306A\u308A\u307E\u3059\uFF09\u3002", \u78BA\u8A8D\u65E5\u6642: timestamp2 };
    }
  }
  const [state, values] = await readConfig(reader);
  if (state === "\u8AAD\u8FBC\u4E0D\u53EF") return { ...output, \u8AAC\u660E: "\u8A2D\u5B9A\u3092\u8AAD\u307F\u53D6\u308C\u307E\u305B\u3093\u3002" };
  const keyValue = values[selected.\u30AD\u30FC\u540D];
  if (!configured(keyValue, id)) return { ...output, \u8AAC\u660E: "\u30AD\u30FC\u304C\u672A\u8A2D\u5B9A\u3067\u3059\u3002" };
  const key = keyValue.trim(), provider = selected.probe, timestamp = (/* @__PURE__ */ new Date()).toISOString();
  if (INTEGRATION_PROBES.includes(provider)) return integrationProbe(id, provider, key, { ...output, \u78BA\u8A8D\u65E5\u6642: timestamp }, secretValues(values), fetch, signal);
  if (id === "openrt_chat") {
    try {
      const body = await fetch("openrouter-key", { Authorization: "Bearer " + key }, void 0, signal);
      if (!record(body.data) || typeof body.data.is_free_tier !== "boolean") throw new Error("shape");
      if (!ready) return { ...output, \u72B6\u614B: "NG", \u78BA\u8A8D\u65E5\u6642: timestamp, \u8AAC\u660E: "\u30AD\u30FC\u8A8D\u8A3C\u306F\u6210\u529F\u3057\u307E\u3057\u305F\u304C\u3001\u516C\u958B\u30E2\u30C7\u30EB\u4E00\u89A7\u304C\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002" };
      const details = safeDetails(withoutRetired(router), secretValues(values));
      return authenticatedRouterResult({ ...output, \u72B6\u614B: "OK", \u8A8D\u8A3C\u78BA\u8A8D: true, \u8AAC\u660E: "\u30AD\u30FC\u8A8D\u8A3C\u6210\u529F\u3002\u516C\u958B\u4E00\u89A7\u30AD\u30E3\u30C3\u30B7\u30E5\u304B\u3089\u5019\u88DC\u3092\u8868\u793A\u3057\u307E\u3059\u3002\u751F\u6210\u53EF\u5426\u30FB\u8AB2\u91D1\u72B6\u614B\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002", \u30E2\u30C7\u30EB: details.map((item) => item.model_id), \u30E2\u30C7\u30EB\u8A73\u7D30: details, \u78BA\u8A8D\u65E5\u6642: timestamp, \u4E00\u89A7\u7BC4\u56F2: "\u8A8D\u8A3C\u78BA\u8A8D\u6E08\u307F\u3002\u516C\u958B\u4E00\u89A7\u306E\u30AD\u30E3\u30C3\u30B7\u30E5\u3002\u6700\u5927500\u4EF6\u3002" }, key);
    } catch (error) {
      return { ...output, \u72B6\u614B: "NG", \u78BA\u8A8D\u65E5\u6642: timestamp, \u8AAC\u660E: "OpenRouter \u306E\u30AD\u30FC\u8A8D\u8A3C\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" + connectionFailureDescription(error) };
    }
  }
  const warnings = ["google", "openai", "anthropic"].includes(provider) && !ready ? ["\u8D77\u52D5\u6642\u306E\u516C\u958BOpenRouter\u4E00\u89A7\u304C\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002\u5143\u306E\u30E2\u30C7\u30EB\u51E6\u7406\u3068\u540C\u3058\u7A7A\u4E00\u89A7\u6642\u306E\u51E6\u7406\u3067\u3001\u65E5\u4ED8\u30FB\u5BFE\u5FDC\u60C5\u5831\u306E\u88DC\u5B8C\u306A\u3057\u3067\u7D9A\u884C\u3057\u307E\u3057\u305F\u3002"] : [];
  try {
    const headers = provider === "google" ? { "x-goog-api-key": key } : provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { Authorization: "Bearer " + key };
    if (provider === "openai" && configured(values.openai_organization, "")) headers["OpenAI-Organization"] = values.openai_organization.trim();
    let body = await fetch(provider, headers, void 0, signal), models, decisionModels = {}, live = [];
    if (provider === "google") {
      if (!Array.isArray(body.models)) throw new Error("shape");
      const entries2 = [...body.models];
      let token = body.nextPageToken, pages = 1;
      while (token) {
        if (pages >= 20) throw new Error("pages");
        body = await fetch(provider, headers, token, signal);
        if (!Array.isArray(body.models)) throw new Error("shape");
        entries2.push(...body.models);
        token = body.nextPageToken;
        pages++;
      }
      live = entries2.filter((item) => record(item) && typeof item.name === "string" && Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes("bidiGenerateContent")).map((item) => String(item.name).replaceAll("models/", ""));
      models = googleCatalog(entries2.map((item) => {
        if (!record(item) || typeof item.name !== "string" || item.supportedGenerationMethods !== void 0 && (!Array.isArray(item.supportedGenerationMethods) || item.supportedGenerationMethods.some((x) => typeof x !== "string"))) throw new Error("shape");
        return { name: item.name, supported_actions: item.supportedGenerationMethods ?? [], input_token_limit: item.inputTokenLimit ?? null };
      }), router);
      decisionModels = googleCatalog(entries2.map((item) => {
        const value = item;
        return { name: value.name, supported_actions: value.supportedGenerationMethods ?? [], input_token_limit: value.inputTokenLimit ?? null };
      }));
    } else {
      if (!Array.isArray(body.data)) throw new Error("shape");
      if (provider === "openai") models = withoutRetired(openaiCatalog(body.data.map((item) => {
        if (!record(item) || typeof item.id !== "string" || typeof item.created !== "number") throw new Error("shape");
        return { id: item.id, created: item.created };
      }), router, now));
      else if (provider === "anthropic") models = claudeCatalog({ data: body.data.map((item) => {
        if (!record(item) || typeof item.id !== "string") throw new Error("shape");
        return { id: item.id, created_at: item.created_at };
      }) }, router, now);
      else models = ollamaCatalog(body, now);
      if (provider === "openai") decisionModels = withoutRetired(openaiCatalog(body.data, {}, now));
    }
    const secrets = secretValues(values);
    if (provider === "openai") live = Object.keys(models).filter((id2) => id2.toLowerCase().includes("realtime"));
    const liveDate = (id2) => {
      const value = provider === "google" ? router[`google/${id2}`]?.\u4F5C\u6210\u65E5 : models[id2]?.\u4F5C\u6210\u65E5;
      return typeof value === "string" && /^\d{4}\/\d{2}\/\d{2}$/.test(value) ? value : null;
    };
    const details = safeDetails(models, secrets), liveCandidates = [...new Set(live)].filter((id2) => /^~?[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,199}$/.test(id2) && !secrets.some((secret) => id2.includes(secret))).slice(0, 200);
    const result = { ...output, \u72B6\u614B: "OK", \u30E2\u30C7\u30EB: details.map((item) => item.model_id), \u30E2\u30C7\u30EB\u8A73\u7D30: details, \u30E9\u30A4\u30D6\u5019\u88DC: liveCandidates, \u30E9\u30A4\u30D6\u5019\u88DC\u4F5C\u6210\u65E5: Object.fromEntries(liveCandidates.map((id2) => [id2, liveDate(id2)])), \u78BA\u8A8D\u65E5\u6642: timestamp, \u8B66\u544A: warnings, \u8AAC\u660E: "\u30E2\u30C7\u30EB\u4E00\u89A7API\u53D6\u5F97\u6210\u529F\u3002\u5143\u306E\u30E2\u30C7\u30EB\u51E6\u7406\u3068\u540C\u3058\u7D5E\u308A\u8FBC\u307F\u30FB\u88DC\u5B8C\u3092\u9069\u7528\u3002\u751F\u6210\u53EF\u5426\u30FB\u8AB2\u91D1\u72B6\u614B\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002", \u4E00\u89A7\u7BC4\u56F2: "\u5143\u306E\u30E2\u30C7\u30EB\u51E6\u7406\u3092\u79FB\u690D\u3057\u305F\u53D6\u5F97\u30E2\u30C7\u30EB\u306E\u7D5E\u308A\u8FBC\u307F\u7D50\u679C\u3001\u8868\u793A\u306F\u6700\u5927500\u4EF6\u3002\u9759\u7684\u30FBOAuth\u5019\u88DC\u306F\u542B\u307F\u307E\u305B\u3093\u3002", \u88DC\u5B8C: ["google", "openai", "anthropic"].includes(provider) ? "\u8D77\u52D5\u6642\u306E\u516C\u958BOpenRouter\u4E00\u89A7\u30AD\u30E3\u30C3\u30B7\u30E5\u3092\u5229\u7528\u3002\u30C6\u30B9\u30C8\u6642\u306E\u8FFD\u52A0\u53D6\u5F97\u306F\u884C\u3044\u307E\u305B\u3093\u3002" : "" };
    return decisionResult(result, id, safeDetails(decisionModels, secrets), async (currentReader) => {
      const [currentState, current] = await readConfig(currentReader);
      return currentState === "\u8AAD\u8FBC\u6E08\u307F" && configured(current[selected.\u30AD\u30FC\u540D], id) && current[selected.\u30AD\u30FC\u540D].trim() === key && (provider !== "openai" || (configured(current.openai_organization, "") ? current.openai_organization.trim() : "") === (headers["OpenAI-Organization"] ?? ""));
    });
  } catch (error) {
    return { ...output, \u72B6\u614B: "NG", \u8AAC\u660E: "\u30E2\u30C7\u30EB\u4E00\u89A7API\u306E\u901A\u4FE1\u307E\u305F\u306F\u8A3A\u65AD\u7528\u30E2\u30C7\u30EB\u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002" + connectionFailureDescription(error), \u78BA\u8A8D\u65E5\u6642: timestamp, \u8B66\u544A: warnings };
  }
}
function safeName(value, secrets) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$/.test(value) && !secrets.some((secret) => value.includes(secret)) ? value : "";
}
async function integrationProbe(id, provider, key, output, secrets, fetch, signal) {
  const name = provider === "slack" ? "Slack" : provider === "discord" ? "Discord" : "Hugging Face";
  try {
    if (provider === "slack") {
      const body2 = await fetch("slack", { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" }, void 0, signal);
      if (body2.ok !== true || typeof body2.bot_id !== "string" || !/^B[A-Z0-9]+$/.test(body2.bot_id)) return { ...output, \u72B6\u614B: "NG", \u8AAC\u660E: "Slack Bot \u30C8\u30FC\u30AF\u30F3\u3068\u3057\u3066\u8A8D\u8A3C\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" };
      return { ...output, \u72B6\u614B: "OK", \u8AAC\u660E: "Slack Bot \u30C8\u30FC\u30AF\u30F3\u3067\u8A8D\u8A3C\u3067\u304D\u307E\u3057\u305F\u3002App \u30C8\u30FC\u30AF\u30F3\u30FBSocket Mode\u30FB\u30C1\u30E3\u30F3\u30CD\u30EB\u6A29\u9650\u30FB\u30E1\u30C3\u30BB\u30FC\u30B8\u9001\u4FE1\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002" };
    }
    if (provider === "discord") {
      const body2 = await fetch("discord", { Authorization: "Bot " + key, "User-Agent": "DiscordBot (aidiy-diag, 0.1.0)" }, void 0, signal);
      if (body2.bot !== true) return { ...output, \u72B6\u614B: "NG", \u8AAC\u660E: "Bot \u30C8\u30FC\u30AF\u30F3\u3068\u3057\u3066\u8A8D\u8A3C\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002Discord Developer Portal \u306E Bot \u30C8\u30FC\u30AF\u30F3\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002" };
      const bot = safeName(body2.username, secrets);
      return { ...output, \u72B6\u614B: "OK", \u8AAC\u660E: `Bot \u30C8\u30FC\u30AF\u30F3\u3067\u8A8D\u8A3C\u3067\u304D\u307E\u3057\u305F${bot ? `\uFF08Bot: ${bot}\uFF09` : ""}\u3002\u30E1\u30C3\u30BB\u30FC\u30B8\u9001\u4FE1\u30FBGateway \u63A5\u7D9A\u30FB\u30C1\u30E3\u30F3\u30CD\u30EB\u6A29\u9650\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002` };
    }
    const body = await fetch("huggingface", { Authorization: "Bearer " + key, "User-Agent": "aidiy-diag" }, void 0, signal);
    const user = safeName(body.name, secrets), token = record(body.auth) && record(body.auth.accessToken) ? body.auth.accessToken : {};
    const role = typeof token.role === "string" && ["read", "write", "fineGrained"].includes(token.role) ? token.role : "";
    const label = `\uFF08${user ? `\u30E6\u30FC\u30B6\u30FC: ${user}\u3001` : ""}\u6A29\u9650: ${role || "\u4E0D\u660E"}\uFF09`;
    if (id === "huggingface_write") {
      if (role === "write") return { ...output, \u72B6\u614B: "OK", \u8AAC\u660E: `\u66F8\u8FBC\u6A29\u9650\u306E\u3042\u308B\u30C8\u30FC\u30AF\u30F3\u3067\u8A8D\u8A3C\u3067\u304D\u307E\u3057\u305F${label}\u3002\u30EA\u30DD\u30B8\u30C8\u30EA\u3078\u306E\u5B9F\u969B\u306E\u66F8\u8FBC\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002` };
      if (role === "fineGrained") {
        const permissions = record(token.fineGrained) ? [...Array.isArray(token.fineGrained.global) ? token.fineGrained.global : [], ...Array.isArray(token.fineGrained.scoped) ? token.fineGrained.scoped.flatMap((item) => record(item) && Array.isArray(item.permissions) ? item.permissions : []) : []] : [];
        return permissions.some((item) => typeof item === "string" && item.endsWith(".write")) ? { ...output, \u72B6\u614B: "PASS", \u8AAC\u660E: `\u7D30\u7C92\u5EA6\u30C8\u30FC\u30AF\u30F3\u3067\u8A8D\u8A3C\u3067\u304D\u307E\u3057\u305F${label}\u3002\u4E00\u90E8\u306B\u66F8\u8FBC\u6A29\u9650\u304C\u3042\u308A\u307E\u3059\u304C\u3001\u5BFE\u8C61\u30EA\u30DD\u30B8\u30C8\u30EA\u306E\u7BC4\u56F2\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002` } : { ...output, \u72B6\u614B: "NG", \u8AAC\u660E: `\u8A8D\u8A3C\u306F\u3067\u304D\u307E\u3057\u305F\u304C\u3001\u66F8\u8FBC\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093${label}\u3002\u66F8\u8FBC\u7528\u306B\u306F write \u6A29\u9650\u306E\u30C8\u30FC\u30AF\u30F3\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002` };
      }
      return { ...output, \u72B6\u614B: "NG", \u8AAC\u660E: `\u8A8D\u8A3C\u306F\u3067\u304D\u307E\u3057\u305F\u304C\u3001\u66F8\u8FBC\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093${label}\u3002\u66F8\u8FBC\u7528\u306B\u306F write \u6A29\u9650\u306E\u30C8\u30FC\u30AF\u30F3\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002` };
    }
    return { ...output, \u72B6\u614B: "OK", \u8AAC\u660E: `\u30C8\u30FC\u30AF\u30F3\u3067\u8A8D\u8A3C\u3067\u304D\u307E\u3057\u305F${label}\u3002\u500B\u5225\u30EA\u30DD\u30B8\u30C8\u30EA\u30FB\u30B2\u30FC\u30C8\u4ED8\u304D\u30E2\u30C7\u30EB\u3078\u306E\u30A2\u30AF\u30BB\u30B9\u306F\u672A\u78BA\u8A8D\u3067\u3059\u3002` };
  } catch (error) {
    return { ...output, \u72B6\u614B: "NG", \u8AAC\u660E: `${name} \u306E\u8A8D\u8A3C\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002` + connectionFailureDescription(error) };
  }
}

// ../runtime/model_runner.ts
function createModelRunner() {
  const active = /* @__PURE__ */ new Set();
  let stopping = false;
  const queue = [];
  const pending = /* @__PURE__ */ new Map();
  const notify = (callback, state) => {
    try {
      callback?.(state);
    } catch {
    }
  };
  const drain = () => {
    while (!stopping && active.size < 2 && queue.length) queue.shift().start();
  };
  const cancel = () => {
    stopping = true;
    for (const job of [...queue]) job.stop();
    for (const controller of active) controller.abort();
  };
  const execute = async (action, id, options = {}) => {
    if (!["status", "public", "test"].includes(action) || action === "test" && !KEY_PROVIDERS.some((p) => p.id === id)) return { error: "unsupported" };
    if (stopping || options.signal?.aborted) return { error: "stopped" };
    const controller = new AbortController();
    active.add(controller);
    let timeout = false, timer;
    const externalAbort = () => controller.abort();
    options.signal?.addEventListener("abort", externalAbort, { once: true });
    try {
      if (action === "test" && Buffer.byteLength(JSON.stringify(options.input ?? {})) > RESPONSE_LIMIT) return { error: "input" };
      return await new Promise((resolve) => {
        let ended = false;
        const finish = (result) => {
          if (ended) return;
          ended = true;
          controller.signal.removeEventListener("abort", aborted);
          resolve(result);
        };
        const aborted = () => finish({ error: timeout ? "timeout" : "stopped" });
        controller.signal.addEventListener("abort", aborted, { once: true });
        timer = setTimeout(() => {
          timeout = true;
          controller.abort();
        }, options.timeout ?? 25e3);
        const injected = { ...options, cache: options.input, signal: controller.signal };
        Promise.resolve().then(() => action === "status" ? status(injected) : action === "public" ? publicCatalog(injected) : probe(id, injected)).then((data) => {
          try {
            if (Buffer.byteLength(JSON.stringify(data)) > RESPONSE_LIMIT) return finish({ error: "output" });
            finish({ data });
          } catch {
            finish({ error: "output" });
          }
        }, () => finish({ error: "failed" }));
      });
    } catch {
      return { error: "input" };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", externalAbort);
      active.delete(controller);
      controller.abort();
    }
  };
  const run = (action, id, options = {}) => {
    if (!["status", "public", "test"].includes(action) || action === "test" && !KEY_PROVIDERS.some((p) => p.id === id)) return Promise.resolve({ error: "unsupported" });
    if (stopping || options.signal?.aborted) return Promise.resolve({ error: "stopped" });
    const key = action === "test" ? `${action}:${id}` : action, existing = pending.get(key);
    if (existing) {
      if (options.onState) existing.listeners.add(options.onState);
      notify(options.onState, existing.state);
      return existing.promise;
    }
    let resolve;
    const entry = { promise: new Promise((r) => {
      resolve = r;
    }), state: "\u5F85\u6A5F\u4E2D", listeners: /* @__PURE__ */ new Set() };
    if (options.onState) entry.listeners.add(options.onState);
    pending.set(key, entry);
    let started = false, finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      options.signal?.removeEventListener("abort", job.stop);
      pending.delete(key);
      resolve(result);
      drain();
    };
    const job = {
      stop: () => {
        if (started) return;
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        finish({ error: "stopped" });
      },
      start: () => {
        started = true;
        options.signal?.removeEventListener("abort", job.stop);
        entry.state = "\u78BA\u8A8D\u4E2D";
        const execution = execute(action, id, options);
        for (const listener of entry.listeners) notify(listener, entry.state);
        execution.then(finish, () => finish({ error: "failed" }));
      }
    };
    queue.push(job);
    options.signal?.addEventListener("abort", job.stop, { once: true });
    for (const listener of entry.listeners) notify(listener, "\u5F85\u6A5F\u4E2D");
    if (options.signal?.aborted) job.stop();
    else drain();
    return entry.promise;
  };
  return { run, cancel };
}
var runner = createModelRunner();
var runModels = runner.run;
var cancelKeyProbes = runner.cancel;
export {
  cancelKeyProbes,
  createModelRunner,
  runModels
};
