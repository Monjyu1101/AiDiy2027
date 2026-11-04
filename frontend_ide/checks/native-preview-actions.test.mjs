// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,symlink,unlink,chmod} from 'node:fs/promises';
import {readFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import actionsModule from '../デスクトップ/native-preview-actions.cjs';
const {createNativePreviewActions,validPreviewPath}=actionsModule;
const desktop=readFileSync(new URL('../desktop.cjs',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Windows はシンボリックリンク権限（開発者モード等）が無いと作成できないため、リンク前提の確認だけ省略する。
const symlinkSkip=await (async()=>{const temp=await mkdtemp(join(tmpdir(),'aidiy-native-preview-link-'));try{await writeFile(join(temp,'a'),'');await symlink(join(temp,'a'),join(temp,'b'));return false;}catch(error){if(error.code==='EPERM')return 'シンボリックリンクを作成できない環境';throw error;}finally{await rm(temp,{recursive:true,force:true});}})();
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

async function fixture(t,options={}){
 const temp=await mkdtemp(join(tmpdir(),'aidiy-native-preview-')),root=join(temp,'project');
 await mkdir(root);await writeFile(join(root,'readme.txt'),'読むだけ');await mkdir(join(root,'日本語 の資料'));
 await writeFile(join(root,'日本語 の資料','説明.txt'),'本文');await writeFile(join(root,'run.cmd'),'echo example');
 await writeFile(join(root,'記号 & % # ; $.txt'),'文字列のパス');
 t.after(()=>rm(temp,{recursive:true,force:true}));
 const records=new Map(),copies=[],opens=[],dialogs=[];
 const state={active:true,mode:'offline',startedAt:10,project:{path:root}};
 const key=value=>value.active?`${value.mode}:${value.startedAt}`:'';
 const add=(kind,owner)=>{
  const frame={url:'http://127.0.0.1:10001/'},sender={mainFrame:frame};
  const window={destroyed:false,webContents:sender,isDestroyed(){return this.destroyed;}};
  const record={kind,owner,window,url:frame.url,viewerPath:kind==='viewer'?'readme.txt':'',linkKey:key(state),revision:0};
  records.set(sender,record);return record;
 };
 const owner=add('ide'),viewer=add('viewer',owner),code=add('code',owner),live=add('live',owner),consoleWindow=add('console',owner);
 // 本番trustedEventをそのまま使用し、Electron自体は起動しない。
 // Browser未起動時も不明なsenderを例外ではなく拒否する、本番の未初期化状態を再現する。
 const trust={windows:records,browserViews:undefined};vm.runInNewContext(desktop.slice(desktop.indexOf('function trustedEvent(event){'),desktop.indexOf('function audioAllowed('))+';globalThis.trusted=trustedEvent;',trust);
 const event=record=>({sender:record.window.webContents,senderFrame:record.window.webContents.mainFrame});
 let readHook,dialogHook,openHook,copyHook,reads=0,quitting=false;
 const actions=createNativePreviewActions({records,trustedEvent:trust.trusted,readState:async record=>{assert.equal(record,owner);reads++;await readHook?.(reads);return structuredClone(state);},sessionKey:key,
  clipboard:{writeText:path=>{copyHook?.();copies.push(path);}},shell:{openPath:async path=>{opens.push(path);return await openHook?.()||'';}},
  dialog:{showMessageBox:async(window,options)=>{dialogs.push({window,options});return await dialogHook?.()||{response:1};}},isQuitting:()=>quitting,platform:"linux",...options});
 return{temp,root,records,state,owner,viewer,code,live,consoleWindow,add,event,actions,copies,opens,dialogs,
  readHook:hook=>{readHook=hook;},dialogHook:hook=>{dialogHook=hook;},openHook:hook=>{openHook=hook;},copyHook:hook=>{copyHook=hook;},quit:()=>{quitting=true;}};
}

test('ネイティブプレビュー: preloadは専用IPCとパスだけを公開し分離設定を維持する',async()=>{
 let api;const calls=[];
 vm.runInNewContext(readFileSync(new URL('../デスクトップ/preload.cjs',import.meta.url),'utf8'),{require:name=>{
  assert.equal(name,'electron');
  return{contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'aidiyWindow');api=value;}},
   ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({ok:true});}}};
 }});
 await api.copyFilePath('folder/a.txt');await api.openFile('folder/a.txt');await api.openFolder('folder/a.txt');await api.openFolder('');
 assert.deepEqual(calls,[['development:copy-file-path','folder/a.txt'],['development:open-file','folder/a.txt'],['development:open-folder','folder/a.txt'],['development:open-folder','']]);
 assert.equal(api.shell,undefined);assert.equal(api.clipboard,undefined);assert.equal(api.invoke,undefined);
 assert.match(desktop,/sandbox:true,contextIsolation:true,nodeIntegration:false/);
 assert.match(desktop,/ipcMain\.handle\('development:copy-file-path',\(event,path\)=>nativePreviewActions\.copyFilePath\(event,path\)\)/);
 assert.match(desktop,/ipcMain\.handle\('development:open-file',\(event,path\)=>nativePreviewActions\.openFile\(event,path\)\)/);
 assert.match(desktop,/ipcMain\.handle\('development:open-folder',\(event,path\)=>nativePreviewActions\.openFolder\(event,path\)\)/);
 assert.match(desktop,/did-start-navigation'.*if\(isMainFrame\)\{nativePreviewActions\.invalidate\(record\)/);
 assert.match(desktop,/render-process-gone'.*nativePreviewActions\.invalidate\(record\)/);
});

test('ネイティブプレビュー: 通常ファイルと日本語・空白のパスを絶対パスでコピー/既定アプリへ渡す',async t=>{
 const f=await fixture(t),event=f.event(f.owner);
 for(const path of ['readme.txt','日本語 の資料/説明.txt','記号 & % # ; $.txt']){
  assert.deepEqual(await f.actions.copyFilePath(event,path),{ok:true});
  assert.deepEqual(await f.actions.openFile(event,path),{ok:true});
 }
 assert.deepEqual(f.copies,['readme.txt','日本語 の資料/説明.txt','記号 & % # ; $.txt'].map(path=>join(f.root,path)));
 assert.deepEqual(f.opens,f.copies.map(path=>realpathSync(path)));assert.equal(f.dialogs.length,0);
 assert.deepEqual(await f.actions.copyFilePath(f.event(f.viewer),'readme.txt'),{ok:true});
 assert.deepEqual(await f.actions.openFile(f.event(f.viewer),'readme.txt'),{ok:true});
});

test('ネイティブプレビュー: 本番IPCハンドラを通しても主フレームと限定APIの境界を維持',async t=>{
 const f=await fixture(t),handlers=new Map();
 const registrations=desktop.split('\n').filter(line=>/ipcMain\.handle\('development:(copy-file-path|open-file|open-folder)'/.test(line)).join('\n');
 vm.runInNewContext(registrations,{ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},nativePreviewActions:f.actions});
 assert.equal(handlers.size,3);const source=f.event(f.owner),iframe={...source,senderFrame:{url:f.owner.url}};
 for(const handler of handlers.values())assert.equal((await handler(iframe,'readme.txt')).ok,false);
 assert.deepEqual(f.opens,[]);assert.deepEqual(f.copies,[]);
 assert.deepEqual(await handlers.get('development:copy-file-path')(source,'readme.txt'),{ok:true});
 assert.deepEqual(await handlers.get('development:open-file')(source,'readme.txt'),{ok:true});
 assert.deepEqual(await handlers.get('development:open-folder')(source,'readme.txt'),{ok:true});
 assert.deepEqual(await handlers.get('development:open-folder')(source,''),{ok:true});
 assert.deepEqual(f.copies,[join(f.root,'readme.txt')]);assert.deepEqual(f.opens,[realpathSync(join(f.root,'readme.txt')),realpathSync(f.root),realpathSync(f.root)]);
});

test('ネイティブプレビュー: 不正型・長すぎる値・URL・絶対パス・別ドライブ・ADS・親参照を拒否',async t=>{
 const f=await fixture(t);
 for(const path of [null,{},1,'','a'.repeat(4097),'readme.txt\0','readme.txt\n','/etc/passwd','//server/share','C:/Windows/test.txt','C:readme.txt','\\server\\share','folder\\readme.txt','http://host/file','file:///tmp/file','readme.txt:stream','../readme.txt','a/../readme.txt','a/./readme.txt','./readme.txt','a//readme.txt','readme.txt/']){
  assert.equal(validPreviewPath(path),false,String(path));
  assert.equal((await f.actions.copyFilePath(f.event(f.owner),path)).ok,false,String(path));
  assert.equal((await f.actions.openFile(f.event(f.owner),path)).ok,false,String(path));
 }
 assert.deepEqual(f.copies,[]);assert.deepEqual(f.opens,[]);assert.deepEqual(f.dialogs,[]);
});

test('ネイティブプレビュー: 不明窓・iframe・別URL・Code/Live/Console・異なるピン留めファイルを拒否',async t=>{
 const f=await fixture(t),ownerEvent=f.event(f.owner);
 const unknown={mainFrame:{url:f.owner.url}};
 for(const event of [f.event(f.code),f.event(f.live),f.event(f.consoleWindow),{sender:unknown,senderFrame:unknown.mainFrame},{...ownerEvent,senderFrame:{url:f.owner.url}},{...ownerEvent,senderFrame:null}]){
  assert.equal((await f.actions.copyFilePath(event,'readme.txt')).ok,false);
  assert.equal((await f.actions.openFile(event,'readme.txt')).ok,false);
 }
 assert.equal((await f.actions.openFile(f.event(f.viewer),'run.cmd')).ok,false);
 f.owner.window.webContents.mainFrame.url='http://127.0.0.1:10002/';assert.equal((await f.actions.copyFilePath(ownerEvent,'readme.txt')).ok,false);
 assert.deepEqual(f.copies,[]);assert.deepEqual(f.opens,[]);assert.deepEqual(f.dialogs,[]);
});

test('ネイティブプレビュー: 終了・古いセッション・親なし・閉じた窓・未登録を拒否',async t=>{
 const f=await fixture(t),mutations=[()=>{f.state.active=false;},()=>{f.state.active=true;f.viewer.linkKey='offline:9';},()=>{f.viewer.linkKey='offline:10';f.viewer.owner=null;},()=>{f.viewer.owner=f.owner;f.owner.window.destroyed=true;},()=>{f.owner.window.destroyed=false;f.viewer.window.destroyed=true;},()=>{f.viewer.window.destroyed=false;f.records.delete(f.viewer.window.webContents);}];
 for(const mutate of mutations){mutate();assert.equal((await f.actions.openFile(f.event(f.viewer),'readme.txt')).ok,false);}
 f.quit();assert.equal((await f.actions.copyFilePath(f.event(f.owner),'readme.txt')).ok,false);
 assert.deepEqual(f.copies,[]);assert.deepEqual(f.opens,[]);
});

test('ネイティブプレビュー: 見つからないファイル・フォルダ・外部リンクを拒否し内部リンクだけ許可',{skip:symlinkSkip},async t=>{
 const f=await fixture(t);await writeFile(join(f.temp,'outside.txt'),'outside');
 await symlink(join(f.temp,'outside.txt'),join(f.root,'outside-link.txt'));
 await symlink(join(f.root,'readme.txt'),join(f.root,'inside-link.txt'));
 await symlink(f.root,join(f.root,'root-link'),'dir');
 for(const path of ['missing.txt','日本語 の資料','outside-link.txt','root-link']){
  assert.equal((await f.actions.copyFilePath(f.event(f.owner),path)).ok,false);
  assert.equal((await f.actions.openFile(f.event(f.owner),path)).ok,false);
 }
 assert.deepEqual(await f.actions.copyFilePath(f.event(f.owner),'inside-link.txt'),{ok:true});
 assert.deepEqual(await f.actions.openFile(f.event(f.owner),'inside-link.txt'),{ok:true});
 assert.deepEqual(f.opens,[realpathSync(join(f.root,'readme.txt'))]);assert.deepEqual(f.copies,[join(f.root,'inside-link.txt')]);
});

test('ネイティブプレビュー: 実行形式・スクリプト・ショートカットは毎回キャンセル既定の確認を出す',async t=>{
 const f=await fixture(t);
 const cases=[['run.cmd','echo example'],['script.JS','console.log(1)'],['jump.LNK',''],['web.webloc',''],['hidden.txt','#!/bin/sh\necho example'],['binary.txt',Buffer.from('7f454c460000','hex')],['windows.txt','MZ binary'],['launcher.txt','[Desktop Entry]\nExec=example'],['shortcut.txt',Buffer.from('4c00000001140200','hex')]];
 for(const [path,content] of cases){
  await writeFile(join(f.root,path),content);
  assert.equal((await f.actions.openFile(f.event(f.owner),path)).ok,false,path);
  const {window,options}=f.dialogs.at(-1);assert.equal(window,f.owner.window);assert.equal(options.defaultId,1);assert.equal(options.cancelId,1);assert.deepEqual(options.buttons,['開く','キャンセル']);assert.match(options.detail,/プログラムが実行/);assert.ok(options.detail.includes(realpathSync(join(f.root,path))));
 }
 assert.deepEqual(f.opens,[]);
 f.dialogHook(()=>({response:0}));assert.deepEqual(await f.actions.openFile(f.event(f.owner),'run.cmd'),{ok:true});
 assert.deepEqual(f.opens,[realpathSync(join(f.root,'run.cmd'))]);
 const before=f.dialogs.length;assert.deepEqual(await f.actions.copyFilePath(f.event(f.owner),'run.cmd'),{ok:true});assert.equal(f.dialogs.length,before);
});

test('ネイティブプレビュー: 実行ビットとリンク先の拡張子にも確認を適用',{skip:symlinkSkip},async t=>{
 const f=await fixture(t);await symlink(join(f.root,'run.cmd'),join(f.root,'harmless.txt'));
 assert.equal((await f.actions.openFile(f.event(f.owner),'harmless.txt')).ok,false);assert.equal(f.dialogs.length,1);
 if(process.platform!=='win32'){
  await chmod(join(f.root,'readme.txt'),0o755);assert.equal((await f.actions.openFile(f.event(f.owner),'readme.txt')).ok,false);assert.equal(f.dialogs.length,2);
 }
 assert.deepEqual(f.opens,[]);
});

test('ネイティブプレビュー: 非同期状態取得中の終了・セッション/プロジェクト変更・表示切替を拒否',async t=>{
 for(const mutate of [f=>{f.owner.revision++;},f=>{f.state.startedAt++;},f=>{f.state.mode='online';},f=>{f.state.project.path=f.temp;},f=>{f.state.active=false;},f=>{f.owner.window.destroyed=true;},f=>{f.owner.window.webContents.mainFrame.url='http://127.0.0.1:other/';},f=>f.actions.invalidate(f.owner)]){
  const f=await fixture(t),wait=deferred();f.readHook(n=>n===2?wait.promise:undefined);
  const pending=f.actions.copyFilePath(f.event(f.owner),'readme.txt');await tick();mutate(f);wait.resolve();
  assert.equal((await pending).ok,false);assert.deepEqual(f.copies,[]);
 }
});

test('ネイティブプレビュー: 確認待ちの連打を重複起動せず、取消後は再試行できる',async t=>{
 const f=await fixture(t),wait=deferred();f.dialogHook(()=>wait.promise);
 const pending=f.actions.openFile(f.event(f.owner),'run.cmd');await tick();
 assert.equal(f.dialogs.length,1);assert.equal((await f.actions.openFile(f.event(f.owner),'run.cmd')).ok,false);
 assert.equal((await f.actions.copyFilePath(f.event(f.owner),'readme.txt')).ok,false);assert.equal(f.dialogs.length,1);
 wait.resolve({response:1});assert.equal((await pending).cancelled,true);assert.deepEqual(f.opens,[]);
 f.dialogHook(()=>({response:0}));assert.deepEqual(await f.actions.openFile(f.event(f.owner),'run.cmd'),{ok:true});assert.equal(f.opens.length,1);
});

test('ネイティブプレビュー: 確認ダイアログ待ち中の親/子終了・再読込・セッション変更を拒否',async t=>{
 for(const mutate of [f=>{f.state.active=false;},f=>{f.state.startedAt++;},f=>{f.state.project.path=f.temp;},f=>{f.owner.revision++;},f=>{f.viewer.window.destroyed=true;},f=>{f.owner.window.destroyed=true;},f=>{f.viewer.viewerPath='readme.txt';},f=>{f.viewer.linkKey='offline:99';},f=>f.actions.invalidate(f.viewer),f=>f.actions.invalidate(f.owner)]){
  const f=await fixture(t),wait=deferred();f.viewer.viewerPath='run.cmd';f.dialogHook(()=>wait.promise);
  const pending=f.actions.openFile(f.event(f.viewer),'run.cmd');await tick();assert.equal(f.dialogs.length,1);
  mutate(f);wait.resolve({response:0});assert.equal((await pending).ok,false);assert.deepEqual(f.opens,[]);
 }
});

test('ネイティブプレビュー: 確認中のファイル差し替え・削除・外部リンク化を拒否',{skip:symlinkSkip},async t=>{
 for(const mutate of [f=>writeFile(join(f.root,'run.cmd'),'changed script'),f=>unlink(join(f.root,'run.cmd')),async f=>{await unlink(join(f.root,'run.cmd'));await symlink(join(f.temp,'outside.cmd'),join(f.root,'run.cmd'));}]){
  const f=await fixture(t),wait=deferred();await writeFile(join(f.temp,'outside.cmd'),'outside');f.dialogHook(()=>wait.promise);
  const pending=f.actions.openFile(f.event(f.owner),'run.cmd');await tick();await mutate(f);wait.resolve({response:0});
  assert.equal((await pending).ok,false);assert.deepEqual(f.opens,[]);
 }
});

test('ネイティブプレビュー: プロジェクト自身がリンクでもコピー名を保ち、確認中のルート差し替えを拒否',{skip:symlinkSkip},async t=>{
 const f=await fixture(t),alias=join(f.temp,'project-link');await symlink(f.root,alias,'dir');f.state.project.path=alias;
 assert.deepEqual(await f.actions.copyFilePath(f.event(f.owner),'日本語 の資料/説明.txt'),{ok:true});
 assert.deepEqual(f.copies,[join(alias,'日本語 の資料','説明.txt')]);
 const wait=deferred();f.dialogHook(()=>wait.promise);const pending=f.actions.openFile(f.event(f.owner),'run.cmd');await tick();
 const other=join(f.temp,'other-project');await mkdir(other);await writeFile(join(other,'run.cmd'),'echo example');
 await unlink(alias);await symlink(other,alias,'dir');wait.resolve({response:0});
 assert.equal((await pending).ok,false);assert.deepEqual(f.opens,[]);
});

test('ネイティブプレビュー: コピー・既定アプリ・状態取得・確認失敗を失敗として返し再試行可能',async t=>{
 const f=await fixture(t),event=f.event(f.owner);
 f.copyHook(()=>{throw Error('clipboard unavailable');});assert.equal((await f.actions.copyFilePath(event,'readme.txt')).ok,false);f.copyHook(null);assert.deepEqual(await f.actions.copyFilePath(event,'readme.txt'),{ok:true});
 f.openHook(()=>{throw Error('open unavailable');});assert.equal((await f.actions.openFile(event,'readme.txt')).ok,false);
 f.openHook(()=> '関連付けがありません');assert.match((await f.actions.openFile(event,'readme.txt')).error,/関連付け/);f.openHook(null);assert.deepEqual(await f.actions.openFile(event,'readme.txt'),{ok:true});
 f.readHook(()=>{throw Error('offline');});assert.equal((await f.actions.openFile(event,'readme.txt')).ok,false);f.readHook(null);
 f.dialogHook(()=>{throw Error('dialog closed');});assert.equal((await f.actions.openFile(event,'run.cmd')).ok,false);f.dialogHook(()=>({response:0}));assert.deepEqual(await f.actions.openFile(event,'run.cmd'),{ok:true});
});

test('フォルダを開く: ファイルは所在フォルダ、フォルダとルートは自身を開き本文を実行しない',async t=>{
 const f=await fixture(t),event=f.event(f.owner);
 for(const path of ['日本語 の資料/説明.txt','日本語 の資料','readme.txt','run.cmd',''])assert.deepEqual(await f.actions.openFolder(event,path),{ok:true});
 assert.deepEqual(f.opens,[join(f.root,'日本語 の資料'),join(f.root,'日本語 の資料'),f.root,f.root,f.root].map(path=>realpathSync(path)));
 assert.deepEqual(f.dialogs,[]);assert.deepEqual(f.copies,[]);
});
test('フォルダを開く: 不正パス・欠落・外部リンクを拒否し、内部リンクの所在を守る',{skip:symlinkSkip},async t=>{
 const f=await fixture(t),event=f.event(f.owner);
 await mkdir(join(f.temp,'outside'));await writeFile(join(f.temp,'outside','file.txt'),'outside');
 await symlink(join(f.temp,'outside'),join(f.root,'outside-dir'),'dir');
 await symlink(join(f.temp,'outside/file.txt'),join(f.root,'outside-file'));
 await symlink(join(f.root,'日本語 の資料/説明.txt'),join(f.root,'inside-file'));
 await symlink(join(f.root,'日本語 の資料'),join(f.root,'inside-dir'),'dir');
 for(const path of [null,{},'../outside',f.temp,'C:/outside','a\\b','https://example.test','missing','missing/file.txt','outside-dir','outside-dir/file.txt','outside-file'])assert.equal((await f.actions.openFolder(event,path)).ok,false,String(path));
 assert.deepEqual(f.opens,[]);
 assert.deepEqual(await f.actions.openFolder(event,'inside-file'),{ok:true});
 assert.deepEqual(await f.actions.openFolder(event,'inside-dir'),{ok:true});
 assert.deepEqual(f.opens,[realpathSync(f.root),realpathSync(join(f.root,'日本語 の資料'))]);
});
test('フォルダを開く: 不明窓・iframe・利用終了・再検査中の削除を拒否する',async t=>{
 const f=await fixture(t),event=f.event(f.owner),unknown={mainFrame:{url:f.owner.url}};
 for(const source of [f.event(f.code),{sender:unknown,senderFrame:unknown.mainFrame},{...event,senderFrame:{url:f.owner.url}}])assert.equal((await f.actions.openFolder(source,'')).ok,false);
 f.state.active=false;assert.equal((await f.actions.openFolder(event,'readme.txt')).ok,false);f.state.active=true;
 f.readHook(async count=>{if(count===3)await unlink(join(f.root,'readme.txt'));});
 assert.equal((await f.actions.openFolder(event,'readme.txt')).ok,false);assert.deepEqual(f.opens,[]);
});
test('フォルダを開く: OSエラーと連打・無効化を安全に処理し再試行できる',async t=>{
 const f=await fixture(t),event=f.event(f.owner),wait=deferred();
 f.readHook(()=>wait.promise);const pending=f.actions.openFolder(event,'');await tick();
 assert.equal((await f.actions.openFolder(event,'')).ok,false);f.actions.invalidate(f.owner);wait.resolve();assert.equal((await pending).ok,false);assert.deepEqual(f.opens,[]);
 f.readHook(null);f.openHook(()=> 'フォルダの表示に失敗');assert.match((await f.actions.openFolder(event,'')).error,/フォルダの表示に失敗/);
 f.openHook(null);assert.deepEqual(await f.actions.openFolder(event,''),{ok:true});
});
test('フォルダを開く: macOSは.appと特殊文字も固定argvでFinderへ渡しアプリ起動しない',async t=>{
 const calls=[];const f=await fixture(t,{platform:'darwin',run:(...args)=>{calls.push(args.slice(0,3));args[3](null);}});
 const name='日本語 $ & ;.app';await mkdir(join(f.root,name));
 assert.deepEqual(await f.actions.openFolder(f.event(f.owner),name),{ok:true});
 assert.deepEqual(calls,[[ '/usr/bin/open',['-a','Finder','--',realpathSync(join(f.root,name))],{windowsHide:true,timeout:10000} ]]);
 assert.deepEqual(f.opens,[]);assert.deepEqual(f.dialogs,[]);
});
