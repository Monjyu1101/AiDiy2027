// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { ref } = createRequire(path.join(__dirname, '../../../../package.json'))('vue');
const capabilities = [{ id: 'claude', 操作: ['導入'], パッケージ: '@anthropic-ai/claude-code', 説明: 'npm 管理' }, { id: 'codex', 操作: ['再導入', '削除'], パッケージ: '@openai/codex', 再導入説明: 'npm install --global @openai/codex を1回実行して更新・再導入します。事前のアンインストールは行いません。' }, { id: 'node', 操作: [], 理由: '対象外' }];
const running = (extra = {}) => ({ 実行ID: 'job/1', 対象: 'claude', 操作: '導入', 状態: '実行中', 実行中: true, ログ: 'installing\n', ...extra });
const completed = (extra = {}) => running({ 状態: '完了', 実行中: false, ログ: 'installing\nchecked\n', 結果: { id: 'claude', 状態: 'OK', バージョン: '2.0' }, 確認済み: true, 前回実行日時: '2026-10-19T22:00:00Z', ...extra });
const snapshot = run => ({ 項目: capabilities, 実行: run });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
async function fixture(options = {}) {
  const { 導入操作状態を作成 } = await import('../導入操作状態.mjs');
  let data = snapshot(null), timerId = 0, nextError;
  const calls = [], timers = new Map(), approvals = [], merged = [];
  const 接続済み = ref(true), 操作中 = ref(false);
  const api = async (...args) => { calls.push(args); if (options.api) return options.api(...args); if (args[1] === 'GET' && nextError) { const error = nextError; nextError = null; throw error; } return data; };
  const state = 導入操作状態を作成({ ...options, api, 接続済み, 操作中, 結果反映: value => { merged.push(value); options.結果反映?.(value); }, 確認: text => { approvals.push(text); return true; }, setTimer: callback => { timers.set(++timerId, callback); return timerId; }, clearTimer: id => timers.delete(id), ...(options.確認 ? { 確認: options.確認 } : {}) });
  return { state, calls, timers, approvals, merged, 接続済み, 操作中, setData: value => { data = value; }, failNext: error => { nextError = error; }, async tick() { const entry = timers.entries().next().value; assert.ok(entry, 'ポーリングが予約されている'); timers.delete(entry[0]); entry[1](); await flush(); } };
}

test('接続時は能力のGETのみ。検出状態で権限を推測せず対象外・未接続を拒否する', async () => {
  const f = await fixture();
  assert.equal(await f.state.開始('claude', '導入'), false);
  await f.state.接続(true);
  assert.deepEqual(f.calls.map(([url, method]) => [url, method]), [['api/導入管理', 'GET']]);
  assert.deepEqual(f.state.可能操作('node'), []); assert.deepEqual(f.state.可能操作('unknown'), []);
  for (const [id, action] of [['node', '削除'], ['claude', '削除'], ['claude', 'exec'], ['unknown', '導入']]) assert.equal(await f.state.開始(id, action), false);
  assert.equal(f.approvals.length, 0); assert.equal(f.timers.size, 0);
  f.state.終了();
});

test('導入・再導入・削除は対象と影響を確認し、取り消した場合はAPIを呼ばない', async () => {
  for (const [id, action] of [['claude', '導入'], ['codex', '再導入'], ['codex', '削除']]) {
    const prompts = [];
    const f = await fixture({ 確認: text => { prompts.push(text); return false; } });
    await f.state.接続(true);
    assert.equal(await f.state.開始(id, action, '対象 CLI'), false);
    assert.equal(f.calls.length, 1); assert.equal(f.操作中.value, false);
    assert.match(prompts[0], new RegExp(`対象 CLI を${action}`));
    assert.match(prompts[0], /対象パッケージ:/); assert.match(prompts[0], /パッケージ/); assert.match(prompts[0], /認証情報・利用者設定・会話履歴は削除しません/);
    assert.match(prompts[0], /終了後に対象の各項目で「確認」ボタンと同じ処理を自動実行/);
    assert.match(prompts[0], action === '削除' ? /利用できなくなります/ : /ネットワーク.*取得.*実行/);
    if (action === '再導入') { assert.match(prompts[0], /npm install --global @openai\/codex を1回実行/); assert.match(prompts[0], /事前のアンインストールは行いません/); assert.doesNotMatch(prompts[0], /削除してから|削除後|npm uninstall/); }
    if (action === '削除') { assert.match(prompts[0], /対象パッケージを削除します/); assert.doesNotMatch(prompts[0], /npm install|更新・再導入/); }
    f.state.終了();
  }
});

test('npm 全4パッケージの実際の能力情報を使い、確認は install 1回だけと表示する', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
  const { tmpdir } = require('node:os');
  const { NPM_PACKAGES, npmCapability } = await import('../../../../../導入管理/導入管理.mjs');
  const prefix = await mkdtemp(path.join(tmpdir(), 'diag-npm-confirm-')), root = path.join(prefix, 'lib', 'node_modules');
  t.after(() => rm(prefix, { recursive: true, force: true }));
  for (const [id, pkg] of Object.entries(NPM_PACKAGES)) {
    const directory = path.join(root, ...pkg.split('/'));
    await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: pkg, bin: { [id]: 'cli.js' } }));
    await writeFile(path.join(directory, 'cli.js'), '// fixture');
    const capability = await npmCapability({ id }, { prefix, root }, { platform: 'linux', resolve: async () => null });
    assert.deepEqual(capability.操作, ['再導入', '削除']);
    const f = await fixture(); f.setData({ 項目: [capability], 実行: null }); await f.state.接続(true);
    assert.equal(await f.state.開始(id, '再導入', id), true); assert.equal(f.approvals.length, 1);
    assert.ok(f.approvals[0].includes(`npm install --global ${pkg} を1回実行`));
    assert.match(f.approvals[0], /事前のアンインストールは行いません/); assert.doesNotMatch(f.approvals[0], /削除してから|削除後|npm uninstall/);
    assert.equal(f.calls.filter(([, method]) => method === 'POST').length, 1); f.state.終了();
  }
});

test('開始連打は一度だけ送信し、POST本文なし。進行ログ・確認中・完了までGETで追跡する', async () => {
  let finish, current = snapshot(null);
  const f = await fixture({ api: async (url, method) => method === 'POST' ? new Promise(resolve => { finish = resolve; }) : current });
  // 個別応答を変えられる API に差し替える代わりに、この fixture の後半は可変 snapshot を使用する。
  await f.state.接続(true);
  const start = f.state.開始('claude', '導入', 'Claude Code'); await flush();
  // 同じ項目の連打だけを拒否し、別項目のボタンは押せるまま（並行実行）。
  assert.equal(f.操作中.value, true); assert.equal(await f.state.開始('claude', '導入'), false);
  assert.equal(f.state.項目操作中('claude'), true); assert.equal(f.state.項目操作中('codex'), false);
  assert.equal(f.approvals.length, 1);
  const sent = f.calls.find(([, method]) => method === 'POST');
  assert.equal(sent[0], `api/導入管理/claude/${encodeURIComponent('導入')}`); assert.equal(sent.length, 3);
  current = snapshot(running()); finish(current); assert.equal(await start, true);
  assert.equal(f.state.実行.value.ログ, 'installing\n'); assert.equal(f.timers.size, 1);
  f.state.終了(); assert.equal(f.timers.size, 0);

  const poll = await fixture(); await poll.state.接続(true); poll.setData(snapshot(running())); await poll.state.開始('claude', '導入');
  poll.setData(snapshot(running({ 状態: '確認中', ログ: 'installing\nchecking\n' }))); await poll.tick();
  assert.equal(poll.state.実行.value.状態, '確認中'); assert.equal(poll.操作中.value, true);
  poll.setData({ 項目: [{ ...capabilities[0], 操作: ['再導入', '削除'] }], 実行: completed() }); await poll.tick();
  assert.equal(poll.操作中.value, false); assert.equal(poll.timers.size, 0); assert.equal(poll.merged.length, 1);
  assert.deepEqual(poll.state.可能操作('claude'), ['再導入', '削除']);
  assert.equal(poll.state.実行.value.ログ, 'installing\nchecked\n');
  await poll.state.読込(); assert.equal(poll.merged.length, 1, '完了結果は一度だけマージする');
  assert.equal(poll.calls.filter(([, method]) => method === 'POST').length, 1);
  assert.ok(poll.calls.every(([url]) => !url.startsWith('api/診断')), 'クライアントは確認を二重実行しない');
  poll.state.終了();
});

test('ポーリング失敗でもロック・ログを保ちGETを再試行し、失敗終端まで監視する', async () => {
  const f = await fixture(); await f.state.接続(true); f.setData(snapshot(running())); await f.state.開始('claude', '導入');
  f.failNext(Error('一時通信エラー')); await f.tick();
  assert.match(f.state.エラー.value, /一時通信エラー/); assert.equal(f.操作中.value, true); assert.equal(f.state.実行.value.ログ, 'installing\n');
  f.setData(snapshot(completed({ 状態: '失敗', 結果: { id: 'claude', 状態: '未検出' }, 確認済み: false }))); await f.tick();
  assert.equal(f.操作中.value, false); assert.equal(f.timers.size, 0); assert.equal(f.state.実行.value.状態, '失敗'); assert.equal(f.merged.length, 1);
  f.state.終了();
});

test('開始応答が不明ならPOSTを再送せずGETで受付結果を照合する', async () => {
  let data = snapshot(null); const calls = [];
  const f = await fixture({ api: async (url, method) => { calls.push([url, method]); if (method === 'POST') { data = snapshot(running()); throw Error('応答切断'); } return data; } });
  await f.state.接続(true); assert.equal(await f.state.開始('claude', '導入'), false);
  assert.equal(f.操作中.value, true); assert.equal(await f.state.開始('claude', '導入'), false);
  await f.tick(); assert.equal(f.state.実行.value.実行ID, 'job/1');
  data = snapshot(completed()); await f.tick(); assert.equal(f.操作中.value, false);
  assert.equal(calls.filter(([, method]) => method === 'POST').length, 1); f.state.終了();
});

test('中止は実行IDのDELETEを一度だけ送り、停止未確認が実行中ならロックを保持する', async () => {
  let data = snapshot(null), cancel;
  const calls = [];
  const f = await fixture({ api: async (...args) => { calls.push(args); if (args[1] === 'DELETE') return new Promise(resolve => { cancel = resolve; }); return data; } });
  await f.state.接続(true); data = snapshot(running()); await f.state.開始('claude', '導入');
  const pending = f.state.中止(); assert.equal(await f.state.中止(), false);
  assert.equal(f.state.取消中.value, true); assert.equal(f.timers.size, 0);
  assert.equal(calls.at(-1)[0], 'api/導入管理/job%2F1'); assert.equal(calls.at(-1).length, 3);
  cancel(snapshot(running({ 状態: '停止未確認' }))); await pending;
  assert.equal(f.操作中.value, true); assert.equal(await f.state.中止(), false);
  data = snapshot(completed({ 状態: '中止' })); await f.tick();
  assert.equal(f.操作中.value, false); assert.equal(f.state.実行.value.状態, '中止'); assert.equal(f.timers.size, 0);
  f.state.終了();
});

test('切断・再接続・終了は通信を破棄し、遅れた応答と確認同意は新しい状態を上書きしない', async () => {
  let finish, data = snapshot(null), defer = false;
  const signals = [];
  const f = await fixture({ api: async (_url, _method, signal) => { signals.push(signal); return defer ? new Promise(resolve => { finish = resolve; }) : data; } });
  await f.state.接続(true); defer = true; const old = f.state.読込();
  f.接続済み.value = false; await f.state.接続(false); assert.equal(signals.at(-1).aborted, true);
  defer = false; data = { 項目: [{ id: 'codex', 操作: ['削除'] }], 実行: null };
  f.接続済み.value = true; await f.state.接続(true);
  finish(snapshot(completed())); await old;
  assert.equal(f.state.実行.value, null); assert.deepEqual(f.state.可能操作('claude'), []); assert.equal(f.merged.length, 0);
  defer = true; const destroyed = f.state.読込(); f.state.終了(); current = snapshot(running()); finish(current); await destroyed;
  assert.equal(f.操作中.value, false); assert.equal(f.timers.size, 0); assert.equal(f.state.実行.value, null);

  let approve;
  const confirm = await fixture({ 確認: () => new Promise(resolve => { approve = resolve; }) }); await confirm.state.接続(true);
  const request = confirm.state.開始('claude', '導入'); confirm.接続済み.value = false; await confirm.state.接続(false); approve(true); await request;
  assert.equal(confirm.calls.filter(([, method]) => method === 'POST').length, 0); confirm.state.終了();
});

test('導入操作のロックは既存の個別・一括・書込・全テストにも適用し、結果は1行だけマージする', async () => {
  const { 導入状況状態を作成 } = await import('../導入状況状態.mjs');
  const 操作中 = ref(true), calls = [];
  const state = 導入状況状態を作成({ api: async url => calls.push(url), 接続済み: ref(true), 通知: ref(''), 操作中, 間隔: 0 });
  state.一覧を反映({ 項目: [{ id: 'claude' }, { id: 'node' }], 結果: [{ id: 'claude', 状態: '未検出' }, { id: 'node', 状態: 'OK', バージョン: 'old' }] });
  state.確認済み.value = true; state.書込済み.value = true; state.表示中.value = 'node';
  for (const run of [() => state.個別確認('node'), state.状況確認, state.書込, state.全テスト]) assert.equal(await run(), false);
  assert.deepEqual(calls, []);
  state.操作結果を反映(completed());
  assert.deepEqual(state.結果.value, [{ id: 'claude', 状態: 'OK', バージョン: '2.0' }, { id: 'node', 状態: 'OK', バージョン: 'old' }]);
  assert.equal(state.書込済み.value, false); assert.equal(state.確認済み.value, true); assert.equal(state.表示中.value, 'node');
  assert.equal(state.前回実行日時.value, '2026-10-19T22:00:00Z');
  state.操作結果を反映(completed({ 対象: 'node' })); assert.equal(state.結果.value[1].バージョン, 'old', '対象の一致しない応答を拒否する');
});

test('個別確認と一括確認の完了後に能力を更新し、再確認と書込済みを混同しない', async () => {
  const { 導入状況状態を作成 } = await import('../導入状況状態.mjs');
  let refresh = 0;
  const state = 導入状況状態を作成({ api: async url => url === 'api/診断' ? { 結果: [{ id: 'claude', 状態: 'OK' }] } : { 結果: { id: 'claude', 状態: 'OK' }, 確認済み: true }, 接続済み: ref(true), 通知: ref(''), 間隔: 0, 確認後: async () => { refresh++; } });
  state.一覧を反映({ 項目: [{ id: 'claude' }], 結果: [] });
  await state.個別確認('claude'); assert.equal(refresh, 1);
  await state.状況確認(); assert.equal(refresh, 2); assert.equal(state.書込済み.value, false);
});

test('開始が拒否され実行がない場合は解除後も理由を表示し、GETの重複はまとめる', async () => {
  let read, blockRead = false;
  const f = await fixture({ api: async (_url, method) => {
    if (method === 'POST') throw Error('操作できません');
    if (blockRead) return new Promise(resolve => { read = resolve; });
    return snapshot(null);
  } });
  await f.state.接続(true); await f.state.開始('claude', '導入'); await f.tick();
  assert.equal(f.操作中.value, false); assert.match(f.state.エラー.value, /操作できません/); assert.equal(f.timers.size, 0);
  blockRead = true; const first = f.state.読込(), second = f.state.読込();
  const getCalls = f.calls.filter(([, method]) => method === 'GET').length;
  read(snapshot(null)); await Promise.all([first, second]);
  assert.equal(f.calls.filter(([, method]) => method === 'GET').length, getCalls);
  assert.equal(getCalls, 3, '初期読込・失敗照合・同時GET1件'); f.state.終了();
});

test('中止応答エラーは自動DELETE再送せず、GET照合後の明示再試行を受け付ける', async () => {
  let data = snapshot(null), failed = false;
  const f = await fixture({ api: async (_url, method) => { if (method === 'DELETE') { failed = true; throw Error('中止通信失敗'); } return data; } });
  await f.state.接続(true); data = snapshot(running()); await f.state.開始('claude', '導入');
  assert.equal(await f.state.中止(), false); assert.equal(failed, true); assert.equal(f.state.取消要求済み.value, true);
  await f.tick(); assert.equal(f.state.取消要求済み.value, false); assert.equal(f.操作中.value, true); assert.match(f.state.エラー.value, /再度「中止」/);
  assert.equal(f.calls.filter(([, method]) => method === 'DELETE').length, 1);
  await f.state.中止(); assert.equal(f.calls.filter(([, method]) => method === 'DELETE').length, 2);
  f.state.終了();
});

test('再接続の一覧が新しい個別確認を持つ場合、過去の完了実行で結果・日時・書込状態を巻き戻さない', async () => {
  const { 導入状況状態を作成 } = await import('../導入状況状態.mjs');
  const state = 導入状況状態を作成({ api: async () => {}, 接続済み: ref(true), 通知: ref(''), 間隔: 0 });
  const latest = { id: 'claude', 状態: 'OK', バージョン: 'latest-manual', 確認日時: '2026-10-19T23:00:00Z' };
  state.一覧を反映({ 項目: [{ id: 'claude' }, { id: 'node' }], 結果: [latest, { id: 'node', 状態: 'OK' }], 前回実行日時: latest.確認日時 });
  state.書込済み.value = true;
  const f = await fixture({ 結果反映: state.操作結果を反映 });
  f.setData(snapshot(completed({ 結果: { id: 'claude', 状態: '未検出', バージョン: 'old-managed', 確認日時: '2026-10-19T22:00:00Z' }, 確認済み: true, 前回実行日時: '2026-10-19T22:00:00Z' })));
  await f.state.接続(true);
  assert.deepEqual(state.結果.value[0], latest); assert.equal(state.前回実行日時.value, latest.確認日時);
  assert.equal(state.書込済み.value, true); assert.equal(state.確認済み.value, false);
  // 日時不明の古い実行も、日時が分かる現在の結果より優先しない。
  state.操作結果を反映(completed()); assert.deepEqual(state.結果.value[0], latest);
  f.state.終了();
});

test('新しい対象行を反映しても別項目の後発確認日時を減らさない', async () => {
  const { 導入状況状態を作成 } = await import('../導入状況状態.mjs');
  const state = 導入状況状態を作成({ api: async () => {}, 接続済み: ref(true), 通知: ref(''), 間隔: 0 });
  state.一覧を反映({ 項目: [{ id: 'claude' }, { id: 'node' }], 結果: [{ id: 'claude', 状態: '未検出', 確認日時: '2026-10-19T20:00:00Z' }, { id: 'node', 状態: 'OK', 確認日時: '2026-10-19T23:00:00Z' }], 前回実行日時: '2026-10-19T23:00:00Z' });
  state.操作結果を反映(completed({ 結果: { id: 'claude', 状態: 'OK', バージョン: 'new-managed', 確認日時: '2026-10-19T22:00:00Z' } }));
  assert.equal(state.結果.value[0].バージョン, 'new-managed'); assert.equal(state.結果.value[1].確認日時, '2026-10-19T23:00:00Z');
  assert.equal(state.前回実行日時.value, '2026-10-19T23:00:00Z');
});

test('追加パッケージの確認は一式の対象・導入方式・案内を示し、未対応操作を作らない', async () => {
  const f = await fixture();
  f.setData({ 項目: [{ id: 'ffprobe', パッケージ: 'Gyan.FFmpeg', 操作: ['再導入', '削除'], 関連項目: ['ffmpeg', 'ffprobe', 'ffplay'], 確認説明: 'WinGet の一式を管理します。実行中は変更できません。', 規約URL: 'https://www.gyan.dev/ffmpeg/builds/' }, { id: 'ollama', 操作: [], 理由: 'モデル保持を保証できないため削除しません。' }], 実行: null });
  await f.state.接続(true);
  await f.state.開始('ffprobe', '再導入', 'ffprobe');
  assert.match(f.approvals[0], /Gyan\.FFmpeg/); assert.match(f.approvals[0], /ffmpeg \/ ffprobe \/ ffplay/);
  assert.match(f.approvals[0], /WinGet の一式/); assert.match(f.approvals[0], /https:\/\/www\.gyan\.dev/);
  assert.match(f.approvals[0], /削除してから、再度インストール/); assert.doesNotMatch(f.approvals[0], /npm install/);
  assert.match(f.approvals[0], /対象の各項目で「確認」ボタンと同じ処理/);
  assert.deepEqual(f.state.可能操作('ollama'), []);
  f.state.終了();
});

test('一式の完了結果をまとめて一度だけ反映し、他行・新しい確認・選択は維持する', async () => {
  const { 導入状況状態を作成 } = await import('../導入状況状態.mjs');
  const state = 導入状況状態を作成({ api: () => assert.fail('追加確認 API は呼ばない'), 接続済み: ref(true), 通知: ref('') });
  const all = ['ffmpeg', 'ffprobe', 'ffplay', 'uv'].map(id => ({ id }));
  state.一覧を反映({ 項目: all, 結果: all.map(({ id }) => ({ id, 状態: 'OK', バージョン: id === 'ffprobe' ? 'newer' : 'old', 確認日時: id === 'ffprobe' ? '2026-10-19T23:10:00Z' : '2026-10-19T23:00:00Z' })) });
  state.書込済み.value = true;
  state.操作結果を反映({ 対象: 'ffmpeg', 確認済み: true, 前回実行日時: '2026-10-19T23:05:00Z', 結果一覧: all.map(({ id }) => ({ id, 状態: 'OK', バージョン: 'installed', 確認日時: '2026-10-19T23:05:00Z' })) });
  assert.deepEqual(state.結果.value.map(row => row.バージョン), ['installed', 'newer', 'installed', 'old']);
  assert.equal(state.確認済み.value, true); assert.equal(state.書込済み.value, false); assert.equal(state.表示中.value, null);
});
