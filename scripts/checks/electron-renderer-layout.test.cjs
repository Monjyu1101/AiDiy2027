// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 構成のみを読み取り検証する。サービス・Electron・外部 API は起動しない。
const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '../..');
const exists = path => existsSync(resolve(root, path));
function present(paths) { for (const path of paths) assert.ok(exists(path), `存在する配置: ${path}`); }
function absent(paths) { for (const path of paths) assert.equal(exists(path), false, `旧配置を残さない: ${path}`); }

test('Avatar の実例は components と dialog を src 直下で役割分離する', () => {
  present(['frontend_avatar/src/main.ts', 'frontend_avatar/src/AiDiy.vue',
    'frontend_avatar/src/components/AIコア.vue', 'frontend_avatar/src/components/AIコア_アバター.vue',
    'frontend_avatar/src/components/AIコア_音声処理.ts', 'frontend_avatar/src/components/AIチャット.vue',
    'frontend_avatar/src/components/AIコード.vue', 'frontend_avatar/src/components/ログイン.vue',
    'frontend_avatar/src/dialog/AI設定再起動.vue', 'frontend_avatar/src/dialog/再起動カウントダウン.vue',
    'frontend_avatar/src/dialog/更新ファイル一覧.vue', 'frontend_avatar/src/dialog/ファイル内容表示.vue',
    'frontend_avatar/src/api', 'frontend_avatar/src/utils', 'frontend_avatar/src/_share']);
});

test('Diag は機能内の関連ソースを components に保ち、再起動 dialog を分離する', () => {
  const base = 'backend_diag/ui/src/';
  const features = ['AI設定', 'モデル一覧', 'ウィンドウ', '導入状況', '共通表示', 'Tools', 'AIモデル', '設定モデル', 'アプリ起動', '起動', 'キー設定共通', '外部連携'];
  present(features.map(name => base + 'components/' + name));
  absent(features.map(name => base + name));
  present(['App.vue', 'main.js', 'style.css', 'index.html', 'dialog/AI設定再起動.vue'].map(name => base + name));
  absent([base + 'components/AI設定/AI設定再起動.vue']);
});

test('IDE 共通 renderer は機能別 components と共通 dialog を持つ', () => {
  const base = 'frontend_ide/src/';
  const features = ['ファイル検索', 'ターミナル', '下書き連携', '開発スペース', '共通表示', 'ブラウザ', 'ファイル閲覧', 'コード', '添付ファイル', 'ライブ', 'タスクチーム'];
  present(features.map(name => base + 'components/' + name));
  absent(features.map(name => base + name));
  present(['App.vue', 'main.js', 'style.css', 'dialog/ファイル解析ダイアログ.vue', 'dialog/ファイル履歴ダイアログ.vue', 'dialog/下書き連携ダイアログ.vue', 'dialog/共通ダイアログ.vue'].map(name => base + name));
});

test('Task / Team は専用 bundle と機能内 dialog / windows の境界を保持する', () => {
  const base = 'frontend_ide/src/components/タスクチーム/';
  present(['起動.js', 'api/client.ts', 'components/AIタスク/dialog', 'components/AIタスク/windows', 'components/AIチーム/dialog'].map(name => base + name));
  const config = JSON.parse(readFileSync(resolve(root, 'frontend_ide/tsconfig.taskteam.json'), 'utf8'));
  assert.deepEqual(config.compilerOptions.paths['@taskteam/*'], ['src/components/タスクチーム/*']);
});

for (const [name, base] of [['Discord', 'frontend_channels/discord/panel/'], ['Slack', 'frontend_channels/slack/panel/']]) {
  test(`${name} は Bot と分離した既存 panel 入口と日本語の接続部品を使う`, () => {
    present(['main.js', 'desktop.cjs', 'preload.cjs', 'index.html', 'web-bridge.js', 'style.css', 'components/接続/接続パネル.vue', 'components/接続/機能切替.vue', 'components/接続/パネル状態.js'].map(path => base + path));
    absent(['画面', '接続', 'ライブ'].map(path => base + path));
    if (name === 'Discord') present([base + 'components/ライブ/音声表示.js', base + 'visualizer.js']);
    else absent([base + 'components/ライブ', base + 'visualizer.js']);
  });
}

test('main / preload、拡張ホストと viewer API は renderer 整理で移さない', () => {
  present(['frontend_avatar/electron/main.ts', 'frontend_avatar/electron/preload.ts',
    'backend_diag/起動/electron-main.cjs', 'frontend_ide/desktop.cjs',
    'frontend_ide/host/src', 'frontend_ide/viewer', 'frontend_channels/discord/src/main.ts', 'frontend_channels/slack/src/main.ts']);
});

for (const kind of ['console', 'code', 'live', 'ide', 'task', 'team', 'browser']) {
  test(`${kind} の独立起動入口を省略せず共通 renderer へ接続する`, () => {
    const entry = `frontend_ide/aidiy_${kind}/launch.mjs`;
    present([entry, `frontend_ide/aidiy_${kind}.cmd`]);
    const source = readFileSync(resolve(root, entry), 'utf8');
    assert.match(source, new RegExp(`launch\\(['"]${kind}['"]\\)`));
    assert.match(source, /from ['"]\.\.\/launch\.mjs['"]/);
  });
}

test('11 アプリの所有元を網羅し、互換入口・補助 worker を別 renderer に複製しない', () => {
  present(['backend_diag/diag_main.mjs', 'frontend_avatar/launch.mjs',
    'frontend_channels/discord/panel/launch.mjs', 'frontend_channels/slack/panel/launch.mjs',
    'frontend_ide/host/aidiy_code/launch.mjs', 'frontend_ide/host/aidiy_live/launch.mjs',
    'frontend_ide/ファイル機能/MarkdownPDF-worker.cjs']);
  for (const kind of ['code', 'live']) {
    const source = readFileSync(resolve(root, `frontend_ide/host/aidiy_${kind}/launch.mjs`), 'utf8');
    assert.match(source, /from ['"]\.\.\/\.\.\/launch\.mjs['"]/);
  }
});

test('Diag の検証 fixture も移動後の src/components を参照し、後続整理で旧パスへ戻さない', () => {
  const { readdirSync } = require('node:fs');
  const checks = resolve(root, 'backend_diag/checks');
  const oldPath = /ui\/src\/(?:AI設定|モデル一覧|ウィンドウ|導入状況|共通表示|Tools|AIモデル|設定モデル|アプリ起動|起動|キー設定共通|外部連携)\//;
  for (const name of readdirSync(checks).filter(name => /\.[cm]js$/.test(name))) {
    assert.doesNotMatch(readFileSync(resolve(checks, name), 'utf8'), oldPath, name);
  }
});
