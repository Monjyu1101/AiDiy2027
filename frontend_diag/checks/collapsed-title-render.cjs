// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Optional: electron --headless --no-sandbox --disable-gpu frontend_diag/checks/collapsed-title-render.cjs
// Real distributed Vue application in an explicit-size iframe: headless Electron's
// outer viewport can be 1px, so it must not be used as evidence of window geometry.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'diag-collapsed-render-'));
app.setPath('userData',path.join(dir,'profile'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const staticDir=path.resolve(__dirname,'../static');
 const html=fs.readFileSync(path.join(staticDir,'index.html'),'utf8');
 const win=new BrowserWindow({show:false,frame:false,webPreferences:{sandbox:true,offscreen:true}});
 let cases=0;
 for(const mini of [false,true]){
  const fixture=html.replace('<head>',`<head><base href="${pathToFileURL(staticDir+path.sep).href}">`)
   .replace('<script type="module"',`<script>window.aidiyWindow={initialMini:${mini}};</script><script type="module"`);
  const fixturePath=path.join(dir,mini?'mini.html':'normal.html');fs.writeFileSync(fixturePath,fixture);
  const hostPath=path.join(dir,'host.html');
  fs.writeFileSync(hostPath,`<iframe style="width:${mini?360:800}px;height:${mini?190:600}px;border:0" src="${pathToFileURL(fixturePath).href}"></iframe>`);
  await win.loadFile(hostPath);await delay(200);
  const run=code=>win.webContents.executeJavaScript(`(()=>{const frame=document.querySelector('iframe'),doc=frame.contentDocument,view=frame.contentWindow;${code}})()`);
  assert.equal(await run("return doc.querySelector('.panel-brand').classList.contains('compact')"),mini);
  for(const zoom of [0.8,1,1.25,1.5]){
   await run(`doc.documentElement.style.zoom=${zoom}`);
   for(let cycle=0;cycle<3;cycle++){
    await run("doc.querySelector('.code-panel-toggle').click()");await delay(300);
    const value=await run(`const root=doc.querySelector('#app'),title=doc.querySelector('.panel-brand'),r=root.getBoundingClientRect(),t=title.getBoundingClientRect(),c=view.getComputedStyle(root);return {rootHeight:r.height,titleHeight:t.height,titleTop:t.top,rootTop:r.top,borders:[c.borderTopWidth,c.borderRightWidth,c.borderBottomWidth,c.borderLeftWidth],barCount:doc.querySelectorAll('.connection-bar').length,mark:doc.querySelector('.code-panel-mark').textContent,hidden:doc.querySelector('.diag-panel').classList.contains('diag-panel-hidden')};`);
    assert.equal(value.mark,'▶');assert.equal(value.hidden,true);assert.equal(value.barCount,0);
    assert.deepEqual(value.borders,['0px','0px','0px','0px']);
    assert.ok(Math.abs(value.rootHeight-value.titleHeight)<0.05,JSON.stringify(value));
    assert.ok(Math.abs(value.titleTop-value.rootTop)<0.05,JSON.stringify(value));
    await run("doc.querySelector('.code-panel-toggle').click()");await delay(300);
    assert.equal(await run("return doc.querySelectorAll('.connection-bar').length"),1);
    assert.ok(await run("const t=doc.querySelector('.panel-brand'),b=doc.querySelector('.connection-bar');return t.nextElementSibling===b&&Math.abs(b.getBoundingClientRect().top-t.getBoundingClientRect().bottom)<0.05"),'restored separator directly below title');
    assert.equal(await run("return doc.querySelector('.code-panel-mark').textContent"),'▽');cases++;
   }
  }
 }
 console.log(`PASS: ${cases} real Vue fold/restore cycles, normal and mini, 4 CSS zoom levels; no connection DOM, no root border whiskers, title-only root.`);
 win.destroy();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
app.on('quit',()=>fs.rmSync(dir,{recursive:true,force:true}));
