const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
for (const project of ['frontend_web', 'frontend_avatar']) {
  test(`${project}: model get/set use current login Authorization, 401 clears auth`, async () => {
    let request, failure, loggedOut = false, expired = false;
    const auth = { token: 'synthetic-login-token', logout() { loggedOut = true; }, refreshToken: async () => {} };
    const storage = new Map([['token', auth.token]]);
    const client = { interceptors: { request: { use(fn) { request = fn; } }, response: { use(ok, fail) { failure = fail; } } } };
    const source = fs.readFileSync(path.join(root, project, 'src/api/client.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
      exports: {}, window: { location: { origin: 'https://test' }, dispatchEvent() { expired = true; } }, URL, Event,
      sessionStorage: { getItem: key => storage.get(key), removeItem: key => storage.delete(key) },
      require: name => name === 'axios' ? { default: { create: () => client } }
        : name.includes('stores/auth') ? { useAuthStore: () => auth } : { CORE_BASE_URL: 'https://test' },
    });
    for (const action of ['取得', '設定']) {
      const result = await request({ method: 'post', url: `/core/AIコア/モデル情報/${action}`, headers: {} });
      assert.equal(result.headers.Authorization, 'Bearer synthetic-login-token');
    }
    await assert.rejects(failure({ response: { status: 401 } }));
    assert.ok(project === 'frontend_web' ? loggedOut : expired && !storage.has('token'));
    const settings = fs.readFileSync(path.join(root, project, project === 'frontend_web' ? 'src/components/AiDiy/dialog/AI設定再起動.vue' : 'src/dialog/AI設定再起動.vue'), 'utf8');
    assert.match(settings, /apiClient.post\('\/core\/AIコア\/モデル情報\/取得'/);
    assert.match(settings, /apiClient.post\('\/core\/AIコア\/モデル情報\/設定'/);
  });
}
test('Web: late token refresh does not resurrect logged-out store', async () => {
  let resolve;
  const api = { post: () => new Promise(done => { resolve = done; }) };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'frontend_web/src/stores/auth.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, localStorage: { setItem() { throw Error('Unexpected token write'); } },
    require: name => name === 'pinia' ? { defineStore: (name, options) => options } : { default: api },
  });
  const state = { token: 'old' };
  const pending = exports.useAuthStore.actions.refreshToken.call(state);
  state.token = '';
  resolve({ data: { status: 'OK', data: { access_token: 'new' } } }); await pending;
  assert.equal(state.token, '');
});
