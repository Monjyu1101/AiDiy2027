// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 最前面の状態はmainを正とし、別窓化（旧「ピン留め」）の状態とは分ける。
export function createWindowPinController({ api, changed = () => {} }) {
  let disposed = false, revision = 0, stop = () => {};
  let state = { pinned: false, locked: false, ready: false, busy: false, error: '' };
  const publish = value => { if (!disposed) { state = { ...state, ...value }; changed({ ...state }); } };
  function accept(value) {
    if (!value || typeof value.pinned !== 'boolean' || typeof value.locked !== 'boolean') throw Error('ピン留め状態を取得できません。');
    publish({ pinned: value.pinned, locked: value.locked, ready: true, error: '' });
  }
  async function refresh() {
    if (disposed || !api?.pinState) return;
    const run = ++revision;
    try { const value = await api.pinState(); if (!disposed && run === revision) accept(value); }
    catch { if (!disposed && run === revision) publish({ error: 'ピン留め状態を取得できません。' }); }
  }
  return {
    get state() { return { ...state }; },
    async start() {
      if (disposed) return;
      const unsubscribe = api?.onPinChanged?.(value => {
        // 所有元IDEへ通知される別パネルのイベントで、本体のボタンを変えない。
        if (disposed || value?.panelName) return;
        try { accept(value); revision++; } catch { /* 不完全な通知では確定済み状態を変更しない。 */ }
      });
      if (typeof unsubscribe === 'function') stop = unsubscribe;
      await refresh();
    },
    refresh,
    async toggle() {
      if (disposed || !state.ready || state.busy || state.locked || !api?.togglePin) return;
      publish({ busy: true, error: '' });
      const run = ++revision;
      try { const value = await api.togglePin(); if (!disposed && run === revision) accept(value); }
      catch { if (!disposed && run === revision) publish({ error: 'ピン留めを切り替えられませんでした。' }); }
      finally { publish({ busy: false }); }
    },
    dispose() { if (disposed) return; disposed = true; revision++; stop(); },
  };
}

// DOMを所有元で描画する別窓にも、その窓だけを対象にした限定APIを渡す。
export function createPanelWindowApi(ownerApi, panelName) {
  const api = Object.fromEntries(['minimize', 'maximize', 'isMaximized', 'close'].map(action =>
    [action, () => ownerApi.panelAction(panelName, action)]));
  api.pinState = () => ownerApi.panelAction(panelName, 'pin-state');
  api.togglePin = () => ownerApi.panelAction(panelName, 'toggle-pin');
  api.onPinChanged = callback => ownerApi.onPinChanged?.(value => {
    if (value?.panelName === panelName) callback({ pinned: value.pinned, locked: value.locked });
  });
  return api;
}
