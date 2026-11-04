// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import axios from 'axios';

function fixture(kind) {
  const storage = new Map(), events = [];
  const source = fs.readFileSync(new URL('../src/components/タスクチーム/api/client.ts', import.meta.url), 'utf8')
    .replace("import axios from 'axios';", '').replace(/export default client;/, '').replace(/export /g, '');
  const context = vm.createContext({ axios, Event, sessionStorage: {
    getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  }, window: { dispatchEvent: event => events.push(event.type) } });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const run = text => vm.runInContext(text, context);
  run(`configureClient('${kind}', '/taskteam'); token('current');`);
  return { run, events, storage, client: run('client') };
}

for (const kind of ['task', 'team']) {
  test(`${kind}: 現セッションの401だけを失効扱いにし、別アプリの認証は保持`, async () => {
    const f = fixture(kind), other = kind === 'task' ? 'team' : 'task';
    f.storage.set(`aidiy_${other}_token`, 'other');
    f.client.defaults.adapter = async config => { throw { config, response: { status: 401 } }; };
    await assert.rejects(f.client.post('/protected', {}));
    assert.equal(f.run('token()'), '');
    assert.deepEqual(f.events, ['taskteam-auth-expired']);
    assert.equal(f.storage.get(`aidiy_${other}_token`), 'other');
  });
  test(`${kind}: 古い要求の401は再ログイン後の認証を破棄しない`, async () => {
    const f = fixture(kind); let rejectRequest, started;
    const ready = new Promise(resolve => { started = resolve; });
    f.client.defaults.adapter = config => new Promise((_, reject) => { rejectRequest = () => reject({ config, response: { status: 401 } }); started(); });
    const request = f.client.post('/protected', {}); await ready;
    f.run("token('new-login')"); rejectRequest(); await assert.rejects(request);
    assert.equal(f.run('token()'), 'new-login'); assert.deepEqual(f.events, []);
  });
  test(`${kind}: 通信断・403・500は認証失効と混同しない`, async () => {
    const f = fixture(kind);
    for (const status of [undefined, 403, 500]) {
      f.client.defaults.adapter = async config => { throw { config, ...(status ? { response: { status } } : {}) }; };
      await assert.rejects(f.client.post('/protected', {}));
      assert.equal(f.run('token()'), 'current'); assert.deepEqual(f.events, []);
    }
  });
}
