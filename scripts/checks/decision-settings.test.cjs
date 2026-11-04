// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Web / Avatar の実SFCをコンパイルし、通信をモックして取得・編集・保存を検証する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../..');

for (const [project, relative] of [
  ['frontend_web', 'src/components/AiDiy/dialog/AI設定再起動.vue'],
  ['frontend_avatar', 'src/dialog/AI設定再起動.vue'],
]) {
  const req = createRequire(path.join(root, project, 'package.json'));
  const vue = req('vue');
  const {parse, compileScript, compileTemplate} = req('@vue/compiler-sfc');
  const ts = req('typescript');
  const {renderToString} = req('@vue/server-renderer');
  const filename = path.join(root, project, relative);
  const source = fs.readFileSync(filename, 'utf8');
  const {descriptor} = parse(source, {filename});
  const script = compileScript(descriptor, {id: project});
  const template = compileTemplate({source: descriptor.template.content, filename, id: project, compilerOptions: {bindingMetadata: script.bindings}});
  assert.deepEqual(template.errors, []);

  function fixture(settings = {}, catalogs = {}) {
    const calls = [];
    let saved = {...settings};
    const api = {post: async (url, body) => {
      calls.push({url, body});
      if (url.endsWith('/取得')) return {data: {status: 'OK', data: {モデル設定: {...saved}, available_models: catalogs}}};
      if (body.save) saved = {...body.モデル設定};
      return {data: {status: 'OK'}};
    }};
    function evaluate(code) {
      const exports = {};
      const js = ts.transpileModule(code, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
      vm.runInNewContext(js, {exports, require(name) {
        if (name === 'vue') return {...vue, onMounted() {}};
        if (name === '@/api/client') return {default: api};
        if (name.includes('qAlert')) return {qConfirm: async () => true, qAlert() {}, qMessage() {}};
        if (name.endsWith('.vue')) return {default: {render: () => null}};
        throw new Error('Unexpected import: ' + name);
      }, console});
      return exports;
    }
    const component = evaluate(script.content).default;
    const scope = vue.effectScope();
    const props = {isOpen: false, sessionId: 'fixture'};
    const bindings = scope.run(() => component.setup(props, {expose() {}, emit() {}}));
    return {bindings, calls, stop: () => scope.stop(), render: async () => {
      const render = evaluate(template.code).render;
      return renderToString(vue.createSSRApp({props: ['isOpen', 'sessionId'], render, setup: () => bindings}, {isOpen: true, sessionId: props.sessionId}));
    }};
  }


  const fields = [
    ['DECISION_OPENAI_MODEL','openai_decisions'], ['DECISION_OAUTH_MODEL','openai_oauth'],
    ['DECISION_GEMINI_MODEL','gemini_chat'], ['DECISION_FREEAI_MODEL','freeai_chat'],
  ];
  test(project + ': 新規4モデルautoとCHAT→LIVE→DECISION→CODE→TASK→TEAM順', async () => {
    const f=fixture();
    try {
      const b=f.bindings;await b.loadConfig();
      assert.equal(b.selections.decisionAi,'auto');
      const html=await f.render();
      const labels=['CHAT_AI_NAME:','LIVE_AI_NAME:','DECISION_AI_NAME:',...fields.map(([key])=>key+':'),'Code AI Setting','TASK_AI_NAME:','TEAM_AI_NAME:'];
      for(let i=1;i<labels.length;i++) assert.ok(html.indexOf(labels[i])>html.indexOf(labels[i-1]),labels[i]);
      for(const [key] of fields){assert.equal(b.decisionModels[key],'auto');assert.ok(html.includes('id="config-'+key+'"'));}
      const saved=b.buildNextSettings();assert.ok(!('DECISION_AI_MODEL' in saved));
      assert.doesNotMatch(source,/gpt-6-luna|gemini-flash-lite-latest|decision_fixed_models/);
    } finally {f.stop();}
  });
  test(project + ': 方式別の独立候補・保存再取得・再起動要求', async () => {
    const models=Object.fromEntries(fields.map(([key,provider])=>[key,provider+'-saved']));
    const f=fixture({DECISION_AI_NAME:'auto',...models,CUSTOM:'keep'},{decision_models:Object.fromEntries(fields.map(([key,provider])=>[provider,{[provider+'-new']:'retrieved'}]))});
    try {
      const b=f.bindings;await b.loadConfig();
      for(const field of b.decisionFields){
        assert.deepEqual(Array.from(b.decisionModelOptions(field),o=>o.value),['auto',field.provider+'-new',field.provider+'-saved']);
        b.decisionModels[field.key]=field.provider+'-new';
      }
      b.selections.decisionAi='openai_decisions';await b.handleSaveOnly();
      const saved=f.calls.at(-1).body;
      assert.equal(saved.save,true);assert.equal(saved.モデル設定.CUSTOM,'keep');
      assert.ok(Object.values(saved.再起動要求).every(value=>value===false));
      await b.loadConfig();
      for(const [key,provider] of fields){assert.equal(saved.モデル設定[key],provider+'-new');assert.equal(b.decisionModels[key],provider+'-new');}
      b.handleSave();await vue.nextTick();
      assert.equal(f.calls.at(-1).body.再起動要求.reboot_tools,true);
      assert.equal(f.calls.at(-1).body.モデル設定.DECISION_OPENAI_MODEL,'openai_decisions-new');
    } finally {f.stop();}
  });
  test(project + ': 別名を保持し方式別キーがなければautoで表示する', async () => {
    const f=fixture({DECISION_AI_NAME:'openai_jsonchat',DECISION_OPENAI_MODEL:'auto'}, {decision_models:{openai_oauth:{known:'known'}}});
    try {
      const b=f.bindings;await b.loadConfig();
      assert.ok(b.decisionAiOptions.value.includes('openai_jsonchat'));
      assert.equal(b.decisionModels.DECISION_OPENAI_MODEL,'auto');
      for(const [key] of fields.slice(1))assert.equal(b.decisionModels[key],'auto');
      assert.ok(b.decisionModelOptions(b.decisionFields[1]).some(o=>o.value==='known'));
      await b.handleSaveOnly();await b.loadConfig();
      assert.ok(!('DECISION_AI_MODEL' in b.buildNextSettings()));
      assert.equal(b.buildNextSettings().DECISION_AI_NAME,'openai_jsonchat');
    } finally {f.stop();}
  });
  test(project + ': 全4方式でDiag候補変更後のモデルを選択・保存・再読込', async () => {
    const catalogs={decision_models:{}};const f=fixture({},catalogs);
    try {
      const b=f.bindings;
      for(const [key,provider] of fields){
        catalogs.decision_models[provider]={'new-from-diag':'retrieved'};
        await b.loadConfig();b.selections.decisionAi=provider;await vue.nextTick();
        assert.ok(b.decisionModelOptions(b.decisionFields.find(f=>f.key===key)).some(o=>o.value==='new-from-diag'));
        assert.doesNotMatch(await f.render(),new RegExp('id="config-'+key+'"[^>]*disabled'));
        b.decisionModels[key]='new-from-diag';await b.handleSaveOnly();await b.loadConfig();
        assert.equal(b.decisionModels[key],'new-from-diag');
      }
    } finally {f.stop();}
  });
  test(project + ': 候補未取得でも他設定・未掲載値を失わない', async () => {
    const settings={CHAT_AI_NAME:'saved-chat',LIVE_AI_NAME:'saved-live',CODE_AI1_NAME:'saved-code',CODE_AI1_MODEL:'saved-model',TASK_AI_NAME:'saved-task',TASK_AI_MODEL_plan:'saved-plan',CUSTOM:'keep',DECISION_AI_NAME:'future-provider',DECISION_FREEAI_MODEL:'future-model'};
    const f=fixture(settings);
    try {
      const b=f.bindings;await b.loadConfig();assert.match(await f.render(),/取得済み候補はありません/);
      b.selections.decisionAi='freeai_chat';await b.handleSaveOnly();
      assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1).body.モデル設定)),{...settings,DECISION_AI_NAME:'freeai_chat',PREDICTION_AI_NAME:'auto',PREDICTION_OPENAI_MODEL:'auto',PREDICTION_OAUTH_MODEL:'auto',PREDICTION_GEMINI_MODEL:'auto',PREDICTION_FREEAI_MODEL:'auto',PREDICTION_CODEX_CLI_MODEL:'auto',PREDICTION_COPILOT_CLI_MODEL:'auto',PREDICTION_AIDIY_HERMES_MODEL:'auto',...Object.fromEntries(fields.map(([key])=>[key,key==='DECISION_FREEAI_MODEL'?'future-model':'auto']))});
      await b.loadConfig();assert.equal(b.decisionModels.DECISION_FREEAI_MODEL,'future-model');
    } finally {f.stop();}
  });
}
