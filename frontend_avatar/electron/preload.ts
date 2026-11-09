// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { contextBridge, ipcRenderer } from 'electron'

type PanelKey = 'chat' | 'file' | 'image' | 'code1' | 'code2' | 'code3' | 'code4' | 'code5' | 'code6'
type WindowPinState = { pinned: boolean; locked: boolean }
type WindowMode = 'login' | 'core'
type WindowRole = WindowMode | PanelKey | 'settings'
type WindowBounds = { x: number; y: number; width: number; height: number }
type WindowMetrics = WindowBounds & { minWidth: number; minHeight: number }
type WindowPointerSnapshot = {
  role: WindowRole | null
  bounds: WindowBounds
  mouse: { x: number; y: number }
  insideWindow: boolean
}
type DisplaySourceKind = 'screen' | 'window'
type DisplaySourceInfo = {
  id: string
  name: string
  kind: DisplaySourceKind
  thumbnailDataUrl: string | null
}

const metadata = ipcRenderer.sendSync('avatar:metadata') as { avatarAlone: boolean; projectPath: string; coreBaseUrl: string }
const api = {
  avatarAlone: metadata.avatarAlone === true,
  projectPath: metadata.projectPath,
  coreBaseUrl: metadata.coreBaseUrl,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  getWindowRole: () => ipcRenderer.invoke('window:get-role') as Promise<WindowRole>,
  getWindowBounds: () => ipcRenderer.invoke('window:get-bounds') as Promise<WindowMetrics>,
  getWindowPointerSnapshot: (role?: WindowRole) => ipcRenderer.invoke('window:get-pointer-snapshot', role) as Promise<WindowPointerSnapshot>,
  setWindowBounds: (bounds: WindowBounds) => ipcRenderer.invoke('window:set-bounds', bounds),
  setWindowInteractive: (interactive: boolean) => ipcRenderer.invoke('window:set-interactive', interactive) as Promise<boolean>,
  setWindowMode: (mode: WindowMode) => ipcRenderer.invoke('window:set-mode', mode),
  openCoreWindow: () => ipcRenderer.invoke('window:open-core') as Promise<WindowMode>,
  openLoginWindow: () => ipcRenderer.invoke('window:open-login') as Promise<WindowMode>,
  closeCurrentWindow: () => ipcRenderer.invoke('window:close-self'),
  minimizeCurrentWindow: () => ipcRenderer.invoke('window:minimize-self'),
  toggleMaximizeCurrentWindow: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<boolean>,
  getWindowPinState: () => ipcRenderer.invoke('window:get-pin') as Promise<WindowPinState | null>,
  toggleWindowPin: () => ipcRenderer.invoke('window:toggle-pin') as Promise<WindowPinState | null>,
  onWindowPinChanged: (callback: (state: WindowPinState) => void) => {
    const handler = (_event: unknown, state: WindowPinState) => callback(state)
    ipcRenderer.on('window:pin-changed', handler)
    return () => ipcRenderer.removeListener('window:pin-changed', handler)
  },
  togglePanel: (panel: PanelKey) => ipcRenderer.invoke('panel:toggle', panel),
  applyPanelStates: (states: Record<PanelKey, boolean>) => ipcRenderer.invoke('panel:apply-states', states) as Promise<Record<PanelKey, boolean>>,
  getPanelStates: () => ipcRenderer.invoke('panel:get-states') as Promise<Record<PanelKey, boolean>>,
  listDisplaySources: () => ipcRenderer.invoke('desktop:list-sources') as Promise<DisplaySourceInfo[]>,
  listVrmaFiles: (folderName: string) => ipcRenderer.invoke('desktop:list-vrma-files', folderName) as Promise<string[]>,
  setDisplaySource: (sourceId: string | null) => ipcRenderer.invoke('desktop:set-source', sourceId),
  getSystemCpuUsage: () => ipcRenderer.invoke('system:get-cpu-usage') as Promise<number>,
  openSettingsWindow: (sessionId: string) => ipcRenderer.invoke('settings:open', sessionId),
  closeSettingsWindow: () => ipcRenderer.invoke('settings:close'),
  onSettingsPrepare: (callback: (sessionId: string) => void) => {
    const handler = (_event: unknown, sessionId: string) => callback(sessionId)
    ipcRenderer.on('settings:session-id', handler)
    return () => { ipcRenderer.removeListener('settings:session-id', handler) }
  },
  onPanelStatesChanged: (callback: (states: Record<PanelKey, boolean>) => void) => {
    const handler = (_event: unknown, states: Record<PanelKey, boolean>) => callback(states)
    ipcRenderer.on('panel:states-changed', handler)
    return () => {
      ipcRenderer.removeListener('panel:states-changed', handler)
    }
  },
  onWindowShown: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('window:shown', handler)
    return () => {
      ipcRenderer.removeListener('window:shown', handler)
    }
  },

}

contextBridge.exposeInMainWorld('desktopApi', api)
