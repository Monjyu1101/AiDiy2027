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
import { dirname, join } from 'node:path';
import { Discordパネル } from '../src/接続パネル/パネル操作';
import { type モデル初期情報 } from '../src/モデル情報/モデル情報';
import { type Discord設定 } from '../src/接続/接続設定';
import { config, waitFor } from './helpers';

const selection = { LIVE_AI_NAME: 'openai_live', LIVE_OPENAI_MODEL: 'test-live-model', LIVE_OPENAI_VOICE: 'marin' };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'aidiy-discord-panel-'));
  const file = join(directory, 'aidiy_discord.json');
  const configurations: Discord設定[] = [];
  let startCount = 0, stopCount = 0, ready = true;
  const create = (value: Discord設定) => {
    configurations.push(value);
    return { 起動: async () => { startCount++; }, 終了: async () => { stopCount++; }, client: { isReady: () => ready } };
  };
  const read = () => ({ ...config(), coreUrl:'ws://127.0.0.1:1/core/ws/AIコア', liveModels: { LIVE_AI_NAME: 'freeai_live', LIVE_FREEAI_MODEL: 'common-model', LIVE_FREEAI_VOICE: 'Zephyr' } });
  const catalog = { models: { freeai_live: { 'common-model': 'Common' }, openai_live: { 'test-live-model': 'Test' } },
    voices: { freeai_live: { Zephyr: 'Zephyr' }, openai_live: { marin: 'Marin', cedar: 'Cedar' } } };
  const panel = () => new Discordパネル(() => {}, read, create, file, () => {}, undefined, () => catalog, async () => undefined);
  return { file, configurations, read, create, panel, catalog, counts: () => [startCount, stopCount], setReady: (value: boolean) => { ready = value; }, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test('候補の順序を維持し、保存済みでも削除されたモデル・声は追加表示・使用しない', async () => {
  const f = fixture();
  try {
    // Live を ON で使っている既存の利用者（初回の既定は OFF）。保存は aidiy_discord.json の1ファイル。
    writeFileSync(f.file, JSON.stringify({ live: true, live_models: selection, code_model: 'auto' }));
    const panel = f.panel();
    delete (f.catalog.voices.openai_live as Record<string, string>).marin;
    const info = await panel.初期情報();
    assert.deepEqual(Object.keys(info.voices.openai_live), ['cedar']);
    assert.match(info.notice, /声を選び直して/);
    assert.throws(() => panel.選択保存(selection), /声を選び直して/);
    assert.deepEqual(JSON.parse(readFileSync(f.file, 'utf8')).live_models, selection);
    await panel.開始();
    assert.equal(panel.状態.phase, 'error'); assert.equal(f.configurations.length, 0);
    panel.選択保存({ ...selection, LIVE_OPENAI_VOICE: 'cedar' });
    await panel.開始();
    assert.equal(f.configurations[0].liveModels.LIVE_OPENAI_VOICE, 'cedar');
    await panel.停止();
    delete (f.catalog.models.openai_live as Record<string, string>)['test-live-model'];
    assert.deepEqual((await panel.初期情報()).models.openai_live, {});
    await panel.開始();
    assert.equal(panel.状態.phase, 'error'); assert.equal(f.configurations.length, 1);
    await panel.終了();
  } finally { f.cleanup(); }
});

test('APIの初期値・候補を優先し、API停止時はファイル候補と共通初期値に戻る', async () => {
 const f=fixture();
 let available=true;
 const info:モデル初期情報={settings:{...selection,CODE_AIDIY_HERMES_MODEL:'openai_oauth/api-code'},
   catalog:{models:{openai_live:{'test-live-model':'API Live'}},voices:{openai_live:{marin:'API Marin'}}},
   code:{aidiy_hermes:{auto:'auto',same:'same','openai_oauth/api-code':'yyyy/mm/dd - openai_oauth/api-code'}},chat:{}};
 const panel=new Discordパネル(()=>{},f.read,f.create,f.file,()=>{},undefined,
   ()=>f.catalog,async()=>available?info:undefined);
 try{
  const initial=await panel.初期情報();
  assert.deepEqual(initial.models,info.catalog.models);
  assert.equal(initial.settings.LIVE_AI_NAME,'openai_live');
  assert.deepEqual(initial.code,{cli:'aidiy_hermes',model:'openai_oauth/api-code'},'未保存時は CODE_AIDIY_HERMES_MODEL を初期表示');
  assert.deepEqual((await panel.コード候補()).models.map(item=>item.id),['auto','same','openai_oauth/api-code']);
  await panel.開始();
  assert.equal(f.configurations[0].liveModels.LIVE_AI_NAME,'openai_live');
  assert.equal(f.configurations[0].hermesModel,'openai_oauth/api-code');
  await panel.停止();
  available=false;
  const fallback=await panel.初期情報();
  assert.deepEqual(fallback.models,f.catalog.models);
  assert.equal(fallback.settings.LIVE_AI_NAME,'freeai_live');
  await panel.開始();
  assert.equal(f.configurations[1].liveModels.LIVE_FREEAI_MODEL,'common-model');
 }finally{await panel.終了();f.cleanup();}
});

test('起動時は未接続、初回は共通モデルを使い開始と停止だけで Bot を制御する', async () => {
  const f = fixture(), panel = f.panel();
  try {
    assert.equal(panel.状態.phase, 'idle'); assert.deepEqual(f.counts(), [0, 0]);
    await Promise.all([panel.開始(), panel.開始()]);
    assert.equal(panel.状態.phase, 'connected'); assert.deepEqual(f.counts(), [1, 0]);
    assert.equal(f.configurations[0].liveModels.LIVE_FREEAI_MODEL, 'common-model');
    assert.throws(() => panel.選択保存(selection));
    f.setReady(false); panel.接続確認(); assert.equal(panel.状態.phase, 'reconnecting');
    f.setReady(true); panel.接続確認(); assert.equal(panel.状態.phase, 'connected');
    await Promise.all([panel.停止(), panel.停止()]); assert.deepEqual(f.counts(), [1, 1]);
    await panel.開始(); assert.deepEqual(f.counts(), [2, 1]);
    await panel.終了(); await panel.開始(); assert.deepEqual(f.counts(), [2, 2]);
  } finally { await panel.終了(); f.cleanup(); }
});

test('手動選択は再起動後にも適用され、トークンや共通設定を保存ファイルに混ぜない', async () => {
  const f = fixture(), first = f.panel();
  try {
    first.選択保存(selection);
    first.コード選択保存({ model: 'openai_oauth/test-code-model' });
    await first.終了();
    assert.deepEqual(JSON.parse(readFileSync(f.file, 'utf8')), { live: false, live_models: selection, code_name: 'aidiy_hermes', code_model: 'openai_oauth/test-code-model' });
    assert.ok(!readFileSync(f.file, 'utf8').includes(f.read().token), 'トークンを保存しない');
    const next = f.panel();
    await next.開始();
    assert.equal(f.configurations[0].liveModels.LIVE_AI_NAME, 'openai_live');
    assert.equal(f.configurations[0].liveModels.LIVE_OPENAI_MODEL, 'test-live-model');
    assert.equal(f.configurations[0].hermesModel, 'openai_oauth/test-code-model');
    assert.equal(f.read().liveModels.LIVE_AI_NAME, 'freeai_live');
    await next.終了();
    writeFileSync(f.file, '{broken');
    const fallback = f.panel(); await fallback.開始();
    assert.equal(f.configurations[1].liveModels.LIVE_AI_NAME, 'freeai_live'); await fallback.終了();
  } finally { f.cleanup(); }
});

test('login が先に完了してもサーバー情報の受信まで接続中を維持する', async () => {
  const f = fixture(); f.setReady(false);
  const panel = f.panel();
  try {
    const pending = panel.開始();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(panel.状態.phase, 'connecting');
    f.setReady(true); await pending; assert.equal(panel.状態.phase, 'connected');
  } finally { await panel.終了(); f.cleanup(); }
});

test('接続途中の停止とパネル終了はログイン完了を待たず回収し、遅い結果で復帰しない', async () => {
  const f = fixture(); let finish!: () => void, stopped = 0, launched = 0;
  const panel = new Discordパネル(() => {}, f.read, () => ({
    起動: () => new Promise<void>(resolve => { launched++; finish = resolve; }),
    終了: async () => { stopped++; }, client: { isReady: () => true },
  }), f.file, () => {}, undefined, () => f.catalog, async () => undefined);
  try {
    const connecting = panel.開始(); assert.equal(panel.状態.phase, 'connecting');
    await waitFor(()=>launched===1);
    await panel.停止(); await connecting; assert.equal(stopped, 1);
    finish(); assert.equal(panel.状態.phase, 'idle');
    const connectingAgain = panel.開始(); await waitFor(()=>launched===2); await panel.終了(); await connectingAgain;
    finish(); await panel.開始(); assert.equal(stopped, 2); assert.equal(panel.状態.phase, 'idle');
  } finally { await panel.終了(); f.cleanup(); }
});

test('接続失敗は秘密を表示せず回収し、再試行できる。タイムアウトも回収する', async () => {
  const f = fixture(); let attempt = 0, stopped = 0;
  const panel = new Discordパネル(() => {}, f.read, () => ({
    起動: async () => { if (++attempt === 1) throw Object.assign(new Error(`invalid token: ${f.read().token}`), { code: 'TokenInvalid' }); },
    終了: async () => { stopped++; }, client: { isReady: () => true },
  }), f.file, () => {}, undefined, () => f.catalog, async () => undefined);
  try {
    await panel.開始(); assert.equal(panel.状態.phase, 'error'); assert.equal(stopped, 1);
    assert.match(panel.状態.message, /トークン認証/);
    assert.match(panel.状態.details || '', /失敗段階: Discord接続/);
    assert.match(panel.状態.details || '', /コード: TokenInvalid/);
    assert.ok(!JSON.stringify(panel.状態).includes(f.read().token));
    await panel.開始(); assert.equal(panel.状態.phase, 'connected'); assert.equal(panel.状態.details, undefined); await panel.終了();
    const timeout = new Discordパネル(() => {}, f.read, () => ({
      起動: () => new Promise<void>(() => {}), 終了: async () => { stopped++; }, client: { isReady: () => false },
    }), f.file, () => {}, 10, () => f.catalog, async () => undefined);
    await timeout.開始(); await waitFor(() => timeout.状態.phase === 'error');
    assert.match(timeout.状態.message, /Discord接続が0.01秒以内/);
    assert.match(timeout.状態.details || '', /失敗段階: Discord接続/);
    assert.equal(stopped, 3); await timeout.終了();
  } finally { await panel.終了(); f.cleanup(); }
});

test('Hermes確認で失敗した場合はBotに接続せず原因を表示する', async () => {
  const f = fixture();
  const panel = new Discordパネル(() => {}, f.read, f.create, f.file, () => {
    throw new Error('Python が見つかりません。Python Path を確認してください。');
  }, undefined, () => f.catalog, async () => undefined);
  try {
    await panel.開始();
    assert.equal(panel.状態.phase, 'error'); assert.deepEqual(f.counts(), [0, 0]);
    assert.match(panel.状態.message, /Hermes用のPython/);
    assert.match(panel.状態.details || '', /失敗段階: Hermes確認/);
    assert.match(panel.状態.details || '', /Python Path/);
  } finally { await panel.終了(); f.cleanup(); }
});

test('Live の ON/OFF を保存して接続制御に使い、Code は ON 固定。OFF 時は Live のモデル確認をしない', async () => {
  const f = fixture(), first = f.panel();
  try {
    const initial = await first.初期情報();
    assert.deepEqual(initial.features, { live: false, code: true }, '初回（未保存）は音声会話 OFF');
    assert.equal(initial.firstRun, true);
    assert.deepEqual(first.機能選択保存({ live: false, code: false }), { live: false, code: true });
    assert.throws(() => first.機能選択保存({}), /ON\/OFF/);
    await first.終了();
    (f.catalog.models as Record<string, Record<string, string>>).freeai_live = {}; // Live が ON なら選択エラーになる状態
    const next = f.panel();
    assert.deepEqual((await next.初期情報()).features, { live: false, code: true });
    await next.開始();
    assert.equal(next.状態.phase, 'connected');
    assert.match(next.状態.message, /コードを利用/);
    assert.deepEqual([f.configurations[0].liveEnabled, f.configurations[0].codeEnabled], [false, true]);
    assert.throws(() => next.モニター(true), /Live が OFF/);
    assert.throws(() => next.機能選択保存({ live: true }), /切断してから/);
    await next.終了();
  } finally { f.cleanup(); }
});

test('起動時の自動接続は保存済みの設定があるときだけ行い、初回はモデル設定画面から始める（Slack と同じ動き）', async () => {
  const f = fixture();
  try {
    const first = f.panel();
    assert.equal(await first.自動開始(), false);
    assert.equal(first.状態.phase, 'idle'); assert.deepEqual(f.counts(), [0, 0], '初回は Discord に接続しない');
    await first.開始();
    assert.equal(first.状態.phase, 'connected', '「接続」は初回でも行える');
    await first.終了();
    const next = f.panel();
    // 画面の「接続」は接続前に機能の選択を保存する。その保存があれば次回から自動接続する。
    next.機能選択保存({ live: false });
    assert.equal((await next.初期情報()).firstRun, false);
    const again = f.panel();
    assert.equal(await again.自動開始(), true);
    assert.equal(again.状態.phase, 'connected');
    await again.終了(); await next.終了();
  } finally { f.cleanup(); }
});

test('旧形式の3ファイルは読み込まず、移行・削除もしない', async () => {
  const f = fixture();
  try {
    const names = ['aidiy_discord_features.json', 'aidiy_discord_model.json', 'aidiy_discord_code_model.json'];
    for (const name of names) writeFileSync(join(dirname(f.file), name), JSON.stringify({ live: true, model: 'old' }));
    const panel = f.panel(), initial = await panel.初期情報();
    assert.equal(initial.firstRun, true); assert.deepEqual(initial.features, { live: false, code: true });
    assert.equal(existsSync(f.file), false);
    for (const name of names) assert.equal(existsSync(join(dirname(f.file), name)), true);
    await panel.終了();
  } finally { f.cleanup(); }
});

test('code_name（将来の別ハーネス用）を保存し、ない保存は aidiy_hermes として解釈する。未対応の値では接続しない', async () => {
  const f = fixture();
  try {
    writeFileSync(f.file, JSON.stringify({ live: false, live_models: {}, code_model: 'same' }));
    const panel = f.panel();
    assert.deepEqual((await panel.初期情報()).code, { cli: 'aidiy_hermes', model: 'same' });
    assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).code_name, undefined, '読込時に保存内容を書き換えない');
    writeFileSync(f.file, JSON.stringify({ live: false, live_models: {}, code_name: 'other_harness', code_model: 'same' }));
    await panel.開始();
    assert.equal(panel.状態.phase, 'error'); assert.match(panel.状態.message, /other_harness には未対応/); assert.deepEqual(f.counts(), [0, 0]);
    writeFileSync(f.file, JSON.stringify({ live: false, live_models: {}, code_name: 'Bad Name', code_model: 'same' }));
    assert.equal((await panel.初期情報()).firstRun, true, '不正な code_name の保存は使わない');
    await panel.終了();
  } finally { f.cleanup(); }
});
