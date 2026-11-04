// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchReference, fileDraftReference } from '../src/components/ファイル閲覧/ファイル参照.js';

test('grep参照は日本語・CRLF・UTF-16の行列を照合する', () => {
  const reference = searchReference('先頭\r\n😀日本語 Test\r\n末尾', { line: 2, column: 7, query: 'test', matchLength: 4 });
  assert.deepEqual(reference, { stale: false, line: 2, column: 7, endColumn: 11, start: 10, length: 4 });
  assert.equal(searchReference('old\nnew', { line: 2, column: 1, query: 'old' }).stale, true);
  assert.equal(searchReference('one\r日本語', { line: 2, column: 1, query: '日本語' }).start, 4);
  assert.equal(searchReference('İ', { line: 1, column: 1, query: 'i', matchLength: 1 }).stale, false);
  assert.equal(searchReference('Test', { line: 1, column: 1, query: 'test', caseSensitive: true }).stale, true);
});

test('消えた行・列、検索座標なしを区別する', () => {
  assert.equal(searchReference('x', { line: 2, column: 1, query: 'x' }).stale, true);
  assert.equal(searchReference('x', { line: 1, column: 3, query: 'x' }).stale, true);
  assert.equal(searchReference('x', {}), null);
});

test('ファイル参照は選択なしではパス、選択ありでは行番号と本文を下書きにする', () => {
  assert.equal(fileDraftReference({ path: 'src/日本語.vue' }), '参照ファイル: src/日本語.vue');
  assert.equal(fileDraftReference({ path: 'sample.md' }, { text: '```js\nhello\n```', startLine: 2, endLine: 4 }), '参照ファイル: sample.md\n選択範囲: 2〜4行\n````\n```js\nhello\n```\n````');
  assert.throws(() => fileDraftReference({ path: 'file' }, { text: 'x'.repeat(80001) }), /80,000/);
});
