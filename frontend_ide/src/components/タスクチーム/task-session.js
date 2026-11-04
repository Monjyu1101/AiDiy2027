// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
let channelRevision = 0;
export function taskChannelName(kind) {
  if (!['sync', 'dialog'].includes(kind)) throw Error('Unknown Task channel');
  return `aidiy-task-${kind}-${channelRevision}`;
}
export function resolveTaskView(kind, hash, api) {
  if (kind !== 'task' || typeof api?.taskWindows !== 'function') return 'combined';
  const view = /^#task-view=(request|flow|detail|dialog)$/.exec(hash)?.[1];
  return view || 'request';
}
// Authentication lives only in the Electron group's memory. A closed request
// window is not an authentication owner, and no token is sent via BroadcastChannel.
export function createTaskSession({ api, applyToken }) {
  let disposed = false, revision = -1;
  async function accept(value) {
    if (disposed) return;
    if (!value || !Number.isInteger(value.revision) || typeof value.token !== 'string') throw Error('タスク認証状態を取得できません。');
    if (value.revision <= revision) return;
    revision = value.revision; channelRevision = revision;
    await applyToken(value.token);
  }
  const stop = api.onTaskSession(value => { void accept(value).catch(() => {}); });
  return {
    async start() { await accept(await api.taskSession('get')); },
    async set(token) {
      const result = await api.taskSession('set', { token, expectedRevision: revision });
      await accept(result);
      if (result.ok === false) throw Error(result.error || 'タスク認証状態を反映できませんでした。');
    },
    dispose() { disposed = true; stop?.(); },
  };
}
// Each surviving Task window caches selection. Reopening the request window can
// recover it from flow/detail; closing one window never clears another's cache.
export function createTaskSelectionCache(channelFactory = name => new BroadcastChannel(name)) {
  const channel = channelFactory(taskChannelName('sync')); let snapshot = null;
  const receive = event => {
    const value = event.data;
    if (value?.type === 'task-selected') snapshot = { type: 'task-selected', タスクID: String(value.タスクID || ''), タイトル: String(value.タイトル || ''), マーメイド記号: String(value.マーメイド記号 || '') };
    if (value?.type === 'request-task-selection' && snapshot) channel.postMessage(snapshot);
  };
  channel.addEventListener('message', receive); channel.postMessage({ type: 'request-task-selection' });
  return { dispose() { channel.removeEventListener('message', receive); channel.close(); snapshot = null; } };
}
