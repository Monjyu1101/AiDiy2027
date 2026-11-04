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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Slackパネル, type パネル状態, type パネル発言 } from '../src/接続パネル/パネル操作';
import { SlackAPIエラー } from '../src/接続/ネットワーク接続';
import { ブラウザ用HTML } from '../src/web-server';
import { config } from './helpers';

type 偽Bot = { 起動(): Promise<void>; 終了(): Promise<void>; 表示?: (who: string, text: string, role: 'user' | 'ai') => void; 正常: boolean; 終了回数: number };

function 準備(起動 = async () => {}) {
  const folder = mkdtempSync(join(tmpdir(), 'aidiy-slack-panel-'));
  const states: パネル状態[] = [], activity: パネル発言[] = [];
  const bots: 偽Bot[] = [];
  let received: Record<string, unknown> | undefined;
  const panel = new Slackパネル(state => states.push(state), config, settings => {
    received = settings as unknown as Record<string, unknown>;
    const bot: 偽Bot = { 起動, 正常: true, 終了回数: 0, async 終了() { bot.終了回数++; } };
    bots.push(bot); return bot;
  }, join(folder, 'aidiy_slack.json'), () => {}, 2000, async () => undefined);
  panel.発言 = value => activity.push(value);
  return { panel, states, activity, bots, folder, settings: () => received, done: () => rmSync(folder, { recursive: true, force: true }) };
}

test('接続・発言通知・再接続表示・切断を Discord 版と同じ状態遷移で通知する', async () => {
  const f = 準備();
  try {
    await f.panel.開始();
    assert.deepEqual(f.states.map(s => s.phase), ['connecting', 'connected']);
    const bot = f.bots[0];
    bot.表示?.('あなた', 'おはよう', 'user');
    bot.表示?.('AiDiy', 'x'.repeat(3000), 'ai');
    assert.deepEqual(f.activity[0], { who: 'あなた', text: 'おはよう', role: 'user' });
    assert.equal(f.activity[1].text.length, 2000);
    bot.正常 = false; f.panel.接続確認();
    bot.正常 = true; f.panel.接続確認();
    assert.deepEqual(f.states.slice(2).map(s => s.phase), ['reconnecting', 'connected']);
    await f.panel.停止();
    assert.equal(f.states.at(-1)?.phase, 'idle'); assert.equal(bot.終了回数, 1);
    // 切断後の古い Bot からの発言はパネルへ流さない。
    bot.表示?.('AiDiy', '遅れた回答', 'ai');
    assert.equal(f.activity.length, 2);
  } finally { f.done(); }
});

test('コードは aidiy_hermes 固定。未保存時は共通設定のモデルを表示し、選んだモデルを1ファイルに保存して Bot に渡す', async () => {
  const f = 準備();
  try {
    const first = await f.panel.初期情報();
    assert.deepEqual(first.code, { cli: 'aidiy_hermes', model: 'auto' }, '未保存時は CODE_AIDIY_HERMES_MODEL（既定 auto）');
    assert.deepEqual((await f.panel.コード候補()).models.slice(0, 2).map(item => item.id), ['auto', 'same']);
    assert.deepEqual(f.panel.コード選択保存({ model: 'codex_cli/same' }), { cli: 'aidiy_hermes', model: 'codex_cli/same' });
    assert.deepEqual(JSON.parse(readFileSync(join(f.folder, 'aidiy_slack.json'), 'utf8')), { code_name: 'aidiy_hermes', code_model: 'codex_cli/same' });
    await f.panel.開始();
    assert.equal(f.settings()?.hermesModel, 'codex_cli/same');
    assert.throws(() => f.panel.コード選択保存({ model: 'auto' }), /切断してから/);
    const initial = await f.panel.初期情報();
    assert.equal(initial.code.model, 'codex_cli/same'); assert.ok(!('botToken' in initial));
  } finally { await f.panel.終了(); f.done(); }
});

test('旧形式の保存（aidiy_slack_code_model.json）は1回だけ新しい1ファイルへ移して削除する', async () => {
  const f = 準備();
  try {
    const legacy = join(f.folder, 'aidiy_slack_code_model.json');
    writeFileSync(legacy, JSON.stringify({ provider: 'codex-cli', model: 'gpt-x' }));
    const initial = await f.panel.初期情報();
    assert.equal(initial.firstRun, false); assert.equal(initial.code.model, 'codex_cli/gpt-x');
    assert.equal(existsSync(legacy), false);
    assert.deepEqual(JSON.parse(readFileSync(join(f.folder, 'aidiy_slack.json'), 'utf8')), { code_name: 'aidiy_hermes', code_model: 'codex_cli/gpt-x' });
  } finally { await f.panel.終了(); f.done(); }
});

test('接続失敗は案内文と token を含まない詳細を返し、Bot を回収する', async () => {
  const f = 準備(async () => { throw new SlackAPIエラー('auth.test', 'invalid_auth'); });
  try {
    await f.panel.開始();
    const last = f.states.at(-1)!;
    assert.equal(last.phase, 'error');
    assert.equal(last.message, 'slack_bot_token が無効です。');
    assert.match(last.details ?? '', /段階: Slack接続/); assert.match(last.details ?? '', /auth\.test: invalid_auth/);
    assert.doesNotMatch(JSON.stringify(f.states), /xoxb-/);
    assert.equal(f.bots[0].終了回数, 1);
  } finally { f.done(); }
});

test('ブラウザ版は同じ画面に WebSocket 橋渡しを差し込む', () => {
  const html = readFileSync(new URL('../panel/index.html', import.meta.url), 'utf8');
  const browser = ブラウザ用HTML(html);
  assert.match(browser, /connect-src 'self'/);
  assert.ok(browser.indexOf('web-bridge.js') < browser.indexOf('view.js'));
  assert.doesNotMatch(html, /visualizer/);
});

test('起動時の自動接続は保存済みの設定があるときだけ行い、初回はモデル設定画面から始める（Discord と同じ動き）', async () => {
  const f = 準備();
  try {
    assert.equal((await f.panel.初期情報()).firstRun, true);
    assert.equal(await f.panel.自動開始(), false);
    assert.deepEqual(f.states.map(s => s.phase), [], '初回は Slack に接続しない'); assert.equal(f.bots.length, 0);
    f.panel.コード選択保存({ model: 'same' });
    assert.equal((await f.panel.初期情報()).firstRun, false);
    assert.equal(await f.panel.自動開始(), true);
    assert.deepEqual(f.states.map(s => s.phase), ['connecting', 'connected']);
  } finally { await f.panel.終了(); f.done(); }
});

test('code_name（将来の別ハーネス用）を保存し、ない保存は aidiy_hermes で書き足す。未対応の値では接続しない', async () => {
  const f = 準備();
  try {
    const file = join(f.folder, 'aidiy_slack.json');
    writeFileSync(file, JSON.stringify({ code_model: 'same' }));
    assert.deepEqual((await f.panel.初期情報()).code, { cli: 'aidiy_hermes', model: 'same' });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).code_name, 'aidiy_hermes', '読込時に code_name を書き足す');
    writeFileSync(file, JSON.stringify({ code_name: 'other_harness', code_model: 'same' }));
    await f.panel.開始();
    assert.equal(f.states.at(-1)?.phase, 'error'); assert.match(f.states.at(-1)?.message ?? '', /other_harness には未対応/); assert.equal(f.bots.length, 0);
    writeFileSync(file, JSON.stringify({ code_name: 'Bad Name', code_model: 'same' }));
    assert.equal((await f.panel.初期情報()).firstRun, true, '不正な code_name の保存は使わない');
  } finally { await f.panel.終了(); f.done(); }
});
