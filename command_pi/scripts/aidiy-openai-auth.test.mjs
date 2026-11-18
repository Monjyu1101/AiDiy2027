import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the actual provider builder/auth resolver with an isolated config and no network.
// No user credential file, environment key, OAuth file, or auth.json is read or modified.
const moduleUrl = new URL('../aidiy/aidiy-providers.ts', import.meta.url);
const source = stripTypeScriptTypes(readFileSync(moduleUrl, 'utf8'))
 .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
 .replace(/\bexport\s+/g, '')
 .replaceAll('import.meta.url', JSON.stringify(moduleUrl.href));
function harness() {
 let config = { openai_key_id: 'fake-config-openai', unrelated: 'not-an-api-key' };
 let reads = 0, oauthCalls = 0;
 const context = {
  dirname, join, resolve, fileURLToPath, homedir: () => '/fake-home',
  process: { env: { OPENAI_API_KEY: 'fake-env-key' } },
  readFileSync: path => {
   assert.equal(path, join(dirname(fileURLToPath(moduleUrl)), '..', '..', '_config', 'AiDiy_key.json'));
   reads++;
   return typeof config === 'string' ? config : JSON.stringify(config);
  },
  getBuiltinModels: () => [{ id: 'test-model', api: 'openai-codex-responses', baseUrl: 'https://wrong.example' }],
  createProvider: definition => definition,
  googleGenerativeAIApi: () => 'google', openAICompletionsApi: () => 'completions',
  openAIResponsesApi: () => 'responses', openAICodexResponsesApi: () => 'codex-responses',
  anthropicMessagesApi: () => 'anthropic', CLI_PROVIDERS: [],
  codexAccessToken: async () => { oauthCalls++; return 'fake-oauth-token'; },
  grokAccessToken: async () => { throw new Error('unexpected Grok auth'); },
 };
 const api = vm.runInNewContext(source + '\n({aidiyProviders})', context);
 return { build: (...args) => api.aidiyProviders(...args), setConfig: value => { config = value; },
  get reads() { return reads; }, get oauthCalls() { return oauthCalls; } };
}

test('openai_chat routes to OpenAI API using only the shared config key, refreshed per request', async () => {
 const h = harness();
 const [provider] = h.build({ openai_chat: { 'test-model': 'Test' } });
 assert.equal(provider.id, 'openai_chat');
 assert.equal(provider.baseUrl, 'https://api.openai.com/v1');
 assert.equal(provider.models[0].api, 'openai-responses');
 assert.equal(provider.models[0].baseUrl, provider.baseUrl);
 assert.equal(provider.api['openai-responses'], 'responses');
 const auth = await provider.auth.apiKey.resolve({ credential: { key: 'fake-stored-key' } });
 assert.equal(auth.auth.apiKey, 'fake-config-openai');
 assert.equal(auth.source, 'AiDiy_key.json openai_key_id');
 h.setConfig({ openai_key_id: ' fake-config-updated ' });
 assert.equal((await provider.auth.apiKey.resolve({})).auth.apiKey, 'fake-config-updated');
 assert.equal(h.oauthCalls, 0);
 assert.equal(h.reads, 3);
});

test('missing, invalid, or placeholder shared key does not fall back to environment, storage, or OAuth', async () => {
 const h = harness();
 const [provider] = h.build({ openai_chat: { 'test-model': 'Test' } });
 for (const config of [{}, { openai_key_id: '' }, { openai_key_id: '< your openai key >' }, { openai_key_id: 123 }, '{broken']) {
  h.setConfig(config);
  assert.equal(await provider.auth.apiKey.resolve({ credential: { key: 'fake-stored-key' } }), undefined);
 }
 assert.equal(h.oauthCalls, 0);
});

test('openai_oauth stays on shared Codex OAuth instead of using the API key', async () => {
 const h = harness();
 const [provider] = h.build({ openai_oauth: { 'test-model': 'Test' } });
 assert.equal(provider.baseUrl, 'https://chatgpt.com/backend-api');
 assert.equal(provider.models[0].api, 'openai-codex-responses');
 assert.equal((await provider.auth.apiKey.resolve({ signal: new AbortController().signal })).auth.apiKey, 'fake-oauth-token');
 assert.equal(h.oauthCalls, 1);
 assert.equal(h.reads, 1);
});
