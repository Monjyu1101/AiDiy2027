// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { createRenderer, h, nextTick, ref } = createRequire(path.join(__dirname, '../../../../../ui/package.json'))('vue');
const { render, source, component } = require('../../../../../checks/ui-components.cjs');
const items = [{ id: 'node', name: 'Node.js', commands: ['node'], menuGroup: 'ベース' }, { id: 'claude', name: 'Claude Code', commands: ['claude'], menuGroup: 'CLI群' }, { id: 'codex', name: 'Codex', commands: ['codex'], menuGroup: 'CLI群' }];
const capabilities = [{ id: 'claude', 操作: ['導入'], パッケージ: '@anthropic-ai/claude-code' }, { id: 'codex', 操作: ['再導入', '削除'], パッケージ: '@openai/codex' }, { id: 'node', 操作: [], 理由: 'この項目は対象外です。' }];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await nextTick(); };
const descendants = node => [node, ...node.children.flatMap(descendants)];
const text = node => node.text + node.children.map(text).join('');
function mount(props) {
  const make = (tag, text = '') => ({ tag, text, children: [], props: {}, parent: null });
  const renderer = createRenderer({ createElement: tag => make(tag), createText: text => make('#text', text), createComment: text => make('#comment', text), setText: (node, text) => node.text = text, setElementText: (node, text) => { node.text = text; node.children = []; }, parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null, patchProp: (node, key, _old, value) => node.props[key] = value, insert(node, parent, anchor) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, node); }, remove(node) { node.parent?.children.splice(node.parent.children.indexOf(node), 1); } });
  const root = make('root'), app = renderer.createApp({ render: () => h(component('components/導入状況/導入状況パネル.vue').default, props()) });
  app.mount(root);
  return { app, root, nodes: () => descendants(root), action: (id, action) => descendants(root).find(node => node.props['data-install-id'] === id && node.props['data-install-action'] === action), select: id => descendants(root).find(node => node.props['data-install-check'] === id).parent.parent.children.find(node => node.props.class === 'install-name').children.find(node => node.tag === 'button'), byId: id => descendants(root).find(node => node.props.id === id) };
}
async function fixture() {
  const { 導入操作状態を作成 } = await import('../導入操作状態.mjs');
  const { 導入状況状態を作成 } = await import('../導入状況状態.mjs');
  const 接続済み = ref(true), 操作中 = ref(false), calls = [], prompts = [], timers = new Map();
  let approved = false, run = null, timerId = 0;
  const install = 導入状況状態を作成({ api: async url => { throw Error(`予期しない確認 ${url}`); }, 接続済み, 操作中, 通知: ref(''), 間隔: 0 });
  install.一覧を反映({ 項目: items, 結果: [{ id: 'node', 状態: 'OK', バージョン: 'keep' }, { id: 'claude', 状態: '未検出' }, { id: 'codex', 状態: 'OK' }] });
  install.確認済み.value = true; install.書込済み.value = true;
  const operation = 導入操作状態を作成({ api: async (...args) => { const [url, method] = args; calls.push(args); if (method === 'POST') { const [, , id, action] = url.split('/'); run = { 実行ID: `run-${calls.length}`, 対象: decodeURIComponent(id), 操作: decodeURIComponent(action), 状態: '実行中', 実行中: true, ログ: 'run\n<script>alert(1)</script>\n' }; } if (method === 'DELETE') run = { ...run, ログ: 'cancelling\n' }; return { 項目: capabilities, 実行: run }; }, 接続済み, 操作中, 結果反映: install.操作結果を反映, 確認: prompt => { prompts.push(prompt); return approved; }, setTimer: callback => { timers.set(++timerId, callback); return timerId; }, clearTimer: id => timers.delete(id) });
  await operation.接続(true);
  const ui = mount(() => ({ 項目: install.項目.value, 結果: install.結果.value, 確認中: install.確認中.value, 個別確認中: install.個別確認中.value, 接続済み: 接続済み.value, 確認済み: install.確認済み.value, 書込中: install.書込中.value, 書込済み: install.書込済み.value, 表示中: install.表示中.value, 操作: operation, 操作中: 操作中.value, on個別確認: install.個別確認 }));
  return { ...ui, operation, install, calls, prompts, approve: value => { approved = value; }, finish: extra => { run = { ...run, 状態: '完了', 実行中: false, 結果: { id: run.対象, 状態: 'OK', 説明: '確認できました。' }, 確認済み: true, ログ: 'finished\n', ...extra }; }, async tick() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); await flush(); }, close() { operation.終了(); ui.app.unmount(); } };
}

test('名称の下の2行目左側に能力由来の導入・再導入・削除だけを表示し、導入済みでも非対応の操作を作らない', async () => {
  const operation = { 可能操作: id => capabilities.find(row => row.id === id)?.操作 || [], 能力: id => capabilities.find(row => row.id === id) };
  const html = await render('components/導入状況/導入状況パネル.vue', { 項目: items, 結果: items.map(item => ({ id: item.id, 状態: 'OK' })), 接続済み: true, 操作: operation });
  assert.equal((html.match(/data-install-action=/g) || []).length, 3);
  assert.match(html, /data-install-action="導入" data-install-id="claude"/);
  assert.match(html, /data-install-action="再導入" data-install-id="codex"/);
  assert.match(html, /data-install-action="削除" data-install-id="codex"/);
  assert.doesNotMatch(html, /data-install-id="node"/);
  assert.doesNotMatch(html, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
  const noCapabilities = await render('components/導入状況/導入状況パネル.vue', { 項目: items, 結果: [], 接続済み: true });
  assert.equal((noCapabilities.match(/data-install-action=/g) || []).length, 2);
  assert.equal((noCapabilities.match(/class="install-unavailable"/g) || []).length, 2);
  assert.doesNotMatch(noCapabilities, /data-install-id="node"/);
  const css = source('components/導入状況/導入状況.css'); assert.match(css, /grid-template-areas:"name check" "manage manage"/);
  const nameIndex = html.indexOf('<span>Claude Code</span>');
  assert.ok(nameIndex >= 0 && nameIndex < html.indexOf('data-install-check="claude"'), 'キーボード順序は1行目の名称から右側の確認へ進む');
  assert.ok(html.indexOf('data-install-check="claude"') < html.indexOf('data-install-id="claude"'), 'キーボード順序も1行目の確認から2行目の導入操作へ進む');
});

const updateItems = require('../../../../診断/catalog.json').filter(item => item.menuGroup === 'CLI群');
test('CLI群7項目は未導入・導入済みとも同じ導入・更新ボタンを表示する', async () => {
  assert.deepEqual(updateItems.map(item => item.id), ['claude', 'codex', 'copilot', 'agy', 'grok', 'opencode', 'ollama']);
  for (const installed of [false, true]) {
    const actions = id => installed ? id === 'ollama' ? ['再導入'] : ['再導入', '削除'] : ['導入'];
    const operation = { 可能操作: actions, 能力: id => ({ id, 操作: actions(id) }) };
    const ui = mount(() => ({ 項目: updateItems, 結果: updateItems.map(item => ({ id: item.id, 状態: installed ? 'OK' : '未検出' })), 接続済み: true, 操作: operation }));
    try {
      for (const item of updateItems) {
        const button = ui.action(item.id, installed ? '再導入' : '導入');
        assert.ok(button); assert.equal(text(button), '導入・更新'); assert.equal(button.props.disabled, false);
        assert.equal(button.props['aria-label'], `${item.name} を導入・更新`);
        assert.equal(Boolean(ui.action(item.id, '削除')), installed && item.id !== 'ollama');
        assert.equal(ui.nodes().filter(node => node.props['data-install-id'] === item.id && text(node) === '導入・更新').length, 1);
      }
    } finally { ui.app.unmount(); }
  }
});

test('導入元不明・Windows未対応・確認中でも入口と理由を残し、権限のない操作を送らない', async () => {
  const calls = [], caps = ref([]), connected = ref(true);
  const operation = { 可能操作: id => caps.value.find(row => row.id === id)?.操作 || [], 能力: id => caps.value.find(row => row.id === id), 開始: (...args) => calls.push(args) };
  const ui = mount(() => ({ 項目: updateItems, 結果: updateItems.map(item => ({ id: item.id, 状態: 'OK' })), 接続済み: connected.value, 操作: operation }));
  try {
    for (const item of updateItems) {
      const button = ui.action(item.id, '導入'); assert.equal(button.props.disabled, true);
      assert.equal(button.props['aria-describedby'], `install-reason-${item.id}`);
      assert.equal(text(ui.byId(`install-reason-${item.id}`)), '導入元を確認しています。');
      button.props.onClick();
    }
    caps.value = [{ id: 'copilot', 操作: [], 理由: '検出された実行ファイルは別の導入元です。元の方法で管理してください。' }, { id: 'agy', 操作: [], 理由: 'Antigravity の自動導入・削除は Windows のみ対応しています。' }];
    await flush();
    for (const cap of caps.value) {
      assert.equal(ui.action(cap.id, '導入').props.disabled, true);
      assert.equal(text(ui.byId(`install-reason-${cap.id}`)), cap.理由);
      assert.equal(ui.action(cap.id, '導入').props.title, cap.理由);
      ui.action(cap.id, '導入').props.onClick();
      assert.equal(ui.action(cap.id, '削除'), undefined);
    }
    caps.value = updateItems.map(item => ({ id: item.id, 操作: ['再導入', '削除'] })); await flush();
    for (const item of updateItems) { assert.equal(ui.action(item.id, '再導入').props.disabled, false); assert.equal(ui.byId(`install-reason-${item.id}`), undefined); }
    connected.value = false; caps.value = []; await flush();
    for (const item of updateItems) { assert.equal(ui.action(item.id, '導入').props.disabled, true); assert.equal(text(ui.byId(`install-reason-${item.id}`)), '接続後に導入元を確認します。'); }
    assert.deepEqual(calls, []);
  } finally { ui.app.unmount(); }
});

test('導入・更新の実Vueクリックは既存の導入／再導入APIへ送り、取消・連打・完了後の更新を守る', async () => {
  const { 導入操作状態を作成 } = await import('../導入操作状態.mjs');
  for (const installed of [false, true]) for (const item of updateItems) {
    const 接続済み = ref(true), 操作中 = ref(false), calls = [], prompts = [];
    let approved = false, run = null;
    const capability = { id: item.id, 操作: installed ? ['再導入', '削除'] : ['導入'], 再導入説明: item.id === 'copilot' ? 'npm install --global @github/copilot を1回実行して更新・再導入します。事前のアンインストールは行いません。' : '旧バイナリを退避してから公式インストーラーで更新・再導入します。失敗・中止時は旧バイナリを復元します。' };
    const operation = 導入操作状態を作成({ 接続済み, 操作中, 確認: prompt => { prompts.push(prompt); return approved; }, setTimer: () => 1, clearTimer: () => {}, api: async (url, method) => {
      calls.push([url, method]);
      if (method === 'POST') run = { 実行ID: `job-${calls.length}`, 対象: item.id, 操作: decodeURIComponent(url.split('/').at(-1)), 状態: '実行中', 実行中: true, ログ: 'fixture' };
      return { 項目: [capability], 実行: run };
    } });
    await operation.接続(true);
    const ui = mount(() => ({ 項目: [item], 結果: [{ id: item.id, 状態: installed ? 'OK' : '未検出' }], 接続済み: true, 操作: operation, 操作中: 操作中.value }));
    try {
      const action = installed ? '再導入' : '導入';
      ui.action(item.id, action).props.onClick(); await flush();
      assert.equal(prompts.length, 1); assert.equal(calls.filter(([, method]) => method === 'POST').length, 0);
      approved = true; ui.action(item.id, action).props.onClick(); ui.action(item.id, action).props.onClick(); await flush();
      assert.deepEqual(calls.filter(([, method]) => method === 'POST'), [[`api/導入管理/${item.id}/${encodeURIComponent(action)}`, 'POST']]);
      assert.equal(ui.action(item.id, action).props.disabled, true);
      if (installed) { assert.ok(prompts.at(-1).includes(capability.再導入説明)); assert.doesNotMatch(prompts.at(-1), /削除してから/); }
      run = { ...run, 状態: '完了', 実行中: false }; capability.操作 = ['再導入', '削除'];
      await operation.読込(); await flush();
      assert.equal(text(ui.action(item.id, '再導入')), '導入・更新'); assert.equal(ui.action(item.id, '再導入').props.disabled, false);
      ui.action(item.id, '再導入').props.onClick(); await flush();
      assert.equal(calls.filter(([, method]) => method === 'POST').length, 2);
      assert.equal(calls.filter(([, method]) => method === 'POST').at(-1)[0], `api/導入管理/${item.id}/${encodeURIComponent('再導入')}`);
    } finally { operation.終了(); ui.app.unmount(); }
  }
});

test('実Vueクリックで確認を取り消せる。承認後は一度だけ実行し、その項目の操作と全確認・書込を無効化する', async () => {
  const f = await fixture();
  try {
    f.action('claude', '導入').props.onClick(); await flush();
    assert.equal(f.prompts.length, 1); assert.equal(f.calls.filter(([, method]) => method === 'POST').length, 0);
    f.approve(true); f.action('claude', '導入').props.onClick(); f.action('claude', '導入').props.onClick(); await flush();
    assert.equal(f.prompts.length, 2); assert.equal(f.calls.filter(([, method]) => method === 'POST').length, 1);
    assert.equal(f.select('claude').props['aria-pressed'], true);
    // 実行中の項目の導入操作と、全項目の確認は無効。別項目の導入操作は並行して押せる。
    assert.equal(f.action('claude', '導入').props.disabled, true);
    assert.ok(f.nodes().filter(node => node.props['data-install-check']).every(node => node.props.disabled));
    assert.equal(f.action('codex', '再導入').props.disabled, false); assert.equal(f.action('codex', '削除').props.disabled, false);
    assert.equal(f.byId('install-run').props.disabled, true); assert.equal(f.byId('install-write').props.disabled, true);
    const console = f.nodes().find(node => node.tag === 'pre'); assert.match(text(console), /<script>alert\(1\)<\/script>/); assert.ok(!f.nodes().some(node => node.tag === 'script'));
    f.finish(); await f.tick();
    assert.ok(f.nodes().find(node => node.tag === 'pre'), '完了してもコンソールを保持する');
    assert.match(text(f.root), /操作後の確認/); assert.match(text(f.root), /確認できました/);
    assert.equal(f.install.書込済み.value, false); assert.equal(f.install.結果.value[0].バージョン, 'keep');
    assert.equal(f.byId('install-run').props.disabled, false);
    assert.equal(f.byId('install-cancel'), undefined);
  } finally { f.close(); }
});

test('実Vueクリックで別項目・詳細へ移った後は完了ポーリングが表示を戻さない', async () => {
  const f = await fixture();
  try {
    f.approve(true); f.action('claude', '導入').props.onClick(); await flush();
    f.select('node').props.onClick(); await flush(); f.finish(); await f.tick();
    assert.equal(f.select('node').props['aria-pressed'], true); assert.equal(f.nodes().find(node => node.tag === 'pre'), undefined);
    assert.match(text(f.byId('detail')), /Node.js/);
    f.action('codex', '再導入').props.onClick(); await flush();
    const detailButton = f.nodes().find(node => node.tag === 'button' && text(node) === '詳細'); detailButton.props.onClick(); await flush();
    f.finish(); await f.tick(); assert.equal(f.nodes().find(node => node.tag === 'pre'), undefined);
    assert.equal(f.select('codex').props['aria-pressed'], true);
    f.nodes().find(node => node.tag === 'button' && text(node) === 'コンソール').props.onClick(); await flush();
    assert.match(text(f.nodes().find(node => node.tag === 'pre')), /finished/);
  } finally { f.close(); }
});

test('実Vue中止ボタンは一度だけDELETEし、中止完了のログと確認結果を保持する', async () => {
  const f = await fixture();
  try {
    f.approve(true); f.action('codex', '削除').props.onClick(); await flush();
    assert.match(f.prompts[0], /Codex を削除/); assert.match(f.prompts[0], /利用できなくなります/);
    const cancel = f.byId('install-cancel'); cancel.props.onClick(); cancel.props.onClick(); await flush();
    assert.equal(f.calls.filter(([, method]) => method === 'DELETE').length, 1);
    assert.equal(f.byId('install-cancel').props.disabled, true); assert.equal(text(f.byId('install-cancel')), '中止確認中…');
    f.finish({ 状態: '中止', 結果: { id: 'codex', 状態: '未検出', 説明: '操作後に未検出です。' } }); await f.tick();
    assert.match(text(f.byId('detail')), /中止/); assert.match(text(f.byId('detail')), /操作後に未検出/);
  } finally { f.close(); }
});

test('Appは接続・終了・全テストロックを配線し、管理完了からタブを変更しない', () => {
  const app = source('App.vue');
  assert.match(app, /watch\(connected,value=>\{void 導入操作.接続\(value\);\},\{flush:'sync'\}\)/);
  assert.match(app, /onUnmounted\(\(\)=>\{導入操作.終了\(\)/);
  assert.match(app, /if\([^;]*操作中.value\|\|全診断中.value[^;]*keyTesting.value[^;]*\)return/);
  assert.match(app, /id="run"[^>]*:disabled="[^"]*操作中/);
  assert.match(app, /:操作="導入操作" :操作中="操作中"/);
  assert.doesNotMatch(source('components/導入状況/導入操作状態.mjs'), /tab\.value|表示中\.value|選択ID\.value/);
});

test('FFmpeg 一式のどの行からも共有コンソールと3行の確認結果を表示する', async () => {
  const bundle = ['ffmpeg', 'ffprobe', 'ffplay'].map(id => ({ id, name: id, menuGroup: 'その他拡張', commands: [id] }));
  const run = ref({ 実行ID: 'bundle-job', 対象: 'ffmpeg', 関連項目: bundle.map(row => row.id), 状態: '完了', 実行中: false, 操作: '導入', ログ: 'one winget package\n', 結果: { id: 'ffmpeg', 状態: 'OK' }, 結果一覧: bundle.map(row => ({ id: row.id, 状態: 'OK', 説明: `${row.id} checked` })) });
  const operation = { 実行: run, 可能操作: () => [], 能力: () => ({}) };
  const ui = mount(() => ({ 項目: bundle, 結果: [], 接続済み: true, 操作: operation, 操作中: false }));
  try {
    ui.select('ffprobe').props.onClick(); await flush();
    const consoleButton = ui.nodes().find(node => node.tag === 'button' && text(node) === 'コンソール');
    assert.ok(consoleButton); consoleButton.props.onClick(); await flush();
    assert.match(text(ui.nodes().find(node => node.tag === 'pre')), /one winget package/);
    assert.deepEqual(ui.nodes().filter(node => node.props['data-install-result']).map(node => node.props['data-install-result']), ['ffmpeg', 'ffprobe', 'ffplay']);
    assert.equal(ui.select('ffprobe').props['aria-pressed'], true);
  } finally { ui.app.unmount(); }
});
