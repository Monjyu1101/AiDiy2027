// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanTree } from '../server.mjs';
import { hasAlwaysExcludedDirectory } from '../../ファイル機能/フォルダ除外規則.mjs';
import { latestFiles } from '../../src/components/ファイル閲覧/最新ファイル.js';

test('バックアップフィルターは_AIDIYのaidiy_*記録を除外し、knowledgeと同名ソースを残す', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aidiy-backup-filter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const excluded = ['_AIDIY/aidiy_code/histories/session.json', '_AIDIY/aidiy_ide/file_searches/search.json', 'nested/_AIDIY/aidiy_ide/file_analyses/analysis.json', '_AIDIY/aidiy_ide_extra/record.md'];
  const included = ['_AIDIY/knowledge/example.md', '_AIDIY/histories/entry.md', 'frontend_ide/aidiy_code/source.py'];
  for (const path of [...excluded, ...included]) {
    const parts = path.split('/');
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), '検証');
  }
  function paths(node, prefix = '') {
    return [...node.f.map(([name]) => prefix + name), ...node.d.flatMap(child => paths(child, `${prefix}${child.n}/`))];
  }
  const filtered = await scanTree(root, { filter: 'backup' });
  assert.equal(filtered.files, included.length);
  assert.deepEqual(paths(filtered.tree).sort(), included.sort());
  assert.deepEqual(filtered.tree.d.find(node => node.n === '_AIDIY').d.map(node => node.n).sort(), ['histories', 'knowledge']);
  assert.deepEqual(paths((await scanTree(root)).tree).sort(), [...excluded, ...included].sort());
  for (const folder of ['_AIDIY/aidiy_code', '_AIDIY/aidiy_ide']) assert.equal((await scanTree(join(root, folder), { filter: 'backup' })).files, 0);
});

test('_AIDIY内の未知aidiy_*はGitと同じ除外で、通常名・ファイル名・OFFを維持する', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aidiy-runtime-filter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const excluded = ['aidiy_custom', 'aidiy_ide_extra', 'aidiy_', 'aidiy_新機能', 'aidiy_with space',
    ...['avatar','browser','code','console','diag','discord','hermes','ide','live','navi','slack','task','team'].map(name => `aidiy_${name}`)]
    .flatMap(name => [`_AIDIY/${name}/record.md`, `nested/_AIDIY/${name}/record.md`]);
  const included = ['_AIDIY/knowledge/guide.md', '_AIDIY/histories/entry.md', '_AIDIY/custom/note.md',
    '_AIDIY/aidiy-custom/note.md', '_AIDIY/AIDIY_custom/note.md', '_aidiy/aidiy_custom/note.md',
    '_AIDIY/knowledge/aidiy_custom/note.md', '_AIDIY/subdir/aidiy_custom/note.md',
    '_AIDIY/aidiy_note.md', 'nested/_AIDIY/aidiy_note.md', 'frontend_ide/aidiy_custom/source.py'];
  for (const path of [...excluded, ...included]) {
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, path), '合成検証データ');
  }
  await writeFile(join(root, '.gitignore'), await readFile(new URL('../../../.gitignore', import.meta.url)));
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(git('init', '--template=').status, 0);
  assert.equal(git('config', 'core.ignorecase', 'false').status, 0);
  const filtered = await scanTree(root, { filter: 'backup' });
  const ordinary = await scanTree(root);
  assert.equal(filtered.truncated, false);
  assert.equal(ordinary.truncated, false);
  const on = new Set(filtered.fileList.map(file => file.path));
  const off = new Set(ordinary.fileList.map(file => file.path));
  for (const path of [...excluded, ...included]) {
    assert.equal(git('check-ignore', '--no-index', '-q', '--', path).status, excluded.includes(path) ? 0 : 1, path);
    assert.equal(on.has(path), included.includes(path), path);
    assert.equal(off.has(path), !hasAlwaysExcludedDirectory(path), path);
  }
  for (const folder of ['_AIDIY/aidiy_custom', 'nested/_AIDIY/aidiy_', '_AIDIY/aidiy_ide_extra']) {
    assert.equal((await scanTree(root, { filter: 'backup', folder })).missing, true, folder);
    assert.equal((await scanTree(root, { folder })).missing, false, folder);
  }
  for (const name of ['electron', 'browser-profile']) {
    const path = `_AIDIY/aidiy_custom/${name}/private.json`;
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, path), '合成profile');
    assert.equal((await scanTree(root)).fileList.some(file => file.path === path), false);
  }
});

test('Officeの~$ロックを全階層で除外し、元文書と通常の~名は残す', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aidiy-office-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const included = ['報告.docx', 'nested/集計.xlsx', 'nested/発表.pptx', '~通常.docx', '資料~$注記.md'];
  const locks = ['~$報告.docx', 'nested/~$集計.xlsx', 'nested/~$発表.pptx'];
  for (const path of [...included, ...locks]) {
    const parts = path.split('/');
    await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...parts), '検証');
  }
  function paths(node, prefix = '') {
    return [...node.f.map(([name]) => prefix + name), ...node.d.flatMap(child => paths(child, `${prefix}${child.n}/`))];
  }
  const filtered = await scanTree(root, { filter: 'backup' });
  assert.equal(filtered.files, included.length);
  assert.deepEqual(paths(filtered.tree).sort(), [...included].sort());
  assert.equal(latestFiles(filtered.tree, 0).some(file => locks.includes(file.path)), false, '最終更新・自動探索へロックを渡さない');
  assert.deepEqual(paths((await scanTree(root)).tree).sort(), [...included, ...locks].sort(), 'フィルターOFFでは通常一覧で確認できる');
});

test('バックアップフィルターは新旧保存先とキャッシュを除外し、通常のbackupを残す', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aidiy-storage-filter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['.aidiy_backup', 'nested/.aidiy_backup', '.backup_local', 'nested/.backup_local', '.aidiy_cache', 'nested/.aidiy_cache', 'backup', 'nested/backup']) {
    await mkdir(join(root, folder), { recursive: true });
    await writeFile(join(root, folder, 'source.txt'), 'source');
  }
  const filtered = await scanTree(root, { filter: 'backup' });
  assert.deepEqual(filtered.fileList.map(file => file.path), ['backup/source.txt', 'nested/backup/source.txt']);
  assert.equal((await scanTree(root, { filter: 'backup', folder: 'backup' })).missing, false);
  assert.equal((await scanTree(root, { filter: 'backup', folder: '.aidiy_backup' })).missing, true);
  assert.equal((await scanTree(root)).files, 6, 'フィルターOFFは従来どおり保存先も表示する');
});
