// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {realpathSync,statSync,fstatSync,openSync,readSync,closeSync,constants}=require('node:fs');
const {resolve,relative,isAbsolute,sep,extname,dirname,win32}=require('node:path');
const {execFile}=require('node:child_process');

const fail=error=>({ok:false,error});
const changed='IDEの利用状態や表示が変わりました。もう一度操作してください。';
// ファイルAPIと同じ / 区切りの相対パスだけを受け取る。URL・ドライブ・ADSも拒否する。
function validPreviewPath(value){
 return typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\\:\x00-\x1f\x7f]/.test(value)
  &&!isAbsolute(value)&&!win32.isAbsolute(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&(process.platform!=='win32'||!/[. ]$/.test(part)));
}
const riskyExtensions=new Set(('.exe .com .bat .cmd .msi .msp .scr .pif .cpl .dll .sys .ocx .vbs .vbe .js .mjs .cjs .jse .jsx .ts .tsx .coffee .wsf .wsh .ps1 .psm1 .psd1 .reg .hta .lnk .url .scf .webloc .fileloc .alias .website .library-ms .search-ms .searchconnector-ms .settingcontent-ms .sh .bash .zsh .ksh .fish .command .run .bin .appimage .desktop .jar .py .pyw .pl .rb .php .lua .tcl .awk .applescript .scpt .workflow .action .shb .sct .chm .application .gadget .appref-ms .pkg .dmg .deb .rpm').split(' '));
function riskyFile(path,info,head){
 if(riskyExtensions.has(extname(path).toLowerCase())||(info.mode&0o111)!==0)return true;
 // 拡張子を変えた実行形式・shebangも見逃さない。読むのは先頭512バイトまで。
 const magic=head.subarray(0,4).toString('hex');
 return head.subarray(0,2).toString()==='#!'||head.subarray(0,2).toString()==='MZ'
  ||['7f454c46','feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca','4c000000'].includes(magic)
  ||/^\s*\[(?:Desktop Entry|InternetShortcut)\]/i.test(head.toString('utf8'));
}

// viewer/server.mjs の insideRoot と同じ realpath / relative 境界を使う。
// ファイルAPIで閲覧できるファイルが対象。HTML配信専用の拡張子・設定除外とは別の境界。
function previewTarget(root,path,{inspect=false,folder=false}={}){
 if(!((folder&&path==='')||validPreviewPath(path))||typeof root!=='string'||!isAbsolute(root)||root.length>4096||root.includes('\0'))throw Error('ファイルのパスが不正です。');
 let full,realRoot,info,folderPath,folderIdentity,head=Buffer.alloc(0);
 try{
  realRoot=realpathSync(root);full=realpathSync(resolve(realRoot,...path.split('/')));
  const back=relative(realRoot,full);
  if((!back&&!folder)||back==='..'||back.startsWith(`..${sep}`)||isAbsolute(back))throw Error('outside');
  info=statSync(full);
  if(!info.isFile()&&!(folder&&info.isDirectory()))throw Error('not a file or folder');
  if(folder){
   // 内部リンクのファイルでも、一覧に表示された項目の所在フォルダを開く。
   folderPath=info.isDirectory()?full:realpathSync(dirname(resolve(realRoot,...path.split('/'))));
   const back=relative(realRoot,folderPath),directory=statSync(folderPath);
   if(back==='..'||back.startsWith(`..${sep}`)||isAbsolute(back)||!directory.isDirectory())throw Error('outside folder');
   folderIdentity=[directory.dev,directory.ino,directory.mode].join(':');
  }
  if(inspect){
   let handle;
   try{
    handle=openSync(full,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));
    const opened=fstatSync(handle);
    if(!opened.isFile()||opened.dev!==info.dev||opened.ino!==info.ino||opened.size!==info.size||opened.mtimeMs!==info.mtimeMs||opened.ctimeMs!==info.ctimeMs)throw Error('changed');
    head=Buffer.alloc(512);head=head.subarray(0,readSync(handle,head,0,head.length,0));
   }
   finally{if(handle!==undefined)closeSync(handle);}
  }
 }catch{throw Error('プロジェクト内のファイルを確認できません。削除・移動やアクセス権を確認してください。');}
 return{full,realRoot,lexical:resolve(root,...path.split('/')),identity:[info.dev,info.ino,info.mode,info.size,info.mtimeMs,info.ctimeMs].join(':'),
  folderPath,folderIdentity,
  risky:inspect&&(riskyFile(path,info,head)||riskyFile(full,info,head))};
}
function previewFile(root,path,inspect=false){return previewTarget(root,path,{inspect});}
const sameFile=(left,right)=>left.full===right.full&&left.realRoot===right.realRoot&&left.identity===right.identity&&left.risky===right.risky&&left.folderPath===right.folderPath&&left.folderIdentity===right.folderIdentity;

// Rendererへ公開するのはコピー・既定アプリ・所在フォルダの操作だけ。任意のコマンド・URLは扱わない。
function createNativePreviewActions({records,trustedEvent,readState,sessionKey,clipboard,shell,dialog,isQuitting=()=>false,platform=process.platform,run=execFile}){
 const pending=new WeakSet(),epochs=new WeakMap();
 const alive=record=>!!record&&!record.window.isDestroyed()&&[...records.values()].includes(record);
 const ownerOf=source=>source?.kind==='ide'&&!source.owner?source:source?.kind==='viewer'?source.owner:null;
 const epoch=record=>epochs.get(record)||0;
 function invalidate(record){if(record)epochs.set(record,epoch(record)+1);}
 async function perform(event,path,action){
  const source=trustedEvent(event),owner=ownerOf(source);
  if(!((action==='folder'&&path==='')||validPreviewPath(path)))return fail('ファイルのパスが不正です。');
  if(!alive(source)||!alive(owner)||owner.kind!=='ide'||owner.owner||(source.kind==='viewer'&&source.viewerPath!==path))return fail('この画面からはファイルを操作できません。');
  if(pending.has(source))return fail('前のファイル操作を確認中です。しばらくお待ちください。');
  const revision=owner.revision,sourceEpoch=epoch(source),ownerEpoch=epoch(owner);
  const current=()=>!isQuitting()&&trustedEvent(event)===source&&alive(source)&&alive(owner)&&ownerOf(source)===owner
   &&owner.revision===revision&&epoch(source)===sourceEpoch&&epoch(owner)===ownerEpoch
   &&(source===owner||source.viewerPath===path);
  const active=state=>current()&&state?.active&&typeof state.project?.path==='string'&&!!sessionKey(state)
   &&(source===owner||source.linkKey===sessionKey(state));
  pending.add(source);
  try{
   const state=await readState(owner);
   if(!active(state))throw Error(changed);
   const root=state.project.path,key=sessionKey(state),lookup=()=>previewTarget(root,path,{inspect:action==='open',folder:action==='folder'}),target=lookup();
   async function recheck(){
    const latest=await readState(owner);
    if(!active(latest)||latest.project.path!==root||sessionKey(latest)!==key)throw Error(changed);
    // 状態取得・確認ダイアログの待ち時間にリンク先やファイルが変わったら開かない。
    // この同期確認からネイティブ操作までに別のIPCを挟まない。
    if(!sameFile(target,lookup()))throw Error('ファイルが変更されました。もう一度操作してください。');
   }
   await recheck();
   if(action==='open'&&target.risky){
    const {response}=await dialog.showMessageBox(source.window,{type:'warning',title:'AiDiy IDE',
     message:'このファイルをアプリで開きますか？',detail:`実行ファイル・スクリプト・ショートカットの可能性があります。開くとプログラムが実行されたり、他の場所へ移動したりする場合があります。信頼できるファイルだけを開いてください。\n\n${target.full}`,
     buttons:['開く','キャンセル'],defaultId:1,cancelId:1,noLink:true});
    if(response!==0)return{ok:false,cancelled:true,error:'アプリで開く操作をキャンセルしました。'};
    await recheck();
   }
   if(!current())throw Error(changed);
   if(action==='copy')clipboard.writeText(target.lexical);
   else if(action==='folder'){
    // macOSは.app等のディレクトリを実行せず、Finderに明示してフォルダとして表示する。
    const error=platform==='darwin'
     ? await new Promise((resolve,reject)=>run('/usr/bin/open',['-a','Finder','--',target.folderPath],{windowsHide:true,timeout:10000},error=>error?reject(error):resolve('')))
     : await shell.openPath(target.folderPath);
    if(error)return fail(`フォルダを開けませんでした。${String(error).slice(0,300)}`);
   }
   else{
    const error=await shell.openPath(target.full);
    if(error)return fail(`アプリで開けませんでした。${String(error).slice(0,300)}`);
   }
   return{ok:true};
  }catch(error){return fail(error?.message||'ファイルを操作できませんでした。');}
  finally{pending.delete(source);}
 }
 return{copyFilePath:(event,path)=>perform(event,path,'copy'),openFile:(event,path)=>perform(event,path,'open'),openFolder:(event,path)=>perform(event,path,'folder'),invalidate};
}
module.exports={createNativePreviewActions,validPreviewPath,previewFile};
