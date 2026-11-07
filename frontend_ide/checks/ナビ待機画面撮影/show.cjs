// 800×600（表示倍率1固定）の枠なしElectron窓へ、指定した待機画面だけを表示する。影・角丸・枠が付かず、窓の撮影がそのまま800×600になる。
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs'); const path = require('node:path');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const scene = process.argv.find(a => a.startsWith('--scene='))?.slice(8) || 'ride';
const marker = process.argv.find(a => a.startsWith('--marker='))?.slice(9);
app.whenReady().then(() => {
  const win = new BrowserWindow({x: 80, y: 80, width: 800, height: 600, useContentSize: true, frame: false, thickFrame: false, hasShadow: false,
    resizable: false, alwaysOnTop: true, title: 'SceneShot', backgroundColor: '#000000', show: true, webPreferences: {contextIsolation: true, sandbox: true}});
  win.webContents.on('did-finish-load', () => { if (marker) fs.writeFileSync(marker, String(Date.now())); });
  win.loadFile(path.join(__dirname, 'index.html'), {query: {scene}});
});
app.on('window-all-closed', () => app.quit());
