/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

const { contextBridge, ipcRenderer } = require('electron');
const 購読 = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('slackPanel', {
  initial: () => ipcRenderer.invoke('slack:request', 'initial'),
  selectCode: value => ipcRenderer.invoke('slack:request', 'select-code', value),
  catalogCode: provider => ipcRenderer.invoke('slack:request', 'catalog-code', provider),
  start: () => ipcRenderer.invoke('slack:request', 'start'),
  stop: () => ipcRenderer.invoke('slack:request', 'stop'),
  window: action => ['minimize', 'maximize', 'close'].includes(action) ? ipcRenderer.invoke('slack:window', action) : Promise.resolve(false),
  isMaximized: () => ipcRenderer.invoke('slack:window', 'isMaximized'),
  getPinState: () => ipcRenderer.invoke('slack:window', 'getPinState'),
  togglePin: () => ipcRenderer.invoke('slack:window', 'togglePin'),
  onPinState: callback => typeof callback === 'function' ? 購読('slack:pin-state', value => {
    if (value && typeof value.pinned === 'boolean' && typeof value.locked === 'boolean') callback({ pinned: value.pinned, locked: value.locked });
  }) : () => {},
  onState: callback => 購読('slack:state', callback),
  onActivity: callback => 購読('slack:activity', callback),
});
