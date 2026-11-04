// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { latestFile, latestFiles, createLatestUpdates } from '../../src/components/ファイル閲覧/最新ファイル.js';
import { scanTree, startServer } from '../server.mjs';
import { createCoreConnection } from '../core-connection.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'aidiy-latest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, path, mtime) {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, path);
  await utimes(full, mtime, mtime);
}

test('最終更新は全階層の_AIDIY・_data・_datasを除外し、通常のツリーには残す', async t => {
  const root = await fixture(t);
  const excluded = ['_AIDIY/knowledge/update.md', '_data/state.json', '_datas/result.txt', 'nested/_AIDIY/knowledge/note.md', 'nested/_data/state.json', 'nested/_datas/result.txt'];
  for (const path of excluded) await put(root, path, 300);
  await put(root, 'src/main.py', 200);
  for (const filter of [undefined, 'backup']) {
    const { tree } = await scanTree(root, { filter });
    assert.deepEqual(latestFile(tree), { name: 'main.py', path: 'src/main.py', mtime: 200000 });
    assert.ok(tree.d.some(dir => dir.n === '_AIDIY'));
  }
  // バックアップ対象のルールは保持する。
  const filtered = (await scanTree(root, { filter: 'backup' })).tree;
  assert.ok(filtered.d.find(dir => dir.n === '_AIDIY').d.find(dir => dir.n === 'knowledge').f.length);
  assert.ok(filtered.d.some(dir => dir.n === '_datas'));
  await put(root, '_AIDIY_extra/source.py', 400);
  assert.equal(latestFile((await scanTree(root)).tree).path, '_AIDIY_extra/source.py');
});

test('最終更新APIはフィルターON / OFF共通で除外し、ソース更新だけに追従する', async t => {
  const root = await fixture(t), connection = createCoreConnection(root);
  connection.offline();
  const app = await startServer(root, 0, { connection });
  t.after(() => app.close());
  await put(root, 'src/main.py', 200);
  await put(root, '_AIDIY/knowledge/update.md', 300);
  await put(root, '_datas/output.txt', 400);
  for (const suffix of ['', '?filter=backup']) {
    const latest = (await fetch(app.url + 'api/latest' + suffix).then(response => response.json())).latest;
    assert.equal(latest.path, 'src/main.py');
  }
  await put(root, '_AIDIY/knowledge/update.md', 500);
  assert.equal((await fetch(app.url + 'api/latest?filter=backup').then(response => response.json())).latest.path, 'src/main.py');
  // 最終更新からの除外は、通常の一覧・手動閲覧には適用しない。
  const galaxy = await fetch(app.url + 'api/galaxy').then(response => response.json());
  assert.ok(galaxy.tree.d.some(dir => dir.n === '_AIDIY'));
  assert.ok(galaxy.tree.d.some(dir => dir.n === '_datas'));
  for (const path of ['_AIDIY/knowledge/update.md', '_datas/output.txt']) {
    assert.equal((await fetch(app.url + 'api/file?' + new URLSearchParams({ path }))).status, 200);
  }
  await put(root, 'src/next.py', 600);
  assert.equal((await fetch(app.url + 'api/latest?filter=backup&fresh=1').then(response => response.json())).latest.path, 'src/next.py');
});

test('除外フォルダのファイルしかなければ最終更新候補を返さない', async t => {
  const root = await fixture(t);
  await put(root, '_AIDIY/knowledge/update.md', 300);
  await put(root, '_datas/output.txt', 400);
  assert.equal(latestFile((await scanTree(root)).tree), null);
  assert.equal(latestFile(undefined), null);
});

test('同じ秒を含めて取得し、取得済みの最後のファイルを除いて更新順に複数件を選ぶ', () => {
  const tracker = createLatestUpdates();
  const file = (path, mtime) => ({ name: path, path, mtime });
  const previous = file('previous.py', 123450), old = file('old.py', 123100);
  assert.deepEqual(tracker.accept([old, previous]), [previous]);
  assert.deepEqual(tracker.accept([old, previous]), []);
  const first = file('first.py', 123450), second = file('second.py', 123600), last = file('last.py', 124000);
  assert.deepEqual(tracker.accept([last, previous, second, first]), [first, second, last]);
  assert.equal(tracker.since, 124000);
  assert.deepEqual(tracker.accept([last]), []);
  assert.deepEqual(tracker.accept([]), []);
  assert.deepEqual(tracker.accept([file('last.py', 124500)]), [file('last.py', 124500)], '同じパス自体の再更新は拾う');
});

test('更新APIは秒の境界を含む複数候補を返し、除外・不正な日時の拒否を維持する', async t => {
  const root = await fixture(t), connection = createCoreConnection(root); connection.offline();
  const app = await startServer(root, 0, { connection }); t.after(() => app.close());
  await put(root, 'old.py', 123.1); await put(root, 'previous.py', 123.45);
  await put(root, 'next.py', 123.6); await put(root, 'last.py', 124);
  await put(root, '_datas/new.py', 125);
  for (const suffix of ['', '&filter=backup']) {
    const data = await fetch(app.url + 'api/latest?since=123450' + suffix).then(r => r.json());
    assert.deepEqual(data.files.map(file => file.path), ['old.py', 'previous.py', 'next.py', 'last.py']);
    assert.equal(data.latest.path, 'last.py');
  }
  assert.deepEqual(latestFiles((await scanTree(root)).tree).map(file => file.path), ['last.py']);
  assert.deepEqual((await fetch(app.url + 'api/latest?since=125000').then(r => r.json())).files, []);
  for (const since of ['', '-1', 'NaN', 'Infinity']) assert.equal((await fetch(app.url + 'api/latest?since=' + since)).status, 400);
});
