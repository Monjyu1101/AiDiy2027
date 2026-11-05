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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { プロジェクトルート, 設定ファイル } from '../src/接続/接続設定';
import { 起動解決, コード要求実行, CLI実行, コードモデル読込, 接続元許可 } from '../src/共通連携/IDE連携';
const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'src');
const features: Record<string, string[]> = {
  接続: ['Core認証.ts', 'Bot接続.ts', 'コマンド処理.ts', '接続設定.ts', 'ネットワーク接続.ts'], コード: ['コード会話.ts', 'Hermesモデル.ts'],
  モデル情報: ['モデル情報.ts'], 接続パネル: ['パネル操作.ts', 'パネル中継.ts', 'パネル設定.ts'], 共通連携: ['IDE連携.ts'],
};
test('Discord 版と同じ日本語の機能フォルダーに集約し、音声会話の部品を持たない', () => {
  const entries = readdirSync(source, { withFileTypes: true });
  assert.deepEqual(entries.filter(item => item.isDirectory()).map(item => item.name).sort(), Object.keys(features).sort());
  assert.deepEqual(entries.filter(item => item.isFile()).map(item => item.name).sort(), ['main.ts', 'panel-worker.ts', 'web-server.ts'].sort());
  for (const [folder, files] of Object.entries(features)) assert.deepEqual(readdirSync(join(source, folder)).sort(), [...files].sort());
  for (const file of ['launch.mjs', 'desktop.cjs', 'preload.cjs', 'index.html', 'view.js', 'web-bridge.js', 'style.css', 'titlebar.css', 'AiDiy.png', 'AiDiy_slack.png']) assert.ok(existsSync(join(root, 'panel', file)), file);
  for (const file of ['visualizer.js', 'ライブ']) assert.equal(existsSync(join(root, 'panel', file)), false, file);
});
test('設定ルートと IDE の CommonJS 共有 export を維持し、Discord 側の部品を経由しない', () => {
  assert.equal(プロジェクトルート, resolve(root, '../..'));
  assert.equal(設定ファイル, join(プロジェクトルート, '_config/AiDiy_key.json'));
  for (const exported of [起動解決, コード要求実行, CLI実行, コードモデル読込, 接続元許可]) assert.equal(typeof exported, 'function');
  const files = readdirSync(source, { recursive: true, encoding: 'utf8' }).filter(file => /\.(ts|mjs)$/.test(file));
  for (const file of files) {
    const absolute = join(source, file), content = readFileSync(absolute, 'utf8');
    for (const match of content.matchAll(/(?:from\s*|import\s*\(|require\s*\()(['"])(\.[^'"]+)\1/g)) {
      const target = resolve(dirname(absolute), match[2]);
      assert.ok([target, `${target}.ts`, `${target}.mjs`, `${target}.cjs`].some(candidate => existsSync(candidate)), `${file}: ${match[2]}`);
      assert.ok(!target.startsWith(resolve(root, '..', 'src')) && !target.startsWith(resolve(root, '..', 'panel')), `${file} は Discord の部品を読まない`);
    }
  }
});


test('renderer は components の日本語機能にまとめ、旧コピーと空 dialog を増やさない', () => {
  const panel = join(root, 'panel');
  assert.deepEqual(readdirSync(join(panel, 'components/接続')).sort(), ['パネル状態.js', '接続パネル.vue', '機能切替.vue', '逃げるマーク.vue'].sort());
  for (const folder of ['画面', '接続', 'ライブ', 'dialog']) assert.equal(existsSync(join(panel, folder)), false, folder);
  const files = readdirSync(join(panel, 'components'), { recursive: true, encoding: 'utf8' }).filter(file => /\.(vue|js)$/.test(file));
  for (const file of files) {
    const absolute = join(panel, 'components', file), content = readFileSync(absolute, 'utf8');
    for (const match of content.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)) {
      assert.ok(existsSync(resolve(dirname(absolute), match[2])), `${file}: ${match[2]}`);
    }
  }
  assert.equal(existsSync(join(panel, 'components/ライブ')), false, 'Slack は音声表示を持たない');
});
