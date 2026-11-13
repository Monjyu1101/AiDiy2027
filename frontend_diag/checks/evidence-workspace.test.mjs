// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

test('補助ツールは現行Task/Teamの画像と作業JSONを分離する（通信なし）', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aidiy-evidence-work-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const target = join(root, 'frontend_diag/checks/総合テスト補助/chrome操作.mjs');
  await mkdir(join(root, 'frontend_diag/checks/総合テスト補助'), {recursive: true});
  await copyFile(new URL('./総合テスト補助/chrome操作.mjs', import.meta.url), target);
  const previous = process.env.RUN_ID;
  process.env.RUN_ID = 'synthetic-run';
  t.after(() => { if (previous === undefined) delete process.env.RUN_ID; else process.env.RUN_ID = previous; });
  const helper = await import(pathToFileURL(target).href);
  // 合成PNGを一時コピーの保存先へ書くだけ。ブラウザや実サービスは呼ばない。
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const {save_path} = JSON.parse(options.body);
    const bytes = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
    bytes.writeUInt32BE(1, 16); bytes.writeUInt32BE(1, 20);
    await writeFile(save_path, bytes);
    return {headers: {get: () => 'image/png'}};
  });
  for (const [book, prefix, document] of [
    ['aidiy_task-操作', 'Task', 'セルフテスト,aidiy_task,操作編'],
    ['aidiy_team-操作', 'Team', 'セルフテスト,aidiy_team,操作編'],
  ]) {
    helper.setBook(book);
    await helper.shot('101', '合成確認', 'fixture');
    helper.record({status: '合成試験'});
    const folder = join(root, 'docs/セルフテスト、操作ガイド/images', document);
    assert.deepEqual(await readdir(folder), [`${prefix}_101_合成確認.png`]);
    const work = join(root, 'docs/セルフテスト、操作ガイド/evidence/.aidiy_cache/selftest', document);
    assert.equal(JSON.parse(await readFile(join(work, 'synthetic-run__evidence.json'))).images.length, 1);
    assert.equal(JSON.parse(await readFile(join(work, 'synthetic-run__results.json'))).length, 1);
    await assert.rejects(helper.shot('101', '合成確認', 'fixture'), /上書きしません/);
  }
  for (const book of ['frontend_web-AIタスク', 'frontend_web-AIチーム']) {
    helper.setBook(book);
    assert.throws(() => helper.record({}), /対応する冊子がありません/);
  }
});

test('Electron統合監査の既定出力はキャッシュ、明示出力先は維持する', async () => {
  const source = await readFile(new URL('../../frontend_ide/checks/Electron表示統合確認.cjs', import.meta.url), 'utf8');
  assert.ok(source.includes("process.env.AIDIY_ELECTRON_AUDIT_DIR||'.aidiy_cache/selftest/electron/'"));
  assert.ok(!source.includes('_AIDIY/knowledge/images/'));
});

test('正式証跡に日付先頭名や作業JSON・ログ・スクリプトを混在させない', async () => {
  const images = new URL('../../docs/セルフテスト、操作ガイド/images/', import.meta.url);
  const files = await readdir(images, {recursive: true, withFileTypes: true});
  const invalid = files.filter(file => file.isFile() &&
    (/^20\d{6}/u.test(file.name) || /\.(?:json|txt|log|mjs)$/iu.test(file.name)));
  assert.deepEqual(invalid.map(file => file.name), []);
});
