// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
async function fixture(t) {
  const previous = { window: globalThis.window, document: globalThis.document };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const scripts = [], configs = [];
  let resets = 0, calls = 0, failure = false;
  const monaco = { editor: { createDiffEditor() {}, defineTheme() {} } };
  const require = (modules, done, reject) => {
    calls++;
    queueMicrotask(() => {
      if (failure) reject({ neededBy: ['vs/editor/editor.main'] });
      else { window.monaco = monaco; done(); }
    });
  };
  require.config = config => configs.push(config);
  require.reset = () => { resets++; failure = false; };
  globalThis.window = {};
  globalThis.document = { createElement: () => ({ remove() { this.removed = true; } }), head: { append: script => scripts.push(script) } };
  const { loadMonaco } = await import(new URL(`../src/components/ファイル閲覧/コード表示.js?test=${++sequence}`, import.meta.url));
  return { scripts, configs, loadMonaco, monaco, install: () => { window.require = require; }, fail: () => { failure = true; }, get calls() { return calls; }, get resets() { return resets; } };
}

test('Monaco: 並行読込を共有し、成功したエディターを再利用する', async t => {
  const f = await fixture(t), first = f.loadMonaco(), second = f.loadMonaco();
  assert.equal(first, second); assert.equal(f.scripts.length, 1);
  assert.match(f.scripts[0].src, /loader\.js\?v=/);
  f.install(); f.scripts[0].onload();
  assert.equal(await first, f.monaco); assert.equal(await f.loadMonaco(), f.monaco);
  assert.equal(f.calls, 1); assert.match(f.configs[0].urlArgs, /^v=/);
});

test('Monaco: ローダー失敗後は再試行で読み直す', async t => {
  const f = await fixture(t), first = f.loadMonaco();
  f.scripts[0].onerror();
  await assert.rejects(first, /ローダー.*再試行/);
  assert.equal(f.scripts[0].removed, true);
  const retry = f.loadMonaco(); assert.notEqual(retry, first); assert.equal(f.scripts.length, 2);
  f.install(); f.scripts[1].onload();
  assert.equal(await retry, f.monaco);
});

test('Monaco: AMDモジュールの失敗状態を解除して再試行する', async t => {
  const f = await fixture(t); f.install(); f.fail();
  await assert.rejects(f.loadMonaco(), /表示ライブラリ.*vs\/editor\/editor.main.*再試行/);
  assert.equal(await f.loadMonaco(), f.monaco);
  assert.equal(f.resets, 1); assert.equal(f.calls, 2); assert.equal(f.scripts.length, 0);
});
