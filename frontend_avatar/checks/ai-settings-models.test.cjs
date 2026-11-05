// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Web / Avatar の実際の SFC スクリプトを Vue のリアクティビティで実行する。API は合成データのみ。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const providers = ['claude_sdk', 'claude_cli', 'claude_ollama', 'copilot_cli', 'codex_cli', 'codex_ollama', 'antigravity_cli', 'grok_cli', 'opencode_cli', 'aidiy_hermes'];

function fixture() {
  const settings = {CODE_BASE_PATH: '../', CODE_PERMISSIONS: 'auto', TASK_AI_NAME: 'codex_cli', TEAM_AI_NAME: 'aidiy_hermes'};
  const code_models = Object.fromEntries(providers.map(provider => {
    settings[`CODE_${provider.toUpperCase()}_MODEL`] = provider === 'grok_cli' ? 'same' : provider === 'opencode_cli' ? 'openai/custom' : 'auto';
    return [provider, {auto: 'auto', same: 'same', custom: 'Custom', 'openai/custom': 'OpenCode', 'openai_oauth/custom': 'Hermes'}];
  }));
  for (let index = 1; index <= 6; index++) {
    settings[`CODE_AI${index}_NAME`] = providers[index - 1];
    settings[`CODE_AI${index}_MODEL`] = index % 2 ? 'custom' : 'same';
  }
  for (const group of ['TASK', 'TEAM']) for (const phase of ['plan', 'do', 'check']) settings[`${group}_AI_MODEL_${phase}`] = phase === 'plan' ? 'custom' : 'same';
  return {settings, code_models};
}

function load(project, filename, data) {
  const requireLocal = createRequire(path.join(root, project, 'package.json'));
  const vue = requireLocal('vue'), ts = requireLocal('typescript'), compiler = requireLocal('@vue/compiler-sfc');
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  const {descriptor, errors} = compiler.parse(source);
  assert.deepEqual(errors, []);
  const compiled = compiler.compileScript(descriptor, {id: 'settings-test'});
  assert.deepEqual(compiler.compileTemplate({source: descriptor.template.content, filename, id: 'settings-test', compilerOptions: {bindingMetadata: compiled.bindings}}).errors, []);
  const script = descriptor.scriptSetup.content.replace(/^import .*$/gm, '');
  const js = ts.transpileModule(script, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText;
  const calls = [], scope = vue.effectScope();
  const dependencies = {...vue, onMounted: () => {}, defineProps: () => ({isOpen: false, sessionId: 'fixture'}), defineEmits: () => () => {},
    apiClient: {post: async (url, body) => {calls.push({url, body});return {data: {status: 'OK', data: {available_models: {code_models: data.code_models, ...data.available_models}, モデル設定: structuredClone(data.settings)}}};}},
    qAlert: async () => {}, qMessage: async () => {}, qConfirm: async () => true};
  const api = scope.run(() => new Function(...Object.keys(dependencies), js + '\nreturn {selections, chatAiOptions, chatModelOptions, errorMessage, loadConfig, buildNextSettings, handleCodeAiChange, copyCode1Settings, copyCode4Settings, handleTaskAiChange, handleTeamAiChange, handleSaveOnly};')(...Object.values(dependencies)));
  return {...api, calls, nextTick: vue.nextTick, close: () => scope.stop(), template: descriptor.template.content};
}

for (const [project, filename] of [['frontend_web', 'frontend_web/src/components/AiDiy/dialog/AI設定再起動.vue'], ['frontend_avatar', 'frontend_avatar/src/dialog/AI設定再起動.vue']]) {
  test(`${project}: openrt_free selects and saves its own models without changing paid OpenRouter settings`, async () => {
    const data = fixture();
    Object.assign(data.settings, {CHAT_AI_NAME: 'openrt_chat', CHAT_OPENRT_MODEL: 'vendor/paid', CHAT_OPENRT_FREE_MODEL: 'auto'});
    data.available_models = {chat_models: {openrt_chat: {'vendor/paid': 'Paid'}, openrt_free: {'vendor/new:free': 'New free', 'vendor/other:free': 'Other free'}}};
    const app = load(project, filename, data);
    try {
      await app.loadConfig(); await app.nextTick();
      assert.ok(app.chatAiOptions.value.includes('openrt_free'));
      app.selections.chatAi = 'openrt_free'; await app.nextTick();
      assert.ok(app.chatModelOptions.value.every(model => model.value !== 'vendor/paid'));
      assert.equal(app.selections.chatModel, 'vendor/new:free');
      app.selections.chatModel = 'vendor/other:free';
      await app.handleSaveOnly();
      const saved = app.calls.at(-1).body.モデル設定;
      assert.equal(saved.CHAT_AI_NAME, 'openrt_free');
      assert.equal(saved.CHAT_OPENRT_FREE_MODEL, 'vendor/other:free');
      assert.equal(saved.CHAT_OPENRT_MODEL, 'vendor/paid');
      Object.assign(data.settings, saved);
      await app.loadConfig(); await app.nextTick();
      assert.equal(app.selections.chatAi, 'openrt_free');
      assert.equal(app.selections.chatModel, 'vendor/other:free');
      app.selections.chatAi = 'openrt_chat'; await app.nextTick();
      assert.equal(app.selections.chatModel, 'vendor/paid');
      app.selections.chatAi = 'openrt_free'; await app.nextTick();
      assert.equal(app.selections.chatModel, 'vendor/other:free');
    } finally {app.close();}
  });
  test(`${project}: missing free setting uses free candidates, never the paid setting`, async () => {
    const data = fixture();
    Object.assign(data.settings, {CHAT_AI_NAME: 'openrt_chat', CHAT_OPENRT_MODEL: 'vendor/paid'});
    data.available_models = {chat_models: {openrt_chat: {'vendor/paid': 'Paid'}, openrt_free: {'vendor/new:free': 'Free'}}};
    const app = load(project, filename, data);
    try {
      await app.loadConfig(); await app.nextTick();
      assert.ok(app.chatAiOptions.value.includes('openrt_free'));
      app.selections.chatAi = 'openrt_free'; await app.nextTick();
      assert.ok(app.chatModelOptions.value.every(model => model.value !== 'vendor/paid'));
      assert.equal(app.selections.chatModel, 'vendor/new:free');
      assert.equal(app.buildNextSettings().CHAT_OPENRT_FREE_MODEL, 'vendor/new:free');
      assert.equal(app.buildNextSettings().CHAT_OPENRT_MODEL, 'vendor/paid');
    } finally {app.close();}
  });
  test(`${project}: missing or empty free catalog follows normal provider selection`, async () => {
    for (const free of [{}, {openrt_free: {}}]) {
      const data = fixture();
      Object.assign(data.settings, {CHAT_AI_NAME: 'openrt_free', CHAT_OPENRT_MODEL: 'vendor/paid', CHAT_OPENRT_FREE_MODEL: 'auto'});
      data.available_models = {chat_models: {openrt_chat: {'vendor/paid': 'Paid'}, ...free}};
      const app = load(project, filename, data);
      try {
        await app.loadConfig(); await app.nextTick();
        assert.equal(app.selections.chatAi, free.openrt_free ? 'openrt_free' : 'openrt_chat');
        assert.equal(app.selections.chatModel, free.openrt_free ? '' : 'vendor/paid');
        // 他の方式と同じく、未編集の設定値は表示上の補正だけで書き換えない。
        await app.handleSaveOnly();
        const saved = app.calls.at(-1).body.モデル設定;
        assert.equal(saved.CHAT_AI_NAME, 'openrt_free');
        assert.equal(saved.CHAT_OPENRT_FREE_MODEL, 'auto');
        assert.equal(saved.CHAT_OPENRT_MODEL, 'vendor/paid');
      } finally {app.close();}
    }
  });
  test(`${project}: Chat/Live watchers select available values without replacing untouched saved settings`, async () => {
    const data = fixture();
    Object.assign(data.settings, {
      CHAT_AI_NAME: 'openai_chat', CHAT_OPENAI_MODEL: 'retired-chat', CHAT_GEMINI_MODEL: 'retired-gemini',
      LIVE_AI_NAME: 'freeai_live', LIVE_FREEAI_MODEL: 'retired-live', LIVE_FREEAI_VOICE: 'retired-voice',
      LIVE_GEMINI_MODEL: 'retired-gemini-live', LIVE_GEMINI_VOICE: 'retired-gemini-voice',
      LIVE_OPENAI_MODEL: 'saved-openai-live', LIVE_OPENAI_VOICE: 'saved-openai-voice',
    });
    data.available_models = {
      chat_models: {openai_chat: {'available-chat': 'Chat'}, gemini_chat: {'available-gemini': 'Gemini'}},
      live_models: {freeai_live: {'available-live': 'Live'}, gemini_live: {'available-gemini-live': 'Gemini'}, openai_live: {first: 'First', 'saved-openai-live': 'Saved'}},
      live_voices: {freeai_live: {'available-voice': 'Voice'}, gemini_live: {'available-gemini-voice': 'Gemini'}, openai_live: {first: 'First', 'saved-openai-voice': 'Saved'}},
    };
    const app = load(project, filename, data);
    try {
      await app.loadConfig(); await app.nextTick();
      assert.equal(app.errorMessage.value, '');
      assert.equal(app.selections.chatModel, 'available-chat');
      assert.equal(app.selections.liveModel, 'available-live');
      assert.equal(app.selections.liveVoice, 'available-voice');
      // 候補の代替表示だけでは、未編集の保存値を書き換えない。
      for (const key of ['CHAT_OPENAI_MODEL', 'LIVE_FREEAI_MODEL', 'LIVE_FREEAI_VOICE']) assert.equal(app.buildNextSettings()[key], data.settings[key]);
      app.selections.chatAi = 'gemini_chat'; app.selections.liveAi = 'gemini_live'; await app.nextTick();
      assert.equal(app.selections.chatModel, 'available-gemini');
      assert.equal(app.selections.liveModel, 'available-gemini-live');
      assert.equal(app.selections.liveVoice, 'available-gemini-voice');
      await app.handleSaveOnly();
      const sent = app.calls.at(-1).body.モデル設定;
      assert.equal(sent.CHAT_GEMINI_MODEL, 'available-gemini');
      assert.equal(sent.LIVE_GEMINI_MODEL, 'available-gemini-live');
      assert.equal(sent.LIVE_GEMINI_VOICE, 'available-gemini-voice');
      app.selections.liveAi = 'openai_live'; await app.nextTick();
      assert.equal(app.selections.liveModel, 'saved-openai-live');
      assert.equal(app.selections.liveVoice, 'saved-openai-voice');
    } finally {app.close();}
  });

  test(`${project}: empty Chat/Live catalogs leave no invisible selection and preserve untouched settings`, async () => {
    const data = fixture();
    Object.assign(data.settings, {CHAT_AI_NAME: 'openai_chat', CHAT_OPENAI_MODEL: 'saved-chat', LIVE_AI_NAME: 'freeai_live', LIVE_FREEAI_MODEL: 'saved-live', LIVE_FREEAI_VOICE: 'saved-voice'});
    data.available_models = {chat_models: {openai_chat: {}}, live_models: {freeai_live: {}}, live_voices: {freeai_live: {}}};
    const app = load(project, filename, data);
    try {
      await app.loadConfig(); await app.nextTick();
      for (const field of ['chatModel', 'liveModel', 'liveVoice']) assert.equal(app.selections[field], '');
      for (const key of ['CHAT_OPENAI_MODEL', 'LIVE_FREEAI_MODEL', 'LIVE_FREEAI_VOICE']) assert.equal(app.buildNextSettings()[key], data.settings[key]);
    } finally {app.close();}
  });

  test(`${project}: saved values survive loading and every Code slot uses the provider default on manual change`, async () => {
    const data = fixture(), app = load(project, filename, data);
    try {
      await app.loadConfig();await app.nextTick();assert.equal(app.errorMessage.value, '');
      for (let index = 1; index <= 6; index++) {
        assert.equal(app.selections[`codeModel${index}`], data.settings[`CODE_AI${index}_MODEL`]);
        assert.match(app.template, new RegExp(`id="config-code-ai${index}-select"[^>]*@change="handleCodeAiChange\\(${index}\\)"`));
      }
      for (const [key, value] of Object.entries(data.settings)) assert.equal(app.buildNextSettings()[key], value, key);
      for (const provider of providers) for (let index = 1; index <= 6; index++) {
        app.selections[`codeAi${index}`] = provider;
        app.handleCodeAiChange(index);await app.nextTick();
        assert.equal(app.selections[`codeModel${index}`], data.settings[`CODE_${provider.toUpperCase()}_MODEL`], `${provider}/${index}`);
      }
      assert.equal(app.calls.length, 1);
    } finally {app.close();}
  });

  test(`${project}: explicit model copies survive cascades and save payloads retain Grok same and prefixed models`, async () => {
    const app = load(project, filename, fixture());
    try {
      await app.loadConfig();
      app.selections.codeAi1 = 'grok_cli';app.handleCodeAiChange(1);await app.nextTick();
      for (let index = 1; index <= 6; index++) assert.equal(app.selections[`codeModel${index}`], 'same');
      app.selections.codeModel1 = 'custom';app.copyCode1Settings();await app.nextTick();
      for (let index = 1; index <= 6; index++) assert.equal(app.selections[`codeModel${index}`], 'custom');
      app.selections.codeAi4 = 'opencode_cli';app.handleCodeAiChange(4);await app.nextTick();
      for (const index of [4, 5, 6]) assert.equal(app.selections[`codeModel${index}`], 'openai/custom');
      assert.equal(app.selections.codeModel3, 'custom');
      app.selections.codeAi5 = 'grok_cli';app.handleCodeAiChange(5);
      app.selections.codeAi6 = 'aidiy_hermes';app.handleCodeAiChange(6);
      app.selections.codeModel6 = 'openai_oauth/custom';
      app.selections.taskAi = 'grok_cli';app.handleTaskAiChange();await app.nextTick();
      for (const key of ['taskModelPlan', 'taskModelDo', 'taskModelCheck', 'teamModelPlan', 'teamModelDo', 'teamModelCheck']) assert.equal(app.selections[key], 'same');
      app.selections.teamAi = 'opencode_cli';app.handleTeamAiChange();await app.nextTick();
      assert.equal(app.selections.teamModelPlan, 'openai/custom');
      await app.handleSaveOnly();
      const sent = app.calls.at(-1).body;
      assert.equal(sent.モデル設定.CODE_AI5_MODEL, 'same');
      assert.equal(sent.モデル設定.CODE_AI4_MODEL, 'openai/custom');
      assert.equal(sent.モデル設定.CODE_AI6_MODEL, 'openai_oauth/custom');
      assert.equal(sent.モデル設定.CODE_GROK_CLI_MODEL, 'same');
      assert.equal(sent.モデル設定.TASK_AI_MODEL_plan, 'same');
      assert.ok(Object.values(sent.再起動要求).every(value => value === false));
    } finally {app.close();}
  });
}
