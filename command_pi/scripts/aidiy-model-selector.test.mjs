import assert from 'node:assert/strict';
import test from 'node:test';
import '../packages/coding-agent/src/experimental/source-resolver.ts';
const { ModelSelectorComponent } = await import('../packages/coding-agent/src/modes/interactive/components/model-selector.ts');
const { initTheme } = await import('../packages/coding-agent/src/modes/interactive/theme/theme.ts');
initTheme('dark');
const model = (provider, id) => ({ provider, id, name: id });
const models = [model('openai_oauth', 'z'), model('freeai', 'z'), model('openai_oauth', 'gpt-6.2-sol'), model('freeai', 'a')];
const keys = items => items.map(item => `${item.provider}/${item.id}`);
function selector(scoped = []) {
 const runtime = {
  getAvailableSnapshot: () => models,
  getModel: (provider, id) => models.find(m => m.provider === provider && m.id === id),
  refresh: async () => ({ errors: new Map(), aborted: false }),
  getError: () => undefined,
 };
 return new ModelSelectorComponent({ requestRender() {} }, models[0], runtime, scoped, () => {}, () => {}, undefined, () => {}, models[2]);
}
const expected = ['freeai/a', 'freeai/z', 'openai_oauth/gpt-6.2-sol', 'openai_oauth/z'];
test('all list sorts combined names without current/default promotion and renders provider/model', () => {
 const component = selector();
 try {
  assert.deepEqual(keys(component.filteredModels), expected);
  assert.equal(component.filteredModels[component.selectedIndex].model, models[0]);
  const text = component.render(100).join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(text, /openai_oauth\/gpt-6\.2-sol/);
  assert.doesNotMatch(text, /\[openai_oauth\]/);
 } finally { component.dispose(); }
});
test('scoped list uses same order; switching, filtering and refresh keep model identity', async () => {
 const component = selector(models.map(model => ({ model })));
 try {
  assert.deepEqual(keys(component.filteredModels), expected);
  component.setScope('all');
  component.filterModels('openai_oauth/gpt-6.2-sol');
  assert.equal(component.filteredModels[0].model, models[2]);
  component.filterModels('');
  assert.deepEqual(keys(component.filteredModels), expected);
  await new Promise(resolve => setImmediate(resolve));
  await component.refreshModels();
  assert.deepEqual(keys(component.filteredModels), expected);
 } finally { component.dispose(); }
});
