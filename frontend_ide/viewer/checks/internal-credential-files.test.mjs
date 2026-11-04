// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 合成ファイルだけで検証する。実資格情報・HTTPサーバー・外部AIは使用しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Server,Socket} from 'node:net';
import {hasAlwaysExcludedDirectory} from '../../ファイル機能/フォルダ除外規則.mjs';
import {isInternalCredentialPath} from '../../ファイル機能/内部認証ファイル.mjs';
import {previewAllowed,createPreview} from '../preview.mjs';
import {scanTree} from '../file-scan.mjs';
import {grepFiles} from '../server.mjs';
import {createFileHistory} from '../../ファイル機能/file-history.mjs';
import {createFileAnalysis} from '../../ファイル機能/file-analysis.mjs';
import {createExplorerFiles} from '../../ファイル機能/explorer-files.mjs';
import {validSearchPath,validateSearchResult} from '../../ファイル機能/ai-search.mjs';

const secret='_AIDIY/backend_core/internal_auth.json';
const atomic='_AIDIY/backend_core/.internal_auth.json.fixture.tmp';
const keyring='_AIDIY/backend_core/internal_auth_keys.json';
const atomicKeys='_AIDIY/backend_core/.internal_auth_keys.json.fixture.tmp';
const privatePaths=[secret,atomic,keyring,atomicKeys];
const aliases=['alias.json','alias.vue','alias-tmp.txt','alias-keys.json','alias-keys-tmp.txt'];
const marker='SYNTHETIC-CREDENTIAL-NOT-A-TOKEN';
test.before(()=>{
  Server.prototype.listen=()=>{throw Error('Test must not open a server');};
  Socket.prototype.connect=()=>{throw Error('Test must not connect');};
});
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'aidiy-private-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'_AIDIY/backend_core'),{recursive:true});
  await mkdir(join(root,'docs'));await mkdir(join(root,'copies'));
  await writeFile(join(root,secret),JSON.stringify({fixture:marker}));
  await writeFile(join(root,atomic),marker);
  await writeFile(join(root,keyring),JSON.stringify({synthetic_private_key:marker}));
  await writeFile(join(root,atomicKeys),marker);
  await writeFile(join(root,'docs/internal_auth.md'),'# normal documentation');
  await symlink(join(root,secret),join(root,'alias.json'));
  await symlink(join(root,secret),join(root,'alias.vue'));
  await symlink(join(root,atomic),join(root,'alias-tmp.txt'));
  await symlink(join(root,keyring),join(root,'alias-keys.json'));
  await symlink(join(root,atomicKeys),join(root,'alias-keys-tmp.txt'));
  return root;
}

test('新credential basename/atomic tmpだけを拒否し、説明書やソースは許可する',()=>{
  for(const path of [...privatePaths,'INTERNAL_AUTH_KEYS.JSON','internal_auth_keys.json::$DATA','INTERNAL_AUTH.JSON','folder\\internal_auth.json',
    'internal_auth.json. ','internal_auth.json::$DATA','.INTERNAL_AUTH.JSON.random.TMP'])assert.equal(isInternalCredentialPath(path),true,path);
  for(const path of ['docs/internal_auth.md','docs/internal_auth_keys.md','internal_auth_keys.py','internal_auth.py','internal-auth.ts','internal_auth.json.example',
    '.internal_auth.json.md','ordinary.json','auth.json'])assert.equal(isInternalCredentialPath(path),false,path);
});

test('実viewer resolverは要求名とrealpath双方で拒否し別名symlinkを通さない',async t=>{
  const root=await fixture(t),source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function insideRoot('),end=source.indexOf('/** 先頭 max',start);
  assert.ok(start>=0&&end>start);
  const insideRoot=runInNewContext(source.slice(start,end)+'; insideRoot',
    {realpath,resolve,relative,isAbsolute,sep,isInternalCredentialPath,hasAlwaysExcludedDirectory});
  for(const path of [...privatePaths,...aliases])assert.equal(await insideRoot(root,path),null,path);
  assert.match(source,/if \(\/\\\.vue\$\/i\.test\(path\)\) return await insideRoot\(root, path\) \?/);
  assert.equal(await insideRoot(root,'docs/internal_auth.md'),join(root,'docs/internal_auth.md'));
  const safeRoot=await mkdtemp(join(tmpdir(),'aidiy-private-name-fixture-'));t.after(()=>rm(safeRoot,{recursive:true,force:true}));
  await writeFile(join(safeRoot,'safe.txt'),'ordinary');
  await symlink(join(safeRoot,'safe.txt'),join(safeRoot,'internal_auth.json'));
  assert.equal(await insideRoot(safeRoot,'internal_auth.json'),null);
});

test('previewは直接名・canonical別名をURL発行/サーバー開始前に拒否する',async t=>{
  const root=await fixture(t),preview=createPreview(root);t.after(()=>preview.close());
  assert.equal(previewAllowed(secret),false);assert.equal(previewAllowed(atomic),false);
  assert.equal(previewAllowed('docs/internal_auth.md'),true);
  for(const path of [...privatePaths,...aliases])assert.equal(await preview.url(path),null,path);
});

test('通常/backup/grep走査は新credentialを一覧・本文検索へ流さない',async t=>{
  const root=await fixture(t);
  for(const options of [{},{filter:'backup'},{scope:'grep'}]){
    const scan=await scanTree(root,options),paths=scan.fileList.map(f=>f.path);
    assert.ok(paths.includes('docs/internal_auth.md'));
    for(const path of [...privatePaths,...aliases])assert.ok(!paths.includes(path),path);
  }
  assert.equal((await grepFiles(root,marker)).matchCount,0);
  assert.equal((await grepFiles(root,'normal documentation')).matchCount,1);
});

test('履歴・解析は新credentialと別名を拒否し、通常文書は維持する',async t=>{
  const root=await fixture(t),history=createFileHistory(root),analysis=createFileAnalysis(root,
    {state:()=>({active:true,startedAt:1}),runAgent:()=>{throw Error('Agent must not run');}});
  t.after(()=>analysis.close());
  for(const path of [...privatePaths,...aliases]){
    await assert.rejects(()=>history.list(path),{status:404});
    await assert.rejects(()=>analysis.get(path));
  }
  assert.deepEqual((await history.list('docs/internal_auth.md')).versions,[]);
  assert.equal((await analysis.get('docs/internal_auth.md')).path,'docs/internal_auth.md');
});

test('Explorerの別名copy/renameと親コピーによる新credential公開を拒否する',async t=>{
  const root=await fixture(t),explorer=createExplorerFiles(root,{native:{
    rename(){throw Error('Native rename must not run');},trash(){throw Error('Native trash must not run');}}});
  t.after(()=>explorer.close());
  for(const path of [...privatePaths,...aliases]){
    await assert.rejects(()=>explorer.apply({action:'copy',path,directory:'copies'}),{status:403});
    await assert.rejects(()=>explorer.apply({action:'rename',path,name:'exposed.txt'}),{status:403});
  }
  await assert.rejects(()=>explorer.apply({action:'copy',path:'_AIDIY/backend_core',directory:'copies'}),{status:403});
  assert.equal((await explorer.apply({action:'copy',path:'docs/internal_auth.md',directory:'copies'})).path,'copies/internal_auth.md');
  assert.equal(await readFile(join(root,secret),'utf8'),JSON.stringify({fixture:marker}));
});

test('AI検索結果もcredential名・canonical別名を受理せず通常文書は許可する',async t=>{
  const root=await fixture(t),job={id:'fixture',query:'synthetic'};
  for(const path of [...privatePaths,...aliases]){
    const data={requestId:job.id,query:job.query,files:[{path,reason:'fixture'}],route:[path]};
    await assert.rejects(()=>validateSearchResult(root,data,job));
  }
  assert.equal(validSearchPath(secret),false);assert.equal(validSearchPath('docs/internal_auth.md'),true);
  const path='docs/internal_auth.md';
  assert.equal((await validateSearchResult(root,{requestId:job.id,query:job.query,files:[{path,reason:'fixture'}],route:[path]},job)).files[0].path,path);
});
