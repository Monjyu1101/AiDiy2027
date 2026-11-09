// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/', import.meta.url));
const read = name => readFileSync(join(source, name), 'utf8');

test('AI操作の表示: ソース全体に旧検索・解析・分析表記を残さない', () => {
  const legacy = /aidiy[\s_-]*(?:検索|解析|分析)/i;
  const remaining = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(vue|[cm]?js|ts|css|html|json)$/.test(entry.name)) {
        if (legacy.test(readFileSync(path, 'utf8'))) remaining.push(path.slice(source.length));
      }
    }
  }
  scan(source);
  assert.deepEqual(remaining, []);
});

test('AI操作の表示: ボタン・見出し・説明とアクセシブル名を統一する', () => {
  const search = read('components/ファイル検索/AI検索パネル.vue');
  for (const label of ['aria-label="AI検索"', '<strong>AI検索</strong>', "'AI検索を依頼'", 'title="AI検索履歴を再読込"', 'title="AI検索の結果を再確認"', 'aria-label="AI検索の依頼文"']) {
    assert.ok(search.includes(label), label);
  }
  const explorer = read('components/ファイル閲覧/ファイル一覧.vue');
  assert.ok(explorer.includes("['ai','AI検索軌跡']"));
  assert.ok(explorer.includes('value="ai">AI検索</label>'));
  const viewer = read('components/ファイル閲覧/ファイルビューア.vue');
  assert.ok(viewer.includes('title="AI解析" aria-label="AI解析"'));
  assert.match(viewer, /class="viewer-analysis"[^>]*>AI解析<\/button>/);
  assert.doesNotMatch(viewer.match(/<button[^>]*class="viewer-analysis"[^>]*>[\s\S]*?<\/button>/)?.[0] || '', /<img\b/);
  const dialog = read('dialog/ファイル解析ダイアログ.vue');
  assert.ok(dialog.includes('<h2 id="file-analysis-title">AI解析</h2>'));
  assert.ok(dialog.includes('aria-label="AI解析を閉じる"'));
  assert.doesNotMatch(dialog.match(/<header>[\s\S]*?<\/header>/)?.[0] || '', /<img\b/);
  assert.ok(dialog.includes('<label for="file-analysis-instruction">概要の分析指示（テキスト）</label>'));
  assert.ok(dialog.includes('aria-describedby="file-analysis-instruction-help"'));
  assert.ok(dialog.includes('表示URLや関連ソースの調査と探索範囲、指定JSON形式での回答・保存は、別の定型文で依頼します。'));
  // 表示だけを変更し、API・保存キー・識別子を変更しない。
  assert.ok(search.includes("'/api/ai-search'"));
  assert.ok(search.includes('aidiy_ide:ai-history-selected:'));
  assert.ok(dialog.includes("'/api/file-analysis'"));
});
