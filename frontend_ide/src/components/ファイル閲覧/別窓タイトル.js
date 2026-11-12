// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { createApp, h, reactive } from 'vue';
import StatusBar from '../共通表示/状態バー.vue';
import PanelToggle from '../コード/パネル表示切替.vue';
import WindowActions from '../共通表示/窓操作.vue';
import { createPanelWindowApi } from '../共通表示/窓操作.js';

// 既存Viewerと同じ状態バーを使用。窓操作は所有元IDE経由で対象の別窓だけへ送る。
export function mountPanelTitle(host, child, owner, title, kind, { restore, titleTools, displayTitle } = {}) {
  const container = child.document.createElement('div');
  container.className = kind === 'panel-routes' ? 'route-window-actions' : 'panel-window-title';
  if (kind === 'panel-routes') host.append(container);
  else host.prepend(container);
  const state = reactive({ connected: false, mode: '', hideClose: false });
  const collapsible = ['panel-navigation', 'explorer', 'panel-viewer'].includes(kind);
  const collapse = reactive({ collapsed: false });
  const collapseApi = collapsible ? {
    collapsePanel: value => owner.aidiyWindow.collapsePanel(value, child.name),
    beginWindowMove: () => owner.aidiyWindow.beginWindowMove(child.name),
    moveWindow: token => owner.aidiyWindow.moveWindow(token, child.name),
    endWindowMove: token => owner.aidiyWindow.endWindowMove(token, child.name),
  } : undefined;
  if(collapsible)host.classList.add('ai-component');
  const preserveDuringVR = kind === 'explorer' || kind === 'panel-routes' || kind === 'panel-navigation';
  const ide = owner.document.querySelector('.development-app.ide');
  const source = owner.document.querySelector('.development-app.ide .ide-heading > .connection-bar');
  const sync = () => {
    state.connected = !!source?.classList.contains('online');
    state.mode = source?.classList.contains('offline') ? 'offline' : 'online';
    state.hideClose = preserveDuringVR && !!ide?.classList.contains('all-displays');
  };
  sync();
  const observer = new owner.MutationObserver(sync);
  if (source) observer.observe(source, { attributes: true, attributeFilter: ['class'] });
  if (preserveDuringVR && ide) observer.observe(ide, { attributes: true, attributeFilter: ['class'] });
  const nativeApi = createPanelWindowApi(owner.aidiyWindow, child.name);
  const windowApi = kind === 'explorer' && restore ? { ...nativeApi, close: restore } : nativeApi;
  const returnButton = () => restore && !state.hideClose ? h('button', { type: 'button', class: 'panel-return', title: '閉じて本体へ戻す', 'aria-label': title + 'を閉じて本体へ戻す', onClick: restore }, [h('span', { class: 'close-icon', 'aria-hidden': 'true' })]) : null;
  const app = createApp({ render: () => kind === 'panel-routes'
    ? h('span', { class: 'route-pin-tools' }, [h(WindowActions, { windowApi, windowContext: child, pinOnly: true }), returnButton()])
    : h(StatusBar, { title: displayTitle ? displayTitle() : kind === 'explorer' ? 'AiDiy IDE / Explorer' : kind === 'panel-navigation' ? 'AiDiy IDE / '+title : title, status: kind === 'explorer' ? (state.connected ? '接続済' : '未接続') : kind === 'panel-navigation' ? undefined : '別ウィンドウ', clockPulse: kind === 'panel-navigation', ...state, desktop: true, windowApi, windowContext: child }, { ...(titleTools ? { 'connection-tools': () => titleTools({ collapsed: collapse.collapsed }) } : {}), ...(collapsible ? { leading: () => h(PanelToggle, { collapsed: collapse.collapsed, desktop: true, windowApi: collapseApi, windowContext: child, onToggle: () => { collapse.collapsed = !collapse.collapsed; }, onHidden: value => { host.classList.toggle('native-panel-collapsed', value); if(kind === 'panel-navigation')host.classList.toggle('navigation-window-collapsed', value); } }) } : {}) }) });
  app.mount(container);
  return () => { observer.disconnect(); app.unmount(); container.remove(); if(collapsible){host.classList.remove('native-panel-collapsed','navigation-window-collapsed','ai-component');} };
}
