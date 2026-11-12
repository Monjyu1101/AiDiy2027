// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, compileScript } from '@vue/compiler-sfc';
import { transform } from 'esbuild';
import * as Vue from 'vue';
import * as sessionTools from '../src/components/タスクチーム/task-session.js';
const source = await readFile(new URL('../src/components/タスクチーム/タスクチームパネル.vue', import.meta.url), 'utf8');
let script = compileScript(parse(source).descriptor, { id: 'taskteam-test' }).content;
script = script.replace(/import\s+(?:\{[^}]*\}|[\w,\s]+)\s+from\s+['"]vue['"];?/g, match => {
  const binding = match.match(/import\s+(.*?)\s+from/s)[1].replace(/\s+as\s+/g, ': ');
  return `const ${binding} = Vue;`;
});
script = script.replace(/import PanelToggle[^;]+;/, 'const PanelToggle = {};');
script = script.replace(/import StatusBar[^;]+;/, 'const StatusBar = {};').replace(/import EscapingMark[^;]+;/, 'const EscapingMark = {};').replace(/import TaskPanel[^;]+;/, 'const TaskPanel = {};').replace(/import TeamPanel[^;]+;/, 'const TeamPanel = {};');
script = script.replace(/import Task(?:Request|Flow|Detail|Editor)[^;]+;/g, match => 'const ' + match.match(/import (\w+)/)[1] + ' = {};');
script = script.replace(/import \{ resolveTaskView, createTaskSession, createTaskSelectionCache \}[^;]+;/, 'const { resolveTaskView, createTaskSession, createTaskSelectionCache } = sessionTools;');
script = script.replace(/import apiClient[^;]+;/, 'const { apiClient, token } = bridge;').replace('export default', 'return');
const compiled = await transform(script, { loader: 'ts', target: 'esnext' });
const componentFactory = new Function('Vue', 'bridge', 'sessionTools', compiled.code);
const renderer = Vue.createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null,
  insert() {}, remove() {}, patchProp() {},
});
const flush = async () => { await Promise.resolve(); await Vue.nextTick(); await Promise.resolve(); await Vue.nextTick(); };
function mount({ stored = '', health = true, desktopApi = null, view = '', kind = 'task', lastUsers = {} } = {}) {
  let value = stored, healthSignal;
  const calls = [];
  const bridge = { token: input => { if (input !== undefined) value = input; return value; }, apiClient: { post: async (path, body) => {
    calls.push({ path, body });
    if (path.endsWith('/ログイン')) return { data: { status: 'OK', data: { access_token: 'test-token' } } };
    return { data: { status: 'OK', data: { 利用者ID: 'test', 利用者名: 'Test', 権限ID: 'admin' } } };
  } } };
  const saved = new Map(Object.entries(lastUsers));
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  globalThis.window = new EventTarget(); window.location = { hash: view ? '#task-view=' + view : '' }; if (desktopApi) window.aidiyWindow = desktopApi;
  globalThis.fetch = async (url, options) => { healthSignal = options.signal; assert.equal(url, '/taskteam-api/status'); return { ok: true, json: async () => ({ connected: health, port: 9003 }) }; };
  const component = componentFactory(Vue, bridge, sessionTools); component.render = () => null;
  const app = renderer.createApp(component, { config: { kind, taskTeamBase: '/taskteam-api' } });
  const instance = app.mount({});
  return { app, state: instance.$.setupState, calls, bridge, saved, signal: () => healthSignal };
}
test('actual Vue setup logs in, loads user and clears password; logout tears down authenticated state', async () => {
  const run = mount(); await flush();
  assert.equal(run.state.connected, true); assert.equal(run.state.port, 9003);
  run.state.userId = 'test'; run.state.password = 'password'; await run.state.login();
  assert.equal(run.state.user.利用者ID, 'test'); assert.equal(run.state.password, ''); assert.equal(run.bridge.token(), 'test-token');
  assert.equal(run.calls[0].path, '/core/auth/ログイン'); assert.equal(run.calls[1].path, '/core/auth/現在利用者');
  run.state.logout(); assert.equal(run.state.user, null); assert.equal(run.bridge.token(), '');
  run.app.unmount(); assert.equal(run.signal().aborted, true);
});
test('actual Vue setup restores a session and handles expiry independently of backend health', async () => {
  const run = mount({ stored: 'saved', health: false }); await flush();
  assert.equal(run.state.user.利用者ID, 'test'); assert.equal(run.state.connected, false); assert.equal(run.state.restoring, false);
  window.dispatchEvent(new Event('taskteam-auth-expired')); assert.equal(run.state.user, null); assert.equal(run.bridge.token(), '');
  assert.match(run.state.error, /有効期限/); run.app.unmount();
});
test('disposal prevents a late login response from restoring session state', async () => {
  const run = mount(); await flush(); let respond;
  run.bridge.apiClient.post = () => new Promise(resolve => { respond = resolve; });
  const login = run.state.login(); run.app.unmount();
  respond({ data: { status: 'OK', data: { access_token: 'late' } } }); await login;
  assert.equal(run.bridge.token(), ''); assert.equal(run.state.user, null);
});

test('each desktop peer restores host authentication, exposes closed views and never automatically reopens all', async () => {
  const actions = []; let sessionCallback;
  const api = {
    onTaskSession(callback) { sessionCallback = callback; return () => {}; },
    taskSession: async action => ({ ok: true, revision: 1, token: 'shared' }),
    taskWindows: async (action, payload) => { actions.push({ action, payload }); return { ok: true, views: ['flow', 'detail'] }; },
  };
  const run = mount({ desktopApi: api, view: 'flow' }); await flush(); await flush();
  assert.equal(run.state.taskView, 'flow'); assert.equal(run.state.user.利用者ID, 'test');
  assert.deepEqual(run.state.openViews, ['flow', 'detail']); assert.equal(actions.some(item => item.action === 'open-all'), false);
  await run.state.openTaskWindows('request'); assert.deepEqual(actions.find(item => item.action === 'open'), { action: 'open', payload: { view: 'request' } });
  sessionCallback({ revision: 2, token: '' }); await flush(); assert.equal(run.state.user, null); assert.equal(run.bridge.token(), '');
  run.app.unmount();
});


test('Task and Team use Avatar-equivalent initial fields without storing passwords', async () => {
  for (const kind of ['task', 'team']) {
    const run = mount({ kind }); await flush();
    assert.equal(run.state.userId, 'admin'); assert.equal(run.state.password, '********');
    run.state.userId = `${kind}-user`; run.state.password = 'test-only'; await run.state.login();
    assert.equal(run.saved.get(`aidiy_${kind}_last_user`), `${kind}-user`);
    assert.deepEqual([...run.saved.keys()], [`aidiy_${kind}_last_user`]);
    run.state.logout(); assert.equal(run.state.password, '********'); run.app.unmount();
    const restored = mount({ kind, lastUsers: { [`aidiy_${kind}_last_user`]: 'previous', [`aidiy_${kind === 'task' ? 'team' : 'task'}_last_user`]: 'other' } });
    await flush(); assert.equal(restored.state.userId, 'previous'); restored.app.unmount();
  }
  assert.match(source, /v-model="password" type="password"/);
});

test('unauthenticated Task cannot reopen peers; successful user verification precedes host login', async () => {
  const events = []; let revision = 0, shared = '';
  const api = {
    onTaskSession() { return () => {}; },
    async taskSession(action, payload) { if (action === 'set') { events.push(payload.token ? 'host-login' : 'host-logout'); shared = payload.token; revision++; } return { ok: true, revision, token: shared }; },
    async taskWindows(action) { events.push(action); return { ok: true, views: ['request'] }; },
  };
  const run = mount({ desktopApi: api, view: 'request' }); await flush(); await flush();
  await run.state.openTaskWindows('flow'); assert.equal(events.includes('open'), false);
  const original = run.bridge.apiClient.post;
  run.bridge.apiClient.post = async (path, body) => { if (path.endsWith('/現在利用者')) events.push('verified'); return original(path, body); };
  await run.state.login(); await flush();
  assert.ok(events.indexOf('verified') < events.indexOf('host-login'));
  assert.equal(run.state.user.利用者ID, 'test'); assert.equal(run.state.password, '');
  run.state.logout(); await flush(); assert.equal(shared, ''); assert.equal(run.state.password, '********');
  assert.match(source, /v-if="user && taskView !== 'combined'/); run.app.unmount();
});

test('failed current-user verification never publishes an authenticated Task session', async () => {
  const tokens = []; const api = {
    onTaskSession() { return () => {}; },
    async taskSession(action, payload) { if (action === 'set') tokens.push(payload.token); return { ok: true, revision: tokens.length, token: '' }; },
    async taskWindows() { return { ok: true, views: ['request'] }; },
  };
  const run = mount({ desktopApi: api, view: 'request' }); await flush(); await flush();
  const original = run.bridge.apiClient.post;
  run.bridge.apiClient.post = (path, body) => path.endsWith('/現在利用者') ? Promise.reject(Error('unverified')) : original(path, body);
  await run.state.login(); await flush();
  assert.equal(tokens.some(Boolean), false); assert.equal(run.state.user, null); assert.equal(run.bridge.token(), '');
  run.app.unmount();
});

test('invalid shared session returns host to logged-out primary state', async () => {
  let notify, revision = 0, shared = ''; const changes = [];
  const api = {
    onTaskSession(callback) { notify = callback; return () => {}; },
    async taskSession(action, payload) { if (action === 'set') { changes.push(payload); shared = payload.token; revision++; } return { ok: true, revision, token: shared }; },
    async taskWindows() { return { ok: true, views: ['request'] }; },
  };
  const run = mount({ desktopApi: api, view: 'request' }); await flush(); await flush();
  run.bridge.apiClient.post = async () => { throw Error('invalid session'); };
  revision = 1; shared = 'invalid'; notify({ revision, token: shared }); await flush(); await flush();
  assert.equal(shared, ''); assert.deepEqual(changes, [{ token: '', expectedRevision: 1 }]);
  assert.equal(run.state.user, null); assert.equal(run.state.password, '********'); run.app.unmount();
});


test('Task and Team collapse keeps authentication and open peer state intact', async () => {
  for (const kind of ['task', 'team']) {
    const run = mount({ kind, stored: 'saved' }); await flush();
    const user = run.state.user;
    run.state.panelCollapsed = true; run.state.panelHidden = true;
    await flush();
    assert.equal(run.state.user, user); assert.equal(run.bridge.token(), 'saved');
    assert.equal(run.state.panelHidden, true);
    run.state.panelCollapsed = false; run.state.panelHidden = false;
    await flush(); assert.equal(run.state.user, user);
    run.app.unmount();
  }
  assert.match(source, /class="ai-component taskteam-shell"/);
  assert.match(source, /#leading><PanelToggle :collapsed="panelCollapsed" :desktop="desktop"/);
  assert.match(source, /@hidden="panelHidden = \$event"/);
  assert.match(source, /\.taskteam-shell\.panel-collapsed > :not\(\.panel-brand\)\{display:none!important\}/);
  assert.doesNotMatch(source, /v-if="!?panel(?:Hidden|Collapsed)"/);
});
