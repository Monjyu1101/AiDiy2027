// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Compile both actual settings dialogs and exercise Vue's native-select change binding.
// API responses are synthetic. No services, AI, configuration files or desktop windows are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(project) {
  const local = createRequire(path.join(root, project, 'package.json'));
  const vue = local('vue'), { parse, compileScript, compileTemplate } = local('@vue/compiler-sfc'), ts = local('typescript');
  const filename = project === 'frontend_web' ? 'src/components/AiDiy/dialog/AI設定再起動.vue' : 'src/dialog/AI設定再起動.vue';
  const settings = { CHAT_AI_NAME: 'openai_chat', CHAT_OPENAI_MODEL: 'chat-one', CHAT_GEMINI_MODEL: 'gemini-one',
    LIVE_AI_NAME: 'freeai_live', LIVE_FREEAI_MODEL: 'freeai-one', LIVE_FREEAI_VOICE: 'voice-one',
    LIVE_OPENAI_MODEL: 'openai-one', LIVE_OPENAI_VOICE: 'voice-one', DECISION_AI_NAME: 'auto',
    CODE_CODEX_CLI_MODEL: 'auto', CODE_AIDIY_HERMES_MODEL: 'openai_oauth/one', CODE_BASE_PATH: '../', CODE_PERMISSIONS: 'auto',
    TASK_AI_NAME: 'codex_cli', TEAM_AI_NAME: 'codex_cli' };
  for (let i = 1; i <= 6; i++) Object.assign(settings, { [`CODE_AI${i}_NAME`]: 'codex_cli', [`CODE_AI${i}_MODEL`]: 'same' });
  for (const family of ['TASK', 'TEAM']) for (const phase of ['plan', 'do', 'check']) settings[`${family}_AI_MODEL_${phase}`] = 'same';
  for (const field of ['OPENAI', 'OAUTH', 'GEMINI', 'FREEAI']) settings[`DECISION_${field}_MODEL`] = 'retained-model';
  const available_models = {
    chat_models: { openai_chat: {'chat-one': 'One', 'chat-two': 'Two'}, gemini_chat: {'gemini-one': 'One', 'gemini-two': 'Two'} },
    live_models: { freeai_live: {'freeai-one': 'One', 'freeai-two': 'Two'}, openai_live: {'openai-one': 'One', 'openai-two': 'Two'} },
    live_voices: { freeai_live: {'voice-one': 'One', 'voice-two': 'Two'}, openai_live: {'voice-one': 'One', 'voice-two': 'Two'} },
    code_models: { codex_cli: {auto: 'Auto', same: 'Same', custom: 'Custom'}, aidiy_hermes: {'openai_oauth/one': 'One', 'openai_oauth/two': 'Two'} },
    decision_models: Object.fromEntries(['openai_decisions', 'openai_oauth', 'gemini_chat', 'freeai_chat'].map(id => [id, {'decision-one': 'One', 'decision-two': 'Two'}])),
  };
  const calls = [], emitted = [], module = {exports: {}}, props = { isOpen: false, sessionId: 'fixture' };
  const { descriptor } = parse(fs.readFileSync(path.join(root, project, filename), 'utf8'));
  const script = compileScript(descriptor, {id: 'settings-popup-test', genDefaultAs: 'component'});
  const template = compileTemplate({source: descriptor.template.content, filename, id: 'settings-popup-test', compilerOptions: {bindingMetadata: script.bindings}});
  assert.deepEqual(template.errors, []);
  const compiled = ts.transpileModule(`${script.content}\n${template.code}\ncomponent.render=render;module.exports=component;`, { compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS} }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, console,
    require(id) {
      if (id === 'vue') return {...vue, onMounted() {}, withDirectives: node => node};
      if (id.endsWith('/api/client')) return {default: {post: async (url, body) => {
        calls.push({url, body: copy(body)});
        return {data: {status: 'OK', data: {available_models, モデル設定: copy(settings)}}};
      }}};
      if (id.endsWith('/utils/qAlert')) return {qAlert: async () => {}, qMessage: async () => {}, qConfirm: async () => true};
      if (id.endsWith('.vue')) return {default: {render: () => null}};
      throw Error(`Unexpected dependency: ${id}`);
    },
  });
  const scope = vue.effectScope(), component = module.exports;
  const data = scope.run(() => component.setup(props, {expose() {}, emit: (...args) => emitted.push(args)}));
  const walk = (node, predicate) => {
    if (predicate(node)) return node;
    const children = Array.isArray(node?.children) ? node.children : node?.children?.default?.() || [];
    for (const child of children) {const found = walk(child, predicate);if (found) return found;}
  };
  const render = () => component.render({}, [], {...props, isOpen: true}, vue.proxyRefs(data), {}, {});
  const control = id => walk(render(), node => node?.type === 'select' && node.props?.id === id);
  return { data, calls, emitted, render, control,
    async load() {await data.loadConfig();await flush();assert.equal(data.errorMessage.value, '');},
    async choose(id, value) {
      const node = control(id);assert.ok(node, id);assert.ok(!node.props.disabled, id);
      const el = new EventTarget(), options = [];
      walk(node, child => {if (child?.type === 'option') options.push({_value: child.props.value, selected: false});return false;});
      Object.assign(el, {options, multiple: false});
      Object.defineProperty(el, 'selectedIndex', {get: () => options.findIndex(o => o.selected), set: index => options.forEach((o, i) => o.selected = i === index)});
      vue.vModelSelect.created(el, {value: '', modifiers: {}}, node);
      vue.vModelSelect.mounted(el, {value: ''});
      el.addEventListener('change', event => {for (const fn of [node.props.onChange].flat().filter(Boolean)) fn(event);});
      el.selectedIndex = options.findIndex(o => o._value === value);assert.notEqual(el.selectedIndex, -1, `${id}: ${value}`);
      el.dispatchEvent(new Event('change'));await flush();
    },
    async save() {await data.handleSaveOnly();await flush();return calls.filter(c => c.url.endsWith('/設定')).at(-1)?.body;},
    close() {scope.stop();},
  };
}
for (const project of ['frontend_web', 'frontend_avatar']) {
  test(`${project}: native select events commit Chat, Live, voice and all four Decision model fields`, async () => {
    const f = fixture(project);
    try {
      await f.load();
      await f.choose('config-chat-ai-select', 'gemini_chat');await f.choose('config-chat-model-select', 'gemini-two');
      await f.choose('config-live-ai-select', 'openai_live');await f.choose('config-live-model-select', 'openai-two');await f.choose('config-live-voice-select', 'voice-two');
      await f.choose('config-decision-ai-select', 'openai_oauth');
      for (const field of ['OPENAI', 'OAUTH', 'GEMINI', 'FREEAI']) await f.choose(`config-DECISION_${field}_MODEL`, 'decision-two');
      const sent = (await f.save()).モデル設定;
      assert.equal(sent.CHAT_AI_NAME, 'gemini_chat');assert.equal(sent.CHAT_GEMINI_MODEL, 'gemini-two');
      assert.equal(sent.LIVE_AI_NAME, 'openai_live');assert.equal(sent.LIVE_OPENAI_MODEL, 'openai-two');assert.equal(sent.LIVE_OPENAI_VOICE, 'voice-two');
      assert.equal(sent.DECISION_AI_NAME, 'openai_oauth');
      for (const field of ['OPENAI', 'OAUTH', 'GEMINI', 'FREEAI']) assert.equal(sent[`DECISION_${field}_MODEL`], 'decision-two');
    } finally {f.close();}
  });
  test(`${project}: every Code slot and Task/Team phase commits via its actual select event`, async () => {
    const f = fixture(project);
    try {
      await f.load();
      for (let i = 1; i <= 6; i++) {
        await f.choose(`config-code-ai${i}-select`, 'aidiy_hermes');
        await f.choose(`config-code-model${i}-select`, 'openai_oauth/two');
      }
      for (const family of ['task', 'team']) {
        await f.choose(`config-${family}-ai-select`, 'aidiy_hermes');
        for (const phase of ['plan', 'do', 'check']) await f.choose(`config-${family}-model-${phase}-select`, 'openai_oauth/two');
      }
      const sent = (await f.save()).モデル設定;
      for (let i = 1; i <= 6; i++) {assert.equal(sent[`CODE_AI${i}_NAME`], 'aidiy_hermes');assert.equal(sent[`CODE_AI${i}_MODEL`], 'openai_oauth/two');}
      for (const family of ['TASK', 'TEAM']) {assert.equal(sent[`${family}_AI_NAME`], 'aidiy_hermes');for (const phase of ['plan', 'do', 'check']) assert.equal(sent[`${family}_AI_MODEL_${phase}`], 'openai_oauth/two');}
    } finally {f.close();}
  });
  test(`${project}: cancel after selecting a model does not send a save request`, async () => {
    const f = fixture(project);
    try {
      await f.load();await f.choose('config-chat-model-select', 'chat-two');
      f.data.handleCancel();await flush();
      assert.equal(f.calls.filter(c => c.url.endsWith('/設定')).length, 0);
      assert.ok(f.emitted.some(([name]) => name === 'close'));
    } finally {f.close();}
  });
}
