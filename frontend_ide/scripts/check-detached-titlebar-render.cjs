// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Companion to check-detached-titlebar.mjs. Native owner IPC and body are mocked.
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { mkdtempSync, rmSync } = require("node:fs");
const profile = mkdtempSync(join(require("node:os").tmpdir(), "aidiy-detached-check-"));
app.setPath("userData", profile);
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1e3, height: 800, show: false, frame: false, webPreferences: { sandbox: true, offscreen: true } });
  await win.loadFile(join(__dirname, "../temp/detached-titlebar-check/index.html"));
  await new Promise((r) => setTimeout(r, 100));
  for (let n = 0; n < 3; n++) {
    await win.webContents.executeJavaScript(n===1?'window.emitLayoutState(true)':`document.querySelectorAll('.code-panel-toggle').forEach(x=>x.click())`);
    await new Promise((r) => setTimeout(r, 100));
    const rows = await win.webContents.executeJavaScript(`['explorer','panel-viewer','panel-navigation'].map(k=>{const r=document.getElementById(k),b=r.querySelector('.connection-bar'),t=r.querySelector('.panel-brand'),content=r.querySelector('.audit-content');return {kind:k,root:r.getBoundingClientRect().height,title:t.getBoundingClientRect().height,width:t.getBoundingClientRect().width,bar:b.getBoundingClientRect().height,display:getComputedStyle(b).display,content:content.getBoundingClientRect().height,mark:r.querySelector('.code-panel-mark').textContent};})`);
    console.log(rows);
    for (const row of rows) {
      assert.equal(row.root, 31);
      assert.equal(row.title, 31);
      assert.equal(row.width, 1e3);
      assert.equal(row.bar, 0);
      assert.equal(row.display, "none");
      assert.equal(row.content, 0);
      assert.equal(row.mark, "\u25B6");
    }
    await win.webContents.executeJavaScript(n===1?'window.emitLayoutState(false)':`document.querySelectorAll('.code-panel-toggle').forEach(x=>x.click())`);
    await new Promise((r) => setTimeout(r, 100));
    const restore = await win.webContents.executeJavaScript(`['explorer','panel-viewer','panel-navigation'].map(k=>{const r=document.getElementById(k);return {kind:k,height:r.getBoundingClientRect().height,bar:r.querySelector('.connection-bar').getBoundingClientRect().height,content:r.querySelector('.audit-content').getBoundingClientRect().height,value:r.querySelector('input').value};})`);
    console.log(restore);
    for (const row of restore) {
      assert.equal(row.height, 360);
      assert.ok(row.bar > 0);
      assert.ok(row.content > 0);
      assert.equal(row.value, "\u4FDD\u6301");
    }
  }
  console.log("PASS: actual mountPanelTitle, scoped Vue and production CSS; owner native IPC mocked; three fold/restore cycles");
  app.exit(0);
}).catch((e) => {
  console.error(e);
  app.exit(1);
});
