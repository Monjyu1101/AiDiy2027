/*! COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027 */

// ../runtime/model_catalog.ts
var DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
var ZERO_DECIMAL = /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?$/;
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
function zeroOpenrouterPricing(value) {
  const pricing = safeRouterMetadata({ pricing: value }).pricing;
  return !!pricing && Object.hasOwn(pricing, "prompt") && Object.hasOwn(pricing, "completion") && Object.entries(pricing).every(([key, price]) => ["overrides", "pricing_overrides"].includes(key) && Array.isArray(price) && price.length === 0 || typeof price === "number" && price === 0 || typeof price === "string" && ZERO_DECIMAL.test(price));
}
function openrouterFreeModel(model) {
  if (model === null || typeof model !== "object" || Array.isArray(model)) return false;
  const detail = model, metadata = safeRouterMetadata(model);
  if (typeof detail.model_id === "string" && /(?:^|[-/:])(?:content-safety|moderation|guard(?:rails)?)(?:[-/:]|$)/i.test(detail.model_id)) return false;
  const output = metadata.output_modalities;
  const modality = typeof detail.\u30E2\u30C0\u30EA\u30C6\u30A3 === "string" ? detail.\u30E2\u30C0\u30EA\u30C6\u30A3 : typeof detail.architecture?.modality === "string" ? detail.architecture.modality : "";
  const parts = modality.toLowerCase().split(/->|→/);
  const outputs = output ?? (parts.length === 2 ? parts[1].split(/[+,/\s]+/).filter(Boolean) : []);
  const declared = parts.length === 2 ? parts[1].split(/[+,/\s]+/).filter(Boolean) : [];
  return zeroOpenrouterPricing(metadata.pricing) && outputs.length > 0 && outputs.every((value) => value === "text") && declared.every((value) => value === "text");
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
    else if (!id.toLowerCase().includes("live")) delete out[id];
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
var CONTEXT_SUFFIX = "-900k";
var CONTEXT_BASES = /* @__PURE__ */ new Set(["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "gpt-5.4", "gpt-daybreak-blue-latest"]);
var CONTEXT_SNAPSHOT_BASES = ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"];
function isCodex900kBase(model) {
  const slug = model.trim().toLowerCase().split("/").at(-1) ?? "";
  if (!slug || slug.endsWith(CONTEXT_SUFFIX)) return false;
  if (CONTEXT_BASES.has(slug)) return true;
  return CONTEXT_SNAPSHOT_BASES.some((base) => slug.startsWith(base + "-") && /^\d{4}-\d{2}-\d{2}$/.test(slug.slice(base.length + 1)));
}
function finalizeCodexModels(ids) {
  const ordered = [], seen = /* @__PURE__ */ new Set();
  for (const id of ids.filter((id2) => !isRetiredOpenaiModel(id2))) if (!seen.has(id)) {
    ordered.push(id);
    seen.add(id);
  }
  for (const [synthetic, templates] of FORWARD_COMPAT) if (!seen.has(synthetic) && templates.some((template) => seen.has(template))) {
    ordered.push(synthetic);
    seen.add(synthetic);
  }
  const out = [], present = new Set(ordered);
  for (const id of ordered) {
    out.push(id);
    const variant = id + CONTEXT_SUFFIX;
    if (present.has(variant) || out.includes(variant)) continue;
    if (isCodex900kBase(id)) out.push(variant);
  }
  return out;
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
export {
  DEFAULT_CODEX_MODELS,
  GROK_CLI_MODELS,
  LOCAL_CHAT_MODELS,
  OAUTH_FALLBACK_MODELS,
  claudeCatalog,
  codexCatalog,
  codexFallbackCatalog,
  codexSlugs,
  finalizeCodexModels,
  googleCatalog,
  grokCatalog,
  idsCatalog,
  isCodex900kBase,
  isRetiredOpenaiModel,
  ollamaCatalog,
  ollamaLocalCatalog,
  openaiCatalog,
  openrouterCatalog,
  openrouterFreeModel,
  pythonString,
  safeRouterMetadata,
  withoutRetired,
  zeroOpenrouterPricing
};
