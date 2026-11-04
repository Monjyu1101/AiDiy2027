// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, opendir, realpath, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createScanPool, scanTree } from '../file-scan.mjs';
import { startServer } from '../server.mjs';
import { createCoreConnection } from '../core-connection.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const result = (root, name = 'a.txt') => ({ root, scannedAt: Date.now(), files: 1, directories: 1, entries: 1, elapsedMs: 0,
  truncated: false, truncationReason: null, tree: { n: 'project', d: [], f: [[name, 1, 1000]] } });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'aidiy-scan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('処理の開始・終了を確認できませんでした');
}

test('走査を共有し、TTL・フィルター・明示更新・プロジェクトを分離する', async t => {
  let time = 100, calls = 0;
  const gate = deferred();
  const pool = createScanPool('/project-one', { now: () => time, ttlMs: 1000, scan: async (root, options) => {
    calls++; if (calls === 1) await gate.promise;
    return result(root, options.filter || 'all');
  } });
  t.after(() => pool.close());
  const first = pool.get(), second = pool.get({ fresh: true });
  await tick(); assert.equal(calls, 1);
  gate.resolve(); assert.equal(await first, await second);
  await pool.get(); assert.equal(calls, 1);
  const filtered = await pool.get({ filter: 'backup' }); assert.equal(calls, 2); assert.equal(filtered.tree.f[0][0], 'backup');
  await pool.get(); assert.equal(calls, 2);
  await pool.get({ fresh: true }); assert.equal(calls, 3);
  time += 1001; await pool.get(); assert.equal(calls, 4);
  const other = createScanPool('/project-two', { scan: async root => result(root) }); t.after(() => other.close());
  assert.equal((await other.get()).root, '/project-two');
});

test('grepの対象範囲は通常・backupフィルターの実行中走査とキャッシュから分離する', async t => {
  const runs = [];
  const pool = createScanPool('/project', { ttlMs: 60000, scan: (root, options) => {
    const gate = deferred(); runs.push({ ...gate, options }); return gate.promise;
  } }); t.after(() => pool.close());
  const ordinary = pool.get(), grep = pool.get({ scope: 'grep' }), sharedGrep = pool.get({ scope: 'grep', fresh: true });
  await tick(); assert.equal(runs.length, 1);
  const ordinaryResult = result('/project', 'ordinary');
  runs[0].resolve(ordinaryResult); assert.equal(await ordinary, ordinaryResult);
  await tick(); assert.equal(runs.length, 2, 'grepは通常走査を共有せず、同時走査は1本に保つ');
  assert.equal(runs[1].options.scope, 'grep');
  const grepResult = result('/project', 'grep');
  runs[1].resolve(grepResult); assert.equal(await grep, grepResult); assert.equal(await sharedGrep, grepResult);
  assert.equal(await pool.get(), ordinaryResult); assert.equal(await pool.get({ scope: 'grep' }), grepResult);
  const backup = pool.get({ filter: 'backup' }); await tick(); assert.equal(runs.length, 3);
  assert.equal(runs[2].options.filter, 'backup');
  const backupResult = result('/project', 'backup'); runs[2].resolve(backupResult); await backup;
  assert.equal(await pool.get({ filter: 'backup' }), backupResult);
  assert.equal(await pool.get({ scope: 'grep' }), grepResult);
  const freshGrep = pool.get({ scope: 'grep', fresh: true }); await tick(); assert.equal(runs.length, 4);
  const updatedGrep = result('/project', 'updated-grep'); runs[3].resolve(updatedGrep); assert.equal(await freshGrep, updatedGrep);
  assert.equal(await pool.get(), ordinaryResult); assert.equal(await pool.get({ filter: 'backup' }), backupResult);
});

test('一方の取消では共有処理を保ち、全員取消後は結果をキャッシュしない', async t => {
  const runs = [];
  const pool = createScanPool('/project', { scan: (root, { signal }) => {
    const gate = deferred(); runs.push({ ...gate, signal }); return gate.promise;
  } }); t.after(() => pool.close());
  const a = new AbortController(), b = new AbortController();
  const first = pool.get({ signal: a.signal }), second = pool.get({ signal: b.signal });
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  const secondRejected = assert.rejects(second, { name: 'AbortError' });
  await tick(); a.abort(); await firstRejected; assert.equal(runs[0].signal.aborted, false);
  b.abort(); await secondRejected; assert.equal(runs[0].signal.aborted, true);
  runs[0].resolve(result('/project', 'stale')); await tick();
  const fresh = pool.get(); await tick(); assert.equal(runs.length, 2);
  runs[1].resolve(result('/project', 'current')); assert.equal((await fresh).tree.f[0][0], 'current');
});

test('待機中の取消は走査を開始せず、closeは待機・実行中を終了する', async () => {
  const runs = [];
  const pool = createScanPool('/project', { scan: (root, { signal }) => {
    const gate = deferred(); runs.push({ ...gate, signal }); return gate.promise;
  } });
  const first = pool.get(); const firstRejected = assert.rejects(first, { name: 'AbortError' });
  const controller = new AbortController();
  const queued = pool.get({ filter: 'backup', signal: controller.signal });
  const queuedRejected = assert.rejects(queued, { name: 'AbortError' });
  await tick(); controller.abort(); await queuedRejected; assert.equal(runs.length, 1);
  const queuedAgain = pool.get({ filter: 'backup' }); const queuedAgainRejected = assert.rejects(queuedAgain, { name: 'AbortError' });
  pool.close(); await Promise.all([firstRejected, queuedAgainRejected]);
  assert.equal(runs[0].signal.aborted, true);
  runs[0].resolve(result('/project')); await tick(); assert.equal(runs.length, 1);
  await assert.rejects(pool.get(), { name: 'AbortError' });
});

test('ファイル・空フォルダ・列挙数・深さ・時間の上限を別々に返す', async t => {
  const root = await fixture(t);
  for (const name of ['a', 'b', 'c']) { await mkdir(join(root, name)); await writeFile(join(root, `${name}.txt`), name); }
  await mkdir(join(root, 'a', 'deep'));
  for (const [limits, reason, field, max] of [
    [{ maxFiles: 1 }, 'files', 'files', 1], [{ maxDirectories: 2 }, 'directories', 'directories', 2],
    [{ maxEntries: 2 }, 'entries', 'entries', 2], [{ maxDepth: 0 }, 'depth', 'directories', 1],
    [{ timeMs: 0 }, 'time', 'entries', 0],
  ]) {
    const scan = await scanTree(root, { limits });
    assert.equal(scan.truncated, true); assert.equal(scan.truncationReason, reason); assert.ok(scan[field] <= max);
  }
  const scan = await scanTree(root);
  assert.equal(scan.files, 3); assert.equal(scan.directories, 5); assert.equal(scan.truncated, false);
});

test('取り消し後は列挙を続けず、遅れて開いたディレクトリも閉じる', async t => {
  const root = await fixture(t), controller = new AbortController();
  let opens = 0, stats = 0;
  await writeFile(join(root, 'a.txt'), 'a'); await writeFile(join(root, 'b.txt'), 'b');
  const cancelled = await scanTree(root, { signal: controller.signal, fs: {
    realpath, opendir: async path => { opens++; return opendir(path); },
    lstat: async path => { stats++; controller.abort(); return lstat(path); },
  } });
  assert.equal(cancelled.truncationReason, 'cancelled'); assert.equal(opens, 1); assert.equal(stats, 1);
  const late = deferred(); let closes = 0;
  const timed = await scanTree(root, { limits: { timeMs: 10 }, fs: {
    realpath, lstat, opendir: () => late.promise,
  } });
  assert.equal(timed.truncationReason, 'time');
  late.resolve({ close: async () => { closes++; } }); await tick(); assert.equal(closes, 1);
});

test('HTTP galaxy/latestは走査共有・部分結果の警告・明示更新を保つ', async t => {
  const root = await fixture(t), connection = createCoreConnection(root); connection.offline();
  let calls = 0, requests = 0;
  const gate = deferred();
  const app = await startServer(root, 0, { connection,
    requestHandler: async (req, res, url) => { if (['/api/galaxy', '/api/latest'].includes(url.pathname)) requests++; return false; },
    scanPoolOptions: { scan: async () => { calls++; await gate.promise; return { ...result(root), truncated: true, truncationReason: 'directories' }; } },
  }); t.after(() => app.close());
  const galaxyRequest = fetch(app.url + 'api/galaxy'), latestRequest = fetch(app.url + 'api/latest');
  await until(() => requests === 2); assert.equal(calls, 1); gate.resolve();
  const galaxy = await (await galaxyRequest).json(), latest = await (await latestRequest).json();
  assert.equal(galaxy.truncationReason, 'directories'); assert.equal(latest.scan.truncationReason, 'directories');
  assert.equal(latest.truncated, true); assert.equal(latest.latest.path, 'a.txt'); assert.equal(latest.files[0].path, 'a.txt');
  await fetch(app.url + 'api/galaxy?fresh=1'); assert.equal(calls, 2);
});

test('HTTPの利用者取消とサーバーcloseは走査を終了させる', async t => {
  const root = await fixture(t), connection = createCoreConnection(root); connection.offline();
  const signals = [];
  const app = await startServer(root, 0, { connection, scanPoolOptions: { scan: (root, { signal }) => {
    signals.push(signal); return new Promise(resolve => signal.addEventListener('abort', () => resolve({ ...result(root), truncated: true, truncationReason: 'cancelled' }), { once: true }));
  } } });
  const controller = new AbortController();
  const request = fetch(app.url + 'api/galaxy', { signal: controller.signal });
  const rejected = assert.rejects(request, { name: 'AbortError' });
  await until(() => signals.length === 1); controller.abort(); await rejected; await until(() => signals[0].aborted);
  const pending = fetch(app.url + 'api/latest').catch(() => null);
  await until(() => signals.length === 2);
  await app.close(); assert.equal(signals[1].aborted, true); await pending;
});

test('利用終了は保留grepを503で終え、次の利用へ古いスナップショットを渡さない', async t => {
  const root = await fixture(t), connection = createCoreConnection(root); connection.offline();
  let calls = 0, activeSignal;
  const app = await startServer(root, 0, { connection, scanPoolOptions: { scan: (root, { signal }) => {
    calls++;
    if (calls > 1) return result(root);
    activeSignal = signal;
    return new Promise(resolve => signal.addEventListener('abort', () => resolve({ ...result(root), truncated: true, truncationReason: 'cancelled' }), { once: true }));
  } } }); t.after(() => app.close());
  const pending = fetch(app.url + 'api/grep?q=test'); await until(() => !!activeSignal);
  await fetch(app.url + 'api/connection/disconnect', { method: 'POST' });
  assert.equal((await pending).status, 503); assert.equal(activeSignal.aborted, true);
  await fetch(app.url + 'api/connection/offline', { method: 'POST' });
  assert.equal((await fetch(app.url + 'api/galaxy')).status, 200); assert.equal(calls, 2);
});

test('直接のオフライン開始・オンライン切替も旧利用の走査を無効にする', async t => {
  const root = await fixture(t);
  for (const endpoint of ['offline', 'connect']) {
    let mode = 'offline', calls = 0, activeSignal;
    const connection = {
      state: () => ({ active: true, mode }), close() {},
      offline() { mode = 'offline'; return this.state(); },
      async connect() { mode = 'online'; return this.state(); },
    };
    const app = await startServer(root, 0, { connection, scanPoolOptions: { scan: (root, { signal }) => {
      calls++;
      if (calls > 1) return result(root);
      activeSignal = signal;
      return new Promise(resolve => signal.addEventListener('abort', () => resolve({ ...result(root), truncated: true, truncationReason: 'cancelled' }), { once: true }));
    } } });
    try {
      const pending = fetch(app.url + 'api/latest'); await until(() => !!activeSignal);
      await fetch(app.url + `api/connection/${endpoint}`, { method: 'POST' });
      assert.equal((await pending).status, 503); assert.equal(activeSignal.aborted, true);
      assert.equal((await fetch(app.url + 'api/galaxy')).status, 200); assert.equal(calls, 2);
    } finally { await app.close(); }
  }
});
