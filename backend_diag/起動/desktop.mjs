// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {readFile,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {recordDesktopFailure} from './desktop-log.mjs';
export function browserMode(options, env=process.env, platform=process.platform) {
  return options.browser || options.noOpen || env.CODESPACES==='true' || env.CI==='true' || (platform==='linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY);
}
export async function desktopBinary(root=fileURLToPath(new URL('../',import.meta.url)), platform=process.platform) {
  const suffix=platform==='win32'?'electron.exe':platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron';
  const electron=path.join(root,'node_modules','electron');
  const metadata=JSON.parse(await readFile(path.join(electron,'package.json'),'utf8'));
  if ((await readFile(path.join(electron,'dist','version'),'utf8')).trim().replace(/^v/,'')!==metadata.version || (await readFile(path.join(electron,'path.txt'),'utf8'))!==suffix) throw new Error('Electron not ready');
  const executable=path.join(electron,'dist',suffix);await access(executable,platform==='win32'?constants.F_OK:constants.X_OK);return executable;
}
const failures={
  IPC:'親子プロセス間通信に失敗しました。',
  TIMEOUT:'起動確認がタイムアウトしました。',
  URL:'起動情報を確認できません。',
  WINDOW:'ウィンドウを作成できません。',
  LOAD:'診断画面を読み込めません。',
  RENDERER:'画面プロセスが終了しました。',
};
export function openDesktop(executable, url, onClose, spawnFn=spawn, timeout=15000, onReady=()=>{}, onExisting=()=>{}) {
  // Windows Electron の stdin は常に EOF。IDE と同じ専用 IPC を使い、秘密 URL は argv/env/log に出さない。
  // GUI には SW_HIDE を引き継がせない（windowsHide:true だと Windows で show() 後も非表示のまま）。
  const env={...process.env};
  for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH)$/i.test(key))delete env[key];
  const child=spawnFn(executable,[fileURLToPath(new URL('./electron-main.cjs',import.meta.url))],{shell:false,stdio:['ignore','ignore','pipe','ipc'],env,windowsHide:false,detached:process.platform!=='win32'});
  let ended=false, sent=false, shown=false, reported=false, existing=false, disconnectTimer;
  const finish=()=>{if(ended)return;ended=true;clearTimeout(timer);clearTimeout(disconnectTimer);onClose();};
  const report=(code,detail='')=>{
    if(reported || child.diagClosing)return;reported=true;process.exitCode=1;
    if(process.env.AIDIY_DIAG_LAUNCHER_CHILD==='1')recordDesktopFailure(Object.hasOwn(failures,code)?code:['SPAWN','EXIT'].includes(code)?code:'EXIT');
    console.error(`Electron: ${failures[code] || '異常終了しました。'}${detail} セットアップまたは実行環境を確認してください。--browser でも起動できます。`);
  };
  const abort=code=>{report(code);closeDesktop(child);finish();};
  const timer=setTimeout(()=>abort('TIMEOUT'),timeout);timer.unref();
  // 生の stderr は URL・ローカル情報を含み得るため表示しない。既知の起動原因だけを分類する。
  let diagnostic='';
  child.stderr?.on('data',chunk=>{
    diagnostic=(diagnostic+String(chunk)).slice(-4096);
    if(/error while loading shared libraries/i.test(diagnostic))child.diagNativeReason=' 共有ライブラリが不足しています。';
    else if(/No usable sandbox|Running as root without --no-sandbox/i.test(diagnostic))child.diagNativeReason=' OS の sandbox 実行条件を確認してください。';
    else if(/Missing X server|cannot open display|Failed to connect to Wayland display/i.test(diagnostic))child.diagNativeReason=' GUI ディスプレイへ接続できません。';
  });
  child.on('message',message=>{
    if(ended || child.diagClosing)return;
    if(message?.type==='diag-ready' && !sent){
      sent=true;
      try {child.send({type:'diag-start',url},error=>{if(error && !ended)abort('IPC');});}catch{abort('IPC');}
    }else if(message?.type==='diag-shown' && sent){if(!shown){shown=true;clearTimeout(timer);onReady();}}
    else if(message?.type==='diag-failed' && Object.hasOwn(failures,message.code)){report(message.code);}
    // 既に起動中の診断ウィンドウを前面に出した。秘密 URL は送らずに終了させる。
    else if(message?.type==='diag-existing' && !sent){existing=true;clearTimeout(timer);onExisting();}
  });
  child.once('disconnect',()=>{
    // 正常終了でも IPC は exit より先に閉じる。終了イベントを待ち、残存した子だけ停止する。
    if(!ended && !child.diagClosing){disconnectTimer=setTimeout(()=>abort('IPC'),1000);disconnectTimer.unref();}
  });
  child.once('error',error=>{
    const code=['ENOENT','EACCES','EPERM'].includes(error?.code)?` (${error.code})`:'';
    report('SPAWN',code);closeDesktop(child);finish();
  });
  child.once('exit',(code,signal)=>{
    if(!existing && (!shown || code!==0 || signal))report('EXIT',` (exit=${Number.isInteger(code)?code:'none'}, signal=${['SIGTERM','SIGKILL','SIGABRT','SIGSEGV'].includes(signal)?signal:'none'})${child.diagNativeReason || ''}`);
    if(process.platform!=='win32' && child.pid){try{process.kill(-child.pid,'SIGKILL');}catch{}}
    finish();
  });return child;
}

export function closeDesktop(child, timeout=1000) {
  if (!child || child.diagClosing) return;
  child.diagClosing=true;
  const kill=signal=>{try {if(process.platform!=='win32' && child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{}};
  kill('SIGTERM');
  const timer=setTimeout(()=>kill('SIGKILL'),timeout);timer.unref();
  child.once('exit',()=>clearTimeout(timer));
}
