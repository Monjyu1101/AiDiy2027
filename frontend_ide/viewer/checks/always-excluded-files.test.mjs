// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Server,Socket} from 'node:net';
import rules from '../../../backend_server/core_router/フォルダ除外規則.json' with {type:'json'};
import {alwaysExcludedDirectory,hasAlwaysExcludedDirectory} from '../../ファイル機能/フォルダ除外規則.mjs';
import {isInternalCredentialPath} from '../../ファイル機能/内部認証ファイル.mjs';
import {scanTree,resolveScanFolder} from '../file-scan.mjs';
import {grepFiles} from '../server.mjs';
import {createPreview,previewAllowed} from '../preview.mjs';
import {createFileHistory} from '../../ファイル機能/file-history.mjs';
import {createFileAnalysis} from '../../ファイル機能/file-analysis.mjs';
import {validateSearchResult,validSearchPath} from '../../ファイル機能/ai-search.mjs';

test.before(()=>{
  Server.prototype.listen=()=>{throw Error('No live server allowed');};
  Socket.prototype.connect=()=>{throw Error('No network allowed');};
});
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'aidiy-baseline-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const write=async(path,text='VISIBLE-FIXTURE')=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);};
  for(const name of rules.ignored){await write(`${name}/hidden.txt`,'EXCLUDED-FIXTURE');await write(`src/${name.toUpperCase()}/hidden.txt`,'EXCLUDED-FIXTURE');}
  for(const path of ['main.txt','docs/internal_auth.md','docs/node_modules.md','.git-notes/source.txt',
    'package.json','temp/draft.txt','_AIDIY/knowledge/guide.md'])await write(path);
  await symlink(join(root,'node_modules/hidden.txt'),join(root,'alias.txt'));
  await symlink(join(root,'node_modules'),join(root,'alias-dir'),'junction');
  return {root,write};
}
async function resolver(){
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function insideRoot('),end=source.indexOf('/** 先頭 max',start);
  return runInNewContext(source.slice(start,end)+'; insideRoot',
    {realpath,resolve,relative,isAbsolute,sep,isInternalCredentialPath,hasAlwaysExcludedDirectory});
}

test('常時除外はディレクトリ構成要素の完全一致で、名前の部分一致や通常ファイルを除外しない',()=>{
  for(const name of rules.ignored){
    assert.ok(alwaysExcludedDirectory(name));assert.ok(alwaysExcludedDirectory(name.toUpperCase()));
    assert.ok(hasAlwaysExcludedDirectory(`src/${name}/a.txt`));
    assert.ok(hasAlwaysExcludedDirectory(`src\\${name.toUpperCase()}\\a.txt`));
    assert.ok(hasAlwaysExcludedDirectory(name,true));
    assert.equal(hasAlwaysExcludedDirectory(`docs/${name}`),false,'a file name is not a directory');
  }
  for(const path of ['.git-notes/a.txt','venv_notes/a.txt','docs/node_modules.md','docs/internal_auth.md','temp/a.txt','package.json'])
    assert.equal(hasAlwaysExcludedDirectory(path),false,path);
});

test('フィルターOFFもbaselineを守りONは追加backup条件、隠れた依存物変更は走査結果に影響しない',async t=>{
  const {root,write}=await fixture(t);
  for(const filter of ['', 'backup']){
    const before=await scanTree(root,{filter}),paths=before.fileList.map(f=>f.path);
    assert.ok(paths.includes('main.txt'));assert.ok(paths.includes('docs/node_modules.md'));
    assert.ok(paths.includes('_AIDIY/knowledge/guide.md'));
    assert.equal(paths.includes('package.json'),filter==='');assert.equal(paths.includes('temp/draft.txt'),filter==='');
    assert.equal(paths.includes('.git-notes/source.txt'),filter==='');
    assert.ok(paths.every(path=>!hasAlwaysExcludedDirectory(path)));
    for(const name of rules.ignored) {
      assert.equal(await resolveScanFolder(root,name,filter),null,name);
      assert.equal(await resolveScanFolder(root,`src/${name.toUpperCase()}`,filter),null,name);
    }
    assert.equal(await resolveScanFolder(root,'alias-dir',filter),null);
    await write('node_modules/new.txt','CHANGED-IGNORED-FIXTURE');
    const after=await scanTree(root,{filter});
    for(const key of ['files','latest','revision','fileList'])assert.deepEqual(after[key],before[key],key);
  }
  assert.equal((await grepFiles(root,'EXCLUDED-FIXTURE')).matchCount,0);
  assert.ok((await grepFiles(root,'VISIBLE-FIXTURE')).matchCount>0);
});

test('viewer/preview は直接指定とsymlink別名の常時除外を守り、専用asset root自体は除外しない',async t=>{
  const {root}=await fixture(t),insideRoot=await resolver(),preview=createPreview(root);t.after(()=>preview.close());
  for(const path of ['node_modules/hidden.txt','src/NODE_MODULES/hidden.txt','alias.txt','alias-dir/hidden.txt']){
    assert.equal(await insideRoot(root,path),null,path);assert.equal(await preview.url(path),null,path);
  }
  assert.equal(previewAllowed('src/NODE_MODULE/hidden.html'),false);
  assert.equal(await insideRoot(root,'docs/node_modules.md'),join(root,'docs/node_modules.md'));
  // Monaco/Officeは別の固定rootで資産を配信する。親にnode_modulesがあるだけでは拒否しない。
  assert.equal(await insideRoot(join(root,'node_modules'),'hidden.txt'),join(root,'node_modules/hidden.txt'));
});

test('履歴/解析/AI検索結果にもbaselineとcanonical別名を適用し、通常文書は維持する',async t=>{
  const {root}=await fixture(t),history=createFileHistory(root),analysis=createFileAnalysis(root,
    {state:()=>({active:true,startedAt:1}),runAgent:()=>{throw Error('No agent allowed');}});
  t.after(()=>analysis.close());const job={id:'baseline',query:'synthetic'};
  const result=path=>({requestId:job.id,query:job.query,files:[{path,reason:'fixture'}],route:[path]});
  for(const path of ['node_modules/hidden.txt','src/NODE_MODULES/hidden.txt','alias.txt','alias-dir/hidden.txt']){
    await assert.rejects(()=>history.list(path));await assert.rejects(()=>analysis.get(path));
    await assert.rejects(()=>validateSearchResult(root,result(path),job));
  }
  assert.equal(validSearchPath('src/.GIT_LOCAL/hidden.txt'),false);
  for(const path of ['docs/node_modules.md','package.json']){
    assert.deepEqual((await history.list(path)).versions,[]);
    assert.equal((await analysis.get(path)).path,path);
    assert.equal((await validateSearchResult(root,result(path),job)).files[0].path,path);
  }
});
