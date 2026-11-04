// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTaskView, createTaskSession, createTaskSelectionCache, taskChannelName } from '../src/components/タスクチーム/task-session.js';
test('Electron task defaults to request; each peer and editor has its own view; Web remains combined', () => {
  const api = { taskWindows() {} };
  for (const view of ['request', 'flow', 'detail', 'dialog']) assert.equal(resolveTaskView('task', '#task-view=' + view, api), view);
  assert.equal(resolveTaskView('task', '', api), 'request');
  assert.equal(resolveTaskView('task', '#task-view=flow', null), 'combined');
  assert.equal(resolveTaskView('team', '#task-view=flow', api), 'combined');
});
test('host event wins over delayed get and stale logout uses revision compare-and-set', async () => {
  const applied = []; let notify, getResult, setArgs, stopped = false;
  const api = {
    onTaskSession(callback) { notify = callback; return () => { stopped = true; }; },
    taskSession(action, payload) {
      if (action === 'get') return new Promise(resolve => { getResult = resolve; });
      setArgs = payload; return Promise.resolve({ ok: false, revision: 3, token: 'new-login' });
    },
  };
  const sync = createTaskSession({ api, applyToken: token => { applied.push(token); } });
  const start = sync.start(); notify({ revision: 2, token: 'current' });
  getResult({ revision: 1, token: 'old' }); await start;
  assert.deepEqual(applied, ['current']);
  await assert.rejects(sync.set(''), /タスク認証状態/); assert.deepEqual(setArgs, { token: '', expectedRevision: 2 });
  assert.deepEqual(applied, ['current', 'new-login']);
  sync.dispose(); assert.equal(stopped, true); notify({ revision: 4, token: '' }); assert.equal(applied.length, 2);
});
test('Task selection survives request-window closure and is available to reopened peers', () => {
  const channels = new Set();
  function factory(name) {
    const listeners = new Set();
    const channel = { name, postMessage(data) { for (const other of channels) if (other !== channel && other.name === name) for (const callback of other.listeners) callback({ data }); },
      addEventListener(_, callback) { listeners.add(callback); }, removeEventListener(_, callback) { listeners.delete(callback); }, close() { channels.delete(channel); }, listeners };
    channels.add(channel); return channel;
  }
  const requestCache = createTaskSelectionCache(factory), flowCache = createTaskSelectionCache(factory);
  const oldRequest = factory(taskChannelName('sync')); oldRequest.postMessage({ type: 'task-selected', タスクID: 'T123', タイトル: 'Selected' });
  requestCache.dispose(); oldRequest.close();
  const reopened = factory(taskChannelName('sync')); let selected;
  reopened.addEventListener('message', event => { selected = event.data; }); reopened.postMessage({ type: 'request-task-selection' });
  assert.equal(selected.タスクID, 'T123'); assert.equal(selected.タイトル, 'Selected');
  flowCache.dispose(); reopened.close(); assert.equal(channels.size, 0);
});

test('selection and editor acknowledgments are isolated by authentication revision, never token text', async () => {
  const before = taskChannelName('sync'); let notify;
  const api = { onTaskSession(callback) { notify = callback; return () => {}; }, taskSession: async () => ({ revision: 90, token: 'private-token' }) };
  const session = createTaskSession({ api, applyToken() {} }); await session.start();
  assert.notEqual(taskChannelName('sync'), before); assert.equal(taskChannelName('sync'), 'aidiy-task-sync-90');
  notify({ revision: 91, token: '' }); assert.equal(taskChannelName('dialog'), 'aidiy-task-dialog-91');
  notify({ revision: 92, token: 'other-user' }); assert.equal(taskChannelName('sync'), 'aidiy-task-sync-92');
  assert.doesNotMatch(taskChannelName('dialog'), /private-token|other-user/); session.dispose();
});


test('same-revision host rejection surfaces failure without replacing session revision', async () => {
  const applied = []; let value;
  const api = {
    onTaskSession() { return () => {}; },
    async taskSession(action, payload) {
      if (action === 'get') return { ok: true, revision: 0, token: '' };
      value = payload; return { ok: false, revision: 0, token: '', error: 'rejected' };
    },
  };
  const sync = createTaskSession({ api, applyToken: token => applied.push(token) }); await sync.start();
  await assert.rejects(sync.set('invalid'), /rejected/);
  assert.deepEqual(value, { token: 'invalid', expectedRevision: 0 }); assert.deepEqual(applied, ['']); sync.dispose();
});
