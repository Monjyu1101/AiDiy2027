// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { request } from 'node:http';
import { createExplorerFiles } from '../ファイル機能/explorer-files.mjs';
import { createNativeExplorer } from '../ファイル機能/explorer-native.mjs';
import { startServer } from '../viewer/server.mjs';
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'aidiy-explorer-test-')), root = join(home, 'project'), trash = join(home, 'isolated-trash');
  await mkdir(root); await mkdir(trash);
  t.after(async () => { assert.ok(resolve(home).startsWith(resolve(tmpdir()) + sep)); await rm(home, { recursive: true, force: true }); });
  let count = 0;
  const native = { async trash(path) { await rename(path, join(trash, String(++count))); }, async rename(from, to) { await rename(from, to); } };
  return { home, root, trash, native };
}
const exists = path => lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const headers = { 'content-type': 'application/json', 'x-aidiy-explorer': '1' };
async function serverFixture(t, opts = {}) {
  const fixtureResult = await fixture(t), { root, native } = fixtureResult;
  const app = await startServer(root, 0, { explorerOptions: { native, ...opts }, panelsFactory: () => ({ close() {}, http() {}, upgrade() {} }) });
  t.after(() => app.close());
  const post = (body, extra = {}) => fetch(new URL('/api/explorer/actions', app.url), { method: 'POST', headers, body: JSON.stringify(body), ...extra });
  const activate = () => fetch(new URL('/api/connection/offline', app.url), { method: 'POST' });
  return { ...fixtureResult, app, post, activate };
}
test('Explorer: 空ファイル・フォルダを排他的に作成し、既存内容を上書きしない', async t => {
  const { root, native } = await fixture(t), service = createExplorerFiles(root, { native });
  assert.deepEqual(await service.apply({ action: 'create-folder', directory: '', name: '資料' }), { action: 'create-folder', path: '資料', name: '資料', type: 'directory' });
  assert.equal((await service.apply({ action: 'create-file', directory: '資料', name: '案内.md' })).path, '資料/案内.md');
  await writeFile(join(root, '資料', '案内.md'), '保護');
  await assert.rejects(() => service.apply({ action: 'create-file', directory: '資料', name: '案内.md' }), { status: 409 });
  await assert.rejects(() => service.apply({ action: 'create-folder', directory: '資料', name: '案内.md' }), { status: 409 });
  assert.equal(await readFile(join(root, '資料', '案内.md'), 'utf8'), '保護');
});

test('Explorer一括: 同一階層のコピー・複製とゴミ箱移動',async t=>{
 const {root,native,trash}=await fixture(t),service=createExplorerFiles(root,{native});
 await mkdir(join(root,'folder'));await mkdir(join(root,'target'));await writeFile(join(root,'folder/a.txt'),'a');await writeFile(join(root,'b.txt'),'b');
 const paths=['folder','b.txt'];
 const copied=await service.apply({action:'copy',paths,directory:'target'});
 assert.equal(copied.results.length,2);assert.equal(await readFile(join(root,'target/folder/a.txt'),'utf8'),'a');
 const duplicated=await service.apply({action:'copy',paths:['folder','b.txt'],duplicate:true});
 assert.deepEqual(duplicated.results.map(row=>row.path),['folder - コピー','b - コピー.txt']);
 await assert.rejects(()=>service.apply({action:'trash',paths}),{code:'confirmation_required'});
 assert.equal(await exists(join(root,'b.txt')),true);
 const result=await service.apply({action:'trash',paths,confirmed:true});assert.equal(result.results.length,2);
 assert.equal(await exists(join(root,'folder')),false);assert.equal(await exists(join(root,'b.txt')),false);
 assert.equal((await readdir(trash)).length,2);
});

test('Explorer一括: 全対象の境界・存在とコピー先を事前確認し、不正対象で変更しない',async t=>{
 const {root,native}=await fixture(t),service=createExplorerFiles(root,{native});
 await writeFile(join(root,'safe.txt'),'safe');await mkdir(join(root,'folder'));
 for(const path of ['../outside.txt','', 'missing.txt'])await assert.rejects(()=>service.apply({action:'trash',paths:['safe.txt',path],confirmed:true}));
 await assert.rejects(()=>service.apply({action:'trash',paths:['folder','folder/child.txt'],confirmed:true}),{code:'overlapping_targets'});
  await assert.rejects(()=>service.apply({action:'rename',paths:['safe.txt'],name:'changed.txt'}),{code:'invalid_batch'});
 await assert.rejects(()=>service.apply({action:'copy',paths:['safe.txt','folder'],directory:'folder'}),{code:'recursive_copy'});
 assert.equal(await exists(join(root,'folder/safe.txt')),false);assert.equal(await readFile(join(root,'safe.txt'),'utf8'),'safe');
});

test('Explorer一括HTTP: 部分成功を返し、失敗対象以降を自動実行しない',async t=>{
 const f=await serverFixture(t);await f.activate();
 for(const name of ['a.txt','b.txt','c.txt'])await writeFile(join(f.root,name),name);
 const move=f.native.trash;let calls=0;f.native.trash=async(...args)=>{if(++calls===2)throw Error('mock failure');return move(...args);};
 const response=await f.post({action:'trash',paths:['a.txt','b.txt','c.txt'],confirmed:true}),body=await response.json();
 assert.equal(response.status,503);assert.deepEqual(body.completed.map(row=>row.path),['a.txt']);assert.equal(body.failedPath,'b.txt');assert.equal(body.total,3);assert.equal(calls,2);
 assert.equal(await exists(join(f.root,'b.txt')),true);assert.equal(await exists(join(f.root,'c.txt')),true);
});

test('Explorer一括PDF: 同一階層のMarkdownだけを処理し、混在指定では生成しない',async t=>{
 const {root,native}=await fixture(t);let calls=0;
 const service=createExplorerFiles(root,{native,pdfRenderer:async()=>{calls++;return Buffer.from('%PDF-1.4\nfixture');}});
 for(const name of ['a.md','b.md','other.txt'])await writeFile(join(root,name),'text');
 await assert.rejects(()=>service.apply({action:'pdf',paths:['a.md','other.txt']}),{code:'not_markdown'});assert.equal(calls,0);
 const result=await service.apply({action:'pdf',paths:['a.md','b.md']});assert.equal(result.results.length,2);assert.equal(calls,2);
 assert.equal(await exists(join(root,'a.pdf')),true);assert.equal(await exists(join(root,'b.pdf')),true);
});

test('Explorer一括: 階層の異なる個別ファイルはコピー・削除でき、親フォルダを残す',async t=>{
 const {root,native}=await fixture(t),service=createExplorerFiles(root,{native});
 await mkdir(join(root,'folder'));await mkdir(join(root,'target'));await writeFile(join(root,'folder/a.txt'),'a');await writeFile(join(root,'b.txt'),'b');await writeFile(join(root,'folder/keep.txt'),'keep');
 const paths=['folder/a.txt','b.txt'];const copied=await service.apply({action:'copy',paths,directory:'target'});assert.equal(copied.results.length,2);
 assert.equal(await readFile(join(root,'target/a.txt'),'utf8'),'a');assert.equal(await readFile(join(root,'target/b.txt'),'utf8'),'b');
 const removed=await service.apply({action:'trash',paths,confirmed:true});assert.equal(removed.results.length,2);
 assert.equal(await exists(join(root,'folder')),true);assert.equal(await readFile(join(root,'folder/keep.txt'),'utf8'),'keep');
});
test('Explorer: ファイル・フォルダ・隠しファイルをコピーし、衝突は連番で回避する', async t => {
  const { root, native } = await fixture(t), service = createExplorerFiles(root, { native });
  await mkdir(join(root, 'src')); await mkdir(join(root, 'target')); await mkdir(join(root, 'src', 'nested'));
  await writeFile(join(root, 'src', 'nested', 'a.txt'), 'original'); await writeFile(join(root, 'src', '.env.example'), 'EXAMPLE=yes');
  const first = await service.apply({ action: 'copy', path: 'src', directory: 'target' });
  assert.equal(first.path, 'target/src'); assert.equal(await readFile(join(root, 'target/src/nested/a.txt'), 'utf8'), 'original');
  assert.equal(await readFile(join(root, 'target/src/.env.example'), 'utf8'), 'EXAMPLE=yes');
  const [second, third] = await Promise.all([service.apply({ action: 'copy', path: 'src', directory: 'target' }), service.apply({ action: 'copy', path: 'src', directory: 'target' })]);
  assert.equal(second.path, 'target/src - コピー'); assert.equal(third.path, 'target/src - コピー (2)');
  await writeFile(join(root, 'readme.md'), 'text');
  assert.equal((await service.apply({ action: 'copy', path: 'readme.md', directory: '' })).path, 'readme - コピー.md');
  await writeFile(join(root, '.gitignore'), 'dist');
  assert.equal((await service.apply({ action: 'copy', path: '.gitignore', directory: '' })).path, '.gitignore - コピー');
});
test('Explorer: root・traversal・絶対パス・Windows予約名やADSを拒否する', async t => {
  const { root, native } = await fixture(t), service = createExplorerFiles(root, { native });
  await writeFile(join(root, 'safe.txt'), 'untouched');
  for (const path of ['', '.', '..', '/safe.txt', '../safe.txt', 'a/../safe.txt', 'a//safe.txt', 'a/./safe.txt', 'a\\safe.txt', 'C:/safe.txt', '//server/share', 'safe.txt:stream', 'safe.txt\0']) {
    await assert.rejects(() => service.apply({ action: 'trash', path, confirmed: true }), { status: 400 }, path);
  }
  for (const name of ['', '.', '..', 'a/b', 'a\\b', 'NUL', 'CON.txt', 'com1', 'LPT9.log', 'COM¹', 'a:', 'a?', 'a\n', 'a ', 'a.', 'x'.repeat(256)]) {
    await assert.rejects(() => service.apply({ action: 'rename', path: 'safe.txt', name }), { status: 400 }, name);
  }
  assert.equal(await readFile(join(root, 'safe.txt'), 'utf8'), 'untouched');
});
test('Explorer: symlink祖先・項目・コピー配下のリンクを拒否し、外側へ書かない', async t => {
  const { home, root, native } = await fixture(t), outside = join(home, 'outside'), service = createExplorerFiles(root, { native });
  await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'outside'); await mkdir(join(root, 'src'));
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(outside, join(root, 'src', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const body of [
    { action: 'trash', path: 'linked', confirmed: true }, { action: 'rename', path: 'linked/secret.txt', name: 'bad.txt' },
    { action: 'create-file', directory: 'linked', name: 'bad.txt' }, { action: 'copy', path: 'src', directory: '' },
  ]) await assert.rejects(() => service.apply(body), { status: 403 });
  assert.deepEqual(await readdir(outside), ['secret.txt']); assert.equal(await exists(join(root, 'src - コピー')), false);
});
test('Explorer: フォルダ自身・配下へのコピーと不足した親を拒否する', async t => {
  const { root, native } = await fixture(t), service = createExplorerFiles(root, { native }); await mkdir(join(root, 'a/b'), { recursive: true });
  for (const directory of ['a', 'a/b']) await assert.rejects(() => service.apply({ action: 'copy', path: 'a', directory }), { status: 400 });
  await assert.rejects(() => service.apply({ action: 'create-file', directory: 'missing', name: 'file.txt' }), { status: 404 });
});
test('Explorer: renameは同名衝突を拒否し、成功と同じ名前の指定を返す', async t => {
  const { root, native } = await fixture(t); let changes = 0; const service = createExplorerFiles(root, { native, onChange: () => { changes++; } });
  await writeFile(join(root, 'a.txt'), 'a'); await writeFile(join(root, 'b.txt'), 'b');
  await assert.rejects(() => service.apply({ action: 'rename', path: 'a.txt', name: 'b.txt' }), { status: 409 });
  const result = await service.apply({ action: 'rename', path: 'a.txt', name: '日本語.txt' });
  assert.equal(result.previousPath, 'a.txt'); assert.equal(result.path, '日本語.txt'); assert.equal(changes, 1);
  await service.apply({ action: 'rename', path: '日本語.txt', name: '日本語.txt' }); assert.equal(changes, 1);
  assert.equal(await readFile(join(root, 'b.txt'), 'utf8'), 'b');
});
test('Explorer: 確認済み削除だけを隔離ゴミ箱へ送り、失敗時は永久削除しない', async t => {
  const { root, native, trash } = await fixture(t), service = createExplorerFiles(root, { native });
  await writeFile(join(root, 'a.txt'), 'restore me');
  for (const confirmed of [undefined, false, 'true', 1]) await assert.rejects(() => service.apply({ action: 'trash', path: 'a.txt', confirmed }), { status: 400 });
  assert.equal(await exists(join(root, 'a.txt')), true); assert.deepEqual(await readdir(trash), []);
  const result = await service.apply({ action: 'trash', path: 'a.txt', confirmed: true }); assert.equal(result.type, 'file');
  assert.equal(await exists(join(root, 'a.txt')), false); assert.equal(await readFile(join(trash, '1'), 'utf8'), 'restore me');
  await writeFile(join(root, 'b.txt'), 'keep me');
  const unavailable = createExplorerFiles(root, { native: { ...native, trash: async () => { throw Error('unavailable'); } } });
  await assert.rejects(() => unavailable.apply({ action: 'trash', path: 'b.txt', confirmed: true }), { status: 503, code: 'trash_unavailable' });
  assert.equal(await readFile(join(root, 'b.txt'), 'utf8'), 'keep me');
});
test('Explorer: コピー容量・項目上限は書き込み前に拒否する', async t => {
  const { root, native } = await fixture(t); await mkdir(join(root, 'a')); await writeFile(join(root, 'a/b.txt'), '12345');
  for (const limits of [{ maxBytes: 4 }, { maxEntries: 1 }]) {
    const service = createExplorerFiles(root, { native, limits });
    await assert.rejects(() => service.apply({ action: 'copy', path: 'a', directory: '' }), { status: 413 });
    assert.equal(await exists(join(root, 'a - コピー')), false);
  }
});
test('Explorer: 直列化・待機数上限・セッション世代が未実行の変更を止める', async t => {
  const { root, native } = await fixture(t); await writeFile(join(root, 'a'), 'a');
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
  const blocked = { ...native, async trash(path) { entered(); await new Promise(resolve => { release = resolve; }); await native.trash(path); } };
  let active = true; const service = createExplorerFiles(root, { native: blocked, state: () => ({ active }), limits: { maxPending: 2 } });
  const first = service.apply({ action: 'trash', path: 'a', confirmed: true }); await waiting;
  const second = service.apply({ action: 'create-file', name: 'queued' });
  await assert.rejects(() => service.apply({ action: 'create-file', name: 'overflow' }), { status: 429 });
  service.invalidate(); active = false; active = true; release(); await first;
  await assert.rejects(() => second, { status: 503 }); assert.equal(await exists(join(root, 'queued')), false);
  service.close(); await assert.rejects(() => service.apply({ action: 'create-file', name: 'closed' }), { status: 503 });
});
test('Explorer API: 利用開始・Content-Type・専用ヘッダー・Origin・method・JSON・上限を検証する', async t => {
  const { root, app, post, activate } = await serverFixture(t);
  const body = { action: 'create-file', directory: '', name: 'test.txt' };
  assert.equal((await post(body)).status, 503); await activate();
  assert.equal((await post(body, { headers: { 'content-type': 'application/json' } })).status, 403);
  assert.equal((await post(body, { headers: { ...headers, 'content-type': 'text/plain' } })).status, 403);
  assert.equal((await post(body, { headers: { ...headers, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await post(body, { headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(new URL('/api/explorer/actions', app.url))).status, 405);
  assert.equal((await post(body, { body: '{' })).status, 400);
  assert.equal((await post(body, { body: 'x'.repeat(20 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(await exists(join(root, 'test.txt')), false);
  const response = await post(body, { headers: { ...headers, origin: new URL(app.url).origin } });
  assert.equal(response.status, 200); assert.equal((await response.json()).path, 'test.txt');
  const collision = await post(body); assert.equal(collision.status, 409); assert.equal((await collision.json()).error, 'already_exists');
});
test('Explorer API: chunked過大bodyもエラーを返して変更しない', async t => {
  const { app, root, activate } = await serverFixture(t); await activate();
  const status = await new Promise((done, reject) => {
    const req = request(new URL('/api/explorer/actions', app.url), { method: 'POST', headers }, response => { response.resume(); response.on('end', () => done(response.statusCode)); });
    req.on('error', reject); req.write('x'.repeat(20 * 1024 * 1024)); req.end('x');
  });
  assert.equal(status, 413); assert.deepEqual(await readdir(root), []);
});
test('Explorer API: 成功後は共有走査を無効化し、新項目と削除を即時に反映する', async t => {
  const { app, post, activate } = await serverFixture(t); await activate();
  const scan = async () => (await fetch(new URL('/api/galaxy', app.url))).json();
  assert.deepEqual((await scan()).tree.f, []);
  assert.equal((await post({ action: 'create-file', name: 'fresh.txt' })).status, 200);
  assert.equal((await scan()).tree.f[0][0], 'fresh.txt');
  assert.equal((await post({ action: 'trash', path: 'fresh.txt', confirmed: true })).status, 200);
  assert.deepEqual((await scan()).tree.f, []);
});
test('Explorer native: OSごとの引数はシェル文字列へパスを挿入しない', async () => {
  const source = '/tmp/日本語 $(touch hacked); "quote".txt';
  for (const platform of ['linux', 'darwin', 'win32']) {
    const calls = [], native = createNativeExplorer({ platform, run: async (...args) => { calls.push(args); }, env: { TEST: '1' } });
    await native.trash(source, 'file'); assert.equal(calls.length, 1);
    const [command, args, options] = calls[0]; assert.equal(options.shell, undefined);
    if (platform === 'linux') { assert.equal(command, 'gio'); assert.deepEqual(args, ['trash', '--', source]); }
    if (platform === 'darwin') { assert.equal(command, '/usr/bin/osascript'); assert.ok(args.includes(source)); assert.ok(!args[3].includes(source)); }
    if (platform === 'win32') {
      assert.equal(command, 'powershell.exe'); assert.equal(options.env.AIDIY_EXPLORER_SOURCE, source);
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      assert.ok(!script.includes(source)); assert.match(script, /public interface IOperation/);
      assert.ok(args.at(-1).length < 30000); assert.ok(args.includes('-STA')); assert.ok(!args.includes('-ExecutionPolicy'));
    }
  }
});
test('Explorer native: WindowsはRecycle必須の事前ガードと失敗時中断を持つ', async () => {
  const source = await readFile(new URL('../ファイル機能/explorer-windows.ps1', import.meta.url), 'utf8');
  assert.match(source, /PreDeleteItem[\s\S]*flags & 0x80/); assert.match(source, /throw new COMException/);
  assert.match(source, /0x00080000/); assert.match(source, /0x00100000/); assert.match(source, /GetAnyOperationsAborted/);
  assert.match(source, /SetOwnerWindow\(IntPtr window\)/); assert.match(source, /DriveType\.Fixed/);
  assert.match(source, /new Version\(6, 2\)/); assert.match(source, /ExactSpelling=true, PreserveSig=false/);
  assert.doesNotMatch(source, /Remove-Item|DeletePermanently|System\.IO\.File\]::Delete|System\.IO\.Directory\]::Delete/);
});
test('Explorer native: Linux renameは途中のフォルダ衝突でも中へ移動せず、上書きしない', { skip: process.platform !== 'linux' }, async t => {
  const { root } = await fixture(t), native = createNativeExplorer();
  await mkdir(join(root, 'source')); await writeFile(join(root, 'source', 'keep.txt'), 'source'); await mkdir(join(root, 'destination'));
  await assert.rejects(() => native.rename(join(root, 'source'), join(root, 'destination'), 'directory'), { code: 'EEXIST' });
  assert.deepEqual(await readdir(join(root, 'destination')), []); assert.equal(await readFile(join(root, 'source/keep.txt'), 'utf8'), 'source');
  await native.rename(join(root, 'source'), join(root, 'renamed'), 'directory'); assert.equal(await exists(join(root, 'source')), false);
  assert.equal(await readFile(join(root, 'renamed/keep.txt'), 'utf8'), 'source');
});
test('Explorer native: Linux gioを専用HOME/XDGゴミ箱だけで検証する', { skip: process.platform !== 'linux' }, async t => {
  const { home, root } = await fixture(t), xdg = join(home, 'isolated-xdg'); await mkdir(xdg);
  const native = createNativeExplorer({ env: { ...process.env, HOME: home, XDG_DATA_HOME: xdg } }), service = createExplorerFiles(root, { native });
  await writeFile(join(root, 'recoverable.txt'), 'restorable');
  try { await service.apply({ action: 'trash', path: 'recoverable.txt', confirmed: true }); }
  catch (error) { if (error.code === 'trash_unavailable') { t.skip('このLinux環境ではgioのゴミ箱が利用できません'); return; } throw error; }
  assert.equal(await exists(join(root, 'recoverable.txt')), false);
  assert.equal(await readFile(join(xdg, 'Trash/files/recoverable.txt'), 'utf8'), 'restorable');
  const info = await readFile(join(xdg, 'Trash/info/recoverable.txt.trashinfo'), 'utf8');
  assert.match(info, /\[Trash Info\]/); assert.match(info, /Path=/); assert.match(info, /DeletionDate=/);
});
test('Explorer: 起動時のルートが別ディレクトリ・リンクに置換されたら変更しない', async t => {
  for (const replacement of ['directory', 'symlink']) {
    const { home, root, native } = await fixture(t), service = createExplorerFiles(root, { native });
    await service.apply({ action: 'create-file', name: 'anchor' });
    await rename(root, join(home, 'original-project')); const outside = join(home, 'outside'); await mkdir(outside);
    if (replacement === 'directory') await mkdir(root);
    else await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => service.apply({ action: 'create-file', name: 'must-not-exist' }), { status: 409, code: 'changed_path' });
    assert.equal(await exists(join(root, 'must-not-exist')), false); assert.deepEqual(await readdir(outside), []);
  }
});
test('Explorer: 待機中に親フォルダを外部リンクへ置換しても作成・コピーを止める', async t => {
  const { home, root, native } = await fixture(t); await mkdir(join(root, 'destination')); await writeFile(join(root, 'source'), 'source');
  await writeFile(join(root, 'blocking'), 'blocking'); const outside = join(home, 'outside'); await mkdir(outside);
  let release, signal; const entered = new Promise(resolve => { signal = resolve; });
  const service = createExplorerFiles(root, { native: { ...native, async trash(path) { await native.trash(path); signal(); await new Promise(resolve => { release = resolve; }); } } });
  const first = service.apply({ action: 'trash', path: 'blocking', confirmed: true }); await entered;
  const copying = service.apply({ action: 'copy', path: 'source', directory: 'destination' }).catch(error => error);
  const creating = service.apply({ action: 'create-file', name: 'bad', directory: 'destination' }).catch(error => error);
  await rename(join(root, 'destination'), join(root, 'old-destination'));
  await symlink(outside, join(root, 'destination'), process.platform === 'win32' ? 'junction' : 'dir'); release(); await first;
  assert.equal((await copying).code, 'symbolic_link'); assert.equal((await creating).code, 'symbolic_link');
  assert.deepEqual(await readdir(outside), []); assert.equal(await readFile(join(root, 'source'), 'utf8'), 'source');
});
test('Explorer API: 本文受信中の利用終了・再開でも古い要求を実行しない', async t => {
  const { app, activate, root } = await serverFixture(t); await activate();
  let connected; const responsePromise = new Promise((done, reject) => {
    const req = request(new URL('/api/explorer/actions', app.url), { method: 'POST', headers }, response => { response.resume(); response.on('end', () => done(response.statusCode)); });
    req.on('error', reject); req.write('{"action":"create-file",'); connected = req;
  });
  // 最初のチャンクがルートへ届き、受信時のセッション世代を記録するまで待つ。
  await new Promise(resolve => setTimeout(resolve, 20));
  await fetch(new URL('/api/connection/disconnect', app.url), { method: 'POST' }); await activate();
  connected.end('"name":"stale.txt"}');
  assert.equal(await responsePromise, 503); assert.equal(await exists(join(root, 'stale.txt')), false);
});
test('Explorer native: gio未導入・非対応OSでは元の内容と場所を保ち、永久削除へ切り替えない', async t => {
  const { root, home } = await fixture(t); await writeFile(join(root, 'keep.txt'), 'unchanged');
  const before = await lstat(join(root, 'keep.txt'));
  const backends = [createNativeExplorer({ platform: 'unsupported' }), createNativeExplorer({ platform: 'linux', env: { ...process.env, PATH: join(home, 'no-programs') } })];
  for (const native of backends) {
    const service = createExplorerFiles(root, { native });
    await assert.rejects(() => service.apply({ action: 'trash', path: 'keep.txt', confirmed: true }), { status: 503, code: 'trash_unavailable' });
    const after = await lstat(join(root, 'keep.txt'));
    assert.equal(after.ino, before.ino); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'unchanged');
  }
});
