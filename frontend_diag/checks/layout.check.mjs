// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import {copySharedFixture} from './fixture-layout.mjs';
import assert from 'node:assert/strict';
import {access,copyFile,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {CATALOG_PATH} from '../diag/診断/probes.mjs';
import {BUNDLED_ZIP} from '../diag/モデル情報/bundled_models.mjs';
import {STOP_FILE} from '../diag/起動/lifecycle.mjs';
import {DESKTOP_LOG} from '../diag/起動/desktop-log.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));

test('feature folders retain package entry, catalog, bundled models and root control files',async()=>{
 const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(metadata.main,'diag/起動/electron-main.cjs');
 assert.equal(CATALOG_PATH,path.join(root,'diag/診断/catalog.json'));
 assert.equal(BUNDLED_ZIP,path.join(root,'diag/モデル情報/openrouter_models/openrouter_models.zip'));
 assert.equal(fileURLToPath(STOP_FILE),path.join(root,'.stop-request'));
 assert.equal(fileURLToPath(DESKTOP_LOG),path.join(root,'.desktop-errors.log'));
 await readFile(path.join(root,metadata.main));
});

test('moved desktop module still finds Electron in the package root without a caller override',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'diag-layout-')),directory=path.join(workspace,'frontend_diag');
 try {
  const startup=path.join(directory,'diag/起動'),electron=path.join(directory,'node_modules/electron');
  await copySharedFixture(workspace);await mkdir(startup,{recursive:true});await mkdir(path.join(electron,'dist'),{recursive:true});
  for(const name of ['desktop.mjs','desktop-log.mjs'])await copyFile(path.join(root,'diag/起動',name),path.join(startup,name));
  const suffix=process.platform==='win32'?'electron.exe':process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron';
  const executable=path.join(electron,'dist',suffix);await mkdir(path.dirname(executable),{recursive:true});
  await writeFile(path.join(electron,'package.json'),JSON.stringify({version:'1.2.3'}));
  await writeFile(path.join(electron,'dist/version'),'1.2.3');await writeFile(path.join(electron,'path.txt'),suffix);
  await writeFile(executable,'fixture only',{mode:0o755});
  const {desktopBinary}=await import(pathToFileURL(path.join(startup,'desktop.mjs')).href);
  assert.equal(await desktopBinary(),executable);
 }finally{await rm(workspace,{recursive:true,force:true});}
});

// Avatar と同じ src/components・src/dialog 分離を回帰確認する。
test('renderer keeps Japanese feature groups under components and dialogs beside them', async()=>{
 const src=path.join(root,'diag/ui');
 assert.deepEqual((await readdir(src,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort(),['components','dialog']);
 await access(path.join(src,'dialog/AI設定再起動.vue'));
 for(const name of ['AI設定','モデル一覧','ウィンドウ','導入状況','共通表示','Tools','AIモデル','設定モデル','アプリ起動','起動','キー設定共通','外部連携'])await access(path.join(src,'components',name));
 await assert.rejects(access(path.join(src,'components/AI設定/AI設定再起動.vue')),{code:'ENOENT'});
 for(const name of ['App.vue','main.js','style.css','index.html'])await access(path.join(src,name));
});
