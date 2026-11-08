// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);

test('モジュール配置: 公開入口を維持し、内部処理は担当フォルダから読み込む', async () => {
  for (const entry of ['launch.mjs', 'server.mjs', 'desktop.cjs', '_setup.py', '_cleanup.py',
    'aidiy_console/launch.mjs', 'aidiy_code/launch.mjs', 'aidiy_live/launch.mjs', 'aidiy_ide/launch.mjs']) {
    await access(new URL(entry, root));
  }
  const modules = {
    'デスクトップ/desktop-process.mjs': 'spawnDesktop',
    'デスクトップ/project-profile.cjs': 'projectIdentity',
    'ファイル機能/ai-search.mjs': 'createAISearch',
    'ファイル機能/file-analysis.mjs': 'createFileAnalysis',
    'ファイル機能/file-history.mjs': 'createFileHistory',
    'aidiy_console/console.mjs': 'startConsole',
    'viewer/markdown-preview.mjs': 'renderMarkdownDocument',
  };
  for (const [path, name] of Object.entries(modules)) {
    const module = await import(new URL(path, root));
    assert.equal(typeof (module[name] ?? module.default?.[name]), 'function', path);
    await assert.rejects(access(new URL(path.split('/').at(-1), root)), { code: 'ENOENT' });
  }
});

test('モジュール配置: Electron preload・端末worker・PowerShell補完を配置先から解決する', async () => {
  const desktop = await readFile(new URL('desktop.cjs', root), 'utf8');
  assert.match(desktop, /preload:join\(__dirname,'デスクトップ\/preload\.cjs'\)/);
  for (const path of ['デスクトップ/preload.cjs', 'aidiy_console/console-worker.mjs', 'aidiy_console/powershell-init.ps1']) {
    await access(new URL(path, root));
  }
  const terminal = await readFile(new URL('aidiy_console/console.mjs', root), 'utf8');
  assert.match(terminal, /new URL\('\.\/powershell-init\.ps1', import\.meta\.url\)/);
  const worker = await readFile(new URL('aidiy_console/console-process.mjs', root), 'utf8');
  assert.match(worker, /new URL\('\.\/console-worker\.mjs', import\.meta\.url\)/);
});

test('Vue機能配置: 四画面と共通部品は日本語の担当フォルダを使う', async () => {
  const { readdir } = await import('node:fs/promises');
  const { componentPaths } = await import('./component-paths.mjs');
  const entries = await readdir(new URL('src/', root), { withFileTypes: true });
  assert.deepEqual(entries.filter(entry => entry.isFile()).map(entry => entry.name).sort(), ['App.vue', 'main.js', 'style.css']);
  assert.deepEqual(entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort(), ['components', 'dialog']);
  const featureEntries = await readdir(new URL('src/components/', root), { withFileTypes: true });
  assert.deepEqual(featureEntries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort(),
    ['コード', 'ライブ', 'コンソール', '開発スペース', 'ファイル閲覧', 'ファイル検索', 'ブラウザ', '下書き連携', '共通表示', 'タスクチーム', '添付ファイル'].sort());
  assert.deepEqual((await readdir(new URL('src/dialog/', root))).sort(), ['ファイル解析ダイアログ.vue','ブラウザ解析ダイアログ.vue', 'ファイル履歴ダイアログ.vue', '下書き連携ダイアログ.vue', '共通ダイアログ.vue'].sort());
  const app = await readFile(new URL('src/App.vue', root), 'utf8');
  for (const name of ['CodePanel', 'LivePanel', 'ConsolePanel', 'SpaceView', 'StatusBar', 'DraftHandoffDialog']) {
    assert.ok(app.includes(`'./${componentPaths[name]}'`), name);
  }
  for (const path of Object.values(componentPaths)) await access(new URL(`src/${path}`, root));
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  assert.ok(main.includes("'./components/共通表示/会話表示.css'"));
});

test('Vue機能配置: 相対import・CSS参照と共有サーバーの読込先が存在する', async () => {
  const { readdir } = await import('node:fs/promises');
  async function verify(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) { await verify(url); continue; }
      const source = await readFile(url, 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\s+|@import\s+)["'](\.[^"']+)["']/g)) {
        const candidates = [match[1], `${match[1]}.js`, `${match[1]}.ts`];
        const exists = await Promise.all(candidates.map(path => access(new URL(path, url)).then(() => true, () => false)));
        assert.ok(exists.some(Boolean), `${url.href}: ${match[1]}`);
      }
    }
  }
  await verify(new URL('src/', root));
  const viewer = await readFile(new URL('viewer/server.mjs', root), 'utf8');
  assert.ok(viewer.includes("'../src/components/ファイル閲覧/最新ファイル.js'"));
  const terminal = await readFile(new URL('aidiy_console/console.mjs', root), 'utf8');
  assert.ok(terminal.includes("'../src/components/コンソール/コマンド補完.js'"));
});
