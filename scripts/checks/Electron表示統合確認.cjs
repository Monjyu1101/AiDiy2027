// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Electronの独立試験を指定順に実行し、終了コードとログを保存する。
const {spawn}=require('node:child_process');
const {mkdirSync,writeFileSync,copyFileSync,existsSync}=require('node:fs');
const {resolve,join}=require('node:path');
process.chdir(resolve(__dirname,'../..'));
const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'');
const output=resolve(process.env.AIDIY_ELECTRON_AUDIT_DIR||'.aidiy_cache/selftest/electron/'+stamp+'-electron-motion-audit');mkdirSync(output,{recursive:true});
const jobs=[
 ['00-console-python',['-B','-X','utf8','-m','unittest','scripts/checks/test_electron_console.py','frontend_avatar/checks/test_start.py','scripts/checks/test_start_native_output.py','scripts/checks/test_diag_start.py'],{},process.env.AIDIY_TEST_PYTHON||'python'],
 ['00-console-node',['--test','scripts/checks/electron-console.test.cjs','frontend_avatar/checks/dev-start.test.cjs']],
 ['01-common',['--test','frontend_ide/checks/window-opening.test.mjs','frontend_ide/checks/native-window-move.test.mjs','frontend_ide/checks/folder-pages.test.mjs','frontend_ide/checks/panel-windows.test.mjs','frontend_ide/checks/route-expansion.test.mjs','backend_diag/checks/desktop.check.mjs','backend_diag/checks/statusbar.check.cjs']],
 ['02-diag',['backend_diag/checks/initial-mini-desktop.mjs']],
 ['03-console-code-live-ide',['frontend_ide/scripts/check-module-move.mjs']],
 ['04-ide-panels',['frontend_ide/scripts/check-panel-desktop.mjs']],
 ['05-ide-vr',['frontend_ide/scripts/check-all-displays.mjs'],{AIDIY_ALL_PANEL_POSITION_ONLY:'1'}],
 ['06-ide-2d',['frontend_ide/scripts/check-2d-motion.mjs']],
 ['07-avatar-windows',['frontend_avatar/checks/window-move-desktop.mjs']],
 ['08-avatar-opening',['--test','frontend_avatar/checks/window-opening.test.cjs']],
 ['09-discord',['frontend_channels/discord/checks/window-behavior-desktop.mjs']],
 ['10-discord-contract',['--test','frontend_channels/discord/checks/desktop.test.ts']],
 ['11-app-mini',['backend_diag/checks/app-launch-browser.mjs']],
 ['12-ide-browser',['frontend_ide/scripts/check-browser.mjs']],
 ['13-transparent-opening',['scripts/checks/Electron表示開始試験.cjs'],{AIDIY_TEST_OUTPUT:join(output,'共通-Electron表示')},require(resolve('frontend_ide/host/node_modules/electron'))],
];
const results=[];const save=()=>writeFileSync(join(output,'result.json'),JSON.stringify({date:new Date().toISOString(),os:process.platform,scope:'既存アプリを止めず隔離プロファイルで順に実行。AI・Discord投稿なし。OS設定による省略分岐の除去後の回帰試験。',results,passed:results.length===jobs.length&&results.every(r=>r.exitCode===0)},null,2)+'\n');
(async()=>{
 for(const [name,args,extra,executable=process.execPath] of jobs){
  console.log('開始 '+name);const start=Date.now();let log='';
  const child=spawn(executable,args,{cwd:process.cwd(),env:{...process.env,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',s=>log+=s);child.stderr.on('data',s=>log+=s);
  const code=await new Promise((res,rej)=>{child.once('exit',res);child.once('error',rej);});
  writeFileSync(join(output,name+'.log'),log,'utf8');results.push({name,command:[executable,...args].join(' '),env:extra||{},exitCode:code,durationMs:Date.now()-start,log:name+'.log'});save();console.log('終了 '+name+' '+code);
  if(code!==0){console.log(log.slice(-4500));process.exitCode=1;return;}
 }
 for(const [source,name] of [['temp/window-move-check/avatar-result.json','avatar-17-windows.json'],['temp/window-move-check/modules-result.json','module-move-result.json'],['temp/all-displays-check/panel-position-result.json','vr-panel-result.json']])if(existsSync(source))copyFileSync(source,join(output,name));
 console.log('Electron順次確認 OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
