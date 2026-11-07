// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Electronの透明パネル・750msズームを測る。AIやプロジェクト設定には接続しない。
const {app,BrowserWindow}=require('electron');
const {拡大表示}=require('../../frontend_ide/host/scripts/window-opening.cjs');
const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join,resolve,sep}=require('node:path');
const assert=require('node:assert/strict');
const profile=mkdtempSync(join(tmpdir(),'aidiy-opening-'));app.setPath('userData',profile);
const output=resolve(process.env.AIDIY_TEST_OUTPUT||'temp/window-opening-check');mkdirSync(output,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 let main,canvas,timer;const frames=[],captureState={};let timing,options;
 try{
  main=new BrowserWindow({show:false,x:300,y:220,width:540,height:340,frame:false,webPreferences:{sandbox:true}});
  main.focus=()=>{};
  await main.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html style="height:100%;background:transparent"><body style="margin:0;min-height:100%;background:#080c1a;color:#b5efff;font:24px sans-serif;opacity:0"><p style="margin:0;padding:32px">AiDiy 透明パネル内の実画面ズーム</p><p style="padding:0 32px;font-size:16px">表示内容ごと拡大します。</p></body></html>'));
  const initial=main.getBounds();
  const capture=main.webContents.capturePage.bind(main.webContents),execute=main.webContents.executeJavaScript.bind(main.webContents);
  main.webContents.capturePage=async(...args)=>{try{captureState.opacity=await execute('getComputedStyle(document.body).opacity');const result=await capture(...args);captureState.empty=result.isEmpty();captureState.size=result.getSize();return result;}catch(error){captureState.error=String(error);throw error;}};
  main.webContents.executeJavaScript=async(...args)=>{try{return await execute(...args);}catch(error){captureState.scriptError=String(error);throw error;}};
  class MeasuredCanvas extends BrowserWindow{
   constructor(value){super(value);canvas=this;options=value;
    this.webContents.once('did-finish-load',async()=>{
     await this.webContents.executeJavaScript(`window.openingTimes={};document.addEventListener('animationstart',e=>{openingTimes.start=performance.now();openingTimes.duration=getComputedStyle(e.target).animationDuration;});document.addEventListener('animationend',e=>{openingTimes.end=performance.now();});`);
     timer=setInterval(async()=>{if(canvas.isDestroyed())return;try{
      const data=await canvas.webContents.executeJavaScript(`({time:performance.now(),transform:getComputedStyle(document.querySelector('div')).transform,...openingTimes})`);
      frames.push({...data,bounds:canvas.getBounds()});
      if(data.start&&!data.end&&frames.filter(f=>f.start&&!f.end).length===2){writeFileSync(join(output,'opening-midpoint.png'),(await canvas.webContents.capturePage()).toPNG());}
      if(data.end)timing=data;
     }catch{}},60);
    });
   }
  }
  const start=performance.now();assert.equal(await 拡大表示(MeasuredCanvas,main),true);
  const elapsed=performance.now()-start;
  if(canvas&&!canvas.isDestroyed())timing=await canvas.webContents.executeJavaScript('window.openingTimes');
  await sleep(30);clearInterval(timer);
  assert.ok(timing&&timing.end-timing.start>=700&&timing.end-timing.start<1100,JSON.stringify({timing,canvas:!!canvas,frames:frames.length,captureState}));
  assert.equal(timing.duration,'0.75s');assert.equal(options.transparent,true);assert.equal(options.backgroundColor,'#00000000');
  assert.deepEqual(main.getBounds(),initial,'実窓の寸法は変えない');
  assert.ok(frames.some(f=>f.start&&!f.end&&f.transform!=='matrix(1, 0, 0, 1, 0, 0)'),'途中倍率を観測する');
  const b=frames[0].bounds;for(const f of frames)assert.deepEqual(f.bounds,b,'透明パネルの領域を固定して確保');
  const rendered=await main.webContents.executeJavaScript(`!document.querySelector('style[data-aidiy-opening-capture]')`);
  assert.equal(rendered,true,'キャプチャ専用の一時スタイルを回収');
  assert.equal(await main.webContents.executeJavaScript("getComputedStyle(document.body).opacity"),'0','登場待ちの不透明度を元に戻す');
  const result={status:'✅ OK',method:'隔離した実Electronで実画面を取り込み、透明パネル内のズームとOS窓の矩形を測定。',durationMs:timing.end-timing.start,elapsedMs:elapsed,transparent:true,realContentSnapshot:true,captureStyleRemoved:rendered,mainBoundsUnchanged:true,canvasBoundsUnchanged:true,frames};
  writeFileSync(join(output,'opening-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,frames:frames.length}));
 }catch(error){writeFileSync(join(output,'opening-failure-'+Date.now()+'.json'),JSON.stringify({error:String(error),captureState,timing,frames},null,2));console.error(error);process.exitCode=1;}
 finally{clearInterval(timer);for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(process.exitCode||0);}
});
app.on('quit',()=>{if(!resolve(profile).startsWith(resolve(tmpdir())+sep))return;try{rmSync(profile,{recursive:true,force:true});}catch{}});
