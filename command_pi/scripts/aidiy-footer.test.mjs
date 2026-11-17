import assert from 'node:assert/strict';
import test from 'node:test';
import '../packages/coding-agent/src/experimental/source-resolver.ts';
const { FooterComponent, formatModelForFooter } = await import('../packages/coding-agent/src/modes/interactive/components/footer.ts');
const { initTheme } = await import('../packages/coding-agent/src/modes/interactive/theme/theme.ts');
const { visibleWidth } = await import('@earendil-works/pi-tui');
initTheme('dark');
const plain = text => text.replace(/\x1b\[[0-9;]*m/g, '');
function footer(providerCount = 1) {
 const model = { provider: 'openai_oauth', id: 'gpt-6.1-sol', reasoning: true, contextWindow: 100000 };
 const session = {
  model, state: { model, thinkingLevel: 'medium' },
  sessionManager: {
   getEntryCount: () => 0, getSessionId: () => 'test', getLeafId: () => null,
   getEntries: () => [], getCwd: () => '/test', getSessionName: () => undefined,
  },
  getContextUsage: () => ({ percent: 0, contextWindow: 100000 }),
  modelRuntime: { isUsingSubscription: () => false },
 };
 return { session, component: new FooterComponent(session, {
  getGitBranch: () => undefined, getAvailableProviderCount: () => providerCount,
  getExtensionStatuses: () => new Map(),
 }) };
}
test('footer shows provider/model for single and multiple providers, right-aligned', () => {
 for (const count of [1, 3]) {
  const { component } = footer(count);
  const line = plain(component.render(100)[1]);
  assert.ok(line.endsWith('openai_oauth/gpt-6.1-sol • medium'));
  assert.equal(visibleWidth(line), 100);
  assert.doesNotMatch(line, /\(openai_oauth\)/);
 }
});
test('footer avoids duplicate provider and handles missing model', () => {
 assert.equal(formatModelForFooter({ provider: 'openai_oauth', id: 'openai_oauth/gpt-6.1-sol' }), 'openai_oauth/gpt-6.1-sol');
 assert.equal(formatModelForFooter(undefined), 'no-model');
 assert.equal(formatModelForFooter({ provider: '', id: 'local' }), 'local');
});
test('narrow terminals never overflow or drop provider in favor of bare model', () => {
 const { component } = footer();
 for (let width = 1; width <= 100; width++) {
  for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width, `width ${width}`);
  const line = plain(component.render(width)[1]);
  if (line.includes('gpt-6')) assert.ok(line.includes('openai_oauth/'));
 }
});
test('model changes and routed responses use the same combined label', () => {
 const { component, session } = footer();
 session.state.model = { provider: 'copilot_cli', id: 'claude-sonnet-5.5' };
 session.model = session.state.model;
 session.routedModel = { model: { provider: 'freeai', id: 'gemini' }, thinkingLevel: 'low' };
 const line = plain(component.render(120)[1]);
 assert.ok(line.endsWith('copilot_cli/claude-sonnet-5.5 → freeai/gemini • low'));
 assert.ok(!line.includes('openai_oauth'));
 session.state.model = undefined;
 session.model = undefined;
 session.routedModel = undefined;
 assert.ok(plain(component.render(80)[1]).endsWith('no-model'));
});
