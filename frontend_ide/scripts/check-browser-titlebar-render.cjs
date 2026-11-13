// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict'),fs=require('node:fs');const {join}=require('node:path'),{pathToFileURL}=require('node:url');const directory=process.argv.at(-1);const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.disableHardwareAcceleration();app.whenReady().then(async()=>{const win=new BrowserWindow({width:1450,height:600,show:false,frame:false,webPreferences:{offscreen:true,sandbox:true}});let count=0;
fs.writeFileSync(join(directory,'host.html'),'<iframe id="frame" style="border:0;height:500px"></iframe>');await win.loadFile(join(directory,'host.html'));
const evalFrame=code=>win.webContents.executeJavaScript('document.querySelector("iframe").contentWindow.eval('+JSON.stringify(code)+')');
for(const width of [1440,1100,900,800,640,400])for(const header of [false,true])for(const long of [false,true]){
 await win.webContents.executeJavaScript(`document.querySelector('iframe').width=${width};document.querySelector('iframe').src=${JSON.stringify(pathToFileURL(join(directory,'index.html')).href+'?'+(header?'header&':'')+(long?'long':''))}`);await sleep(250);
 for(let cycle=0;cycle<(header?1:6);cycle++){
 const m=await evalFrame(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const brand=document.querySelector('.panel-brand');return{brand:rect(brand),parts:[...brand.children].map(rect),errors:runtimeErrors,wrap:getComputedStyle(brand.children[0]).whiteSpace};})()`);
 assert.equal(m.brand.height,31,JSON.stringify(m));assert.deepEqual(m.errors,[]);assert.equal(m.wrap,'nowrap');assert.ok(m.parts[0].right<=m.parts[1].x+1,JSON.stringify(m));assert.ok(m.parts[1].right<=m.parts[2].x+1,JSON.stringify(m));assert.ok(m.parts.every(r=>r.y>=m.brand.y&&r.bottom<=m.brand.bottom+1),JSON.stringify(m));count++;
 if(!header){await evalFrame(`document.querySelector('.code-panel-toggle').click()`);await sleep(250);}
 }
 if(width===800&&!long){const image=await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});if(image.isEmpty())console.warn('Screenshot unavailable: headless renderer returned an empty image.');else fs.writeFileSync(join(directory,'browser-title-'+(header?'fullscreen':'normal')+'.png'),image.toPNG());}
}
console.log('PASS '+count+' layouts, real Vue, normal/fullscreen/long title/folding at 400–1440 CSS px. Native IPC mocked.');win.destroy();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
