// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// sandbox付きElectronへdata:だけを読み込む。API、clipboard、削除は全てrenderer内のメモリfixture。
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installNativeWindowMove } = require('../デスクトップ/長押し窓移動.cjs');
const output = process.env.AIDIY_EXPLORER_FIXTURE_OUTPUT;
assert.ok(output && process.env.AIDIY_EXPLORER_FIXTURE_HTML, 'Launch with scripts/check-explorer-component.mjs');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { passed: false, sandbox: true, contextIsolation: true, nodeIntegration: false, network: 'none; data: fixture only', mutations: 'renderer memory only', checks: [], screenshots: [], limitations: ['IME composition is simulated; no OS IME integration', 'No real OS Trash, filesystem mutation, AI, or application-server integration'] };
const windows = [];
let begins = 0;
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } });
  windows.push(win);
  const contents = win.webContents;
  const cleanups = [];
  function native(window) {
    cleanups.push(installNativeWindowMove({ record: { window, kind: 'explorer' }, screen: { getCursorScreenPoint: () => ({ x: 100, y: 100 }) }, drag: { forRecord: () => ({ begin: () => { begins++; return 'fixture-token'; }, end() {}, move: () => true }) } }));
  }
  native(win);
  contents.setWindowOpenHandler(details => details.url === 'about:blank' ? { action: 'allow', overrideBrowserWindowOptions: { show: false, width: 420, height: 780, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } } } : { action: 'deny' });
  contents.on('did-create-window', child => { windows.push(child); native(child); child.show(); });
  contents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(data:|about:)/.test(details.url) }));
  await win.loadURL('data:text/html,' + encodeURIComponent(fs.readFileSync(process.env.AIDIY_EXPLORER_FIXTURE_HTML, 'utf8')));
  contents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: 1100, height: 900 }, viewPosition: { x: 0, y: 0 }, viewSize: { width: 1100, height: 900 }, deviceScaleFactor: 1, scale: 1 });
  win.show(); contents.focus();
  const js = code => contents.executeJavaScript(code);
  async function until(code) { for (let n = 0; n < 100; n++) { if (await js(code)) return; await sleep(30); } throw Error('Timed out: ' + code); }
  async function click(selector) { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(30); }
  async function menu(file) {
    const selector = file ? `[role=treeitem][data-path="${file}"]` : '.explorer-root';
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+30,clientY:r.top+10}));})()`);
    await until(`!!document.querySelector('.explorer-context-menu')`);
  }
  const command = action => click(`.explorer-context-menu [data-action="${action}"]`);
  async function keyboard(selector, key, extra = {}) { await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.focus();n.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true,...${JSON.stringify(extra)}}));})()`); await sleep(30); }
  async function value(selector, text) { await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(text)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`); }
  async function hold(selector, owner = contents, expectedDrag = false) {
    const position = await owner.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    const before = begins;
    owner.sendInputEvent({ type: 'mouseDown', ...position, button: 'left', clickCount: 1 });
    await sleep(800);
    assert.equal(begins - before, expectedDrag ? 1 : 0, selector + ': native drag eligibility');
    owner.sendInputEvent({ type: 'mouseUp', ...position, button: 'left', clickCount: 1 });
    await sleep(60);
  }
  async function screenshot(name, owner = contents) {
    await sleep(150);
    const image = await owner.capturePage(), size = image.getSize(), bitmap = image.toBitmap();
    let min = 255, max = 0;
    for (let i = 0; i < bitmap.length; i += 4) { min = Math.min(min, bitmap[i], bitmap[i + 1], bitmap[i + 2]); max = Math.max(max, bitmap[i], bitmap[i + 1], bitmap[i + 2]); }
    const usable = size.width > 1 && size.height > 1 && max - min > 12;
    const file = path.join(output, name + '.png');
    fs.writeFileSync(file, image.toPNG());
    result.screenshots.push({ file, size, usable, rgbRange: [min, max] });
  }
  await until(`window.fixture?.ready && !!document.querySelector('[data-path="docs"]')`);
  await hold('.qa-heading', contents, true);
  result.checks.push('positive control: ordinary background long-press starts native drag once');
  await click('[data-path="docs"] .chevron');
  await menu('docs/sample.txt');
  assert.equal(await js(`document.querySelectorAll('.explorer-context-menu [role=menuitem]').length`), 10);
  assert.equal(await js(`document.querySelector('[data-action="paste"]').disabled`), true);
  await hold('.menu-target');
  await screenshot('01-context-menu');
  result.checks.push('10 menu items; paste disabled before copy; native menu no-drag');
  await command('copy-path');
  assert.equal(await js('fixture.log.clipboard.at(-1)'), '/fixture/project/docs/sample.txt');
  await menu('docs/sample.txt'); await command('copy');
  await menu('target'); await command('paste');
  await until(`fixture.files.has('target/sample.txt') && !!document.querySelector('[data-path="target/sample.txt"]')`);
  result.checks.push('absolute path copied to mock clipboard; file copy/paste with real Vue tree update');
  await menu('docs/sample.txt'); await command('rename');
  await until(`!!document.querySelector('.explorer-rename')`);
  await screenshot('02-inline-rename');
  await value('.explorer-rename', '日本語.txt');
  const beforeRename = await js('fixture.mutations().length');
  for (const key of ['Enter', 'Escape']) {
    await keyboard('.explorer-rename', key, { isComposing: true });
    assert.equal(await js(`!!document.querySelector('.explorer-rename')`), true);
    assert.equal(await js('fixture.mutations().length'), beforeRename);
  }
  await keyboard('.explorer-rename', 'Escape');
  assert.equal(await js(`!!document.querySelector('.explorer-rename')`), false);
  assert.equal(await js('fixture.mutations().length'), beforeRename);
  await menu('docs/sample.txt'); await command('rename');
  await value('.explorer-rename', 'renamed.txt');
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await until(`!!document.querySelector('[data-path="docs/renamed.txt"]')`);
  assert.equal(await js('fixture.mutations().length'), beforeRename + 1);
  result.checks.push('inline rename: simulated IME Enter/Escape ignored; Escape cancels; native Enter commits once');
  await menu('docs/renamed.txt'); await command('trash');
  await until(`!!document.querySelector('.explorer-action-dialog')`);
  assert.equal(await js('fixture.log.trash.length'), 0);
  await hold('.explorer-action-dialog .dialog-path');
  await screenshot('03-trash-confirmation');
  await click('.explorer-action-dialog [data-initial-focus]');
  assert.equal(await js('fixture.log.trash.length'), 0);
  await menu('docs/renamed.txt'); await command('trash');
  await click('.explorer-action-dialog .danger');
  await until(`fixture.log.trash.length===1 && !document.querySelector('[data-path="docs/renamed.txt"]')`);
  assert.equal(await js('fixture.mutations().at(-1).body.confirmed'), true);
  result.checks.push('trash: display/cancel produce no request; explicit confirmation sends confirmed:true once; native dialog no-drag');
  await menu('keep.txt'); await command('copy');
  await keyboard('.explorer-root-name', 'v', { ctrlKey: true });
  await until(`!!document.querySelector('[data-path="keep - コピー.txt"]')`);
  assert.equal(await js('fixture.mutations().at(-1).body.directory'), '');
  await keyboard('.explorer-root-name', 'c', { ctrlKey: true, shiftKey: true });
  assert.equal(await js('fixture.log.clipboard.at(-1)'), '/fixture/project');
  await keyboard('.explorer-root-name', 'F10', { shiftKey: true });
  assert.equal(await js(`document.querySelector('[data-action="trash"]').disabled`), true);
  await keyboard('.explorer-context-menu button', 'Escape');
  result.checks.push('root Ctrl+V targets root, Ctrl+Shift+C copies root, Shift+F10 opens root menu');
  await screenshot('04-completed');
  // 同じVue実体をabout:blankへ移し、clipboard・menuとno-dragを再確認する。
  await click('button[aria-label="エクスプローラーをピン留め"]');
  await until('fixture.log.detached===true');
  const child = windows.find(window => window !== win && !window.isDestroyed());
  assert.ok(child, 'Pinned BrowserWindow exists');
  const childJs = code => child.webContents.executeJavaScript(code);
  child.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: 420, height: 780 }, viewPosition: { x: 0, y: 0 }, viewSize: { width: 420, height: 780 }, deviceScaleFactor: 1, scale: 1 });
  child.focus(); child.webContents.focus(); await sleep(200);
  assert.equal(await childJs(`!!document.querySelector('[data-path="keep.txt"]')`), true);
  await childJs(`window.qaPopupEvents=[];for(const kind of ['blur','focus','scroll','contextmenu'])window.addEventListener(kind,event=>qaPopupEvents.push({kind,target:event.target?.className||event.target?.nodeName}),true)`);
  await childJs(`(()=>{const node=document.querySelector('[data-path="keep.txt"]'),r=node.getBoundingClientRect();node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+20,clientY:r.y+10}));})()`);
  await sleep(80);
  result.popupDiagnostics = await childJs(`({events:qaPopupEvents,focused:document.hasFocus(),width:innerWidth,height:innerHeight,menu:!!document.querySelector('.explorer-context-menu')})`);
  assert.equal(await childJs(`document.querySelectorAll('.explorer-context-menu [role=menuitem]').length`), 10);
  await hold('.menu-target', child.webContents);
  await screenshot('05-pinned-menu', child.webContents);
  await childJs(`document.querySelector('button[aria-label="本体へ戻す"]').click()`);
  await until('fixture.log.detached===false && !!document.querySelector("[data-path=\\"keep.txt\\"]")');
  result.checks.push('pin/restore retains actual Vue DOM/tree; pinned popup renders all menu entries and excludes native drag');
  assert.deepEqual(await js('fixture.log.errors'), []);
  result.passed = true;
  result.nativeDragBegins = begins;
  result.electron = process.versions.electron;
  result.chrome = process.versions.chrome;
  result.rendererErrors = await js('fixture.log.errors');
  result.apiRequests = await js('fixture.log.requests');
  if (result.screenshots.some(shot => !shot.usable)) result.limitations.push('One or more headless capturePage images are black, uniform, or 1px; DOM assertions are not visual screenshot verification.');
  await js('fixture.unmount()');
  for (const cleanup of cleanups) cleanup();
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log('EXPLORER_COMPONENT_RESULT ' + JSON.stringify(result));
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  app.quit();
}).catch(async error => {
  result.error = error.stack || String(error);
  try { result.diagnostics = await windows[0]?.webContents.executeJavaScript(`({pinError:document.querySelector('.app-error')?.textContent,errors:window.fixture?.log.errors,secureContext:isSecureContext,randomUUID:typeof crypto.randomUUID})`); } catch {}
  if (result.screenshots.some(shot => !shot.usable)) result.limitations.push('Headless capturePage images are black 1px; DOM checks do not establish visual screenshot QA.');
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.error('EXPLORER_COMPONENT_FAILURE ' + result.error);
  app.exit(1);
});
setTimeout(() => { console.error('Explorer component QA timeout'); app.exit(2); }, 45000).unref();
