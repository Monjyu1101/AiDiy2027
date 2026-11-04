// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// プロバイダ別のモデル情報を _AIDIY/aidiy_diag/<id>_models_info.json へ保存する。
// 用途の分け方は本体（backend_server/conf/conf_model.py の get_chat_models / get_live_models / get_code_models）に合わせる。
// 取得結果を優先し、Chat が空または local のみなら設定モデルを未検証の候補として補う。
import path from 'node:path';
import {NAVI_MODELS_FILE,naviModelsInfo,naviHermesInstalled} from './navi_info.mjs';
import {readFile} from 'node:fs/promises';
import { OUTPUT_DIRECTORY, writeResult } from '../診断/headless.mjs';
import {catalog, resolveProgram} from '../診断/probes.mjs';
import {currentOpenRouterProof, readConfig} from '../runtime/model_probe.mjs';
import {LIVE_VOICES_FILE, liveVoicesInfo} from './voices_info.mjs';
import {PREDICTION_MODELS_FILE, predictionModelsInfo} from './prediction_info.mjs';
import {DECISIONS_MODELS_FILE,decisionsModelsInfo} from './decisions_info.mjs';
import {COPILOT_FALLBACK_MODELS, OAUTH_FALLBACK_SOURCE, oauthModelFallback} from './model_fallbacks.mjs';
import {antigravityModels} from './antigravity_models.mjs';

// 順序はHermesの先頭候補にも使う。存在確認のみでCLIは実行しない。
const CODE_CLIS = Object.freeze({copilot_cli:'copilot', claude_cli:'claude', codex_cli:'codex',
  antigravity_cli:'agy', grok_cli:'grok', opencode_cli:'opencode'});
export async function installedCodeClis({loadEntries = catalog, resolve = resolveProgram} = {}) {
  const entries = await loadEntries();
  return Object.fromEntries(await Promise.all(Object.entries(CODE_CLIS).map(async ([key, id]) => {
    const entry = entries.find(item => item.id === id);
    return [key, !!(entry && await resolve(entry))];
  })));
}

// Hermes / OpenCode は渡す値（プロバイダ/モデル）をそのまま表示名にも使う。先頭の日付・仮設定表示は残す。
export const routeLabel = (id, label) => `${/^(.*?) - /.exec(label)?.[1] ?? 'yyyy/mm/dd'} - ${id}`;
const routeModels = models => Object.fromEntries(Object.entries(models).map(([id, label]) => [id, routeLabel(id, label)]));

export function openCodeModels(models) {
  return Object.fromEntries(Object.entries(models).map(([id, label]) => {
    const model = id.startsWith('openai/') || ['auto', 'same'].includes(id) ? id : `openai/${id}`;
    return [model, model === id ? label : label.endsWith(id) ? label.slice(0, -id.length) + model : `${label} - ${model}`];
  }));
}

function availableCodeModels(code, installedClis) {
  const filtered = Object.fromEntries(Object.entries(code).filter(([key]) => key === 'aidiy_hermes'
    || installedClis[key === 'claude_sdk' ? 'claude_cli' : key] === true));
  // OpenCodeはCodex用の候補を共有。空の場合の規定値と導入判定はCopilotと同じ方式。
  for (const [key, source] of [['copilot_cli', 'copilot_cli'], ['opencode_cli', 'codex_cli']]) {
    let models = Object.keys(code[source]?.models ?? {}).length ? code[source].models : COPILOT_FALLBACK_MODELS;
    // CopilotはAnthropic未取得でも4系統のバージョン付きIDを補う。
    // 取得済みClaudeのfamily別最新選択、OpenAI候補の順序、OpenCodeの候補元は維持する。
    if (key === 'copilot_cli' && !Object.keys(models).some(id => id.startsWith('claude-'))) {
      models = {...models, ...Object.fromEntries(Object.entries(COPILOT_FALLBACK_MODELS).filter(([id]) => id.startsWith('claude-')))};
    }
    if (installedClis[key] === true) filtered[key] = {models:key === 'opencode_cli' ? openCodeModels(models) : {...models}};
  }
  const routes = Object.fromEntries(Object.keys(CODE_CLIS).filter(key => installedClis[key])
    .map(key => [`${key}/same`, `yyyy/mm/dd - ${key}/same`]));
  if (Object.keys(routes).length || filtered.aidiy_hermes) {
    filtered.aidiy_hermes = {models:{...routes, ...filtered.aidiy_hermes?.models}};
  }
  for (const key of ['aidiy_hermes', 'opencode_cli']) if (filtered[key]) filtered[key] = {models:routeModels(filtered[key].models)};
  const priority = key => key === 'antigravity_cli' ? 2
    : ['claude_sdk', 'claude_cli', 'copilot_cli', 'codex_cli', 'aidiy_hermes'].includes(key) ? 0 : 1;
  return Object.fromEntries(Object.entries(filtered).sort(([a], [b]) => priority(a) - priority(b)));
}

// モデル一覧に表示する（モデル一覧を取得する）プロバイダ。ファイル名にも使う。
export const MODEL_PROVIDER_IDS = Object.freeze(['gemini', 'freeai', 'claude', 'openai', 'openai_oauth', 'grok', 'openrt', 'ollama', 'local']);
export const modelsInfoFile = id => `${id}_models_info.json`;

// Grok / local の固定候補も aidiy_diag で管理し、本体は合成ファイルを読む。
const fixed = (source, models) => Object.freeze({source, models:Object.freeze(models)});
export const FIXED_MODELS = Object.freeze({
  grok_cli: fixed('CODE_GROK_CLI_MODELS', {'grok-4.7':'yyyy/mm/dd - grok-4.7', 'grok-4.6':'yyyy/mm/dd - grok-4.6'}),
  local_chat: fixed('CHAT_LOCAL_MODELS', {
    'google/gemma-4-E2B-it': 'google/gemma-4-E2B-it / 約10GB bf16 / 速い (default)',
    'google/gemma-4-E4B-it': 'google/gemma-4-E4B-it / 約16GB bf16 / やや遅い・高品質',
    'google/gemma-4-E2B-it-qat-mobile-transformers': 'google/gemma-4-E2B-it-qat-mobile-transformers / 約2.5GB / 省メモリ・中速',
    'google/gemma-4-E4B-it-qat-mobile-transformers': 'google/gemma-4-E4B-it-qat-mobile-transformers / 約3.5GB / 省メモリ・低速',
  }),
});
const fixedSection = key => ({models:{...FIXED_MODELS[key].models}});
// 区分名は本体 get_chat_models / get_live_models / get_code_models に合わせる。
const LAYOUT = Object.freeze({
  gemini: {chat:'gemini_chat', live:'gemini_live'},
  freeai: {chat:'freeai_chat', live:'freeai_live'},
  claude: {chat:null, code:{claude_sdk:'取得結果', claude_cli:'取得結果', copilot_cli:'取得結果'}},
  openai: {chat:'openai_chat', live:'openai_live', code:{codex_cli:'取得結果', copilot_cli:'取得結果'}},
  openai_oauth: {chat:'openai_oauth', code:{codex_cli:'取得結果', copilot_cli:'取得結果', aidiy_hermes:'openai_oauth/'}},
  grok: {chat:null, code:{grok_cli:'fixed'}},
  openrt: {chat:'openrt_chat'},
  ollama: {chat:'ollama_chat', code:{opencode_cli:'取得結果'}},
  // backend_local: 固定候補。サイズ・速度の説明は固定候補の表示名に残す。
  local: {chat:'local_chat', chatFixed:'local_chat'},
});

// 作成日（YYYY/MM/DD）の新しい順。日付が同じもの・日付の無いもの（OAuth・Ollama など）は元の順を保ち、日付なしは末尾。
const dateKey = row => typeof row.作成日 === 'string' && /^\d{4}\/\d{2}\/\d{2}$/.test(row.作成日) ? row.作成日 : '';
export const newestFirst = rows => rows.map((row, index) => [row, index]).sort(([a, i], [b, j]) => dateKey(b).localeCompare(dateKey(a)) || i - j).map(([row]) => row);
// 日付は API / OpenRouter の作成日 → モデル名の日付 → yyyy/mm/dd の順。
export function liveDate(id, apiDate) {
  if (typeof apiDate === 'string' && /^\d{4}\/\d{2}\/\d{2}$/.test(apiDate)) return apiDate;
  let match = /-(\d{4})-(\d{2})-(\d{2})$/.exec(id); if (match) return `${match[1]}/${match[2]}/${match[3]}`;
  match = /-(\d{2})-(\d{4})$/.exec(id); if (match && Number(match[1]) >= 1 && Number(match[1]) <= 12) return `${match[2]}/${match[1]}/--`;
  return 'yyyy/mm/dd';
}
// Gemini 系は native-audio / live を含み transcribe / translate を含まない ID を文字列降順。
// OpenAI は whisper / translate を除き、作成日の新しい順。
export function liveLabels(apiIds, apiDates = {}, {gemini = false} = {}) {
  const rows = apiIds.filter(id => gemini
    ? (id.includes('native-audio') || id.includes('live')) && !id.includes('transcribe') && !id.includes('translate') && !id.includes('lyria')
    : !id.includes('whisper') && !id.includes('translate'))
    .map((id, index) => [id, liveDate(id, apiDates[id]), index]);
  const key = date => date.startsWith('yyyy') ? '' : date;
  rows.sort(gemini ? ([a], [b]) => a === b ? 0 : a < b ? 1 : -1
    : ([, a, i], [, b, j]) => key(b).localeCompare(key(a)) || i - j);
  return Object.fromEntries(rows.map(([id, date]) => [id, `${date} - ${id}`]));
}
// 「モデル」（詳細）とは別に、本体 get_chat_models と同じ「モデルID: 日付 - モデルID」の一覧。並びは「モデル」と同じ新しい順。
// backend_local は本体と同じくサイズ・速度入りの固定候補の表示名。
const chatLabels = (rows, layout) => Object.fromEntries(rows.map(row => [row.model_id,
  (layout.chatFixed && FIXED_MODELS[layout.chatFixed].models[row.model_id]) || `${dateKey(row) || 'yyyy/mm/dd'} - ${row.model_id}`]));
// Claude SDK / CLI は名前だけ、Copilot はバージョン付き ID。同じ名前は最新の行を使う。
const claudeLabels = (rows, {versioned = false} = {}) => {
  const models = {}, names = new Set();
  for (const row of rows) {
    const name = /^claude-([a-z0-9]+)(?:-|$)/.exec(row.model_id)?.[1];
    if (name && !names.has(name)) {
      // Copilot のバージョン区切りだけをドットにする（5-5 → 5.5）。
      const id = versioned ? row.model_id.replace(/(\d)-(?=\d)/g, '$1.') : row.model_id;
      models[versioned ? id : name] = `${dateKey(row) || 'yyyy/mm/dd'} - ${id}`;
      names.add(name);
    }
  }
  return models;
};
// Codex は同じ接尾辞（sol / luna / pro / sol-900k など）の最新バージョンだけを残す。
const latestCodexModels = rows => {
  const versionOf = id => /^gpt-(\d+(?:\.\d+)*)(.*)$/.exec(id);
  const compare = (a, b) => {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const difference = (left[i] ?? 0) - (right[i] ?? 0);
      if (difference) return difference;
    }
    return 0;
  };
  const candidates = rows.filter(row => !row.model_id.includes('realtime'));
  const latest = new Map();
  for (const row of candidates) {
    const match = versionOf(row.model_id);
    if (match && (!latest.has(match[2]) || compare(match[1], latest.get(match[2])) > 0)) latest.set(match[2], match[1]);
  }
  return candidates.filter(row => {
    const match = versionOf(row.model_id);
    return !match || compare(match[1], latest.get(match[2])) === 0;
  });
};
const details = result => newestFirst((Array.isArray(result?.モデル詳細) ? result.モデル詳細 : []).map(row => ({model_id:row.model_id, 作成日:row.作成日 ?? null, トークン数:row.トークン数 ?? null, モダリティ:row.モダリティ ?? null})));

// 1 プロバイダ分のファイル内容。result は画面と同じキーテスト結果（サーバー側で保持したもの）。
export async function modelsInfo(provider, result, {now = () => new Date()} = {}) {
  result = provider.設定済み === false ? result : oauthModelFallback({...result, id:provider.id});
  const provisional = provider.id === 'openai_oauth' && result.補完 === OAUTH_FALLBACK_SOURCE;
  const layout = LAYOUT[provider.id]; if (!layout) throw new Error('provider');
  const labels = rows => provisional ? Object.fromEntries(rows.map(row => [row.model_id,`仮設定（未検証） - ${row.model_id}`])) : chatLabels(rows, layout);
  const gemini = provider.id === 'gemini' || provider.id === 'freeai';
  const fixedKey = provider.id === 'grok' ? 'grok_cli' : layout.chatFixed;
  const chatModels = fixedKey
    ? details({モデル詳細:Object.keys(FIXED_MODELS[fixedKey].models).map(model_id => ({model_id}))})
    : (provisional || result?.状態 === 'OK') && (provider.id !== 'openrt' || result.認証確認 === true) ? details(result).filter(row => !gemini || !row.model_id.includes('lyria')) : [];
  const info = {形式:2, 種類:'モデル情報', プロバイダ:provider.id, 名前:provider.名前, 保存日時:now().toISOString(), 確認日時:result?.確認日時 ?? null,
    状態:result?.状態 ?? '未実施', 説明:result?.説明 ?? '', 警告:Array.isArray(result?.警告) ? result.警告 : [],
    chat:{取得元:provisional ? OAUTH_FALLBACK_SOURCE : fixedKey ? '固定候補（aidiy_diag）' : result?.状態 === 'OK' ? 'API（本体と同じ絞り込み）' : '取得できませんでした', 件数:chatModels.length, モデル:chatModels}};
  if (provisional) { info.認証確認 = false; info.補完 = OAUTH_FALLBACK_SOURCE; }
  if (provider.id === 'openrt') info.認証確認 = result?.状態 === 'OK' && result.認証確認 === true;
  // 区分名以下は各プログラムがそのまま使う {models} のみ。API の詳細は chat.モデル に残す。
  // Claude / Grok の API 一覧は詳細だけで、本体に存在しない chat 区分は作らない。
  if (layout.chat) info.chat[layout.chat] = layout.chatFixed ? fixedSection(layout.chatFixed) : {models:labels(chatModels)};
  if (layout.live) {
    const acquired = result?.状態 === 'OK';
    const apiIds = acquired && Array.isArray(result?.ライブ候補) ? result.ライブ候補 : [];
    info.live = {[layout.live]:{models:liveLabels(apiIds, result?.ライブ候補作成日 ?? {}, {gemini})}};
  }
  if (layout.code) {
    info.code = {};
    for (const [key, source] of Object.entries(layout.code)) {
      if (source === 'fixed') info.code[key] = fixedSection(key);
      else {
        const prefix = source === 'openai_oauth/' ? source : '';
        // OAuth の仮候補は OAuth 経路だけに渡し、別契約のCLI取得結果へ混ぜない。
        const codeModels = provisional ? (key === 'aidiy_hermes' ? chatModels : [])
          : key === 'codex_cli' || (['openai', 'openai_oauth'].includes(provider.id) && key === 'copilot_cli') ? latestCodexModels(chatModels) : chatModels;
        info.code[key] = {models:provider.id === 'claude' ? claudeLabels(chatModels, {versioned:key === 'copilot_cli'})
          : Object.fromEntries(Object.entries(labels(codeModels))
            .map(([id, label]) => [prefix + id, prefix ? routeLabel(prefix + id, label) : label]))};
      }
    }
  }
  return info;
}

// 各プログラムへ渡す区分だけを合成。同じモデルIDの表示名は日付が新しいものを優先する。
function mergeModelsInfo(infos) {
  const merged = {chat:{}, live:{}, code:{}};
  const labelDate = label => /^(\d{4}\/\d{2}\/(?:\d{2}|--)) - /.exec(label)?.[1] ?? '';
  for (const info of infos) {
    for (const group of Object.keys(merged)) {
      for (const [key, entry] of Object.entries(info[group] ?? {})) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !entry.models || typeof entry.models !== 'object' || Array.isArray(entry.models)) continue;
        const target = merged[group][key] ??= {models:{}};
        for (const [id, label] of Object.entries(entry.models)) {
          // 合成時に付ける xx/same（旧 xx/auto）はプロバイダ別ファイルから引き継がない。
          if (typeof label !== 'string' || /\/(?:auto|same)$/.test(id)) continue;
          if (!Object.hasOwn(target.models, id) || labelDate(label) > labelDate(target.models[id])) target.models[id] = label;
        }
      }
    }
  }
  return merged;
}

// 保存済みの全プロバイダを合成する。個別テスト後の書込でも他プロバイダの候補を維持する。
async function writeMergedModelsInfo(directory, installedClis, providers, results, options) {
  const infos = [];
  const routerVerified = results.openrt?.状態 === 'OK' && results.openrt?.認証確認 === true
    && await currentOpenRouterProof(results.openrt, options.configReader);
  // 合成時だけ FreeAI を先頭にする。画面・診断のプロバイダ順は維持する。
  const order = ['freeai', ...MODEL_PROVIDER_IDS.filter(id => id !== 'freeai')];
  for (const id of order) {
    try {
      const info = JSON.parse(await readFile(path.join(directory, modelsInfoFile(id)), 'utf8'));
      if (id === 'openai_oauth' && providers.some(row => row.id === id && row.設定済み === false)) continue;
      // 旧公開一覧の OK や、キー削除後の保存済み候補を引き継がない。
      if (id === 'openrt' && (info.認証確認 !== true || !providers.some(row => row.id === id && row.設定済み === true) || !routerVerified)) continue;
      infos.push(info);
    }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  const saved = [];
  const merged = mergeModelsInfo(infos);
  // 旧Geminiファイル由来の候補も必ず置換する。Geminiキーの有無とは独立。
  delete merged.code.antigravity_cli;
  if (installedClis.antigravity_cli === true) {
    const models = await (options.antigravityModelsReader ?? antigravityModels)();
    merged.code.antigravity_cli = {models:Object.keys(models).length ? models : {
      auto:'auto (自動判定)', same:'same (変更なし)',
    }};
  }
  merged.code = availableCodeModels(merged.code, installedClis);
  for (const [group, info] of Object.entries(merged)) {
    // 無効ラベルや旧 auto/same の除外後、CLI の補完後に空区分を落とす。
    let nonempty = Object.fromEntries(Object.entries(info).filter(([, entry]) => Object.keys(entry.models).length));
    if (group === 'chat' && Object.keys(nonempty).every(key => key === 'local_chat')) {
      const [, config] = await readConfig(options.configReader);
      const modelKeys = {gemini_chat:'CHAT_GEMINI_MODEL', freeai_chat:'CHAT_FREEAI_MODEL',
        openai_chat:'CHAT_OPENAI_MODEL', openai_oauth:'CHAT_OPENAI_MODEL', openrt_chat:'CHAT_OPENRT_MODEL',
        ollama_chat:'CHAT_OLLAMA_MODEL', local_chat:'CHAT_LOCAL_MODEL'};
      const provider = typeof config.CHAT_AI_NAME === 'string' ? config.CHAT_AI_NAME.trim() : '';
      const value = Object.hasOwn(modelKeys, provider) ? config[modelKeys[provider]] : null;
      const model = typeof value === 'string' ? value.trim() : '';
      if (model && !/^<.*>$/.test(model) && !Object.hasOwn(nonempty[provider]?.models ?? {}, model)) {
        // config 候補を local より先に保存する。既存 local のモデルと順序は維持する。
        const models = {...nonempty[provider]?.models, [model]:`仮設定（未検証） - ${model}`};
        nonempty = {...{[provider]:{models}}, ...Object.fromEntries(Object.entries(nonempty).filter(([key]) => key !== provider))};
      }
    }
    // 設定ファイル未作成でも選択欄を維持する。認証・導入済みの候補とは区別する。
    if (group === 'live' && !Object.keys(nonempty).length) {
      const [, config] = await readConfig(options.configReader);
      const modelKeys = {freeai_live:'LIVE_FREEAI_MODEL', gemini_live:'LIVE_GEMINI_MODEL', openai_live:'LIVE_OPENAI_MODEL'};
      const provider = typeof config.LIVE_AI_NAME === 'string' ? config.LIVE_AI_NAME.trim() : '';
      const value = Object.hasOwn(modelKeys, provider) ? config[modelKeys[provider]] : null;
      const model = typeof value === 'string' ? value.trim() : '';
      if (model && !/^<.*>$/.test(model)) nonempty[provider] = {models:{[model]:`仮設定（未検証） - ${model}`}};
    }
    if (group === 'code' && !Object.keys(nonempty).length) {
      nonempty.aidiy_hermes = {models:{auto:'仮設定（未検証） - auto'}};
    }
    const file = modelsInfoFile(group);
    await writeResult(path.join(directory, file), nonempty);
    saved.push(file);
    if(group==='code'){const naviHermesAvailable=options.naviHermesAvailable??await naviHermesInstalled();await writeResult(path.join(directory,NAVI_MODELS_FILE),naviModelsInfo(nonempty,{...options,naviHermesAvailable}));saved.push(NAVI_MODELS_FILE);}
  }
  return saved;
}

// 結果のあるプロバイダ分を保存したあと、用途別の合成ファイルも更新する。
// 失敗したら例外（それまでのファイルは置換済み、残りは以前の内容のまま）。
export async function writeModelsInfo(providers, results, {directory = OUTPUT_DIRECTORY, ...options} = {}) {
  const saved = [];
  for (const provider of providers) {
    const result = results[provider.id];
    if (!MODEL_PROVIDER_IDS.includes(provider.id) || !result || !(['OK', 'NG', 'PASS'].includes(result.状態) || (provider.id === 'ollama' && result.スキップ === true && result.状態 === '未実施'))) continue;
    const file = modelsInfoFile(provider.id);
    await writeResult(path.join(directory, file), await modelsInfo(provider, result, options));
    saved.push(file);
  }
  saved.push(...await writeMergedModelsInfo(directory, options.installedClis ?? await installedCodeClis(), providers, results, options));
  // 予測・判断用はディスクの旧一覧を認証証跡にしない。実行中の取得結果と現在の認証で再合成。
  let codeModels = {};
  try { codeModels = JSON.parse(await readFile(path.join(directory, modelsInfoFile('code')), 'utf8')); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  await writeResult(path.join(directory, PREDICTION_MODELS_FILE), await predictionModelsInfo(providers, results, {...options, codeModels}));
  saved.push(PREDICTION_MODELS_FILE);
  await writeResult(path.join(directory, DECISIONS_MODELS_FILE), await decisionsModelsInfo(providers, results, options));
  saved.push(DECISIONS_MODELS_FILE);
  await writeResult(path.join(directory, LIVE_VOICES_FILE), liveVoicesInfo());
  saved.push(LIVE_VOICES_FILE);
  return saved;
}
