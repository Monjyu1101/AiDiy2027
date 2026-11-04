/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync, symlinkSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { 会話保存先, 会話一覧, 会話書込, 会話削除, 会話本文上限, 会話ファイル上限 } = require('../out/conversation-store.cjs');

const entry = (id, 更新日時) => ({ id, 更新日時, 初回依頼: `依頼${id}`, メッセージ: [{ 種別: 'user', 本文: 'こんにちは' }], provider: 'aidiy_hermes', model: 'auto' });

test('Code 会話履歴: プロジェクトの _AIDIY/aidiy_code/histories/ へ1会話1ファイルで保存・新しい順に読込・削除', t => {
  const project = mkdtempSync(join(tmpdir(), 'aidiy-code-history-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  assert.equal(会話保存先(project), undefined, '保存前はフォルダを作らない');
  const folder = 会話保存先(project, true);
  assert.equal(folder, join(project, '_AIDIY', 'aidiy_code', 'histories'));
  会話書込(folder, entry('a-1', 100)); 会話書込(folder, entry('b-2', 200));
  writeFileSync(join(folder, 'broken.json'), '{');
  writeFileSync(join(folder, 'c-3.json'), JSON.stringify({ ...entry('other', 300) }));  // ファイル名とIDが違う記録は使わない
  assert.deepEqual(会話一覧(folder).map(item => item.id), ['b-2', 'a-1']);
  assert.deepEqual(readdirSync(folder).filter(name => name.endsWith('.tmp')), [], '一時ファイルを残さない');
  会話削除(folder, 'a-1'); 会話削除(folder, '../outside');
  assert.deepEqual(会話一覧(folder).map(item => item.id), ['b-2']);
  assert.throws(() => 会話書込(folder, entry('../bad', 1)), /会話ID/);
});

test('Code 会話履歴: リンクでプロジェクト外へ書き出さない', t => {
  const project = mkdtempSync(join(tmpdir(), 'aidiy-code-history-')), outside = mkdtempSync(join(tmpdir(), 'aidiy-code-outside-'));
  t.after(() => { rmSync(project, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  symlinkSync(outside, join(project, '_AIDIY'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => 会話保存先(project, true), /プロジェクト外/);
  assert.equal(existsSync(join(outside, 'aidiy_code')), false);
});

test('Code 会話履歴: 旧版が保存した4MiB超の日本語履歴も全文を復元する', t => {
  const project = mkdtempSync(join(tmpdir(), 'aidiy-code-history-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const folder = 会話保存先(project, true);
  const saved = { ...entry('legacy-japanese', 100), メッセージ: [{ 種別: 'assistant', 本文: 'あ'.repeat(1_500_000) }] };
  const path = join(folder, `${saved.id}.json`);
  writeFileSync(path, JSON.stringify(saved), 'utf8');
  assert.ok(statSync(path).size > 4 * 1024 * 1024, '旧読込上限を超える再現データ');
  assert.deepEqual(会話一覧(folder), [saved]);
});

for (const [id, character] of [['ascii', 'a'], ['japanese', 'あ'], ['emoji', '😀'], ['escaped', '\u0000'], ['surrogate', '\ud800']]) {
  test(`Code 会話履歴: 本文上限の${id}を保存し全文を復元する`, t => {
    const project = mkdtempSync(join(tmpdir(), 'aidiy-code-history-'));
    t.after(() => rmSync(project, { recursive: true, force: true }));
    const folder = 会話保存先(project, true);
    const text = character.repeat(会話本文上限 / character.length);
    assert.equal(text.length, 2_000_000, '既存の本文上限は縮小しない');
    const saved = { ...entry(id, 100), メッセージ: [{ 種別: 'assistant', 本文: text }] };
    会話書込(folder, saved);
    assert.ok(statSync(join(folder, `${id}.json`)).size <= 会話ファイル上限);
    assert.deepEqual(会話一覧(folder), [saved]);
  });
}

test('Code 会話履歴: UTF-8のファイル上限と同値は読み書きし、1バイト超過は元の履歴を保持する', t => {
  const project = mkdtempSync(join(tmpdir(), 'aidiy-code-history-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const folder = 会話保存先(project, true);
  const saved = { ...entry('boundary', 100), model: '', メッセージ: [{ 種別: 'assistant', 本文: '\u0000'.repeat(会話本文上限) }] };
  const remaining = 会話ファイル上限 - Buffer.byteLength(JSON.stringify(saved), 'utf8');
  saved.model = 'あ'.repeat(Math.floor(remaining / 3)) + 'a'.repeat(remaining % 3);
  assert.equal(Buffer.byteLength(JSON.stringify(saved), 'utf8'), 会話ファイル上限);
  const path = join(folder, `${saved.id}.json`);
  会話書込(folder, saved);
  assert.equal(statSync(path).size, 会話ファイル上限);
  assert.deepEqual(会話一覧(folder), [saved]);

  const original = readFileSync(path, 'utf8');
  const oversized = { ...saved, model: saved.model + 'a' };
  assert.throws(() => 会話書込(folder, oversized), /保存サイズ.*上限/);
  assert.equal(readFileSync(path, 'utf8'), original, '保存失敗で以前の履歴を失わない');
  assert.deepEqual(readdirSync(folder), [`${saved.id}.json`], '拒否した保存の一時ファイルを作らない');

  // 外部で作られたファイルにも、書込と同じ上限を適用する。
  writeFileSync(path, JSON.stringify(oversized), 'utf8');
  assert.equal(statSync(path).size, 会話ファイル上限 + 1);
  assert.deepEqual(会話一覧(folder), []);
});

test('Code 添付履歴: 画像プレビューも予算へ数え、ファイルから同じmetadataで復元する', t => {
  const project = mkdtempSync(join(tmpdir(), 'aidiy-code-file-history-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const { 履歴メッセージ長さ } = require('../out/conversation-store.cjs');
  const { fileAttachment } = require('../out/file-attachments.cjs');
  const thumbnail = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
  const attachment = fileAttachment({ セッションID: 'session', チャンネル: '1', メッセージ識別: 'output_file', ファイル名: 'temp/output/result.png', サムネイル画像: thumbnail, ファイル版: 'a'.repeat(64) }, 'session', '1');
  const message = { 種別: 'assistant', 本文: attachment.name, 添付: attachment };
  assert.equal(履歴メッセージ長さ(message), message.本文.length + JSON.stringify(attachment).length);
  const folder = 会話保存先(project, true), record = { ...entry('files-1', 100), メッセージ: [message] };
  会話書込(folder, record);
  assert.deepEqual(会話一覧(folder)[0].メッセージ, [message]);
  assert.equal(会話一覧(folder)[0].メッセージ[0].添付.thumbnail, 'data:image/png;base64,' + thumbnail);
  assert.equal(会話一覧(folder)[0].メッセージ[0].添付.revision, 'a'.repeat(64));
});

test('Code 添付履歴: 壊れた添付を捨てても本文は残し、キー/画像を受信境界で再検証する', t => {
  const project = mkdtempSync(join(tmpdir(), 'aidiy-code-invalid-file-history-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const { 履歴メッセージ長さ } = require('../out/conversation-store.cjs');
  const folder = 会話保存先(project, true);
  const valid = { kind: 'output_file', session: 'session', channel: '1', path: 'temp/output/result.png', name: 'result.png', thumbnail: '', key: 'forged' };
  const invalid = [true, 'bad', [], {}, { ...valid, session: '' }, { ...valid, channel: '0' }, { ...valid, path: '../outside.png' }, { ...valid, path: 'https://external.invalid/image.png' }];
  const record = { ...entry('invalid-files', 100), メッセージ: invalid.map(添付 => ({ 種別: 'assistant', 本文: '本文を維持', 添付 })) };
  // 外から壊された既存JSONの読込と、新しく保存する場合の両方を確認する。
  writeFileSync(join(folder, 'invalid-files.json'), JSON.stringify(record));
  assert.ok(会話一覧(folder)[0].メッセージ.every(message => message.本文 === '本文を維持' && !('添付' in message)));
  会話書込(folder, record);
  assert.ok(JSON.parse(readFileSync(join(folder, 'invalid-files.json'), 'utf8')).メッセージ.every(message => !('添付' in message)));
  const cycle = { ...valid }; cycle.thumbnail = cycle;
  assert.doesNotThrow(() => 履歴メッセージ長さ({ 種別: 'assistant', 本文: '安全', 添付: cycle }));
  const safeRecord = { ...entry('valid-files', 200), メッセージ: [{ 種別: 'assistant', 本文: '本文', 添付: { ...valid, thumbnail: 'data:image/svg+xml;base64,PHN2Zz4=' } }] };
  会話書込(folder, safeRecord);
  const safe = 会話一覧(folder)[0].メッセージ[0].添付;
  assert.equal(safe.thumbnail, ''); assert.notEqual(safe.key, 'forged'); assert.equal(safe.path, valid.path);
});
