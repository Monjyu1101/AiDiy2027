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
contextBridge.exposeInMainWorld('discordPanel', {
  initial: () => ipcRenderer.invoke('discord:request', 'initial'),
  select: value => ipcRenderer.invoke('discord:request', 'select', value),
  selectFeatures: value => ipcRenderer.invoke('discord:request', 'select-features', value),
  selectCode: value => ipcRenderer.invoke('discord:request', 'select-code', value),
  catalogCode: provider => ipcRenderer.invoke('discord:request', 'catalog-code', provider),
  start: () => ipcRenderer.invoke('discord:request', 'start'),
  stop: () => ipcRenderer.invoke('discord:request', 'stop'),
  monitor: on => ipcRenderer.invoke('discord:request', 'monitor', on),
  window: action => ['minimize', 'maximize', 'close'].includes(action) ? ipcRenderer.invoke('discord:window', action) : Promise.resolve(false),
  isMaximized: () => ipcRenderer.invoke('discord:window', 'isMaximized'),
  getPinState: () => ipcRenderer.invoke('discord:window', 'getPinState'),
  togglePin: () => ipcRenderer.invoke('discord:window', 'togglePin'),
  onPinState: callback => typeof callback === 'function' ? 購読('discord:pin-state', value => {
    if (value && typeof value.pinned === 'boolean' && typeof value.locked === 'boolean') callback({ pinned: value.pinned, locked: value.locked });
  }) : () => {},
  onState: callback => 購読('discord:state', callback),
  onAudio: callback => 購読('discord:audio', callback),
  onMeter: callback => 購読('discord:meter', callback),
  onActivity: callback => 購読('discord:activity', callback),
});
