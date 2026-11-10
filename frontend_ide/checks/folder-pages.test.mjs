// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createFolderMonitor } from '../src/components/ファイル閲覧/フォルダ監視.js';
import * as fileDates from '../src/components/ファイル閲覧/ファイル日時.js';
import * as folderPages from '../src/components/ファイル閲覧/フォルダページ構成.js';
import { fileIcon, catppuccinAsset } from '../src/components/ファイル閲覧/ファイルアイコン.js';
import { validConnectionState } from '../src/components/共通表示/接続状態.js';
import { createDraftTargetRegistry } from '../src/components/下書き連携/連携先登録.js';
const require = createRequire(import.meta.url), vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc'), { transformSync } = require('esbuild');
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const tree = () => ({ n: 'project', f: [['root10.md', 10, 1000], ['root2.js', 20, 2000]], d: [
  { n: 'src', f: [['main.js', 30, 3000]], d: [{ n: 'nested', f: [['deep.js', 40, 4000]], d: [] }] },
  { n: 'empty', f: [], d: [] },
] });

function setup(path, { props = {}, modules = {}, globals = {} } = {}) {
  const source = readFileSync(new URL(`../src/${path}.vue`, import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, id: path, filename: path }).errors, []);
  const script = compileScript(descriptor, { id: path, genDefaultAs: 'component' });
  const mounted = [], unmounted = [], emitted = [], module = { exports: {} };
  const window = new EventTarget();
  vm.runInNewContext(transformSync(script.content + '\nmodule.exports=component;', { format: 'cjs' }).code, {
    module, window, document: new EventTarget(), location: { hash: '' }, AbortController, AbortSignal, URLSearchParams, Date,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    require: id => id === 'vue' ? { ...vue, provide() {}, inject: (_key, fallback) => fallback, onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => unmounted.push(callback) }
      : id.endsWith('/ファイル日時.js') ? fileDates
      : id.endsWith('/フォルダページ構成.js') ? folderPages
      : id.endsWith('/フォルダ監視.js') ? { createFolderMonitor }
      : id.endsWith('/接続状態.js') ? { validConnectionState }
      : id.endsWith('/連携先登録.js') ? { createDraftTargetRegistry } : modules[id] || {},
    ...globals,
  });
  const scope = vue.effectScope(), reactive = vue.reactive(props);
  const state = scope.run(() => module.exports.setup(reactive, { expose() {}, emit: (...args) => emitted.push(args) }));
  return { source, state, props: reactive, emitted, async mount() { for (const callback of mounted) await callback(); await flush(); }, dispose() { for (const callback of unmounted) callback(); scope.stop(); } };
}

test('2Dページ: 直下だけをフォルダ先・自然順で表示し、深いファイルは集計に留める', () => {
  const pages = folderPages.indexFolderPages(tree(), { mode: 'since', since: 3000 });
  assert.deepEqual(pages.get('').entries.map(entry => entry.path), ['empty', 'src', 'root2.js', 'root10.md']);
  assert.deepEqual(pages.get('src').entries.map(entry => entry.path), ['src/nested', 'src/main.js']);
  assert.equal(pages.get('').folders.find(entry => entry.name === 'src').count, 2);
  assert.equal(pages.get('').folders.find(entry => entry.name === 'src').marked, 2);
  assert.equal(pages.get('empty').entries.length, 0);
  for (const mode of ['grep', 'ai']) {
    const marked = folderPages.indexFolderPages(tree(), { mode, since: 0, paths: ['src/nested/deep.js'] });
    assert.equal(marked.get('').marked, 1); assert.equal(marked.get('src/nested').files[0].marked, true);
  }
  assert.equal(folderPages.indexFolderPages(tree(), { mode: 'since', since: null }).get('').marked, 0);
});

test('2Dゼブラ: 自然順のファイルだけを交互に塗り、フォルダ数・検索・絞り込みで縞を乱さない', () => {
  const data = tree(); data.f.push(['root1.txt', 1, 1000], ['root3.txt', 3, 3000]);
  const stripes = (source, marks) => folderPages.indexFolderPages(source, marks).get('');
  const expected = [['root1.txt', false], ['root2.js', true], ['root3.txt', false], ['root10.md', true]];
  for (const count of [0, 1, 2]) {
    const page = stripes({ ...data, d: data.d.slice(0, count) }, { mode: 'grep', paths: ['root2.js'] });
    assert.deepEqual(page.files.map(file => [file.name, file.striped]), expected);
    assert.ok(page.folders.every(folder => folder.striped === undefined));
    assert.equal(page.files.find(file => file.name === 'root2.js').marked, true);
  }
  const filtered = stripes({ ...data, f: data.f.filter(([name]) => name !== 'root1.txt') });
  assert.deepEqual(filtered.files.map(file => [file.name, file.striped]), [['root2.js', false], ['root3.txt', true], ['root10.md', false]]);
});

test('2Dページ記憶: 親へ戻ると位置と選択行を復元し、削除・フィルター外は残さない', () => {
  const memory = folderPages.createFolderPageMemory(), entries = folderPages.indexFolderPages(tree()).get('').entries;
  memory.save('', { scrollTop: 360, cursor: 'src' }); memory.save('src', { scrollTop: 50, cursor: 'src/main.js' });
  assert.deepEqual(memory.restore('', entries), { scrollTop: 360, cursor: 'src' });
  assert.deepEqual(memory.restore('', entries, 'root2.js'), { scrollTop: 360, cursor: 'root2.js' });
  assert.equal(memory.restore('', entries.filter(entry => entry.path !== 'src')).cursor, 'empty');
  assert.equal(memory.restore('', []).cursor, '');
  memory.clear(); assert.deepEqual(memory.restore('', entries), { scrollTop: 0, cursor: 'empty' });
});

test('ページをめくる方向: 子・別の枝は前、親・パンくずの祖先・ルートは逆、同階層は静止', () => {
  for (const [previous, next, direction] of [
    ['', 'src', 'forward'], ['src', 'src/nested', 'forward'], ['src/nested', 'src', 'back'],
    ['src/nested/deep', 'src', 'back'], ['src/nested', '', 'back'], ['', '', ''],
    ['src', 'src', ''], ['src-old', 'src', 'forward'], ['src/nested', 'other', 'forward'],
  ]) assert.equal(folderPages.folderPageDirection(previous, next), direction, `${previous} → ${next}`);
});

test('複数ページ: 共通の親経由で戻して進み、深い移動も5枚に収め最後の目的地を落とさない', () => {
  assert.deepEqual(folderPages.folderPageTurnPlan('src/nested', 'other/deep').map(({ path, direction }) => [path, direction]), [
    ['src', 'back'], ['', 'back'], ['other', 'forward'], ['other/deep', 'forward'],
  ]);
  assert.deepEqual(folderPages.folderPageTurnPlan('src', 'src'), []);
  assert.equal(folderPages.folderPageTurnPlan('', 'src/nested').length, 2);
  const destination = Array.from({ length: 128 }, (_value, i) => 'part' + i).join('/');
  const long = folderPages.folderPageTurnPlan('a/b/c/d/e/f', destination);
  assert.equal(long.length, 5); assert.equal(long.at(-1).path, destination);
  assert.ok(long.some(step => step.path === '' && step.direction === 'back'));
  assert.ok(long.some(step => step.skipped > 0));
  assert.equal(long.reduce((total, step) => total + step.skipped + 1, 0), 134);
});

function pageFixture(globals = {}) {
  const h = setup('components/ファイル閲覧/フォルダページ', { props: { tree: tree(), current: '', selected: '', marks: { mode: 'since', since: 1 }, active: true, color: () => '#fff' }, globals });
  const actions = [], body = { scrollTop: 0, focus: options => actions.push(['focus', options]), contains: target => target === body, querySelector: () => ({ scrollIntoView: options => actions.push(['scroll', options]) }) };
  h.state.body.value = body;
  const key = (key, extra = {}) => { const event = { key, target: body, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; h.state.keydown(event); return event; };
  return { ...h, body, actions, key };
}

test('2D部品: フォルダを開く・親へ戻る・ルート・空フォルダとスクロール/カーソル復元', async () => {
  const h = pageFixture();
  try {
    await h.mount(); h.body.scrollTop = 275;
    h.state.select(h.state.entries.value.find(entry => entry.path === 'src'));
    assert.equal(h.emitted.at(-1)[1].path, 'src'); assert.equal(h.emitted.at(-1)[1].type, 'dir');
    const focusBefore = h.actions.filter(([type]) => type === 'focus').length;
    h.props.current = 'src'; await flush(); assert.equal(h.body.scrollTop, 0);
    assert.equal(h.actions.filter(([type]) => type === 'focus').length, focusBefore + 1);
    h.body.scrollTop = 62; h.state.select(h.state.entries.value.find(entry => entry.type === 'file'));
    assert.equal(h.emitted.at(-1)[1].path, 'src/main.js');
    h.state.back(); assert.equal(h.emitted.at(-1)[1].path, '');
    h.props.selected = ''; h.props.current = ''; await flush();
    assert.equal(h.body.scrollTop, 275); assert.equal(h.state.cursor.value, 'src');
    h.state.navigate('src'); h.props.current = 'src'; await flush();
    assert.equal(h.body.scrollTop, 62); assert.equal(h.state.cursor.value, 'src/main.js');
    h.props.current = 'empty'; await flush(); assert.equal(h.state.entries.value.length, 0); assert.equal(h.state.cursor.value, '');
    h.key('Enter'); assert.equal(h.emitted.filter(([name]) => name === 'select').at(-1)[1].path, 'src');
  } finally { h.dispose(); }
});

test('ページをめくる演出: 旧ページの下に移動先を用意し、初回/更新/モード復帰は静止する', async () => {
  const h = pageFixture();
  const finish = (id = h.state.turn.value?.id, name = h.state.pageTurn.value, type = 'animationend') => {
    const sheet = {}; h.state.finishTurn({ target: sheet, currentTarget: sheet, animationName: 'folder-page-' + name, type }, id);
  };
  try {
    await h.mount(); assert.equal(h.state.pageTurn.value, '');
    h.body.scrollTop = 275; h.state.cursor.value = 'src';
    h.props.current = 'src'; await flush(); assert.equal(h.state.pageTurn.value, 'forward');
    assert.deepEqual(Array.from(h.state.layers.value, layer => layer.path), ['src', '']);
    assert.equal(h.state.turn.value.outgoing.scrollTop, 275); assert.equal(h.state.turn.value.outgoing.cursor, 'src');
    assert.equal(h.state.turn.value.incoming.path, 'src'); assert.equal(h.state.turnDuration.value, 800);
    const id = h.state.turn.value.id;
    h.state.finishTurn({ target: {}, currentTarget: {}, animationName: 'folder-page-forward' }, id);
    assert.equal(h.state.pageTurn.value, 'forward', '子のanimationendを使わない');
    finish(); assert.equal(h.state.pageTurn.value, '');
    h.props.tree = tree(); await flush(); assert.equal(h.state.pageTurn.value, '');
    h.props.current = 'src/nested'; await flush(); assert.equal(h.state.pageTurn.value, 'forward');
    h.props.current = 'src'; await flush(); assert.equal(h.state.pageTurn.value, 'back');
    finish(id, 'forward'); assert.equal(h.state.pageTurn.value, 'back');
    h.props.active = false; await flush(); assert.equal(h.state.pageTurn.value, ''); assert.equal(h.state.layers.value.length, 1);
    h.props.active = true; await flush(); assert.equal(h.state.pageTurn.value, '');
    h.props.current = ''; await flush(); assert.equal(h.state.pageTurn.value, 'back');
    const last = h.state.turn.value.id;
    h.props.current = 'src'; h.props.current = 'src/nested'; h.props.current = ''; await flush();
    assert.equal(h.state.turn.value.id, last, '同じ最終パスへ戻る連打で新しい演出を追加しない');
  } finally { h.dispose(); }
});

test('ページ演出: OS設定でもページ繰りを保ち、同時モード/パス切替も旧ページに保存する', async () => {
  const h = pageFixture({ matchMedia: () => ({ matches: true }) });
  try {
    await h.mount(); h.body.scrollTop = 180; h.state.save();
    h.props.current = 'src'; h.props.active = false; await flush(); assert.equal(h.state.pageTurn.value, '');
    h.props.active = true; await flush(); assert.equal(h.body.scrollTop, 0);
    h.props.current = ''; await flush(); assert.equal(h.body.scrollTop, 180); assert.equal(h.state.pageTurn.value, 'back');
    h.props.current = 'src/nested'; await flush(); assert.ok(h.state.turn.value);
  } finally { h.dispose(); }
});

test('複数ページ演出: 戻る→進むの実ページを順に重ね、連打・キャンセルは最終目的地を優先する', async () => {
  const h = pageFixture();
  const finish = (type = 'animationend', id = h.state.turn.value?.id, direction = h.state.pageTurn.value) => {
    const target = {}; h.state.finishTurn({ type, target, currentTarget: target, animationName: 'folder-page-' + direction }, id);
  };
  try {
    await h.mount(); h.props.current = 'src/nested'; await flush();
    assert.equal(h.state.pageTurn.value, 'forward'); assert.equal(h.state.turnDuration.value, 400);
    assert.deepEqual(Array.from(h.state.layers.value, layer => layer.path), ['src/nested', 'src', '']);
    assert.equal(h.state.turn.value.incoming.entries[0].path, 'src/nested');
    const old = h.state.turn.value.id;
    finish(); assert.equal(h.state.turnPath.value, 'src/nested');
    assert.deepEqual(Array.from(h.state.layers.value, layer => layer.path), ['src/nested', 'src']);
    finish('animationend', old, 'forward'); assert.equal(h.state.turnPath.value, 'src/nested', '同じ方向の旧要素も無視');
    finish(); assert.equal(h.state.pageTurn.value, '');
    h.props.current = 'empty'; await flush();
    assert.equal(h.state.pageTurn.value, 'back'); assert.equal(h.state.turnPath.value, 'src');
    finish(); assert.equal(h.state.turnPath.value, ''); assert.equal(h.state.turn.value.outgoing.path, 'src');
    const returning = h.state.turn.value.id;
    finish(); assert.equal(h.state.pageTurn.value, 'forward'); assert.equal(h.state.turnPath.value, 'empty');
    assert.equal(h.state.turn.value.outgoing.path, ''); assert.equal(h.state.turn.value.incoming.entries.length, 0);
    finish('animationend', returning, 'back'); assert.equal(h.state.pageTurn.value, 'forward');
    h.props.current = 'src/main'; h.props.current = 'src/nested'; await flush();
    assert.equal(h.state.turnPath.value, ''); assert.equal(h.state.layers.value[0].path, 'src/nested');
    finish('animationcancel'); assert.equal(h.state.pageTurn.value, ''); assert.equal(h.state.layers.value.length, 1);
    h.props.current = ''; await flush(); assert.equal(h.state.turnPath.value, 'src');
    h.props.active = false; await flush(); finish(); assert.equal(h.state.pageTurn.value, '');
    h.props.active = true; await flush(); assert.equal(h.state.pageTurn.value, '');
  } finally { h.dispose(); }
});

test('ページ演出: 同方向の新しい移動・入力・一覧更新で古いシートを残さない', async () => {
  const h = pageFixture();
  try {
    await h.mount(); h.props.current = 'src'; await flush(); const old = h.state.turn.value.id;
    h.props.current = 'src/nested'; await flush(); const latest = h.state.turn.value.id;
    const target = {};
    for (const type of ['animationend', 'animationcancel']) h.state.finishTurn({ type, target, currentTarget: target, animationName: 'folder-page-forward' }, old);
    assert.equal(h.state.turn.value.id, latest); assert.equal(h.state.layers.value[0].path, 'src/nested');
    h.key('Home'); await flush(); assert.equal(h.state.turn.value, null); assert.equal(h.state.cursor.value, 'src/nested/deep.js');
    h.props.current = 'src'; await flush(); h.props.tree = tree(); await flush(); assert.equal(h.state.turn.value, null);
    h.props.current = ''; await flush(); h.props.marks = { mode: 'grep', paths: ['root2.js'] }; await flush();
    assert.equal(h.state.turn.value, null); assert.equal(h.state.entries.value.find(entry => entry.path === 'root2.js').marked, true);
  } finally { h.dispose(); }
});

test('ページ演出: 表示途中の決定キーは演出だけを終え、隠れた項目を開かない', async () => {
  const h = pageFixture();
  try {
    await h.mount();
    for (const key of ['Enter', ' ', 'ArrowRight']) {
      h.props.current = ''; await flush(); h.props.current = 'src'; await flush();
      const count = h.emitted.filter(([name]) => name === 'select').length; assert.equal(h.key(key).prevented, true);
      assert.equal(h.state.turn.value, null); assert.equal(h.emitted.filter(([name]) => name === 'select').length, count);
      assert.equal(h.emitted.at(-1)[0], 'activity', '決定キーで演出を止めた時も自動探索の手動待機へ入る');
      h.key(key); assert.equal(h.emitted.at(-1)[1].path, 'src/nested');
    }
  } finally { h.dispose(); }
});

test('ページ演出: OS設定を途中変更してもページ繰りを保ち、破棄時には終了する', async () => {
  const query = new EventTarget(); query.matches = false;
  const removed = [], remove = query.removeEventListener.bind(query);
  query.removeEventListener = (...args) => { removed.push(args[0]); remove(...args); };
  const h = pageFixture({ matchMedia: () => query });
  try {
    await h.mount(); h.props.current = 'src/nested'; await flush(); assert.ok(h.state.turn.value);
    query.matches = true; const changed = new Event('change'); changed.matches = true; query.dispatchEvent(changed);
    assert.ok(h.state.turn.value); assert.equal(h.state.layers.value[0].path, 'src/nested');
    h.props.current = ''; await flush(); assert.ok(h.state.turn.value);
    query.matches = false; h.props.current = 'src'; await flush(); assert.ok(h.state.turn.value);
    h.dispose(); assert.equal(h.state.turn.value, null); assert.deepEqual(removed, []);
  } finally { h.dispose(); }
});

test('2D部品: 新規・削除・検索マーク・外部選択・フィルター変更をイベントだけで反映する', async () => {
  const h = pageFixture();
  try {
    await h.mount(); h.props.current = 'src'; h.props.selected = 'src/main.js'; await flush();
    assert.equal(h.state.cursor.value, 'src/main.js');
    const updated = tree(); updated.d[0].f.push(['new.ts', 60, 5000]); h.props.tree = updated; await flush();
    assert.equal(h.state.entries.value.at(-1).path, 'src/new.ts');
    h.props.marks = { mode: 'grep', paths: ['src/new.ts'] }; await flush();
    assert.equal(h.state.entries.value.find(entry => entry.path === 'src/new.ts').marked, true);
    await h.state.move(h.state.entries.value.findIndex(entry => entry.path === 'src/new.ts'));
    assert.equal(h.state.cursor.value, 'src/new.ts');
    h.props.tree = JSON.parse(JSON.stringify(updated)); await flush();
    assert.equal(h.state.cursor.value, 'src/new.ts', '更新通知で開いているファイルへカーソルを巻き戻さない');
    const filtered = tree(); filtered.d[0].f = []; h.props.tree = filtered; h.props.selected = ''; await flush();
    assert.equal(h.state.cursor.value, 'src/nested'); assert.equal(h.state.entries.value.some(entry => entry.path === 'src/main.js'), false);
  } finally { h.dispose(); }
});

test('2D部品: キーボードと戻る、入力中/非表示の無効化、連続ページ切替、破棄', async () => {
  const h = pageFixture();
  try {
    await h.mount(); assert.equal(h.key('End').prevented, true); await flush(); assert.equal(h.state.cursor.value, 'root10.md');
    h.key('ArrowUp'); await flush(); h.key('Enter'); assert.equal(h.emitted.at(-1)[1].path, 'root2.js');
    h.props.selected = 'root2.js'; await flush(); h.key('Escape'); assert.equal(h.emitted.at(-1)[0], 'clear');
    h.key('b', { ctrlKey: true }); assert.equal(h.emitted.at(-1)[0], 'toggle-explorer');
    h.key('r'); assert.equal(h.emitted.at(-1)[0], 'refresh');
    h.props.current = 'src/nested'; await flush(); h.key('Backspace'); assert.equal(h.emitted.at(-1)[1].path, 'src');
    h.key('ArrowLeft', { altKey: true }); assert.equal(h.emitted.at(-1)[1].path, 'src');
    const count = h.emitted.length; h.key('Backspace', { target: { closest: () => ({}) } }); assert.equal(h.emitted.length, count);
    h.props.active = false; await flush(); h.key('Enter'); assert.equal(h.emitted.length, count);
    h.props.current = ''; h.props.active = true; h.props.current = 'src'; h.props.current = 'empty'; await flush();
    assert.equal(h.state.cursor.value, ''); assert.equal(h.body.scrollTop, 0);
    const actions = h.actions.length; h.state.restore(true); h.dispose(); await flush(); assert.equal(h.actions.length, actions);
  } finally { h.dispose(); }
});

test('3Dラッパー: モード切替は同じengineへ停止/再開を伝え、再生成せず破棄を1回行う', async () => {
  const modes = [], engines = [], disposed = [];
  const h = setup('components/開発スペース/宇宙キャンバス', { props: { mode: '3d', layout: () => ({}) }, modules: { '../開発スペース/宇宙描画.js': { createSpace(_canvas, _elements, callbacks) { const engine = { setViewMode: mode => modes.push(mode), dispose: () => disposed.push(engine), callbacks }; engines.push(engine); return engine; } } } });
  await h.mount(); assert.equal(engines.length, 1); assert.equal(h.emitted[0][0], 'ready');
  for (const mode of ['2d', '3d', '2d', '3d']) h.props.mode = mode;
  assert.deepEqual(modes, ['3d', '2d', '3d', '2d', '3d']); assert.equal(engines.length, 1);
  h.dispose(); assert.equal(disposed.length, 1);
});

test('IDE: 3Dが既定。2D切替で利用状態・Console/Code/Live・下書き対象を作り直さない', async () => {
  const h = setup('App', { props: { config: { kind: 'ide' } } });
  try {
    const state = { active: true, mode: 'online', startedAt: 10, project: { path: '/same', name: 'same' } };
    h.state.update(state); assert.equal(h.state.viewMode.value, '3d');
    h.state.base.console = '/console'; h.state.base.code = '/code'; h.state.base.live = '/live';
    h.state.tab.value = 'live'; h.state.panelOpen.value = true; h.state.liveOpen.value = true;
    const request = { text: '下書き' }; h.state.draftRequest.value = request;
    const identity = h.state.state.value;
    h.state.viewMode.value = '2d'; await flush(); h.state.update({ ...state, connected: false });
    assert.equal(h.state.viewMode.value, '2d'); assert.equal(h.state.base.code, '/code'); assert.equal(h.state.base.console, '/console'); assert.equal(h.state.base.live, '/live');
    assert.equal(h.state.draftRequest.value.text, request.text); assert.equal(h.state.panelOpen.value, true); assert.equal(h.state.tab.value, 'live'); assert.equal(h.state.liveOpen.value, true);
    h.state.viewMode.value = '3d'; await flush(); assert.equal(identity.project.path, h.state.state.value.project.path);
    h.state.update({ ...state, startedAt: 11 }); assert.equal(h.state.viewMode.value, '3d'); assert.equal(h.state.base.code, '');
  } finally { h.dispose(); }
});

test('部品境界/配置: プロジェクト右に3D/2D、右端にConsole/Code/Live、共通機能はモード外', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/components/開発スペース/開発スペース.vue', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.ok(app.indexOf('class="ide-project-name"') < app.indexOf('class="ide-view-modes"'));
  assert.ok(app.indexOf('class="ide-view-modes"') < app.indexOf('class="ide-toolbar-right"'));
  assert.match(app, /class="ide-toolbar-right"[^>]*>\s*<LaunchMenu/);
  // 起動項目は Console、Navi の順（別窓・パネル・VR の3か所とも）。項目名に「＋」は付けず、Navi も起動中は全ボタンを無効にして「起動中…」を出す。
  for (const name of ['desktopLaunchItems', 'panelLaunchItems']) {
    const block = app.match(new RegExp(String.raw`const ${name}=computed\(\(\)=>\[[\s\S]*?\n\](?:\.map\([^\n]+\))?\);`))?.[0] ?? ''; assert.ok(block, name);
    assert.ok(block.indexOf("'Console'") >= 0 && block.indexOf("'Console'") < block.indexOf("'Navi'"), 'Console が Navi より前');
    assert.match(block, /class:'navigation-launch',text:launchText\('navigation','Navi'\),disabled:!!launching\.value/);
    assert.doesNotMatch(block, /＋/);
  }
  const vr = app.match(/<div class="all-launchers">[\s\S]*?<\/div>/)?.[0] ?? ''; assert.ok(vr);
  assert.ok(vr.indexOf("'Console'") >= 0 && vr.indexOf("'Console'") < vr.indexOf("'Navi'"), 'Console が Navi より前');
  assert.match(vr, /class="navigation-launch" :disabled="!!launching\|\|allBusy"[^>]*>\{\{ launching==='navigation'\?'起動中…':'Navi' \}\}/);
  assert.doesNotMatch(vr, /＋/);
  assert.match(app, /@opened="navigationOpened"/);
  assert.match(readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue', import.meta.url), 'utf8'), /openingWindow\.value=false;emit\('opened'\)/);
  assert.match(app, /<SpaceView\b[^>]*:key="[^"\n]+" :started-at="state.startedAt" :view-mode="viewMode"/);
  assert.doesNotMatch(app, /<SpaceView[^>]*:key="[^"\n]*viewMode/);
  assert.equal((view.match(/<ViewerSession /g) || []).length, 1); assert.equal((view.match(/<FileExplorer /g) || []).length, 1);
  assert.match(view, /<SpaceCanvas :mode="viewMode"/); assert.match(view, /<FolderPages v-if="scan&&pagesReady" :active="viewMode==='2d'"/);
  assert.match(view, /<ViewerSession v-for="entry in viewerSessions"/);
  const session = readFileSync(new URL('../src/components/ファイル閲覧/閲覧セッション.vue', import.meta.url), 'utf8');
  assert.equal((session.match(/<FileViewer /g) || []).length, 1); assert.doesNotMatch(css, /prefers-reduced-motion/);
  assert.match(css, /animation:folder-page-forward var\(--page-turn-duration,800ms\)/); assert.match(css, /animation:folder-page-back var\(--page-turn-duration,800ms\)/);
  assert.match(css, /@keyframes folder-page-forward\{from\{clip-path:polygon\(/);
  assert.match(css, /@keyframes folder-page-back\{from\{clip-path:polygon\(/);
  assert.match(css, /@keyframes folder-page-edge-forward\{from\{left:100%\}to\{left:calc\(0% - var\(--page-turn-slant\)\)\}/);
  assert.match(css, /@keyframes folder-page-edge-back\{from\{left:calc\(0% - var\(--page-turn-slant\)\)\}to\{left:100%\}/);
  assert.doesNotMatch(css, /rotateY\(/);
  assert.doesNotMatch(readFileSync(new URL('../src/components/ファイル閲覧/フォルダページ.vue', import.meta.url), 'utf8'), /setInterval/);
});

test('2Dページの斜線: 切り抜きと同じ時間/イージングで動き、ページは不透明な重なりを保つ', () => {
  const css = require('postcss').parse(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));
  const values = selector => {
    const result = {}; css.walkRules(rule => { if (rule.selector === selector) rule.walkDecls(declaration => result[declaration.prop] = declaration.value); }); return result;
  };
  for (const direction of ['forward', 'back']) {
    const sheet = values('.folder-page-sheet.page-turn-' + direction), edge = values('.folder-page-turn-edge.page-turn-' + direction);
    assert.equal(sheet.animation.replace('folder-page-' + direction, ''), edge.animation.replace('folder-page-edge-' + direction, ''));
    assert.equal(sheet.animation, `folder-page-${direction} var(--page-turn-duration,800ms) var(--page-turn-curve) both`);
  }
  assert.equal(values('.folder-page-stack').position, 'relative'); assert.equal(values('.folder-page-stack').isolation, 'isolate');
  assert.equal(values('.folder-page-stack')['min-height'], '96px'); assert.equal(values('.folder-page-stack').overflow, 'hidden');
  assert.equal(values('.folder-page-body').position, 'absolute'); assert.equal(values('.folder-page-body').inset, '0');
  assert.equal(values('.folder-page-sheet')['z-index'], '2'); assert.equal(values('.folder-page-underlay')['z-index'], '1');
  assert.equal(values('.folder-page-turn-edge')['z-index'], '3'); assert.equal(values('.folder-page-turn-edge').width, 'var(--page-turn-slant)');
  assert.equal(values('.folder-page-turn-edge').height, '100%'); assert.equal(values('.folder-page-turn-edge')['stroke-width'], '2px');
  assert.equal(values('.folder-page-turn-edge').overflow, 'visible'); assert.equal(values('.folder-page-turn-edge')['pointer-events'], 'none');
  assert.equal(values('.folder-page-turn-edge').top, '0'); assert.equal(values('.folder-page-turn-edge').bottom, '0');
  assert.equal(values('.folder-page-sheet')['pointer-events'], 'none');
});

test('2D斜線の幾何: 進む/戻るの上下端を切り抜きと揃え、狭幅・横長・低いページでも四隅まで覆う', () => {
  const css = require('postcss').parse(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));
  const rules = {}, frames = {};
  css.walkRules(rule => { if (rule.parent.type === 'root') rules[rule.selector] = Object.fromEntries(rule.nodes.map(node => [node.prop, node.value])); });
  css.walkAtRules('keyframes', rule => { frames[rule.params] = Object.fromEntries(rule.nodes.map(frame => [frame.selector, Object.fromEntries(frame.nodes.map(node => [node.prop, node.value]))])); });
  const interpolate = (from, to, progress) => from + (to - from) * progress;
  for (const [width, height] of [[240, 640], [390, 96], [800, 480], [1600, 96], [2560, 1080]]) {
    const length = (source, axis = width) => {
      if (source.includes('var(--page-turn-slant)')) return length(source.replaceAll('var(--page-turn-slant)', rules['.folder-page-stack']['--page-turn-slant']), axis);
      if (source.startsWith('calc(')) {
        const [, left, operator, right] = /^calc\((.+) ([+-]) (.+)\)$/.exec(source);
        return length(left, axis) + (operator === '+' ? 1 : -1) * length(right, axis);
      }
      if (source.startsWith('min(')) return Math.min(...source.slice(4, -1).split(',').map(value => length(value, axis)));
      const match = /^(-?[\d.]+)(%|px)?$/.exec(source); assert.ok(match, source);
      return Number(match[1]) * (match[2] === '%' ? axis / 100 : 1);
    };
    const polygon = source => source.slice('polygon('.length, -1).split(',').map(point => {
      const index = point.lastIndexOf(' ');
      return [length(point.slice(0, index)), length(point.slice(index + 1), height)];
    });
    const slant = length(rules['.folder-page-turn-edge'].width);
    assert.ok(slant > 0 && slant <= 160 && slant <= width * .2);
    for (const direction of ['forward', 'back']) {
      const sheet = frames['folder-page-' + direction], edge = frames['folder-page-edge-' + direction];
      const from = polygon(sheet.from['clip-path']), to = polygon(sheet.to['clip-path']);
      const topIndex = direction === 'forward' ? 1 : 0, bottomIndex = direction === 'forward' ? 2 : 3;
      let previousVisible = width * height;
      for (let step = 0; step <= 20; step++) {
        const progress = step / 20, left = interpolate(length(edge.from.left), length(edge.to.left), progress);
        const points = from.map((point, index) => point.map((value, axis) => interpolate(value, to[index][axis], progress)));
        const top = points[topIndex], bottom = points[bottomIndex];
        assert.ok(Math.abs(top[0] - left - slant) < 1e-8); assert.ok(Math.abs(bottom[0] - left) < 1e-8);
        assert.equal(top[1], 0); assert.equal(bottom[1], height); assert.ok(top[0] > bottom[0], '戻る時も上端が右へ傾く');
        let visible = 0;
        for (let row = 0; row <= 20; row++) {
          const boundary = interpolate(top[0], bottom[0], row / 20);
          const outgoing = direction === 'forward' ? Math.max(0, Math.min(width, boundary)) : width - Math.max(0, Math.min(width, boundary));
          if (step === 0) assert.ok(Math.abs(outgoing - width) < 1e-8, '四隅を含め初めは旧ページ全面');
          if (step === 20) assert.ok(outgoing < 1e-8, '最後は四隅を含め移動先全面');
          visible += outgoing * height / 21;
        }
        assert.ok(visible <= previousVisible + 1e-8, '露出済みの内容を再び覆わない'); previousVisible = visible;
      }
    }
  }
});

test('2D斜線の速度: CSS曲線はゆっくり始まり、終点まで徐々に加速する', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const curve = /--page-turn-curve:cubic-bezier\(([^)]+)\)/.exec(css)[1].split(',').map(Number);
  const [x1, y1, x2, y2] = curve;
  const bezier = (u, first, second) => 3 * (1 - u) ** 2 * u * first + 3 * (1 - u) * u ** 2 * second + u ** 3;
  const progress = time => {
    let low = 0, high = 1;
    for (let index = 0; index < 60; index++) { const u = (low + high) / 2; if (bezier(u, x1, x2) < time) low = u; else high = u; }
    return bezier((low + high) / 2, y1, y2);
  };
  assert.ok(progress(.25) < .15); assert.ok(Math.abs(progress(0)) < 1e-8); assert.ok(Math.abs(progress(1) - 1) < 1e-8);
  let previousSpeed = 0;
  for (let step = 1; step <= 20; step++) {
    const speed = progress(step / 20) - progress((step - 1) / 20);
    assert.ok(speed > previousSpeed, '等時間の移動距離が最後まで増える'); previousSpeed = speed;
  }
});

test('2D配色: 既存AiDiyメニューのクリーム色を専用変数で使い、3Dの黒を維持する', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const menu = readFileSync(new URL('../../frontend_web/src/assets/menu-common.css', import.meta.url), 'utf8');
  for (const color of ['#faf7f2', '#f5f1e8', '#f0ebe0', '#5a4a3a']) { assert.ok(menu.includes(color)); assert.ok(css.includes(color)); }
  assert.match(css, /\.space-view\.mode-2d\{--aidiy-cream-light:/);
  assert.match(css, /\.space-view\{height:100%;background:#000\}/);
  assert.match(css, /\.mode-2d \.folder-pages,\.mode-2d \.folder-page-body,\.mode-2d \.space-loading\{background:var\(--aidiy-cream-light\)/);
});

test('2D文字: ページ本文は18px、日時・件数・補足は16pxで共通ビューアの文字設定を変えない', () => {
  const css = require('postcss').parse(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));
  const rules = selector => {
    const found = []; css.walkRules(rule => { if (rule.selector === selector) found.push(rule); }); return found;
  };
  const values = (selector, property) => rules(selector).flatMap(rule => rule.nodes.filter(node => node.prop === property).map(node => node.value));
  assert.deepEqual(values('.folder-pages', 'font-size'), ['18px']);
  assert.deepEqual(values('.folder-pages', 'line-height'), ['1.5']);
  assert.deepEqual(values('.folder-page-heading button', 'min-height'), ['36px']);
  for (const selector of ['.folder-page-summary', '.folder-page-meta', '.folder-page-reference-note', '.folder-pages footer']) {
    assert.deepEqual(values(selector, 'font-size'), ['16px'], selector);
  }
  assert.deepEqual(values('.folder-page-meta time', 'font-size'), ['inherit']);
  assert.deepEqual(values('.folder-page-meta time', 'display'), ['block'], '狭幅でも日時を隠さない');
  assert.deepEqual(values(':root', '--file-font-size'), ['10px']);
  css.walkDecls('--file-font-size', declaration => assert.equal(declaration.parent.selector, ':root', 'ページ用拡大を共通パネルへ継承しない'));
  css.walkRules(rule => {
    if (!rule.selector.includes('folder-page')) return;
    for (const declaration of rule.nodes) {
      if (declaration.prop === 'font-size' && declaration.value.endsWith('px')) assert.ok(parseFloat(declaration.value) >= 16, `${rule.selector}: ${declaration.value}`);
    }
  });
});

test('2D文字の折り返し: ページ幅で日時を次行へ送り、長い名前と補足を省略せずスクロールできる', () => {
  const css = require('postcss').parse(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));
  const value = (selector, property, parent = 'root') => {
    let result;
    css.walkRules(rule => {
      if (rule.selector === selector && (parent === 'root' ? rule.parent.type === 'root' : rule.parent.name === parent)) {
        rule.walkDecls(property, declaration => result = declaration.value);
      }
    });
    return result;
  };
  assert.equal(value('.folder-pages', 'container'), 'folder-page / size');
  assert.equal(value('.folder-pages', 'overflow'), 'auto');
  assert.equal(value('.folder-page-entry', 'display'), 'grid');
  assert.equal(value('.folder-page-entry', 'min-height'), '48px');
  assert.equal(value('.folder-page-entry', 'grid-template-columns'), '32px minmax(0,1fr) max-content');
  assert.equal(value('.folder-page-entry', 'grid-template-columns', 'container'), '32px minmax(0,1fr)');
  assert.equal(value('.folder-page-meta', 'grid-column', 'container'), '2');
  assert.equal(value('.folder-page-meta', 'text-align', 'container'), 'left');
  for (const selector of ['.folder-page-name', '.folder-page-meta', '.folder-page-reference-note', '.folder-pages footer']) {
    assert.equal(value(selector, 'overflow-wrap'), 'anywhere', selector);
    assert.equal(value(selector, 'text-overflow'), undefined, selector);
  }
  for (const selector of ['.folder-page-body', '.folder-page-heading nav', '.folder-page-reference-note', '.folder-pages footer']) {
    assert.equal(value(selector, 'overflow'), 'auto', selector);
  }
  assert.equal(value('.folder-page-body', 'min-height'), '96px', '窮屈な高さでも一覧を潰さない');
  assert.equal(value('.folder-page-heading nav', 'max-height', 'container'), '36px');
  const compact = '.folder-page-summary,.folder-page-reference-note,.folder-pages footer';
  assert.equal(value(compact, 'max-height', 'container'), '30px');
  assert.equal(value(compact, 'overflow', 'container'), 'auto');
  const queries = []; css.walkAtRules('container', rule => queries.push(rule.params));
  assert.ok(queries.includes('folder-page (max-width:520px)'), '画面全体でなくページの実幅を使う');
  assert.ok(queries.includes('folder-page (max-height:360px)'), 'プレビューを除いた高さで補足欄を抑える');
});

test('2Dファイル行間: 16pxのサイズ・日時2行を48pxへ収め、狭幅は省略せず折り返す', () => {
  // CSS値から通常行の必要高さを計算する。実ブラウザーのレイアウト測定ではない。
  const css = require('postcss').parse(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));
  const values = (selector, parent = 'root') => {
    const result = {};
    css.walkRules(rule => { if (rule.selector === selector && (parent === 'root' ? rule.parent.type === 'root' : rule.parent.name === parent)) rule.walkDecls(decl => result[decl.prop] = decl.value); });
    return result;
  };
  const row = values('.folder-page-entry'), meta = values('.folder-page-meta'), date = values('.folder-page-meta time');
  const minHeight = parseFloat(row['min-height']), border = parseFloat(row['border-bottom']);
  const font = parseFloat(values('.folder-pages')['font-size']), nameHeight = font * Number(values('.folder-pages')['line-height']);
  const metaHeight = parseFloat(meta['font-size']) * Number(meta['line-height']);
  assert.equal(date['margin-top'], '0'); assert.equal(date.display, 'block');
  for (const padding of [row.padding, values('.folder-page-entry', 'media').padding]) {
    const outside = parseFloat(padding) * 2 + border;
    assert.equal(Math.max(minHeight, nameHeight + outside, metaHeight + outside), 48, 'フォルダ通常行');
    assert.equal(Math.max(minHeight, nameHeight + outside, metaHeight * 2 + outside), 48, 'ファイル補足2行');
  }
  const narrow = values('.folder-page-meta', 'container');
  assert.equal(narrow.display, 'flex'); assert.equal(narrow['flex-wrap'], 'wrap'); assert.equal(narrow['column-gap'], '12px');
  assert.equal(values('.folder-page-entry', 'container')['row-gap'], '0');
  for (const selector of ['.folder-page-entry', '.folder-page-meta', '.folder-page-meta time']) {
    assert.equal(values(selector).height, undefined); assert.equal(values(selector).overflow, undefined, '長い内容は切り捨てない');
  }
});

test('2D行色: フォルダを少し濃く、ファイルを微かな縞にし、操作状態と文字の判読性を優先する', () => {
  const css = require('postcss').parse(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));
  const rules = new Map();
  css.walkRules(rule => { if (rule.parent.type === 'root') rules.set(rule.selector, Object.fromEntries(rule.nodes.map(decl => [decl.prop, decl.value]))); });
  const folder = '.mode-2d .folder-page-entry.folder', stripe = '.mode-2d .folder-page-entry.striped';
  assert.equal(rules.get(folder).background, '#f3edde');
  assert.equal(rules.get('.folder-page-entry.folder')['border-radius'], '0');
  assert.equal(rules.get('.folder-page-entry.folder')['box-shadow'], 'none'); assert.equal(rules.get(stripe).background, 'var(--aidiy-cream-base)');
  assert.equal(rules.get(folder)['border-color'], '#d8d0c4');
  const selectors = [...rules.keys()];
  for (const state of [':hover', '[data-cursor=true]', '.selected']) {
    const selector = '.mode-2d .folder-page-entry' + state;
    assert.ok(selectors.indexOf(selector) > selectors.indexOf(folder)); assert.ok(selectors.indexOf(selector) > selectors.indexOf(stripe));
  }
  assert.ok(selectors.indexOf('.mode-2d .folder-page-entry.selected') > selectors.indexOf('.mode-2d .folder-page-entry[data-cursor=true]'));
  assert.equal(rules.get('.mode-2d .folder-page-entry[data-cursor=true]')['box-shadow'], 'inset 3px 0 #856848');
  assert.equal(rules.get('.mode-2d .folder-page-entry.marked,.mode-2d .folder-page-mark').color, '#7a4908');
  assert.equal(rules.get('.mode-2d .folder-page-body:focus-visible,.mode-2d .folder-page-heading button:focus-visible').outline, '2px solid #856848');
  const luminance = hex => [1, 3, 5].reduce((sum, index, component) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return sum + [.2126, .7152, .0722][component] * (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  }, 0);
  const folderColors = rules.get(folder).background.match(/#[\da-f]{6}/g);
  const backgrounds = ['#faf7f2', '#f5f1e8', ...folderColors, ...[':hover', '[data-cursor=true]', '.selected'].map(state => rules.get('.mode-2d .folder-page-entry' + state).background)];
  for (const background of backgrounds) for (const foreground of ['#5a4a3a', rules.get(folderColors.includes(background) ? '.mode-2d .folder-page-entry.folder .folder-page-meta' : '.mode-2d .folder-page-meta').color, '#7a4908']) {
    assert.ok((luminance(background) + .05) / (luminance(foreground) + .05) >= 4.5, `${foreground} on ${background}`);
  }
  assert.ok(folderColors.every(color => luminance(color) < luminance('#f5f1e8')), 'フォルダとファイルの境目を区別する');
});

test('2Dカード: 多数・長い日本語名もフォルダ先の同じ選択順を保ち、ファイルと空表示を残す', async () => {
  const { app, root, props, emitted, walk, find, warnings } = await mountedPages();
  const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => all(child, predicate))];
  const rows = () => all(find('folder-page-body'), element => element.props.class?.split(' ').includes('folder-page-entry'));
  const longName = '非常に長い日本語の設計資料と開発手順'.repeat(5);
  try {
    props.tree = { n: 'project', d: Array.from({ length: 80 }, (_, i) => ({ n: i === 0 ? longName : `フォルダ${i}`, d: [], f: [] })), f: [['README.md', 10, 1000]] };
    await flush();
    assert.equal(rows().length, 81);
    assert.ok(rows().slice(0, 80).every(row => row.props.class.split(' ').includes('folder')));
    assert.equal(rows().at(-1).props.title, 'README.md');
    const folder = rows().find(row => row.props.title === longName);
    assert.equal(walk(folder, element => element.props.class === 'folder-page-name').text, longName);
    folder.props.onClick(); await flush(); assert.equal(props.current, longName);
    assert.ok(find('folder-page-empty'));
    walk(find('folder-page-heading'), element => element.props.title?.startsWith('親フォルダ')).props.onClick(); await flush();
    assert.equal(props.current, '');
    assert.equal(rows().find(row => row.props['data-cursor']).props.title, longName);
    rows().at(-1).props.onClick(); await flush();
    assert.equal(emitted.at(-1).type, 'file'); assert.equal(props.selected, 'README.md');
    props.tree = { n: 'project', d: [], f: [] }; props.selected = ''; await flush();
    assert.equal(rows().length, 0); assert.ok(find('folder-page-empty')); assert.deepEqual(warnings, []);
  } finally { app.unmount(); }
});

test('共通画面: 2Dの遅延初期化・共通ビューアEsc・入力中の戻る抑止・軌跡バー高さ追従', async () => {
  const calls = [], styles = [], observers = []; let bottom = 208;
  const h = setup('components/開発スペース/開発スペース', { props: { viewMode: '3d', startedAt: 1 }, globals: {
    getComputedStyle: () => ({ getPropertyValue: () => '78px' }),
    ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { calls.push('disconnect'); } },
  } });
  h.state.root.value = { querySelector: () => ({ getBoundingClientRect: () => ({ bottom }) }), style: { setProperty: (...args) => styles.push(args) } };
  const engine = { marks() {}, route() {}, refresh() {}, clear: () => calls.push('clear'), ascend: level => calls.push(['ascend', level]) };
  h.state.ready(engine);
  try {
    await h.mount(); assert.equal(h.state.pagesReady.value, false);
    assert.deepEqual(styles.at(-1), ['--folder-page-top', '216px']);
    bottom = 126; observers[0].callback(); assert.deepEqual(styles.at(-1), ['--folder-page-top', '134px']);
    h.props.viewMode = '2d'; await flush(); assert.equal(h.state.pagesReady.value, true);
    h.state.selected.value = { path: 'src/main.js' }; h.state.trail.value = ['src'];
    const key = (key, extra = {}) => { const event = { key, preventDefault() { this.prevented = true; }, target: { closest: () => null }, ...extra }; h.state.pageKey(event); return event; };
    assert.equal(key('Escape').prevented, true); assert.equal(calls.at(-1), 'clear');
    h.state.selected.value = null; key('Backspace'); assert.deepEqual(calls.at(-1), ['ascend', 0]);
    const count = calls.length; key('Backspace', { target: { closest: () => ({}) } }); key('Escape', { defaultPrevented: true }); assert.equal(calls.length, count);
    h.props.viewMode = '3d'; await flush(); key('Escape'); assert.equal(calls.length, count); assert.equal(h.state.pagesReady.value, true);
  } finally { h.dispose(); }
  assert.equal(calls.at(-1), 'disconnect');
});

async function mountedPages(globals = {}) {
  const refreshSource = parse(readFileSync(new URL('../src/components/共通表示/再読込ボタン.vue', import.meta.url), 'utf8')).descriptor;
  const refreshScript = compileScript(refreshSource, { id: 'mounted-refresh', genDefaultAs: 'component', inlineTemplate: true });
  const refreshModule = { exports: {} };
  vm.runInNewContext(transformSync(refreshScript.content + '\nmodule.exports=component;', { format: 'cjs' }).code, {
    module: refreshModule, require: id => id === 'vue' ? vue : assert.fail(id),
  });
  // アイコンも実際のSFCをコンパイルし、旧ページ・経由ページを含む表示を検証する。
  const iconSource = parse(readFileSync(new URL('../src/components/ファイル閲覧/ファイル種別アイコン.vue', import.meta.url), 'utf8')).descriptor;
  const iconScript = compileScript(iconSource, { id: 'mounted-icon', genDefaultAs: 'component', inlineTemplate: true });
  const iconModule = { exports: {} };
  vm.runInNewContext(transformSync(iconScript.content + '\nmodule.exports=component;', { format: 'cjs' }).code, {
    module: iconModule, require: id => id === 'vue' ? vue : { fileIcon },
  });
  const { descriptor } = parse(readFileSync(new URL('../src/components/ファイル閲覧/フォルダページ.vue', import.meta.url), 'utf8'));
  const script = compileScript(descriptor, { id: 'mounted-pages', genDefaultAs: 'component', inlineTemplate: true });
  const module = { exports: {} };
  vm.runInNewContext(transformSync(script.content + '\nmodule.exports=component;', { format: 'cjs' }).code, {
    module, Date, setTimeout:()=>1,clearTimeout(){},require: id => id === 'vue' ? vue : id.endsWith('再読込ボタン.vue') ? refreshModule.exports : id.endsWith('ファイル日時.js') ? fileDates : id.endsWith('ファイル種別アイコン.vue') ? iconModule.exports : folderPages, ...globals,
  });
  const walk = (element, predicate) => predicate(element) ? element : (element.children || []).map(child => walk(child, predicate)).find(Boolean);
  const node = type => ({ type, children: [], props: {}, scrollTop: 0,
    focus() { this.focused = true; }, contains(target) { return !!walk(this, element => element === target); },
    querySelector() { return walk(this, element => element.props['data-cursor'] === true); }, scrollIntoView() {},
  });
  const renderer = vue.createRenderer({
    createElement: node, createText: text => ({ ...node('text'), text }), createComment: text => ({ ...node('comment'), text }),
    insert(element, parent, anchor) {
      if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1);
      element.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(element); else parent.children.splice(index, 0, element);
    },
    remove(element) { if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1); element.parent = null; },
    parentNode: element => element.parent, nextSibling: element => element.parent?.children[element.parent.children.indexOf(element) + 1],
    patchProp: (element, key, _previous, next) => element.props[key] = next,
    setText: (element, text) => element.text = text, setElementText: (element, text) => { element.text = text; element.children = []; },
  });
  const props = vue.reactive({ active: true, tree: tree(), current: '', selected: '', marks: { mode: 'since', since: 1 } });
  const emitted = [], root = node('root');
  const app = renderer.createApp({ render: () => vue.h(module.exports, { ...props, onSelect: entry => { emitted.push(entry); if (entry.type === 'dir') { props.current = entry.path; props.selected = ''; } else props.selected = entry.path; } }) });
  const warnings = []; app.config.warnHandler = message => warnings.push(message);
  app.mount(root); await flush();
  const find = className => walk(root, element => element.props.class?.split(' ').includes(className));
  return { app, root, props, emitted, warnings, walk, find };
}

test('実マウント: 先頭ページは親ボタンを出さず、子から戻る操作とルートのパンくずは保つ', async () => {
  const { app, root, props, emitted, walk, find, warnings } = await mountedPages();
  const parent = () => walk(root, element => element.props.title?.startsWith('親フォルダ'));
  try {
    assert.equal(parent(), undefined);
    const rootCrumb = walk(find('folder-page-heading'), element => element.type === 'button' && element.text === 'project');
    assert.equal(rootCrumb.props['aria-current'], 'location');
    const count = emitted.length;
    find('folder-pages').props.onKeydown({ key: 'Backspace', preventDefault() {}, stopPropagation() {} });
    assert.equal(emitted.length, count, 'ルートより上へ移動しない');
    walk(root, element => element.props.title === 'src').props.onClick(); await flush();
    assert.ok(parent()); assert.equal(parent().props.disabled, undefined);
    parent().props.onClick(); await flush();
    assert.equal(props.current, ''); assert.equal(parent(), undefined);
    assert.equal(rootCrumb.props['aria-current'], 'location'); assert.deepEqual(warnings, []);
  } finally { app.unmount(); }
});

test('実マウント: ファイルの縞とメタデータを通常・旧・経由ページへ共通表示し、検索と選択を保つ', async () => {
  const { app, root, props, walk, warnings } = await mountedPages();
  const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => all(child, predicate))];
  const assertRows = layer => {
    const rows = all(layer, element => element.props.class?.split(' ').includes('folder-page-entry'));
    let fileIndex = 0;
    for (const row of rows) {
      const classes = row.props.class.split(' ');
      if (classes.includes('folder')) { assert.equal(classes.includes('striped'), false); continue; }
      assert.equal(classes.includes('striped'), fileIndex++ % 2 === 1);
      assert.ok(walk(row, element => element.props.class === 'folder-page-size').text);
      assert.ok(walk(row, element => element.type === 'time').props.datetime);
    }
  };
  try {
    props.tree.d[0].f.push(['other.txt', 42, 4000]); props.marks = { mode: 'grep', paths: ['root10.md'] }; await flush();
    const file = walk(root, element => element.props.title === 'root10.md');
    file.props.onClick(); await flush();
    assert.ok(['striped', 'marked', 'selected'].every(name => file.props.class.split(' ').includes(name)));
    props.current = 'src/nested'; await flush();
    const layers = all(root, element => element.props['data-page-layer']); assert.equal(layers.length, 3);
    for (const layer of layers) assertRows(layer);
    const outgoing = layers.find(layer => layer.props['data-page-layer'] === 'outgoing');
    const previousFile = walk(outgoing, element => element.props.title === 'root10.md');
    assert.ok(['striped', 'marked', 'selected'].every(name => previousFile.props.class.split(' ').includes(name)));
    assert.deepEqual(warnings, []);
  } finally { app.unmount(); }
});

test('実マウント: 2DのDOMを外してもページ位置・選択行を保持し、同じ部品で復帰する', async () => {
  const { app, root, props, warnings, walk, find } = await mountedPages();
  try {
    const body = find('folder-page-body'); body.scrollTop = 180; body.props.onScroll();
    assert.doesNotMatch(body.props.class, /page-turn-/);
    const file = walk(root, element => element.props.title === 'root2.js'); file.props.onClick(); await flush();
    assert.equal(props.selected, 'root2.js');
    props.active = false; await flush(); assert.equal(find('folder-page-body'), undefined);
    props.active = true; await flush();
    assert.equal(find('folder-page-body').scrollTop, 180);
    assert.doesNotMatch(find('folder-page-body').props.class, /page-turn-/);
    assert.equal(walk(root, element => element.props.title === 'root2.js').props['aria-selected'], true);
    walk(root, element => element.props.title === 'src').props.onClick(); await flush();
    assert.equal(props.current, 'src'); assert.equal(find('folder-page-body').scrollTop, 0);
    const childBody = find('folder-page-body'); assert.notEqual(childBody, body); assert.match(find('folder-page-sheet').props.class, /page-turn-forward/);
    walk(root, element => element.props.title === 'src/nested').props.onClick(); await flush();
    const nestedBody = find('folder-page-body'); assert.notEqual(nestedBody, childBody); assert.match(find('folder-page-sheet').props.class, /page-turn-forward/);
    childBody.props.onAnimationend({ target: childBody, currentTarget: childBody, animationName: 'folder-page-forward' }); await flush();
    assert.match(find('folder-page-sheet').props.class, /page-turn-forward/);
    walk(root, element => element.props.title?.startsWith('親フォルダ')).props.onClick(); await flush();
    assert.equal(props.current, 'src'); assert.match(find('folder-page-sheet').props.class, /page-turn-back/);
    walk(root, element => element.props.title?.startsWith('親フォルダ')).props.onClick(); await flush();
    assert.equal(props.current, ''); assert.equal(find('folder-page-body').scrollTop, 180);
    assert.equal(walk(root, element => element.props.title === 'src').props['aria-selected'], true);
    assert.equal(find('folder-page-body').focused, true); assert.match(find('folder-page-sheet').props.class, /page-turn-back/);
    const longName = '長い日本語ファイル名と空白なしの名前'.repeat(12) + '.txt';
    props.tree.f.push([longName, 2048, 1000]); await flush();
    const longEntry = walk(root, element => element.props.title === longName);
    assert.equal(walk(longEntry, element => element.props.class === 'folder-page-name').text, longName);
    assert.equal(walk(longEntry, element => element.type === 'time').props.datetime, new Date(1000).toISOString());
    longEntry.props.onClick(); await flush(); assert.equal(props.selected, longName);
    assert.deepEqual(warnings, []);
  } finally { app.unmount(); }
});


test('実マウント: 移動先を下に保ち、旧ページの内容/位置・斜線・単一の操作リストを検証する', async () => {
  const { app, root, props, emitted, warnings, walk, find } = await mountedPages();
  const layer = kind => walk(root, element => element.props['data-page-layer'] === kind);
  const click = path => walk(layer('live'), element => element.props.title === path).props.onClick();
  const finish = (sheet, type = 'animationend') => sheet.props[type === 'animationcancel' ? 'onAnimationcancel' : 'onAnimationend']({ type, target: sheet, currentTarget: sheet, animationName: 'folder-page-' + (sheet.props.class.includes('page-turn-back') ? 'back' : 'forward') });
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  try {
    const original = layer('live'); original.scrollTop = 240; original.props.onScroll();
    click('src'); await flush();
    const first = layer('outgoing'), destination = layer('live');
    assert.equal(destination.props['data-page-path'], 'src'); assert.equal(destination.scrollTop, 0); assert.equal(destination.focused, true);
    assert.equal(first.props['data-page-path'], ''); assert.equal(first.scrollTop, 240);
    assert.equal(walk(first, element => element.props.title === 'src').props['data-cursor'], true);
    assert.equal(walk(first, element => element.props.title === 'root2.js').props.role, undefined);
    assert.equal(walk(destination, element => element.props.title === 'src/main.js').props.role, 'option');
    assert.equal(first.props['aria-hidden'], true); assert.equal(first.props.inert, true); assert.equal(first.props.tabindex, undefined);
    assert.equal(descendants(first).filter(element => element.props.id).length, 0, '表示専用シートはIDを複製しない');
    assert.equal(descendants(root).filter(element => element.props.role === 'listbox').length, 1);
    const count = emitted.length; walk(first, element => element.props.title === 'root2.js').props.onClick();
    assert.equal(emitted.length, count, '表示専用シートから選択を送信しない');
    assert.ok(find('folder-page-turn-edge').props.class.includes('page-turn-forward'));
    const edge = find('folder-page-turn-edge'), line = walk(edge, element => element.type === 'line');
    assert.equal(edge.type, 'svg'); assert.equal(edge.props.viewBox, '0 0 100 100'); assert.equal(edge.props.preserveAspectRatio, 'none');
    assert.equal(edge.props['aria-hidden'], 'true'); assert.equal(edge.props.focusable, 'false');
    assert.deepEqual([line.props.x1, line.props.y1, line.props.x2, line.props.y2], ['100', '0', '0', '100']);
    assert.equal(line.props['vector-effect'], 'non-scaling-stroke');
    assert.equal(find('folder-page-stack').props.style['--page-turn-duration'], '800ms');
    finish(first); await flush(); assert.equal(layer('outgoing'), undefined); assert.equal(find('folder-page-turn-edge'), undefined);
    assert.equal(layer('live'), destination, '演出終了で移動先のDOM/フォーカス/スクロールを作り直さない');
    destination.scrollTop = 76; destination.props.onScroll(); click('src/main.js'); await flush();
    props.current = ''; props.selected = ''; await flush();
    assert.equal(layer('live').scrollTop, 240); assert.equal(layer('outgoing').scrollTop, 76);
    assert.ok(find('folder-page-turn-edge').props.class.includes('page-turn-back'));
    find('folder-page-stack').props.onWheelCapturePassive(); await flush();
    assert.equal(layer('outgoing'), undefined); assert.equal(layer('live').scrollTop, 240, '手動スクロールで演出だけを終える');
    click('src'); await flush(); assert.equal(layer('live').scrollTop, 76);
    const stale = layer('outgoing'); click('src/nested'); await flush(); const latest = layer('outgoing');
    assert.notEqual(stale, latest); finish(stale); finish(stale, 'animationcancel'); await flush();
    assert.equal(layer('outgoing'), latest); assert.equal(layer('live').props['data-page-path'], 'src/nested');
    find('folder-page-stack').props.onPointerdownCapture(); finish(latest); await flush();
    assert.equal(layer('outgoing'), undefined, '押してから離すまでに演出が終了した場合');
    const clickEvent = { preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    find('folder-page-stack').props.onClickCapture(clickEvent); await flush();
    assert.equal(clickEvent.prevented, true); assert.equal(clickEvent.stopped, true, '隠れた移動先の行へクリックを伝えない');
    assert.equal(layer('outgoing'), undefined); assert.equal(find('folder-page-turn-edge'), undefined);
    const visibleClick = { preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    find('folder-page-stack').props.onPointerdownCapture();
    find('folder-page-stack').props.onClickCapture(visibleClick); assert.equal(visibleClick.stopped, undefined);
    props.current = 'src'; await flush(); find('folder-page-stack').props.onPointerdownCapture();
    find('folder-page-stack').props.onPointercancelCapture(); finish(layer('outgoing')); await flush();
    find('folder-page-stack').props.onClickCapture(visibleClick); assert.equal(visibleClick.stopped, undefined, '取り消したポインターを次のクリックへ持ち越さない');
    assert.deepEqual(warnings, []);
  } finally { app.unmount(); }
});

test('実マウント: 一覧更新・外部選択・移動が同じtickでも旧ページのカーソルを上書きしない', async () => {
  const { app, root, props, warnings, walk } = await mountedPages();
  const live = () => walk(root, element => element.props['data-page-layer'] === 'live');
  const selected = () => walk(live(), element => element.props['data-cursor'] === true)?.props.title;
  try {
    for (const dataFirst of [true, false]) {
      walk(live(), element => element.props.title === 'root10.md').props.onClick(); await flush();
      live().scrollTop = 220; live().props.onScroll();
      if (dataFirst) { props.tree = tree(); props.selected = 'src/main.js'; props.current = 'src'; }
      else { props.current = 'src'; props.selected = 'src/main.js'; props.tree = tree(); }
      await flush();
      assert.equal(selected(), 'src/main.js'); assert.equal(live().scrollTop, 0);
      assert.equal(walk(root, element => element.props['data-page-layer'] === 'outgoing'), undefined, '同時更新では古い一覧を重ねない');
      props.selected = ''; props.current = ''; await flush();
      assert.equal(selected(), 'root10.md', '移動先のカーソルを旧ページの記憶へ保存しない'); assert.equal(live().scrollTop, 220);
    }
    assert.deepEqual(warnings, []);
  } finally { app.unmount(); }
});

test('実マウント: 1〜5枚と省略あり・戻る・別の枝でもCSS演出の合計を800msに揃える', async () => {
  const { app, root, props, warnings, walk, find } = await mountedPages();
  const layer = kind => walk(root, element => element.props['data-page-layer'] === kind);
  const path = depth => Array.from({ length: depth }, (_value, i) => 'd' + i).join('/');
  const navigate = async (target, expectedSteps) => {
    props.current = target; await flush(); const destination = layer('live');
    let count = 0, duration = 0;
    while (layer('outgoing')) {
      assert.ok(++count <= expectedSteps);
      const milliseconds = parseFloat(find('folder-page-stack').props.style['--page-turn-duration']);
      assert.equal(milliseconds, 800 / expectedSteps); duration += milliseconds;
      const sheet = layer('outgoing'), direction = sheet.props.class.includes('page-turn-back') ? 'back' : 'forward';
      sheet.props.onAnimationend({ type: 'animationend', target: sheet, currentTarget: sheet, animationName: 'folder-page-' + direction });
      await flush(); assert.equal(layer('live'), destination);
    }
    assert.equal(count, expectedSteps); assert.equal(duration, 800);
    assert.equal(layer('live').props['data-page-path'], target); assert.equal(find('folder-page-turn-edge'), undefined);
  };
  try {
    const deepTree = tree(); let node = deepTree;
    for (let index = 0; index < 20; index++) { const child = { n: 'd' + index, f: [], d: [] }; node.d.push(child); node = child; }
    props.tree = deepTree; await flush();
    for (const depth of [1, 2, 3, 4, 5, 20]) {
      await navigate(path(depth), Math.min(depth, 5));
      await navigate('', Math.min(depth, 5));
    }
    await navigate('src/nested', 2); await navigate(path(5), 5);
    assert.deepEqual(warnings, []);
  } finally { app.unmount(); }
});

test('実マウント: 深い移動は経由ページを順に入れ替え、最大5枚・800msで最終ページへ到着する', async () => {
  const { app, root, props, warnings, walk, find } = await mountedPages();
  const layer = kind => walk(root, element => element.props['data-page-layer'] === kind);
  const finish = sheet => sheet.props.onAnimationend({ type: 'animationend', target: sheet, currentTarget: sheet, animationName: 'folder-page-forward' });
  try {
    const deepTree = tree(); let node = deepTree;
    for (let index = 0; index < 20; index++) { const child = { n: 'd' + index, f: [['file' + index + '.js', 1, 1000]], d: [] }; node.d.push(child); node = child; }
    props.tree = deepTree; await flush();
    const path = Array.from({ length: 20 }, (_value, i) => 'd' + i).join('/');
    props.current = path; await flush(); const destination = layer('live');
    assert.equal(destination.props['data-page-path'], path); assert.ok(layer('incoming'));
    let count = 0, prior = '', duration = 0;
    while (layer('outgoing')) {
      const incoming = layer('incoming') || destination, outgoing = layer('outgoing');
      assert.equal(outgoing.props['data-page-path'], prior); prior = incoming.props['data-page-path'];
      assert.ok(walk(incoming, element => element.props.title === prior + '/file' + (prior.split('/').length - 1) + '.js'));
      assert.equal(layer('live'), destination); assert.ok(++count <= 5);
      const milliseconds = parseFloat(find('folder-page-stack').props.style['--page-turn-duration']);
      assert.equal(milliseconds, 160); duration += milliseconds;
      finish(outgoing); await flush();
      if (layer('outgoing')) { const current = layer('outgoing'); finish(outgoing); await flush(); assert.equal(layer('outgoing'), current); }
    }
    assert.equal(count, 5); assert.equal(prior, path); assert.equal(layer('live'), destination);
    assert.equal(duration, 800);
    assert.equal(layer('incoming'), undefined); assert.deepEqual(warnings, []);
  } finally { app.unmount(); }
});


test('3Dパネル境界: エクスプローラー・ビューア・閲覧/検索軌跡へ静かな白い影を限定する',()=>{
  const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
  const rule=css.match(/\.space-view:not\(\.mode-2d\) :is\(\.explorer-panel,\.viewer-popup,\.explorer-routes,\.route-file-list\)\{([^}]+)\}/);
  assert.ok(rule,'2D以外の4パネルだけを対象にする');
  assert.match(rule[1],/box-shadow:[^;]+rgba\(255,255,255,/);assert.doesNotMatch(rule[1],/animation|transition/);
});


test('2Dアイコン: 通常・旧・経由ページが同じ同梱SVGと共通部品を使い、選択操作を変えない', async () => {
  const { app, root, props, emitted, warnings, walk, find } = await mountedPages();
  const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => all(child, predicate))];
  const assertIcons = layer => {
    const rows = all(layer, element => element.props.class?.split(' ').includes('folder-page-entry'));
    assert.ok(rows.length);
    for (const row of rows) {
      const name = row.props.title.split('/').at(-1), directory = row.props.class.split(' ').includes('folder');
      const icon = walk(row, element => element.type === 'img');
      assert.ok(icon); assert.equal(icon.props.src, `/development/assets/catppuccin_icons/mocha/${fileIcon(name, { directory })}.svg`);
      assert.ok(catppuccinAsset(icon.props.src.slice('/development/'.length)));
      assert.equal(icon.props.alt, ''); assert.equal(icon.props['aria-hidden'], 'true');
      assert.equal(icon.props.draggable, 'false'); assert.equal(icon.props.innerHTML, undefined);
    }
  };
  try {
    assertIcons(find('folder-page-body'));
    const row = walk(root, element => element.props.title === 'root2.js'); row.props.onClick(); await flush();
    assert.equal(emitted.at(-1).path, 'root2.js'); assert.equal(props.selected, 'root2.js');
    props.current = 'src/nested'; await flush();
    const layers = all(root, element => element.props['data-page-layer']);
    assert.equal(layers.length, 3);
    for (const layer of layers) {
      assertIcons(layer);
      if (layer.props['data-page-layer'] !== 'live') { assert.equal(layer.props.inert, true); assert.equal(layer.props['aria-hidden'], true); }
    }
    const old = layers.find(layer => layer.props['data-page-layer'] === 'outgoing');
    const selected = emitted.length; walk(old, element => element.props.title === 'src').props.onClick(); await flush();
    assert.equal(emitted.length, selected, '表示用の旧ページのアイコン行から移動させない');
    props.current = ''; await flush(); assertIcons(find('folder-page-body'));
    assert.deepEqual(warnings, []);
  } finally { app.unmount(); }
});

test('2Dアイコン: 24px表示は既存32px列内に収まり、クリーム背景の選択状態でも色を識別できる', () => {
  const css = require('postcss').parse(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));
  const declaration = (selector, property) => {
    let value; css.walkRules(rule => { if (rule.selector === selector) rule.walkDecls(property, decl => value = decl.value); }); return value;
  };
  assert.equal(declaration('.folder-page-icon', '--file-type-icon-size'), '24px');
  assert.equal(declaration('.folder-page-icon', 'width'), '32px');
  assert.equal(declaration('.folder-page-icon', 'display'), 'grid');
  assert.equal(declaration('.folder-page-icon', 'place-items'), 'center');
  assert.equal(declaration('.mode-2d .folder-page-icon', 'filter'), 'brightness(.5) saturate(.9)');
  assert.match(readFileSync(new URL('../src/components/ファイル閲覧/ファイル種別アイコン.vue', import.meta.url), 'utf8'), /width:var\(--file-type-icon-size,16px\);height:var\(--file-type-icon-size,16px\)/);
  // 元SVGは増やさず、2DのCSSフィルターだけで暗くする。計算は実描画の検証とは別。
  const manifest = JSON.parse(readFileSync(new URL('../public/assets/catppuccin_icons/manifest.json', import.meta.url), 'utf8'));
  const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const luminance = channels => channels.reduce((value, channel, index) => value + [.2126, .7152, .0722][index] * (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4), 0);
  const backgrounds = ['#faf7f2', '#f5f1e8', '#f0ebe0', '#eae2d5', '#eee6d8', '#e6d5b7', '#ddcfb5'];
  for (const file of manifest.files) {
    const svg = readFileSync(new URL('../public/assets/catppuccin_icons/' + file.path, import.meta.url), 'utf8');
    for (const [hex] of svg.matchAll(/#[0-9a-fA-F]{6}/g)) {
      const bright = rgb(hex).map(value => value * .5);
      const gray = bright.reduce((sum, value, index) => sum + value * [.213, .715, .072][index], 0);
      const foreground = luminance(bright.map(value => value * .9 + gray * .1));
      for (const background of backgrounds) {
        const [low, high] = [foreground, luminance(rgb(background))].sort((a, b) => a - b);
        assert.ok((high + .05) / (low + .05) >= 3, `${file.path}: ${hex} on ${background}`);
      }
    }
  }
});


test('更新シート: 上から下へ切替、位置と選択を保持し、OS設定による省略なし', async()=>{
 const query={matches:false,addEventListener(){},removeEventListener(){}};
 const {app,root,props,walk,find}=await mountedPages({matchMedia:()=>query});
 const layer=kind=>walk(root,e=>e.props['data-page-layer']===kind);
 try {
  walk(layer('live'),e=>e.props.title==='root2.js').props.onClick();await flush();
  layer('live').scrollTop=220;layer('live').props.onScroll();const live=layer('live');
  props.tree={...tree(),f:[['root2.js',99,5000],['added.txt',1,1000]]};await flush();
  const old=layer('outgoing');assert.ok(old.props.class.includes('page-turn-refresh'));assert.equal(old.scrollTop,220);assert.equal(live.scrollTop,220);
  assert.equal(props.selected,'root2.js');assert.ok(walk(old,e=>e.props.title==='root10.md'));assert.equal(walk(live,e=>e.props.title==='root10.md'),undefined);
  const line=walk(find('folder-page-turn-edge'),e=>e.type==='line');assert.deepEqual([line.props.x1,line.props.y1,line.props.x2,line.props.y2],['0','0','100','0']);
  props.tree={...tree(),f:[['root2.js',100,6000]]};await flush();const newest=layer('outgoing');
  old.props.onAnimationend({type:'animationend',target:old,currentTarget:old,animationName:'folder-page-refresh'});await flush();assert.equal(layer('outgoing'),newest);
  find('folder-page-stack').props.onWheelCapturePassive();await flush();assert.equal(layer('outgoing'),undefined);assert.equal(live.scrollTop,220);
  query.matches=true;props.tree={...tree(),f:[['root2.js',101,7000]]};await flush();assert.ok(layer('outgoing').props.class.includes('page-turn-refresh'));
 } finally {app.unmount();}
});


test('手動更新: 差分なしでも更新シートを出し、連打を共有、失敗・離脱後は出さない',async()=>{
 const {app,root,props,walk,find}=await mountedPages();const layer=kind=>walk(root,e=>e.props['data-page-layer']===kind);
 try {
  let complete,calls=0;props.reload=()=>{calls++;return new Promise(resolve=>complete=resolve);};await flush();
  const button=find('folder-page-refresh');const first=button.props.onClick();button.props.onClick();await flush();assert.equal(calls,1);assert.equal(button.props.disabled,true);
  complete(true);await first;await flush();assert.ok(layer('outgoing').props.class.includes('page-turn-refresh'));
  find('folder-page-stack').props.onWheelCapturePassive();await flush();
  const failed=button.props.onClick();complete(false);await failed;await flush();assert.equal(layer('outgoing'),undefined);
  const leaving=button.props.onClick();props.active=false;await flush();complete(true);await leaving;assert.equal(layer('outgoing'),undefined);
 }finally{app.unmount();}
});
