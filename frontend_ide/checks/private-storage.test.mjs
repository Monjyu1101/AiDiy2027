// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import storage from '../host/scripts/project-storage.cjs';
import profiles from '../デスクトップ/project-profile.cjs';
import tasks from '../デスクトップ/タスクチーム起動.cjs';
import {shellHistory} from '../aidiy_console/shell-history.mjs';
import {hasAlwaysExcludedDirectory} from '../ファイル機能/フォルダ除外規則.mjs';
import {validSearchPath} from '../ファイル機能/ai-search.mjs';
import {previewAllowed} from '../viewer/preview.mjs';
import {scanTree} from '../viewer/file-scan.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'aidiy-private-storage-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
function git(project,...args){const result=spawnSync('git',['-C',project,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.error?.message);return result.stdout;}

test('外部GitプロジェクトでもConsole履歴・profileが候補に入らず、利用者のGit設定は変更しない',async t=>{
 const root=await fixture(t);git(root,'init','-q');
 await writeFile(join(root,'.gitignore'),'user-build/\n');
 const files=['.gitignore','.git/config','.git/info/exclude'],before=await Promise.all(files.map(file=>readFile(join(root,file),'utf8')));
 const history=await shellHistory(root,{...process.env,SHELL:'/bin/bash'},'linux');
 // 実際の秘密を使わず、実シェルの保存先へ合成コマンドを書き込む。
 const bash=spawnSync(history.shell,[...history.args,'-i'],{env:history.env,input:'export SYNTHETIC_API_KEY=test-only\nexit\n',encoding:'utf8'});
 if(bash.error?.code==='ENOENT')await writeFile(history.env.HISTFILE,'export SYNTHETIC_API_KEY=test-only\n');
 else {assert.equal(bash.status,0,bash.stderr);assert.match(await readFile(history.env.HISTFILE,'utf8'),/SYNTHETIC_API_KEY/);}
 for(const [program,children] of [['aidiy_ide',['electron']],['aidiy_discord',['browser-profile']],['aidiy_task',['electron','fixed']]]){
  const folder=storage.preparePrivateDirectory(storage.programDataDirectory(root,program,undefined,children));
  await writeFile(join(folder,'Cookies'),'synthetic-profile');
 }
 assert.equal(git(root,'ls-files','--others','--exclude-standard').trim(),'.gitignore');
 assert.deepEqual(await Promise.all(files.map(file=>readFile(join(root,file),'utf8'))),before);
 const historyPath='_AIDIY/aidiy_console/bash_history';
 assert.equal(hasAlwaysExcludedDirectory(historyPath),true);
 assert.equal(validSearchPath(historyPath),false);assert.equal(previewAllowed(historyPath),false);
 assert.ok(!JSON.stringify((await scanTree(root)).tree).includes('bash_history'));
 assert.equal(hasAlwaysExcludedDirectory('src/aidiy_console/example.js'),false);
});

test('profileのelectron/browser-profileとTask/Teamの下位リンクを拒否する',async t=>{
 const root=await fixture(t),outside=join(root,'outside');await mkdir(outside);
 for(const [program,children] of [['aidiy_ide',['electron']],['aidiy_code',['electron']],['aidiy_live',['electron']],['aidiy_console',['electron']],['aidiy_browser',['electron']],['aidiy_navi',['electron']],['aidiy_avatar',['electron']],['aidiy_diag',['electron']],['aidiy_discord',['electron']],['aidiy_slack',['browser-profile']],['aidiy_task',['electron','fixed']],['aidiy_team',['electron','standalone']]]){
  const project=join(root,program);await mkdir(project);
  const parent=join(project,'_AIDIY',program,...children.slice(0,-1));await mkdir(parent,{recursive:true});
  await symlink(outside,join(parent,children.at(-1)),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>storage.programDataDirectory(project,program,undefined,children),/保存先/);
  if(program==='aidiy_ide')assert.throws(()=>profiles.projectProfile(undefined,project),/保存先/);
  if(['aidiy_task','aidiy_team'].includes(program))assert.throws(()=>tasks.taskTeamProfile(undefined,program.slice(6),project,program==='aidiy_task'),/保存先/);
 }
 assert.deepEqual(await readdir(outside),[]);
});

test('専用.gitignoreは既存内容を上書きせず、リンクや除外不足では保存を開始しない',async t=>{
 const root=await fixture(t),outside=join(root,'outside');await writeFile(outside,'untouched');
 const linked=join(root,'linked');await mkdir(linked);await symlink(outside,join(linked,'.gitignore'));
 assert.throws(()=>storage.preparePrivateDirectory(linked),/gitignore/);assert.equal(await readFile(outside,'utf8'),'untouched');
 const custom=join(root,'custom');await mkdir(custom);await writeFile(join(custom,'.gitignore'),'*.log\n');
 assert.throws(()=>storage.preparePrivateDirectory(custom),/すべてを除外/);assert.equal(await readFile(join(custom,'.gitignore'),'utf8'),'*.log\n');
 const existing=join(root,'existing');await mkdir(existing);await writeFile(join(existing,'.gitignore'),'# user comment\r\n*\r\n');
 assert.equal(storage.preparePrivateDirectory(existing),existing);assert.equal(await readFile(join(existing,'.gitignore'),'utf8'),'# user comment\r\n*\r\n');
 const profile=join(root,'profile');await symlink(existing,profile,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>storage.preparePrivateDirectory(profile),/保存先/);
});

test('Gitで全除外にならない先頭空白・tab・escape・否定規則を安全と誤判定しない',async t=>{
 const root=await fixture(t);git(root,'init','-q');
 for(const [index,rules] of [' *\n','\t*\n','\\*\n','*\n!bash_history\n'].entries()){
  const folder=join(root,`misleading-${index}`);await mkdir(folder);await writeFile(join(folder,'.gitignore'),rules);
  await writeFile(join(folder,'bash_history'),'synthetic-history');
  // 見た目が「*」でも実Gitが履歴を拾う規則は、書込開始前に拒否する。
  assert.ok(git(root,'ls-files','--others','--exclude-standard').includes(`misleading-${index}/bash_history`));
  assert.throws(()=>storage.preparePrivateDirectory(folder),/すべてを除外/);
  assert.equal(await readFile(join(folder,'.gitignore'),'utf8'),rules);
 }
});
