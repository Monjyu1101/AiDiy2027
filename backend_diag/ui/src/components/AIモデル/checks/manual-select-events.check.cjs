// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Exercise the actual AI-model panel's native select event handlers without AI/network calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const {component} = require('../../../../../checks/ui-components.cjs');
const {createRenderer, h, nextTick} = require('vue');
const make = (tag, text = '') => ({tag, text, children: [], props: {}, parent: null});
const renderer = createRenderer({
  createElement: tag => make(tag), createText: text => make('#text', text), createComment: text => make('#comment', text),
  setText: (node, text) => node.text = text, setElementText: (node, text) => {node.text = text;node.children = [];},
  parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  patchProp: (node, key, old, value) => node.props[key] = value,
  insert(node, parent, anchor) {if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);node.parent = parent;const index = anchor ? parent.children.indexOf(anchor) : -1;parent.children.splice(index < 0 ? parent.children.length : index, 0, node);},
  remove(node) {node.parent?.children.splice(node.parent.children.indexOf(node), 1);},
});
const descendants = node => [node, ...node.children.flatMap(descendants)];
test('Diag: all four family/provider/model selects and Live voice update through rendered events without running AI', async () => {
  const {AIモデル状態を作成} = await import('../AIモデル状態.mjs');
  const catalog = {区分: Object.fromEntries(['CHAT', 'LIVE', 'DECISION', 'CODE'].map(family => [family, {プロバイダ: [
    {id: 'first', モデル: [{id: 'one', 名前: 'One'}, {id: 'two', 名前: 'Two'}], 音声: [{id: 'voice-one', 名前: 'One'}, {id: 'voice-two', 名前: 'Two'}]},
    {id: 'second', モデル: [{id: 'three', 名前: 'Three'}], 音声: [{id: 'other', 名前: 'Other'}]},
  ]}]))};
  const calls = [], state = AIモデル状態を作成({接続可能: () => true, api: async (...args) => {calls.push(args);assert.equal(args[0], 'api/AIモデル');return catalog;}});
  const root = make('root'), app = renderer.createApp({render: () => h(component('components/AIモデル/AIモデルパネル.vue').default, {state, online: true, visible: true})});
  const select = async (label, value) => {
    const node = descendants(root).find(item => item.tag === 'select' && item.props['aria-label'] === label);
    assert.ok(node, label);assert.ok(!node.props.disabled);
    assert.ok(descendants(node).some(item => item.tag === 'option' && item.props.value === value), `${label}: ${value}`);
    const target = new EventTarget();target.value = value;target.addEventListener('change', node.props.onChange);
    target.dispatchEvent(new Event('change'));await nextTick();
  };
  try {
    await state.読込();app.mount(root);await nextTick();
    for (const family of ['CHAT', 'LIVE', 'DECISION', 'CODE']) {
      const tab = descendants(root).find(node => node.tag === 'button' && node.text === family);
      assert.ok(tab, family);tab.props.onClick();await nextTick();
      await select('モデル', 'two');assert.equal(state.入力.model, 'two');
      await select('プロバイダ', 'second');assert.equal(state.入力.model, 'three');
      await select('プロバイダ', 'first');assert.equal(state.入力.model, 'two');
      if (family === 'LIVE') {await select('音声', 'voice-two');assert.equal(state.入力.voice, 'voice-two');}
    }
    assert.equal(calls.length, 1, 'Changing candidates must not run a trial, save settings, or contact an AI');
  } finally {app.unmount();state.終了();}
});
