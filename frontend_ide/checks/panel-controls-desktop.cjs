// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vue DOMを実BrowserWindowへ移す。IPCはfixture所有窓だけへ限定し、外部通信は拒否する。
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const {panelBounds}=require('../デスクトップ/panel-windows.cjs');
const explorerArea={x:0,y:0,width:1920,height:Number(process.env.AIDIY_PANEL_CONTROLS_SCREEN_HEIGHT)||1040};
const fs = require('node:fs');
const path = require('node:path');
const output = process.env.AIDIY_PANEL_CONTROLS_OUTPUT;
assert.ok(output && process.env.AIDIY_PANEL_CONTROLS_HTML && process.env.AIDIY_PANEL_CONTROLS_PRELOAD, 'Launch with scripts/check-panel-controls.mjs');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = {
  passed: false, sandbox: true, contextIsolation: true, nodeIntegration: false,
  scope: 'Actual FileExplorer Vue component, createPanelWindow DOM transfer, StatusBar and WindowActions; fixture-scoped IPC with actual BrowserWindows',
  network: 'none; data: and about:blank only', checks: [], screenshots: [], actions: [], resizeRequests: [],
  limitations: ['Programmatic DOM clicks; trusted 500ms native drag is covered by a separate fixture.', 'Pin state and VR orchestration use fixture IPC, not production main-process authorization or desktop stacking-order proof.', 'CDP viewport emulation checks renderer layout, not physical OS window geometry; an initial zero-sized headless popup can add scrollbar height before emulation is ready. Compact-height assertions run after viewport-ready expansion/collapse.', 'External file-icon SVG assets are not served by the network-free data fixture.'],
};
const records = new Map(), windows = [];
let owner, sequence = 0, refuseNextPopup = false, locked = false;
const evaluate = (window, code) => window.webContents.executeJavaScript(code);
async function until(window, code, label = code) {
  for (let n = 0; n < 150; n++) { if (await evaluate(window, code)) return; await sleep(20); }
  throw Error('Timed out: ' + label);
}
async function click(window, selector) {
  await evaluate(window, `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing '+${JSON.stringify(selector)});node.click();})()`);
  await sleep(35);
}
async function viewport(window, width, height) {
  const debug = window.webContents.debugger;
  if (!debug.isAttached()) debug.attach('1.3');
  await debug.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}
async function capture(window, name) {
  await sleep(120);
  const shot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const image = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64')), size = image.getSize(), bitmap = image.toBitmap();
  let min = 255, max = 0;
  for (let i = 0; i < bitmap.length; i += 4) { min = Math.min(min, bitmap[i], bitmap[i + 1], bitmap[i + 2]); max = Math.max(max, bitmap[i], bitmap[i + 1], bitmap[i + 2]); }
  assert.ok(size.width > 1 && size.height > 1 && max - min > 12, name + ': usable renderer screenshot');
  const file = path.join(output, name + '.png');
  fs.writeFileSync(file, image.toPNG());
  result.screenshots.push({ file, size, rgbRange: [min, max], method: 'CDP emulated renderer screenshot' });
}
function ownSender(event) { assert.equal(event.sender, owner.webContents, 'Only fixture owner may use panel IPC'); }
function recordFor(event, name) {
  ownSender(event);
  const record = records.get(name);
  assert.ok(record?.window && !record.window.isDestroyed(), 'Action targets a live fixture-owned panel');
  return record;
}
function publish(record) { owner.webContents.send('panel-fixture:pin-changed', { panelName: record.name, pinned: record.pinned, locked: record.locked }); }
function pin(record, value) {
  record.pinned = value; record.window.setAlwaysOnTop(value);
  publish(record);
  return { pinned: record.pinned, locked: record.locked };
}
function installIPC() {
  ipcMain.handle('panel-fixture:prepare', (event, rect, kind) => {
    ownSender(event); assert.ok(['explorer', 'panel-routes'].includes(kind));
    const name = 'panel-controls-' + ++sequence;
    records.set(name, { name, kind, width: kind === 'panel-routes' ? 360 : 420, height: kind === 'panel-routes' ? Math.ceil(rect.height) : panelBounds(rect,{window:owner},{getDisplayMatching:()=>({workArea:explorerArea})}).height, pinned: true, locked });
    return { ok: true, name };
  });
  ipcMain.handle('panel-fixture:show', async (event, name) => {
    const record = recordFor(event, name);
    await record.viewport; record.window.show(); return { ok: true };
  });
  ipcMain.handle('panel-fixture:action', (event, name, action) => {
    const record = recordFor(event, name); result.actions.push({ name, kind: record.kind, action });
    if (action === 'pin-state') return { pinned: record.pinned, locked: record.locked };
    if (action === 'toggle-pin') return record.locked ? { pinned: true, locked: true } : pin(record, !record.pinned);
    if (action === 'isMaximized') return record.window.isMaximized();
    if (action === 'minimize') { record.window.minimize(); return true; }
    if (action === 'maximize') { record.window.isMaximized() ? record.window.unmaximize() : record.window.maximize(); return true; }
    if (action === 'close') { if (!record.locked) record.window.close(); return !record.locked; }
    throw Error('Action not allowed in fixture: ' + action);
  });
  ipcMain.handle('panel-fixture:resize', async (event, name, height) => {
    const record = recordFor(event, name); assert.equal(record.kind, 'panel-routes');
    assert.ok(Number.isFinite(height) && height > 0 && height <= 500);
    record.height = Math.ceil(height); result.resizeRequests.push({ name, height: record.height });
    record.window.setSize(record.width, record.height); await viewport(record.window, record.width, record.height);
    return { ok: true, height: record.height };
  });
  ipcMain.handle('panel-fixture:vr', (event, value) => {
    ownSender(event); locked = !!value;
    for (const record of records.values()) if (record.window && !record.window.isDestroyed()) { record.locked = locked; if (locked) record.pinned = true; pin(record, record.pinned); }
  });
}
const livePanel = kind => [...records.values()].reverse().find(record => record.kind === kind && record.window && !record.window.isDestroyed());
async function detached(kind) {
  let record;
  for (let n = 0; n < 150; n++) {
    record = livePanel(kind);
    if (record && await evaluate(record.window, `!!document.querySelector('.window-pin:not(:disabled)')`)) return record;
    await sleep(20);
  }
  throw Error('Native panel not ready: ' + kind);
}
async function pinState(record, pinned, isLocked = false) {
  await until(record.window, `(()=>{const n=document.querySelector('.window-pin');return !!n && n.getAttribute('aria-pressed')===${JSON.stringify(String(pinned))} && n.disabled===${isLocked};})()`);
}
async function toggle(record, expected) {
  const before = result.actions.filter(action => action.name === record.name && action.action === 'toggle-pin').length;
  await click(record.window, '.window-pin'); await pinState(record, expected);
  assert.equal(result.actions.filter(action => action.name === record.name && action.action === 'toggle-pin').length, before + 1, 'One click sends one toggle to the correct child');
}
async function restore(record) {
  const transitions = record.kind === 'explorer' ? await evaluate(owner, 'fixture.log.detachedEvents.length') : null;
  await click(record.window, record.kind === 'explorer' ? '.panel-window-title .window-close' : '.panel-return');
  await until(owner, `fixture.saved.${record.kind === 'explorer' ? 'explorer' : 'routes'}.ownerDocument===document`);
  assert.ok(record.window.isDestroyed(), 'Return closes the detached BrowserWindow');
  if (transitions !== null) assert.equal(await evaluate(owner, 'fixture.log.detachedEvents.length'), transitions + 1, 'One existing Explorer return click emits exactly one restore transition');
  assert.equal(await evaluate(owner, `document.querySelectorAll('.panel-window-title,.route-window-actions').length`), 0, 'Temporary native controls are removed on return');
}
async function run() {
  await app.whenReady();
  owner = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { preload: process.env.AIDIY_PANEL_CONTROLS_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } });
  windows.push(owner); installIPC();
  owner.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(data:|about:)/.test(details.url) }));
  owner.webContents.setWindowOpenHandler(details => {
    const record = records.get(details.frameName);
    if (details.url !== 'about:blank' || !record || refuseNextPopup) { refuseNextPopup = false; return { action: 'deny' }; }
    return { action: 'allow', overrideBrowserWindowOptions: { show: true, frame: false, width: record.width, height: record.height, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } } };
  });
  owner.webContents.on('did-create-window', (child, details) => {
    const record = records.get(details.frameName); assert.ok(record);
    record.window = child; windows.push(child); child.setAlwaysOnTop(true);
    // Headless native bounds can be 1px. Request emulation immediately; the
    // initial WindowProxy may still report 0px until the renderer is ready.
    child.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: record.width, height: record.height }, viewPosition: { x: 0, y: 0 }, viewSize: { width: record.width, height: record.height }, deviceScaleFactor: 1, scale: 1 });
    record.viewport = viewport(child, record.width, record.height);
  });
  await owner.loadURL('data:text/html,' + encodeURIComponent(fs.readFileSync(process.env.AIDIY_PANEL_CONTROLS_HTML, 'utf8')));
  await viewport(owner, 1100, 900); owner.show();
  await until(owner, 'window.fixture?.ready && !!document.querySelector(".explorer-panel")');
  assert.equal(await evaluate(owner, `document.querySelector('.explorer-panel>ul[role=tree]').hasAttribute('data-aidiy-window-move-list')`), false);
  assert.deepEqual(await evaluate(owner, `({require:typeof require,process:typeof process})`), { require: 'undefined', process: 'undefined' });
  await click(owner, 'input[type=radio][value=grep]');
  await evaluate(owner, `(()=>{const n=document.querySelector('.grep-query input');n.value='未送信の検索入力';n.dispatchEvent(new Event('input',{bubbles:true}));fixture.remember();})()`);
  await click(owner, '.route-restore-toggle');
  assert.deepEqual(await evaluate(owner, `['.explorer-panel>header','.route-controls'].map(selector=>{const n=document.querySelector(selector);return{last:n.lastElementChild.textContent,disabled:n.lastElementChild.disabled,pins:n.querySelectorAll('.explorer-detach,.route-detach').length};})`), [{ last: '📌', disabled: false, pins: 1 }, { last: '📌', disabled: false, pins: 1 }]);
  await capture(owner, '01-embedded-detach-buttons');
  const routeMetrics=`(()=>{const n=document.querySelector('.explorer-routes'),bar=n.querySelector('.route-controls');return{width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,gap:getComputedStyle(bar).gap,buttons:[...n.querySelectorAll('.route-burger,.route-choice')].map(b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);return{width:r.width,height:r.height,fontSize:s.fontSize,padding:s.padding}})}})()`;
  const embeddedMetrics=await evaluate(owner,routeMetrics);
  result.checks.push('Embedded Explorer and route bar retain exactly one active right-edge detach pin; real Vue grep input is populated without submitting a search');

  await click(owner, '.explorer-detach');
  let explorer = await detached('explorer'); await pinState(explorer, true);
  assert.equal(explorer.height,Math.min(900,explorerArea.height-16));
  assert.equal(await evaluate(explorer.window,'innerHeight'),explorer.height);
  result.checks.push(`Explorer renderer uses production initial height: ${explorer.height}px for work area ${explorerArea.height}px`);
  assert.equal(await evaluate(explorer.window, `document.querySelector('.explorer-panel>ul[role=tree]').hasAttribute('data-aidiy-window-move-list')`), true);
  assert.equal(await evaluate(owner, 'fixture.saved.explorer.ownerDocument!==document'), true);
  assert.equal(await evaluate(owner, `!!document.querySelector('.explorer-toggle')`),false,'Detached Explorer leaves no burger in owner');
  assert.equal(await evaluate(explorer.window, `document.querySelectorAll('.explorer-panel>header .explorer-detach').length`), 0);
  assert.deepEqual(await evaluate(explorer.window, `[...document.querySelectorAll('.panel-window-title .window-actions button')].map(n=>n.classList.contains('window-pin')?'pin':n.getAttribute('aria-label'))`), ['最小化', '最大化', 'pin', '終了']);
  assert.equal(await evaluate(explorer.window, `!!document.querySelector('.panel-window-title .panel-return')`), false);
  assert.equal(await evaluate(explorer.window, `document.querySelector('.panel-window-title .window-close .close-icon')!==null`), true);
  assert.equal(await evaluate(explorer.window, `document.querySelector('.grep-query input').value`), '未送信の検索入力');
  await capture(explorer.window, '02-native-explorer-pin-on');
  await toggle(explorer, false); await capture(explorer.window, '03-native-explorer-pin-off'); await toggle(explorer, true);
  await restore(explorer);
  assert.equal(await evaluate(owner, `document.querySelector('.explorer-panel>ul[role=tree]').hasAttribute('data-aidiy-window-move-list')`), false);
  assert.equal(await evaluate(owner, `fixture.saved.input===document.querySelector('.grep-query input') && fixture.saved.input.value==='未送信の検索入力'`), true);
  result.checks.push('Actual Explorer DOM moves into BrowserWindow; native title keeps minimize/maximize/pin/close in order, body-header return is removed and title close restores the embedded panel; ON→OFF→ON pin then close preserve the same unsubmitted input node/value');

  for (let n = 0; n < 2; n++) {
    await click(owner, '.explorer-detach'); explorer = await detached('explorer');
    assert.equal(await evaluate(explorer.window, 'document.querySelectorAll(".panel-window-title").length'), 1);
    await pinState(explorer, true); await toggle(explorer, false); await restore(explorer);
  }
  result.checks.push('Two additional Explorer detach/toggle/return cycles create one title only, reset initial pin ON, and dispatch one child-scoped toggle per click');

  const beforeRefusal = windows.length; refuseNextPopup = true;
  await click(owner, '.explorer-detach');
  await until(owner, `document.querySelector('.app-error')?.textContent.includes('ポップアップ')`);
  assert.equal(windows.length, beforeRefusal);
  assert.equal(await evaluate(owner, `fixture.saved.explorer===document.querySelector('.explorer-panel') && fixture.saved.input.value==='未送信の検索入力' && !fixture.log.detached`), true);
  result.checks.push('Actual Electron popup denial leaves the original panel and input intact, reports the blocked popup, and creates no native child');

  await click(owner, '.route-detach');
  let routes = await detached('panel-routes'); await pinState(routes, true);
  assert.equal(await evaluate(owner, `!!document.querySelector('.route-restore-toggle')`),false,'Detached routes leave no burger in owner');
  assert.deepEqual(await evaluate(routes.window,routeMetrics),embeddedMetrics,'Embedded and independent bars share compact dimensions, font and spacing');
  assert.equal(await evaluate(routes.window, `document.querySelectorAll('.panel-window-title,.route-detach,.window-minimize,.window-maximize,.window-close').length`), 0);
  assert.equal(await evaluate(routes.window, `document.querySelectorAll('.route-controls .window-pin').length`), 1);
  assert.equal(await evaluate(routes.window, `getComputedStyle(document.querySelector('.route-burger')).webkitAppRegion==='drag' && !document.querySelector('.route-drag-handle')`), true);
  assert.equal(await evaluate(routes.window, `document.querySelector('.route-window-actions')===document.querySelector('.route-controls').lastElementChild`), true);
  assert.deepEqual(await evaluate(routes.window, `[...document.querySelectorAll('.route-choice')].map(n=>n.textContent)`), ['閲覧軌跡', '検索軌跡', 'AI検索軌跡']);
  result.routeGeometry = await evaluate(routes.window, `(()=>{const n=document.querySelector('.route-controls'),r=n.getBoundingClientRect();return{width:r.width,height:r.height,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,buttons:[...n.querySelectorAll('button')].map(b=>({text:b.textContent,left:b.getBoundingClientRect().left,width:b.getBoundingClientRect().width,top:b.getBoundingClientRect().top,bottom:b.getBoundingClientRect().bottom}))};})()`);
  assert.ok(result.routeGeometry.scrollWidth <= result.routeGeometry.clientWidth, 'Native route bar fits 360px without horizontal scrolling');
  assert.ok(result.routeGeometry.height <= 40, 'Native route controls stay in the original compact-height row');
  assert.equal(await evaluate(routes.window, `[...document.querySelectorAll('.route-choice')].every(n=>n.scrollWidth<=n.clientWidth && getComputedStyle(n).textOverflow!=='ellipsis')`), true, 'Full route labels are not clipped or truncated');
  await toggle(routes, false); await toggle(routes, true);
  await click(routes.window, '.route-choice[title="閲覧軌跡"]');
  await until(routes.window, `document.querySelector('.route-reveal')?.dataset.phase==='open' && document.querySelector('.route-file-list')?.getAttribute('aria-hidden')==='false'`);
  assert.ok(await evaluate(routes.window, `document.querySelectorAll('.route-tree [data-route-path]').length`) >= 2);
  assert.ok(result.resizeRequests.some(request => request.name === routes.name && request.height > 300));
  await capture(routes.window, '05-native-routes-expanded');
  await click(routes.window, '.route-choice[title="閲覧軌跡"]');
  await until(routes.window, `document.querySelector('.route-reveal')?.dataset.phase==='closed'`);
  assert.equal(result.resizeRequests.filter(request => request.name === routes.name).at(-1).height, 40, 'Viewport-ready collapsed routes reserve the original 40px height');
  await capture(routes.window, '04-native-routes-compact');
  await click(routes.window, '.route-choice[title="閲覧軌跡"]');
  await until(routes.window, `document.querySelector('.route-reveal')?.dataset.phase==='open'`);
  await restore(routes);
  assert.equal(await evaluate(owner, `fixture.saved.routes===document.querySelector('.explorer-routes') && !!document.querySelector('.route-tree [data-route-path="keep.txt"]')`), true);
  result.checks.push('Native routes keep a compact 360px row with immediate-drag burger, no extra vertical handle, pin and close at right; classification and preserved DOM still work');

  await click(owner, '.route-detach'); routes = await detached('panel-routes');
  assert.equal(await evaluate(routes.window, `document.querySelectorAll('.route-window-actions').length`), 1);
  await click(routes.window, '.route-burger');
  assert.equal(routes.window.isDestroyed(), false, 'Native title drag surface does not close on click');
  await restore(routes);
  await click(owner, '.route-burger');
  await until(owner, `fixture.saved.routes.ownerDocument===document && !!document.querySelector('.route-restore-toggle')`);
  assert.ok(routes.window.isDestroyed());
  assert.equal(await evaluate(owner, `getComputedStyle(fixture.saved.routes).display`), 'none');
  await click(owner, '.route-restore-toggle');
  result.checks.push('Repeated route detachment has one controls mount; native burger stays a title drag surface; embedded burger still closes the bar and preserves its reopen entry');

  await click(owner, '.explorer-detach'); explorer = await detached('explorer');
  await click(owner, '.route-detach'); routes = await detached('panel-routes');
  await evaluate(owner, 'fixture.setVR(true)');
  for (const record of [explorer, routes]) {
    await pinState(record, true, true);
    await until(record.window, `!document.querySelector('.panel-return,.explorer-detach')`);
    const before = result.actions.filter(action => action.action === 'toggle-pin').length;
    await click(record.window, '.window-pin');
    assert.equal(result.actions.filter(action => action.action === 'toggle-pin').length, before);
  }
  assert.equal(await evaluate(explorer.window, `document.querySelector('.window-close').disabled`), true);
  assert.equal(await evaluate(routes.window, `getComputedStyle(document.querySelector('.route-burger')).webkitAppRegion==='drag'`), true);
  await click(routes.window, '.route-burger');
  assert.equal(await evaluate(routes.window, `!!document.querySelector('.explorer-routes')`), true);
  assert.equal(routes.window.isDestroyed(), false);
  await capture(explorer.window, '06-vr-explorer-locked');
  await capture(routes.window, '07-vr-routes-locked');
  await evaluate(owner, 'fixture.setVR(false)');
  await until(owner, 'fixture.saved.explorer.ownerDocument===document && fixture.saved.routes.ownerDocument===document && !fixture.log.detached');
  for (let n = 0; n < 150 && (!explorer.window.isDestroyed() || !routes.window.isDestroyed()); n++) await sleep(20);
  assert.ok(explorer.window.isDestroyed() && routes.window.isDestroyed());
  assert.equal(await evaluate(owner, `fixture.saved.input.value`), '未送信の検索入力');
  result.checks.push('VR pins are ON and disabled, return controls disappear, Explorer close is disabled and route burger remains a title drag surface; programmatic click cannot send a pin toggle; exiting VR restores both original DOM nodes and input state');
  await click(owner, '.explorer-toggle'); await click(owner, '.route-restore-toggle');
  await capture(owner, '08-restored-after-vr');
  assert.deepEqual(await evaluate(owner, 'fixture.log.errors'), []);
  result.apiRequests = await evaluate(owner, 'fixture.log.requests');
  result.resizeMeasurements = await evaluate(owner, 'fixture.log.resizes');
  assert.ok(result.apiRequests.every(request => request.method === 'GET' && /^\/api\/(latest|ai-search\/history)/.test(request.url)));
  result.webPreferences = windows.filter(window => !window.isDestroyed()).map(window => {
    const preferences = window.webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
    return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration };
  });
  await evaluate(owner, 'fixture.unmount()');
  assert.ok([...records.values()].every(record => !record.window || record.window.isDestroyed()));
  result.checks.push('Unmount leaves no live detached panel; all API requests are in-memory read-only latest/history fixtures; renderer reports no errors');
  result.passed = true; result.electron = process.versions.electron; result.chrome = process.versions.chrome;
}
run().then(() => {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log('PANEL_CONTROLS_RESULT ' + JSON.stringify(result));
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  app.quit();
}).catch(async error => {
  result.error = error.stack || String(error);
  try { result.diagnostics = await evaluate(owner, `({error:document.querySelector('.app-error')?.textContent,errors:window.fixture?.log.errors,detached:window.fixture?.log.detached,resizes:window.fixture?.log.resizes})`); } catch {}
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.error('PANEL_CONTROLS_FAILURE ' + result.error);
  app.exit(1);
});
setTimeout(() => { console.error('Panel controls QA timeout'); app.exit(2); }, 45000).unref();
