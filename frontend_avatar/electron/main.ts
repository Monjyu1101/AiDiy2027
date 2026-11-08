// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, Menu, type IpcMainInvokeEvent } from 'electron'
import { readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
const shouldOpenDevTools = process.env.VITE_OPEN_DEVTOOLS === '1'
const APP_USER_MODEL_ID = 'AiDiy.frontend_avatar'
// main.js直接起動時のapp.getAppPath()はdist-electron。配置が固定の実行ファイルから解決する。
const AVATAR_ICON_PATH = path.resolve(__dirname, '../public/icons/AiDiy_avatar.png')
if (process.platform === 'darwin') app.setName('AiDiy Avatar')
// Avatar は選択プロジェクトを持たず、配置元だけにプロファイルを保存する。
const { programDataDirectory, preparePrivateDirectory } = require(path.join(__dirname, '../../frontend_ide/host/scripts/project-storage.cjs'))
const avatarProjectRoot = path.resolve(__dirname, '../..')
const avatarProfile = programDataDirectory(avatarProjectRoot, 'aidiy_avatar', avatarProjectRoot, ['electron'])
preparePrivateDirectory(avatarProfile)
app.setPath('userData', avatarProfile)
app.setPath('sessionData', avatarProfile)
// aidiy_code / aidiy_live / aidiy_discord と共通の初回演出（透明キャンバスの中で中央から拡大してから表示する）。
// ウィンドウを毎フレーム広げると Windows で未描画の縁が白くちらつくため、共通実装を使う。
const { 拡大表示 } = require(path.join(__dirname, '../../frontend_ide/host/scripts/window-opening.cjs')) as {
  拡大表示: (browserWindow: typeof BrowserWindow, window: BrowserWindow, options?: { background?: string; canShow?: () => boolean }) => Promise<boolean>
}
const { attachNativeWindowMove } = require(path.join(__dirname, '../../frontend_ide/デスクトップ/長押し窓移動.cjs')) as {
  attachNativeWindowMove: (window: BrowserWindow, screen: typeof import('electron').screen, kind: 'avatar') => () => void
}

type WindowPinState = { pinned: boolean; locked: boolean }
const { createWindowPins } = require(path.join(__dirname, '../../frontend_ide/デスクトップ/最前面ピン.cjs')) as {
  createWindowPins: (options: { onChanged: (window: BrowserWindow, state: WindowPinState) => void }) => {
    register: (window: BrowserWindow, options?: Partial<WindowPinState>) => WindowPinState
    state: (window: BrowserWindow) => WindowPinState
    toggle: (window: BrowserWindow) => WindowPinState
    unregister: (window: BrowserWindow) => void
  }
}
const windowPins = createWindowPins({
  onChanged: (window, state) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('window:pin-changed', state)
    }
  },
})

type WindowMode = 'login' | 'core'
type PanelKey = 'chat' | 'file' | 'image' | 'code1' | 'code2' | 'code3' | 'code4' | 'code5' | 'code6'
type WindowRole = WindowMode | PanelKey | 'settings'
type WindowBounds = { x: number; y: number; width: number; height: number }
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

type BoundsPreset = {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

const LOGIN_BOUNDS: BoundsPreset = { width: 320, height: 240, minWidth: 320, minHeight: 240 }
const CORE_BOUNDS: BoundsPreset = { width: 520, height: 620, minWidth: 440, minHeight: 420 }
const CHAT_BASE_BOUNDS: BoundsPreset = { width: 520, height: 620, minWidth: 440, minHeight: 420 }
const SETTINGS_BOUNDS: BoundsPreset = { width: 720, height: 580, minWidth: 580, minHeight: 400 }
const PANEL_BOUNDS: Record<PanelKey, BoundsPreset> = {
  chat: CHAT_BASE_BOUNDS,
  file: CHAT_BASE_BOUNDS,
  image: CHAT_BASE_BOUNDS,
  code1: CHAT_BASE_BOUNDS,
  code2: CHAT_BASE_BOUNDS,
  code3: CHAT_BASE_BOUNDS,
  code4: CHAT_BASE_BOUNDS,
  code5: CHAT_BASE_BOUNDS,
  code6: CHAT_BASE_BOUNDS,
}

const panelStates: Record<PanelKey, boolean> = {
  chat: false,
  file: false,
  image: false,
  code1: false,
  code2: false,
  code3: false,
  code4: false,
  code5: false,
  code6: false,
}

let loginWindow: BrowserWindow | null = null
let coreWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
const panelWindows = new Map<PanelKey, BrowserWindow>()
const windowRoles = new Map<number, WindowRole>()
let selectedDisplaySourceId: string | null = null
let previousCpuTimes: { idle: number; total: number } | null = null
// Electronのバグ回避: getMinimumSize()が初期サイズを返す場合があるため独自管理
const windowMinSizes = new Map<number, { minWidth: number; minHeight: number }>()
const 表示処理 = new WeakMap<BrowserWindow, Promise<boolean>>()
const 表示希望 = new WeakMap<BrowserWindow, boolean>()

function getWorkArea() {
  return screen.getPrimaryDisplay().workArea
}

function readCpuTimes() {
  return os.cpus().reduce((summary, cpu) => {
    const idle = cpu.times.idle
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0)
    return {
      idle: summary.idle + idle,
      total: summary.total + total,
    }
  }, { idle: 0, total: 0 })
}

function getSystemCpuUsagePercent() {
  const current = readCpuTimes()
  if (!previousCpuTimes) {
    previousCpuTimes = current
    return 0
  }

  const idleDelta = current.idle - previousCpuTimes.idle
  const totalDelta = current.total - previousCpuTimes.total
  previousCpuTimes = current
  if (totalDelta <= 0) return 0
  return Math.min(100, Math.max(0, (1 - (idleDelta / totalDelta)) * 100))
}

function getBottomRightPosition(
  width: number,
  height: number,
  margins: { right?: number; bottom?: number } = {},
) {
  const area = getWorkArea()
  const right = margins.right ?? 24
  const bottom = margins.bottom ?? 0
  return {
    x: area.x + Math.max(0, area.width - width - right),
    y: area.y + Math.max(0, area.height - height - bottom),
  }
}

function getBottomLeftPosition(_width: number, height: number, margin = 24) {
  const area = getWorkArea()
  return {
    x: area.x + margin,
    y: area.y + Math.max(margin, area.height - height - margin),
  }
}

function getCenteredPosition(width: number, height: number) {
  const area = getWorkArea()
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
  }
}

function getPanelInitialPosition(panel: PanelKey, width: number, height: number) {
  const area = getWorkArea()
  if (panel === 'chat') {
    // 中央を基本とし、右下のコア窓（右端から24）と重ならない位置までに留める
    const centered = getCenteredPosition(width, height)
    const coreLeft = area.x + area.width - CORE_BOUNDS.width - 24
    return {
      x: Math.max(area.x + 24, Math.min(centered.x, coreLeft - width - 16)),
      y: centered.y,
    }
  }
  if (panel === 'image') {
    return getBottomLeftPosition(width, height)
  }

  const baseX = area.x + 24
  const baseY = area.y + 24
  const orderMap: Record<Exclude<PanelKey, 'image' | 'chat'>, number> = {
    file: 0,
    code1: 1,
    code2: 2,
    code3: 3,
    code4: 4,
    code5: 5,
    code6: 6,
  }
  const step = 48
  const order = orderMap[panel as Exclude<PanelKey, 'image' | 'chat'>] ?? 0

  // 表示倍率が大きく作業領域が狭い場合も、後ろの番号の窓が画面外へはみ出さないよう収める
  return {
    x: Math.max(area.x, Math.min(baseX + (step * order), area.x + area.width - width - 24)),
    y: Math.max(area.y, Math.min(baseY + (step * order), area.y + area.height - height)),
  }
}

function resolveDisplaySourceKind(sourceId: string): DisplaySourceKind {
  return sourceId.startsWith('window:') ? 'window' : 'screen'
}

async function listDisplaySources(): Promise<DisplaySourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  })

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    kind: resolveDisplaySourceKind(source.id),
    thumbnailDataUrl: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
  }))
}

async function listVrmaFiles(folderName: string): Promise<string[]> {
  const safeFolderName = path.basename(folderName)
  const appPath = app.getAppPath()
  const candidateDirs = [
    path.join(appPath, 'public', 'vrma', safeFolderName),
    path.join(appPath, 'frontend_avatar', 'public', 'vrma', safeFolderName),
    path.join(process.cwd(), 'public', 'vrma', safeFolderName),
    path.join(process.cwd(), 'frontend_avatar', 'public', 'vrma', safeFolderName),
  ]

  for (const vrmaDir of candidateDirs) {
    try {
      const entries = await readdir(vrmaDir, { withFileTypes: true })
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.vrma'))
        .map((entry) => `/vrma/${safeFolderName}/${entry.name}`)
        .sort((a, b) => a.localeCompare(b, 'ja'))
      if (files.length > 0) {
        return files
      }
    } catch {
      // Try the next candidate directory.
    }
  }

  console.error('[vrma] list failed:', safeFolderName, candidateDirs)
  return []
}

function getRendererUrl(role: WindowRole): string {
  const baseUrl = isDev
    ? (process.env.VITE_DEV_SERVER_URL as string)
    : pathToFileURL(path.resolve(__dirname, '../dist/index.html')).toString()

  const url = new URL(baseUrl)
  url.searchParams.set('role', role)
  return url.toString()
}

function createBaseWindow(bounds: BoundsPreset, role: WindowRole, show = true): BrowserWindow {
  const window = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: bounds.minWidth,
    minHeight: bounds.minHeight,
    show: false,
    backgroundColor: '#00000000',
    transparent: true,
    hasShadow: false,
    frame: false,
    resizable: true,
    autoHideMenuBar: true,
    title: 'AiDiy Avatar',
    icon: AVATAR_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  windowRoles.set(window.id, role)
  // ログイン画面は他の窓に隠れないよう、最前面ピンONで表示を始める。
  windowPins.register(window, { pinned: role === 'login' })
  attachNativeWindowMove(window, screen, 'avatar')

  // min サイズを独自管理し、ロード後に再適用（Electron Windowsバグ対策）
  windowMinSizes.set(window.id, { minWidth: bounds.minWidth, minHeight: bounds.minHeight })
  window.webContents.once('did-finish-load', () => {
    if (!window.isDestroyed()) {
      window.setMinimumSize(bounds.minWidth, bounds.minHeight)
    }
  })
  window.on('closed', () => {
    windowPins.unregister(window)
    windowMinSizes.delete(window.id)
  })

  if (isDev) {
    window.loadURL(getRendererUrl(role))
    if (shouldOpenDevTools) {
      window.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    window.loadURL(getRendererUrl(role))
  }

  if (show) void ウィンドウ表示(window)
  return window
}

function waitForReady(window: BrowserWindow) {
  if (window.isDestroyed()) {
    return Promise.resolve()
  }
  if (!window.webContents.isLoading()) {
    return Promise.resolve()
  }
  // 読込中に窓が閉じられる（electronmonの再起動等）と window.webContents は参照できないため、先に保持する。
  const contents = window.webContents
  return new Promise<void>((resolve) => {
    const done = () => {
      window.removeListener('ready-to-show', done)
      window.removeListener('closed', done)
      if (!contents.isDestroyed()) contents.removeListener('did-finish-load', done)
      resolve()
    }
    window.once('ready-to-show', done)
    window.once('closed', done)
    contents.once('did-finish-load', done)
  })
}

// 全パネル共通。読み込み・配置後に非表示の窓を拡大し、連打でも演出を重ねない。
async function ウィンドウ表示(window: BrowserWindow, background = '#000', canShow = () => true): Promise<boolean> {
  表示希望.set(window, true)
  const pending = 表示処理.get(window)
  if (pending) return pending
  const operation = (async () => {
    await waitForReady(window)
    const allowed = () => 表示希望.get(window) === true && canShow()
    if (window.isDestroyed() || !allowed()) return false
    if (window.isVisible()) { window.show(); window.focus(); return true }
    return 拡大表示(BrowserWindow, window, { background, canShow: allowed })
  })()
  表示処理.set(window, operation)
  try { return await operation }
  finally { if (表示処理.get(window) === operation) 表示処理.delete(window) }
}
function ウィンドウ非表示(window: BrowserWindow) {
  表示希望.set(window, false)
  window.hide()
}

function clampWindowBounds(window: BrowserWindow, nextBounds: WindowBounds): WindowBounds {
  const minSizes = windowMinSizes.get(window.id) ?? { minWidth: 100, minHeight: 100 }
  const currentBounds = window.getBounds()
  const clampedWidth = Math.max(minSizes.minWidth, Math.round(nextBounds.width))
  const clampedHeight = Math.max(minSizes.minHeight, Math.round(nextBounds.height))

  return {
    x: Math.round(nextBounds.x ?? currentBounds.x),
    y: Math.round(nextBounds.y ?? currentBounds.y),
    width: clampedWidth,
    height: clampedHeight,
  }
}

function getWindowByRole(role: WindowRole): BrowserWindow | null {
  if (role === 'login') return loginWindow && !loginWindow.isDestroyed() ? loginWindow : null
  if (role === 'core') return coreWindow && !coreWindow.isDestroyed() ? coreWindow : null
  if (role === 'settings') return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
  const panelWindow = panelWindows.get(role as PanelKey)
  return panelWindow && !panelWindow.isDestroyed() ? panelWindow : null
}

function getWindowPointerSnapshot(window: BrowserWindow, requestedRole?: WindowRole): WindowPointerSnapshot {
  const targetWindow = requestedRole ? (getWindowByRole(requestedRole) ?? window) : window
  const role = windowRoles.get(targetWindow.id) ?? null
  const bounds = targetWindow.getBounds()
  const mouse = screen.getCursorScreenPoint()
  const insideWindow =
    mouse.x >= bounds.x &&
    mouse.x <= bounds.x + bounds.width &&
    mouse.y >= bounds.y &&
    mouse.y <= bounds.y + bounds.height

  return {
    role,
    bounds,
    mouse,
    insideWindow,
  }
}

function notifyPanelStates() {
  const payload = { ...panelStates }
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('panel:states-changed', payload)
    }
  })
}

async function setPanelVisibility(panel: PanelKey, visible: boolean) {
  const window = panelWindows.get(panel)
  if (!window || window.isDestroyed()) {
    panelStates[panel] = false
    notifyPanelStates()
    return
  }

  panelStates[panel] = visible
  notifyPanelStates()
  if (!visible) { ウィンドウ非表示(window); return }
  if (await ウィンドウ表示(window, '#000', () => panelStates[panel] && panelWindows.get(panel) === window)) {
    window.webContents.send('window:shown')
  }
}

function closePanelWindow(panel: PanelKey) {
  const window = panelWindows.get(panel)
  if (window && !window.isDestroyed()) {
    window.destroy()
  }
  panelWindows.delete(panel)
  panelStates[panel] = false
  notifyPanelStates()
}

function closeAllPanelWindows() {
  ;(Object.keys(panelStates) as PanelKey[]).forEach((panel) => {
    closePanelWindow(panel)
  })
}

function applyPrimaryMode(window: BrowserWindow, mode: WindowMode) {
  const bounds = mode === 'login' ? LOGIN_BOUNDS : CORE_BOUNDS
  const position = mode === 'core'
    ? getBottomRightPosition(bounds.width, bounds.height, { right: 24, bottom: 0 })
    : getCenteredPosition(bounds.width, bounds.height)

  windowRoles.set(window.id, mode)
  window.setMinimumSize(bounds.minWidth, bounds.minHeight)
  window.setResizable(mode === 'core')
  window.setBounds({
    x: position.x,
    y: position.y,
    width: bounds.width,
    height: bounds.height,
  }, false)
}

function createPanelWindow(panel: PanelKey) {
  const existing = panelWindows.get(panel)
  if (existing && !existing.isDestroyed()) {
    setPanelVisibility(panel, panelStates[panel])
    return existing
  }

  const bounds = PANEL_BOUNDS[panel]
  const window = createBaseWindow(bounds, panel, false)
  const { x, y } = getPanelInitialPosition(panel, bounds.width, bounds.height)
  window.setPosition(x, y)

  panelWindows.set(panel, window)
  panelStates[panel] = false

  window.on('closed', () => {
    panelWindows.delete(panel)
    panelStates[panel] = false
    windowRoles.delete(window.id)
    notifyPanelStates()
  })

  notifyPanelStates()
  return window
}

function ensureAllPanelWindows() {
  ;(Object.keys(panelStates) as PanelKey[]).forEach((panel) => {
    createPanelWindow(panel)
  })
}

function createLoginWindow(show = true) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    applyPrimaryMode(loginWindow, 'login')
    if (loginWindow.isMinimized()) {
      loginWindow.restore()
    }
    loginWindow.center()
    if (show) void ウィンドウ表示(loginWindow)
    return loginWindow
  }

  loginWindow = createBaseWindow(LOGIN_BOUNDS, 'login', show)
  applyPrimaryMode(loginWindow, 'login')

  loginWindow.on('closed', () => {
    if (loginWindow) {
      windowRoles.delete(loginWindow.id)
    }
    loginWindow = null
    // ログイン画面の終了はアプリ全体の終了。残った設定窓も閉じる。
    if (!isQuitting) app.quit()
  })

  return loginWindow
}

function createCoreWindow(show = true) {
  if (coreWindow && !coreWindow.isDestroyed()) {
    applyPrimaryMode(coreWindow, 'core')
    if (show) void ウィンドウ表示(coreWindow)
    return coreWindow
  }

  coreWindow = createBaseWindow(CORE_BOUNDS, 'core', show)
  applyPrimaryMode(coreWindow, 'core')

  coreWindow.on('closed', () => {
    closeAllPanelWindows()
    if (coreWindow) {
      windowRoles.delete(coreWindow.id)
    }
    coreWindow = null
    if (!isQuitting && (!loginWindow || !loginWindow.isVisible())) app.quit()
  })

  return coreWindow
}

async function openCoreWindow(sourceWindow?: BrowserWindow | null) {
  const nextCoreWindow = createCoreWindow(false)
  ensureAllPanelWindows()
  await waitForReady(nextCoreWindow)
  if (!nextCoreWindow.isDestroyed()) {
    await ウィンドウ表示(nextCoreWindow)
    if (!nextCoreWindow.isDestroyed()) nextCoreWindow.webContents.send('window:shown')
  }

  if (loginWindow && !loginWindow.isDestroyed()) {
    ウィンドウ非表示(loginWindow)
  } else if (sourceWindow && !sourceWindow.isDestroyed() && sourceWindow !== nextCoreWindow) {
    ウィンドウ非表示(sourceWindow)
  }

  return 'core' as const
}

async function openLoginWindow(sourceWindow?: BrowserWindow | null) {
  closeAllPanelWindows()
  const nextLoginWindow = createLoginWindow(false)
  await waitForReady(nextLoginWindow)
  if (!nextLoginWindow.isDestroyed()) {
    if (nextLoginWindow.isMinimized()) {
      nextLoginWindow.restore()
    }
    nextLoginWindow.center()
    await ウィンドウ表示(nextLoginWindow)
    if (!nextLoginWindow.isDestroyed()) nextLoginWindow.webContents.send('window:shown')
  }

  if (coreWindow && !coreWindow.isDestroyed()) {
    coreWindow.close()
  }

  return 'login' as const
}

function openSettingsWindow(sessionId: string) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings:session-id', sessionId)
    const existing = settingsWindow
    void ウィンドウ表示(existing, '#f8fafc', () => settingsWindow === existing).then(shown => {
      if (shown) existing.webContents.send('window:shown')
    })
    return
  }

  settingsWindow = new BrowserWindow({
    width: SETTINGS_BOUNDS.width,
    height: SETTINGS_BOUNDS.height,
    minWidth: SETTINGS_BOUNDS.minWidth,
    minHeight: SETTINGS_BOUNDS.minHeight,
    show: false,
    backgroundColor: '#f8fafc',
    transparent: false,
    frame: false,
    resizable: true,
    autoHideMenuBar: true,
    title: 'AiDiy Avatar',
    icon: AVATAR_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  windowRoles.set(settingsWindow.id, 'settings')
  windowPins.register(settingsWindow)
  attachNativeWindowMove(settingsWindow, screen, 'avatar')
  windowMinSizes.set(settingsWindow.id, { minWidth: SETTINGS_BOUNDS.minWidth, minHeight: SETTINGS_BOUNDS.minHeight })

  const createdSettingsWindow = settingsWindow
  settingsWindow.once('ready-to-show', async () => {
    if (!createdSettingsWindow.isDestroyed()) {
      createdSettingsWindow.setMinimumSize(SETTINGS_BOUNDS.minWidth, SETTINGS_BOUNDS.minHeight)
      createdSettingsWindow.center()
      createdSettingsWindow.webContents.send('settings:session-id', sessionId)
      if (await ウィンドウ表示(createdSettingsWindow, '#f8fafc', () => settingsWindow === createdSettingsWindow)) createdSettingsWindow.webContents.send('window:shown')
    }
  })

  settingsWindow.on('closed', () => {
    windowPins.unregister(createdSettingsWindow)
    if (settingsWindow) {
      windowRoles.delete(settingsWindow.id)
      windowMinSizes.delete(settingsWindow.id)
    }
    settingsWindow = null
  })

  const baseUrl = isDev
    ? (process.env.VITE_DEV_SERVER_URL as string)
    : pathToFileURL(path.resolve(__dirname, '../dist/index.html')).toString()
  const url = new URL(baseUrl)
  url.searchParams.set('role', 'settings')
  void settingsWindow.loadURL(url.toString())
}

// 任意のroleやIDを受け取らず、登録済みの現在ウィンドウのmain frameだけを操作する。
function currentControlWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed() || !windowRoles.has(window.id)) return null
  if (window.webContents !== event.sender || event.senderFrame !== window.webContents.mainFrame) return null
  return window
}

let isQuitting = false
app.on('before-quit', () => { isQuitting = true })

if (!app.requestSingleInstanceLock()) {
  if (process.connected) process.send?.({ avatarExisting: true }, () => app.quit())
  else app.quit()
} else {
app.on('second-instance', () => {
  const window = coreWindow ?? loginWindow ?? BrowserWindow.getAllWindows().find(item => item.isVisible())
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  void ウィンドウ表示(window)
})

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const { Macメニューを設定 } = require(path.join(__dirname, '../../frontend_ide/host/scripts/MacOS-Menu.cjs'))
    Macメニューを設定({ app, Menu, 名前: 'AiDiy Avatar', 閉じる: () => app.quit(), icon: AVATAR_ICON_PATH, platform: process.platform })
  }
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_USER_MODEL_ID)
  }

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sourceId = selectedDisplaySourceId
      selectedDisplaySourceId = null
      if (!sourceId) {
        callback({})
        return
      }

      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
        const selectedSource = sources.find((source) => source.id === sourceId)
        if (!selectedSource) {
          console.error('[desktop-capture] selected source not found:', sourceId)
          callback({})
          return
        }
        callback({ video: selectedSource })
      } catch (error) {
        console.error('[desktop-capture] source resolve failed:', error)
        callback({})
      }
    },
    { useSystemPicker: false },
  )

  ipcMain.handle('window:get-pin', (event) => {
    const window = currentControlWindow(event)
    return window ? windowPins.state(window) : null
  })

  ipcMain.handle('window:toggle-pin', (event) => {
    const window = currentControlWindow(event)
    return window ? windowPins.toggle(window) : null
  })

  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = currentControlWindow(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else if (window.isMaximizable()) window.maximize()
    return window.isMaximized()
  })

  ipcMain.handle('window:get-role', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return 'login'
    return windowRoles.get(window.id) ?? 'login'
  })

  ipcMain.handle('window:set-mode', async (event, mode: WindowMode) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return mode

    if (mode === 'core') {
      return openCoreWindow(window)
    }
    return openLoginWindow(window)
  })

  ipcMain.handle('window:open-core', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return openCoreWindow(window)
  })

  ipcMain.handle('window:open-login', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return openLoginWindow(window)
  })

  ipcMain.handle('window:close-self', (event) => {
    const window = currentControlWindow(event)
    if (!window) return
    const role = windowRoles.get(window.id)
    if (role && role !== 'login' && role !== 'core' && role !== 'settings') {
      setPanelVisibility(role as PanelKey, false)
      return
    }
    window.close()
  })

  ipcMain.handle('window:minimize-self', (event) => {
    const window = currentControlWindow(event)
    if (!window) return
    window.minimize()
  })

  ipcMain.handle('window:get-bounds', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      return { x: 0, y: 0, width: 0, height: 0, minWidth: 100, minHeight: 100 }
    }
    const bounds = window.getBounds()
    const minSizes = windowMinSizes.get(window.id) ?? { minWidth: 100, minHeight: 100 }
    return {
      ...bounds,
      minWidth: minSizes.minWidth,
      minHeight: minSizes.minHeight,
    }
  })

  ipcMain.handle('window:get-pointer-snapshot', (event, requestedRole?: WindowRole) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      const mouse = screen.getCursorScreenPoint()
      return {
        role: null,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        mouse,
        insideWindow: false,
      } satisfies WindowPointerSnapshot
    }
    return getWindowPointerSnapshot(window, requestedRole)
  })

  ipcMain.handle('window:set-bounds', (event, nextBounds: WindowBounds) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return

    const bounds = clampWindowBounds(window, nextBounds)
    window.setBounds(bounds)
    return bounds
  })

  ipcMain.handle('window:set-interactive', (event, interactive: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false

    window.setIgnoreMouseEvents(!interactive, { forward: true })
    if (interactive) {
      window.setFocusable(true)
    } else {
      window.blur()
      window.setFocusable(false)
    }
    return interactive
  })

  ipcMain.handle('panel:toggle', async (_event, panel: PanelKey) => {
    createPanelWindow(panel)
    await setPanelVisibility(panel, !panelStates[panel])
    return { ...panelStates }
  })

  ipcMain.handle('panel:apply-states', async (_event, states: Record<PanelKey, boolean>) => {
    await Promise.all((Object.keys(states) as PanelKey[]).map(async (panel) => {
      createPanelWindow(panel)
      await setPanelVisibility(panel, Boolean(states[panel]))
    }))
    return { ...panelStates }
  })

  ipcMain.handle('panel:get-states', () => ({ ...panelStates }))

  ipcMain.handle('settings:open', (_event, sessionId: string) => {
    openSettingsWindow(sessionId)
  })

  ipcMain.handle('settings:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && !window.isDestroyed()) {
      window.hide()
    }
  })

  ipcMain.handle('desktop:list-sources', async () => listDisplaySources())

  ipcMain.handle('desktop:list-vrma-files', async (_event, folderName: string) => listVrmaFiles(folderName))

  ipcMain.handle('desktop:set-source', (_event, sourceId: string | null) => {
    selectedDisplaySourceId = sourceId
    return selectedDisplaySourceId
  })

  ipcMain.handle('system:get-cpu-usage', () => getSystemCpuUsagePercent())

  // 独立起動時は所有者確定後に8092を起動し、準備完了してから窓を作る。
  if (process.env.AIDIY_AVATAR_MANAGED === '1' && process.connected) {
    await new Promise<void>((resolve) => {
      const onMessage = (message: unknown) => {
        if ((message as { avatarRendererReady?: boolean })?.avatarRendererReady) {
          process.off('message', onMessage)
          resolve()
        }
      }
      process.on('message', onMessage)
      process.once('disconnect', () => app.quit())
      process.send?.({ avatarPrimary: true })
    })
  }
  // 起動時のログイン画面も、読み込み後に拡大演出で表示する。
  const startupLogin = createLoginWindow(false)
  // aidiy_avatar の起動処理へ表示完了を知らせ、呼出元のコマンドを解放させる。
  void ウィンドウ表示(startupLogin).then(shown => {
    if (shown && process.connected) process.send?.({ avatarShown: true })
  })

  app.on('activate', () => {
    if (!loginWindow && !coreWindow && BrowserWindow.getAllWindows().length === 0) {
      createLoginWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
}
