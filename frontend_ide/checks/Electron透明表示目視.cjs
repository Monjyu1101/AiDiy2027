// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実IDE画面のズーム途中を静止し、Computer UseでWindowsの合成結果を撮影する。
// 表示処理は本番共通モジュール。試験用に完了待ちの上限だけ延長する。
const {app,BrowserWindow}=require('electron');
const {readFileSync,mkdtempSync,rmSync,writeFileSync,mkdirSync}=require('node:fs');
const {join,resolve}=require('node:path');const {tmpdir}=require('node:os');
const vm=require('node:vm');
const profile=mkdtempSync(join(tmpdir(),'aidiy-transparent-preview-'));app.setPath('userData',profile);
const delay=40000;
const output=resolve(process.env.AIDIY_PREVIEW_OUTPUT||'temp/transparent-galaxy');mkdirSync(output,{recursive:true});
const moduleFixture={exports:{}};
vm.runInNewContext(readFileSync(resolve(__dirname,'../../frontend_ide/host/scripts/window-opening.cjs'),'utf8'),{module:moduleFixture,setTimeout:(fn,ms)=>setTimeout(fn,ms===1750?ms+delay:ms)});
app.whenReady().then(async()=>{
 try{
  const win=new BrowserWindow({show:false,title:'AiDiy IDE 表示確認',frame:false,width:1000,height:620,x:360,y:200,backgroundColor:'#080c1a',webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  if(!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(process.env.AIDIY_PREVIEW_URL||''))throw Error('起動中IDEのURLをAIDIY_PREVIEW_URLに指定してください。');
  await win.loadURL(process.env.AIDIY_PREVIEW_URL);
  // 非表示のままでは宇宙の描画ループが停止する。透明度0で先に描画し、準備中を撮影しない。
  win.setOpacity(0);win.showInactive();
  const ready=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
   const start=performance.now();const check=()=>{
    const engine=window.aidiyIDE,canvas=document.querySelector('.space-canvas');
    const status=document.querySelector('.space-orbit-status')?.textContent||'';
    if(engine?.world&&canvas&&!document.querySelector('.space-loading')&&status&&!status.includes('準備中')){
     const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
     let colored=0;for(let n=0;n<pixels.length;n+=80)if(pixels[n]+pixels[n+1]+pixels[n+2]>90)colored++;
     if(colored>30){engine.setAutoSpin(false);engine.interact();resolve({galaxyReady:true,coloredSamples:colored,loading:false,status});return;}
    }
    if(performance.now()-start>20000){reject(Error('銀河の描画完了を確認できません。準備中の画像では進みません。'));return;}
    setTimeout(check,50);
   };check();
  })`);
  writeFileSync(join(output,'galaxy-ready.json'),JSON.stringify(ready,null,2));
  console.log(JSON.stringify(ready));win.hide();win.setOpacity(1);
  class PreviewCanvas extends BrowserWindow{
   async loadURL(url){
    const html=decodeURIComponent(url.slice(url.indexOf(',')+1)),snapshot=html.match(/src="data:image\/png;base64,([^"]+)"/);
    if(snapshot)writeFileSync(join(output,'galaxy-snapshot.png'),Buffer.from(snapshot[1],'base64'));
    await super.loadURL(url);await this.webContents.executeJavaScript(`document.title='AiDiy IDE 透明ズーム確認';document.addEventListener('animationstart',()=>{const a=document.querySelector('div').getAnimations()[0];a.pause();a.currentTime=200;setTimeout(()=>a.play(),${delay});},{once:true});`);
   }
  }
  await moduleFixture.exports.拡大表示(PreviewCanvas,win);
  for(const window of BrowserWindow.getAllWindows())window.destroy();app.exit(0);
 }catch(error){writeFileSync(join(output,'failure-'+Date.now()+'.json'),JSON.stringify({error:String(error)}));console.error(error);app.exit(1);}
});
app.on('quit',()=>{try{rmSync(profile,{recursive:true,force:true});}catch{}});
