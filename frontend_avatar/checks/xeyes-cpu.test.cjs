// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実際のTypeScript/Vueをメモリ上で実行する。OS計測・IPC・時計だけを置換する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '..');
const own = createRequire(path.join(project, 'package.json'));
const shared = createRequire(path.join(project, '../frontend_ide/package.json'));
const dependency = name => { try { return own(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; return shared(name); } };
const ts = dependency('typescript'), vue = dependency('vue'), compiler = dependency('@vue/compiler-sfc');
const mainSource = fs.readFileSync(path.join(project, 'electron/main.ts'), 'utf8');
const compile = source => ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
const copy = value => JSON.parse(JSON.stringify(value));

function mainFixture({ platform = 'win32', values = [], createFailure = false } = {}) {
  const ast = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
  const functions = new Set(['closeSystemCpuMonitor', 'getSystemCpuUsagePercent']);
  const variables = new Set(['systemCpuMonitor']);
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && functions.has(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => variables.has(item.name.getText(ast)))
    || ts.isTypeAliasDeclaration(node) && node.name.text === 'SystemCpuMonitor');
  const quit = mainSource.match(/app\.on\('before-quit',[^\n]+/)[0];
  let created = 0, closed = 0, reads = 0, siReads = 0, getLoad, quitHandler;
  const si = { async currentLoad() { siReads++; return { currentLoad: 67.25 }; } };
  const context = {
    process: { platform }, path, __dirname: path.join(project, 'dist-electron'),
    app: { on(event, callback) { assert.equal(event, 'before-quit'); quitHandler = callback; } },
    require(id) {
      if (id === 'systeminformation') return si;
      assert.equal(id, path.resolve(project, '../frontend_ide/aidiy_cpu/systeminformation-cpu.cjs'));
      return { createSystemInformationCpuMonitor(options) {
        assert.equal(typeof options.getLoad, 'function'); getLoad = options.getLoad; created++;
        if (createFailure) throw Error('cannot create');
        return { read() { reads++; const value = values.shift(); if (value instanceof Error) throw value; return value; }, close() { closed++; } };
      } };
    },
  };
  const code = compile(`let isQuitting = false;\n${selected.map(node => node.getText(ast)).join('\n')}\n${quit}\nglobalThis.api = {read: getSystemCpuUsagePercent, close: closeSystemCpuMonitor};`);
  assert.deepEqual(code.diagnostics, []);
  vm.runInNewContext(code.outputText, context);
  return { ...context.api, load: () => getLoad(), quit: () => quitHandler(), counts: () => ({ created, closed, reads, siReads }) };
}

for (const platform of ['win32', 'linux', 'darwin']) test(`${platform}: SI共有monitorを1回作り、取得済み率をIPC周期で割らず0%も保持する`, () => {
  const fixture = mainFixture({ platform, values: [null, { cpu: 70 }, { cpu: 70 }, { cpu: 0 }, { cpu: 100 }] });
  assert.equal(fixture.read(), null); assert.equal(fixture.read(), 70); assert.equal(fixture.read(), 70);
  assert.equal(fixture.read(), 0); assert.equal(fixture.read(), 100);
  assert.deepEqual(fixture.counts(), { created: 1, closed: 0, reads: 5, siReads: 0 });
});

test('全OSの未取得・不正値を0や別の計測経路へ置き換えない', () => {
  const values = [null, undefined, { cpu: null }, { cpu: '50' }, { cpu: NaN }, { cpu: Infinity }, { cpu: -1 }, { cpu: 101 }];
  const fixture = mainFixture({ values: [...values] });
  for (const _ of values) assert.equal(fixture.read(), null);
  assert.equal(fixture.counts().siReads, 0);
  assert.doesNotMatch(mainSource, /os\.cpus\(|windows-native-cpu|windowsCpuMonitor|readCpuTimes/);
});

test('SI読込例外は解放してnullを返し、後の要求で復帰する', () => {
  const fixture = mainFixture({ values: [{ cpu: 80 }, Error('failed'), null, { cpu: 60 }] });
  assert.equal(fixture.read(), 80); assert.equal(fixture.read(), null); assert.equal(fixture.read(), null); assert.equal(fixture.read(), 60);
  assert.deepEqual(fixture.counts(), { created: 2, closed: 1, reads: 4, siReads: 0 });
  const unavailable = mainFixture({ createFailure: true }); assert.equal(unavailable.read(), null); assert.equal(unavailable.counts().siReads, 0);
});

test('before-quitで共有monitorを閉じ、その後のIPCで作り直さない', () => {
  const fixture = mainFixture({ values: [{ cpu: 20 }] });
  assert.equal(fixture.read(), 20); fixture.quit(); fixture.quit(); assert.equal(fixture.read(), null);
  assert.deepEqual(fixture.counts(), { created: 1, closed: 1, reads: 1, siReads: 0 });
});

test('Avatar自身のSI currentLoad()を関数として注入し、IPCが直接追加採取しない', async () => {
  const fixture = mainFixture({ values: [null] });
  assert.equal(fixture.read(), null); assert.equal(fixture.counts().siReads, 0);
  assert.deepEqual(await fixture.load(), { currentLoad: 67.25 }); assert.equal(fixture.counts().siReads, 1);
  assert.match(mainSource, /require\('systeminformation'\)/);
  assert.doesNotMatch(mainSource, /frontend_ide[^\n]*node_modules/);
});

test('Avatar単独セットアップにSIの正確な依存版と公式tarballが記録されている', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(project, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.dependencies.systeminformation, '5.33.19');
  assert.equal(lock.packages[''].dependencies.systeminformation, '5.33.19');
  assert.equal(lock.packages['node_modules/systeminformation'].version, '5.33.19');
  assert.equal(lock.packages['node_modules/systeminformation'].resolved, 'https://registry.npmjs.org/systeminformation/-/systeminformation-5.33.19.tgz');
});

test('CPU IPCの実配線・preload・renderer型がnumber|nullで一致する', () => {
  assert.match(mainSource, /ipcMain\.handle\('system:get-cpu-usage', \(\) => getSystemCpuUsagePercent\(\)\)/);
  assert.match(fs.readFileSync(path.join(project, 'electron/preload.ts'), 'utf8'), /getSystemCpuUsage:.*Promise<number \| null>/);
  assert.match(fs.readFileSync(path.join(project, 'src/env.d.ts'), 'utf8'), /getSystemCpuUsage\?: \(\) => Promise<number \| null>/);
  assert.deepEqual(compile(mainSource).diagnostics, []);
  assert.deepEqual(compile(fs.readFileSync(path.join(project, 'electron/preload.ts'), 'utf8')).diagnostics, []);
});

const filename = path.join(project, 'src/components/AIコア_xeyes.vue');
const source = fs.readFileSync(filename, 'utf8');
const { descriptor, errors } = compiler.parse(source, { filename });
assert.deepEqual(errors, []);
const compiledScript = compiler.compileScript(descriptor, { id: 'xeyes-cpu-test' });
const compiledTemplate = compiler.compileTemplate({ source: descriptor.template.content, filename, id: 'xeyes-cpu-test', compilerOptions: { bindingMetadata: compiledScript.bindings } });
assert.deepEqual(compiledTemplate.errors, []);
const templateModule = { exports: {} };
vm.runInNewContext(compile(compiledTemplate.code).outputText, { exports: templateModule.exports, require: id => { assert.equal(id, 'vue'); return vue; } });
// 本番renderをVueのrender context内で評価する。実DOMやOS窓は作らない。
const syntheticRenderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, patchProp() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null });

function rendererFixture({ desktop = true } = {}) {
  let next = null, onMount, onUnmount, calls = 0;
  const intervals = new Map(), frames = new Set(); let nextId = 0;
  const window = {
    setInterval(callback, period) { const id = ++nextId; intervals.set(id, { callback, period }); return id; },
    clearInterval(id) { intervals.delete(id); },
    requestAnimationFrame() { const id = ++nextId; frames.add(id); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  if (desktop) window.desktopApi = { async getSystemCpuUsage() { calls++; if (next instanceof Error) throw next; return next; } };
  const scope = vue.effectScope();
  const dependencies = { ...vue, window, defineProps: () => ({ controlsVisible: true }), withDefaults: props => props,
    onMounted: callback => { onMount = callback; }, onBeforeUnmount: callback => { onUnmount = callback; } };
  const js = compile(descriptor.scriptSetup.content.replace(/^import .*$/gm, '')).outputText;
  const api = scope.run(() => new Function(...Object.keys(dependencies), `${js}\nreturn {props, stageRef, leftEyeRef, rightEyeRef, leftPupilStyle, rightPupilStyle, cpuSamples, cpuAverage, cpuColorLevel, bloodshotLineLevel, designMode, cpuColorEnabled, effectiveCpuColorLevel, effectiveBloodshotLineLevel, bloodshotTicks, collectCpuUsage, cpuBarColor};`)(...Object.values(dependencies)));
  return { ...api, window, intervals, frames, calls: () => calls, set: value => { next = value; }, mount: () => onMount(), unmount: () => { onUnmount(); scope.stop(); },
    render: () => {
      let tree;
      const app = syntheticRenderer.createApp({ render() { tree = templateModule.exports.render({}, [], {}, vue.proxyRefs(api), {}, {}); return null; } });
      app.mount({}); app.unmount(); return tree;
    },
  };
}
function find(vnode, type) { if (vnode?.type === type) return vnode; for (const child of Array.isArray(vnode?.children) ? vnode.children : []) { const found = find(child, type); if (found) return found; } return null; }

test('xeyes: 起動中・Web・未取得は—表示で0%を捏造しない', async () => {
  for (const desktop of [true, false]) {
    const fixture = rendererFixture({ desktop });
    try {
      assert.equal(find(fixture.render(), 'strong').children, '—'); await fixture.collectCpuUsage();
      assert.equal(fixture.cpuAverage.value, null); assert.deepEqual(copy(fixture.cpuSamples.value), [null]);
      assert.equal(find(fixture.render(), 'strong').children, '—'); assert.equal(fixture.cpuColorLevel.value, 0);
    } finally { fixture.unmount(); }
  }
});

test('xeyes: 70%は70%、0%は平均対象になり、平均と色の平滑化を維持する', async () => {
  const fixture = rendererFixture();
  try {
    fixture.set(70); await fixture.collectCpuUsage(); assert.equal(fixture.cpuAverage.value, 70); assert.equal(find(fixture.render(), 'strong').children, '70%');
    assert.equal(fixture.cpuColorLevel.value, 0.5);
    fixture.set(0); await fixture.collectCpuUsage(); assert.equal(fixture.cpuAverage.value, 35); assert.deepEqual(copy(fixture.cpuSamples.value), [70, 0]);
    for (let i = 0; i < 12; i++) { fixture.set(0); await fixture.collectCpuUsage(); }
    assert.equal(fixture.cpuSamples.value.length, 12); assert.equal(fixture.cpuAverage.value, 0); assert.equal(find(fixture.render(), 'strong').children, '0%');
  } finally { fixture.unmount(); }
});

test('xeyes: null・例外・不正値は平均から除外し、欠損時の色を急変させない', async () => {
  const fixture = rendererFixture();
  try {
    fixture.set(80); await fixture.collectCpuUsage(); const color = fixture.cpuColorLevel.value;
    for (const value of [null, undefined, NaN, Infinity, -1, 101, '50', Error('IPC failed')]) {
      fixture.set(value); await fixture.collectCpuUsage(); assert.equal(fixture.cpuAverage.value, null); assert.equal(fixture.cpuColorLevel.value, color);
      assert.equal(find(fixture.render(), 'strong').children, '—');
    }
    fixture.set(40); await fixture.collectCpuUsage(); assert.equal(fixture.cpuAverage.value, 60); assert.equal(fixture.cpuColorLevel.value, 0.25);
    for (let i = 0; i < 12; i++) { fixture.set(null); await fixture.collectCpuUsage(); }
    assert.ok(fixture.cpuSamples.value.every(value => value === null));
    fixture.set(0); await fixture.collectCpuUsage(); assert.equal(fixture.cpuAverage.value, 0);
  } finally { fixture.unmount(); }
});

test('xeyes: 12枠を維持し、古い標本を押し出した平均を使う', async () => {
  const fixture = rendererFixture();
  try {
    for (let i = 1; i <= 13; i++) { fixture.set(i); await fixture.collectCpuUsage(); }
    assert.deepEqual(copy(fixture.cpuSamples.value), Array.from({ length: 12 }, (_, i) => i + 2));
    assert.equal(fixture.cpuAverage.value, 7.5);
  } finally { fixture.unmount(); }
});

test('xeyes: 500ms IPC予定を維持し、破棄時にintervalと描画を解除する', async () => {
  const fixture = rendererFixture();
  await fixture.mount(); await Promise.resolve();
  assert.equal(fixture.intervals.size, 1); assert.equal([...fixture.intervals.values()][0].period, 500); assert.equal(fixture.frames.size, 1);
  fixture.unmount(); assert.equal(fixture.intervals.size, 0); assert.equal(fixture.frames.size, 0);
});

test('xeyes: 遅いIPCを重複させず、破棄後の応答を描画へ戻さない', async () => {
  const fixture = rendererFixture(); let resolve;
  fixture.set(new Promise(done => { resolve = done; }));
  const pending = fixture.collectCpuUsage(); await fixture.collectCpuUsage(); assert.equal(fixture.calls(), 1);
  fixture.unmount(); resolve(100); await pending;
  assert.equal(fixture.cpuSamples.value.length, 0); assert.equal(fixture.cpuAverage.value, null);
});

test('xeyes: mountのIPC待機中に破棄しても周期を再開しない', async () => {
  const fixture = rendererFixture(); let resolve;
  fixture.window.desktopApi.getWindowRole = () => new Promise(done => { resolve = done; });
  const pending = fixture.mount(); fixture.unmount(); resolve('core'); await pending;
  assert.equal(fixture.intervals.size, 0); assert.equal(fixture.frames.size, 0); assert.equal(fixture.calls(), 0);
});
