// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import storage from '../host/scripts/project-storage.cjs';
import {プロジェクトフォルダ決定} from '../host/scripts/launch-project.mjs';
import {ideDataFolder} from '../ファイル機能/ide-data.mjs';
import {createNavigation} from '../ファイル機能/navigation.mjs';
const require=createRequire(import.meta.url),repo=fileURLToPath(new URL('../../',import.meta.url));
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'aidiy-project-storage-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('設定ルート: 空文字はAiDiy、未指定CLIはcwd、明示projectを優先する',async t=>{
 const root=await fixture(t);
 assert.equal(storage.projectRoot('',root),root);
 assert.equal(プロジェクトフォルダ決定([],''),resolve(repo));
 assert.equal(プロジェクトフォルダ決定([''],undefined,root),resolve(repo));
 assert.equal(プロジェクトフォルダ決定([],undefined,root),root);
 assert.equal(storage.programDataDirectory(root,'aidiy_browser'),join(root,'_AIDIY','aidiy_browser'));
 assert.throws(()=>storage.programDataDirectory(root,'../code'),/プログラム名/);
 assert.throws(()=>storage.projectRoot(''),/配置元/);
});

test('新設定フォルダは旧 .aidiy を読込・移動せず、プログラム別に分離する',async t=>{
 const root=await fixture(t),old=join(root,'.aidiy','file-analysis');
 await mkdir(old,{recursive:true});await writeFile(join(old,'old.json'),'legacy');
 const ide=await ideDataFolder(root,'file_analyses'),browser=await ideDataFolder(root,'browser_analyses',{program:'aidiy_browser'});
 assert.equal(ide,join(root,'_AIDIY','aidiy_ide','file_analyses'));
 assert.equal(browser,join(root,'_AIDIY','aidiy_browser','browser_analyses'));
 assert.deepEqual(await readdir(ide),[]);assert.equal(await readFile(join(old,'old.json'),'utf8'),'legacy');
});

test('設定保存先はプロジェクト外向きのシンボリックリンクを拒否する',async t=>{
 const root=await fixture(t),outside=await fixture(t);await symlink(outside,join(root,'_AIDIY'),'dir');
 assert.throws(()=>storage.programDataDirectory(root,'aidiy_code'),/保存先/);
 await assert.rejects(()=>ideDataFolder(root,'file_analyses'),/保存先/);
});

test('Code/Live設定と検証回数はproject別、home APIと旧設定に依存しない',async t=>{
 const root=await fixture(t),projectA=join(root,'a'),projectB=join(root,'b');await mkdir(projectA);await mkdir(projectB);
 const bundle=join(root,'models.cjs');
 await build({entryPoints:[fileURLToPath(new URL('../host/src/model-preferences.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',outfile:bundle,plugins:[{name:'no-home',setup(builder){builder.onLoad({filter:/project-storage\.cjs$/},async args=>({contents:await readFile(args.path,'utf8'),loader:'js'}));builder.onResolve({filter:/^node:os$/},()=>{throw Error('設定でhomeを参照してはいけません');});}}]});
 const model=require(bundle),fileA=model.モデル保存先('code',projectA),fileB=model.モデル保存先('code',projectB);
 const selected={provider:'codex_cli',model:'auto'};
 model.コードモデル保存(selected,fileA);model.検証回数保存(3,model.コード設定保存先(fileA));
 assert.deepEqual(model.コードモデル読込(fileA),selected);assert.equal(model.コードモデル読込(fileB),undefined);
 assert.equal(model.検証回数読込(model.コード設定保存先(fileB)),undefined);
 assert.equal(fileA,join(projectA,'_AIDIY','aidiy_code','aidiy_code_model.json'));
 assert.equal(model.モデル保存先('live',projectA),join(projectA,'_AIDIY','aidiy_live','aidiy_live_model.json'));
 assert.throws(()=>model.コードモデル保存(selected,''),/作業フォルダ/);
 await mkdir(join(projectB,'.aidiy'));await writeFile(join(projectB,'.aidiy','aidiy_code_model.json'),JSON.stringify(selected));
 assert.equal(model.コードモデル読込(fileB),undefined);
});

test('Navigatorのモデル・履歴はプロジェクト内で分離し、別窓は同一プロジェクトだけ共有する',async t=>{
 const root=await fixture(t),a=join(root,'a'),b=join(root,'b');await mkdir(a);await mkdir(b);
 const options={state:()=>({active:true,startedAt:1}),defaultModel:async()=>({provider:'aidiy_hermes',model:'auto'}),runAgent:()=>{throw Error('AI実行禁止');}};
 const one=createNavigation(a,options),two=createNavigation(b,options);t.after(()=>{one.close();two.close();});
 await one.saveModel({provider:'aidiy_hermes',model:'selected'});
 assert.equal((await two.get()).selection.model,'auto');
 assert.equal(JSON.parse(await readFile(join(a,'_AIDIY','aidiy_navi','aidiy_navi_model.json'),'utf8')).model,'selected');
 const reopened=createNavigation(a,options);t.after(()=>reopened.close());assert.equal((await reopened.get()).selection.model,'selected');
 assert.ok((await readdir(join(a,'_AIDIY','aidiy_navi'))).includes('navigation'));
});

test('移したElectron/browser profileは通常ソースと区別し、汎用検索/ビューアから隠す',async t=>{
 const root=await fixture(t),{hasAlwaysExcludedDirectory}=await import('../ファイル機能/フォルダ除外規則.mjs');
 const {validSearchPath}=await import('../ファイル機能/ai-search.mjs');
 const {previewAllowed}=await import('../viewer/preview.mjs');
 const {scanTree}=await import('../viewer/file-scan.mjs');
 for(const path of ['_AIDIY/aidiy_browser/electron/window-one/Cookies','_AIDIY/aidiy_discord/browser-profile/Local Storage/token','_AIDIY/aidiy_avatar/electron/Preferences']){
  await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),'private-profile');
  assert.equal(hasAlwaysExcludedDirectory(path),true);assert.equal(validSearchPath(path),false);assert.equal(previewAllowed(path),false);
 }
 await mkdir(join(root,'electron'));await writeFile(join(root,'electron','main.ts'),'ordinary-source');
 assert.equal(validSearchPath('electron/main.ts'),true);
 const scan=await scanTree(root);assert.ok(!JSON.stringify(scan.tree).includes('Cookies'));assert.ok(JSON.stringify(scan.tree).includes('main.ts'));
});
