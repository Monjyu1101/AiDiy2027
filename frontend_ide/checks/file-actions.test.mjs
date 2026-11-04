// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyBrowserText, fullFilePath } from '../src/components/ファイル閲覧/ファイル操作.js';

test('パス: Windowsドライブ・UNC・日本語・空白・記号とPOSIXのルートを保持する', () => {
  for (const [root, path, expected] of [
    ['C:\\作業 フォルダ\\', '資料/日本語 & % #.xlsx', 'C:\\作業 フォルダ\\資料\\日本語 & % #.xlsx'],
    ['C:/作業', 'a.txt', 'C:\\作業\\a.txt'],
    ['\\\\server\\share\\', 'dir/file.txt', '\\\\server\\share\\dir\\file.txt'],
    ['/', '日本語.txt', '/日本語.txt'],
    ['/project/', 'a.txt', '/project/a.txt'],
    ['/project\\literal', 'a\\b.txt', '/project\\literal/a\\b.txt'],
    ['', 'dir/file.txt', 'dir/file.txt'],
  ]) assert.equal(fullFilePath(root, path), expected);
});

function documentFixture({ result = true, throws = false } = {}) {
  const events = [], restoredRange = {}, copied = [];
  const selection = { rangeCount: 1, getRangeAt: () => ({ cloneRange: () => restoredRange }),
    removeAllRanges: () => events.push('clear ranges'), addRange: range => { assert.equal(range, restoredRange); events.push('restore range'); } };
  const active = { selectionStart: 2, selectionEnd: 5, selectionDirection: 'backward',
    focus: options => { assert.equal(options.preventScroll, true); events.push('restore focus'); },
    setSelectionRange: (...args) => { assert.deepEqual(args, [2, 5, 'backward']); events.push('restore input'); } };
  let field;
  const document = { activeElement: active, getSelection: () => selection,
    createElement: type => {
      assert.equal(type, 'textarea');
      field = { style: {}, focus: () => events.push('focus'), select: () => events.push('select'),
        setSelectionRange: (start, end) => { assert.equal(start, 0); assert.equal(end, field.value.length); }, remove: () => events.push('remove') };
      return field;
    },
    body: { append: element => { assert.equal(element, field); events.push('append'); } },
    execCommand: command => { assert.equal(command, 'copy'); copied.push(field.value); if (throws) throw Error('denied'); return result; },
  };
  return { document, events, copied, field: () => field };
}

test('Webコピー: Clipboard API成功時は代替処理を実行しない', async () => {
  const written = [];
  await copyBrowserText('/project/日本語 & a.txt', { clipboard: { writeText: async text => written.push(text) }, document: null });
  assert.deepEqual(written, ['/project/日本語 & a.txt']);
});

test('Webコピー: APIなし・権限拒否時の代替は文字列をそのままコピーし、選択とフォーカスを復元する', async () => {
  for (const clipboard of [null, { writeText: async () => { throw Error('NotAllowedError'); } }]) {
    const f = documentFixture();
    await copyBrowserText('C:\\日本語 フォルダ\\<script>&.txt', { clipboard, document: f.document });
    assert.deepEqual(f.copied, ['C:\\日本語 フォルダ\\<script>&.txt']);
    assert.equal(f.field().readOnly, true);
    assert.deepEqual(f.events, ['append', 'focus', 'select', 'remove', 'restore focus', 'restore input', 'clear ranges', 'restore range']);
  }
});

test('Webコピー: 代替のfalse・例外・非対応を成功扱いにせず後始末する', async () => {
  for (const options of [{ result: false }, { throws: true }]) {
    const f = documentFixture(options);
    await assert.rejects(copyBrowserText('path', { clipboard: null, document: f.document }));
    assert.equal(f.events.includes('remove'), true);
    assert.equal(f.events.includes('restore focus'), true);
  }
  await assert.rejects(copyBrowserText('path', { clipboard: null, document: null }));
});

test('Webコピー: 遅い権限拒否の前に対象を変えたら古いパスの代替コピーを実行しない', async () => {
  const f = documentFixture(); let reject, current = true;
  const pending = copyBrowserText('old', { clipboard: { writeText: () => new Promise((_resolve, fail) => { reject = fail; }) }, document: f.document, isCurrent: () => current });
  current = false; reject(Error('denied'));
  await assert.rejects(pending, /cancelled/);
  assert.deepEqual(f.copied, []); assert.deepEqual(f.events, []);
});
