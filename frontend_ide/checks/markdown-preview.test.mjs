// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { markdownText, renderMarkdownDocument, MAX_MARKDOWN_BYTES } from '../viewer/markdown-preview.mjs';
import { createPreview } from '../viewer/preview.mjs';
import { startDevelopment } from '../server.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'aidiy-markdown-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, path, content) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

test('Markdownを見出し・表・コード・リンクへ整形し、生HTMLと危険なURLを実行させない', () => {
  const html = renderMarkdownDocument('# 日本語 見出し\n\n# 日本語 見出し\n\n| 項目 | 値 |\n| --- | --- |\n| 数量 | 10 |\n\n```js\nconst value = 1;\n```\n\n- 一覧\n\n[外部](https://example.com)\n\n<script>alert(1)</script>\n\n[危険](javascript:alert(1))\n\n![画像](assets/図.png)', '<title>', 'nonce');
  assert.match(html, /<h1 id="日本語-見出し">日本語 見出し<\/h1>/);
  assert.match(html, /id="日本語-見出し-1"/);
  assert.match(html, /<table>/); assert.match(html, /class="language-js"/); assert.match(html, /<ul>/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /<title>&lt;title&gt;<\/title>/);
  assert.match(html, /aidiy-ide-viewer-activity/);
  assert.match(renderMarkdownDocument('# 日本語 見出し', 'title', 'nonce'), /id="日本語-見出し"/);
  assert.equal(markdownText(Buffer.from([0x82, 0xa0])), 'あ');
});

test('別オリジンでMarkdownと相対画像・別文書を表示し、HEAD・CSP・利用終了を守る', async t => {
  const root = await fixture(t);
  let active = true;
  const preview = createPreview(root, () => active);
  t.after(() => preview.close());
  await put(root, 'docs/日本語 ノート.md', '# 読む\n\n![画像](assets/画像.png)\n\n[次へ](../next.markdown)');
  await put(root, 'docs/assets/画像.png', 'image');
  await put(root, 'next.markdown', '# 次のページ');
  const url = await preview.url('docs/日本語 ノート.md');
  const response = await fetch(url), html = await response.text();
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(html, /<h1 id="読む">読む<\/h1>/);
  assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(html));
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'.*script-src 'nonce-/);
  assert.equal(await fetch(new URL('assets/画像.png', url)).then(r => r.text()), 'image');
  assert.match(await fetch(new URL('../next.markdown', url)).then(r => r.text()), /次のページ<\/h1>/);
  assert.equal(await fetch(url, { method: 'HEAD' }).then(r => r.text()), '');
  active = false;
  assert.equal((await fetch(url)).status, 503);
});

test('Markdownでも秘密ファイル・プロジェクト外リンク・サイズ上限を守る', async t => {
  const root = await fixture(t), outside = await fixture(t), preview = createPreview(root);
  t.after(() => preview.close());
  await put(root, '_config/note.md', '# private');
  await put(root, 'large.md', 'a'.repeat(MAX_MARKDOWN_BYTES + 1));
  await put(root, 'binary.md', Buffer.from([0, 1]));
  await put(outside, 'private.md', '# outside');
  const linked = process.platform === 'win32' ? 'linked/private.md' : 'linked.md';
  if (process.platform === 'win32') await symlink(outside, join(root, 'linked'), 'junction');
  else await symlink(join(outside, 'private.md'), join(root, 'linked.md'));
  assert.equal(await preview.url('_config/note.md'), null);
  assert.equal(await preview.url(linked), null);
  assert.equal((await fetch(await preview.url('large.md'))).status, 413);
  assert.equal((await fetch(await preview.url('binary.md'))).status, 415);
});

test('IDEのMarkdownプレビューAPIは利用開始後に提供し、コード本文はそのまま返す', async t => {
  const root = await fixture(t), app = await startDevelopment(root);
  t.after(() => app.close());
  await put(root, 'README.md', '# README\n本文');
  await put(root, 'large.md', 'a'.repeat(MAX_MARKDOWN_BYTES + 1));
  const path = app.url + 'api/preview?path=README.md';
  assert.equal((await fetch(path)).status, 503);
  await fetch(app.url + 'api/connection/offline', { method: 'POST' });
  const result = await fetch(path).then(r => r.json());
  assert.equal(result.kind, 'markdown');
  assert.notEqual(new URL(result.url).origin, new URL(app.url).origin);
  assert.equal((await fetch(app.url + 'api/file?path=README.md').then(r => r.json())).text, '# README\n本文');
  const large = await fetch(app.url + 'api/preview?path=large.md').then(r => r.json());
  assert.match(large.error, /1MB/);
});
