// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createSpace, fileSizeScale } from '../src/components/開発スペース/宇宙描画.js';

const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const dir = (n, f = [], d = []) => ({ n, f: f.map(file => Array.isArray(file) ? file : [file, 40, 100]), d });
const snapshot = tree => ({ root: '/project', tree, truncated: false });
const fixture = () => snapshot(dir('project', ['root.js'], [
  dir('src', ['main.js'], [dir('nested', [['note.txt', 50, 200]], [dir('deeper', [['deep.py', 60, 300]])]), dir('empty')]),
  dir('vacant'),
]));
const event = (type, values = {}) => Object.assign(new Event(type, { cancelable: true }), values);

// 実エンジンを使い、Canvas/API/時計だけをメモリ内へ置き換える。ブラウザ・AI・ソケットは使わない。
function space(t, initial = fixture()) {
  const old = new Map(), frames = new Map(), timers = new Map(), changes = [], requests = [], draws = [], arcs = [], texts = [], routeLines = [], routeMarkers = [], storage = new Map();
  const window = new EventTarget(), document = new EventTarget(), canvas = new EventTarget(), location = { hash: '' };
  let data = initial, clock = 0, id = 0, busy = false, dash = [];
  document.hidden = false;
  const context = new Proxy({ font: '', createRadialGradient: () => ({ addColorStop() {} }),
    measureText: text => ({ width: text.length * 6 }), drawImage: (...args) => draws.push(args), fillText: (...args) => texts.push(args),
    arc: (...args) => arcs.push({ args, fill: context.fillStyle, alpha: context.globalAlpha, composite: context.globalCompositeOperation }),
    moveTo: (...args) => { if (!dash.length && ['#a7f6ff','#ffe2a0'].includes(context.fillStyle)) routeMarkers.push({args,alpha:context.globalAlpha}); },
    setLineDash: value => { dash = value; }, lineTo: (...args) => { if (dash.join(',') === '5,7') routeLines.push(args); },
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  const tipNodes = { '.t-name': {}, '.t-sub': {} };
  const tooltip = { style: {}, querySelector: name => tipNodes[name] };
  Object.assign(canvas, { getContext: () => context, classList: { add() {}, remove() {}, toggle() {} },
    style: { removeProperty(key) { delete this[key]; } }, setAttribute(name, value) { if (name === 'aria-busy') busy = value === 'true'; },
    setPointerCapture() {}, animate: () => ({ finished: Promise.resolve(), cancel() {} }),
  });
  document.createElement = () => ({ getContext: () => context });
  Object.assign(window, { devicePixelRatio: 1, history: { pushState(_a, _b, hash) { location.hash = hash; } },
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; }, cancelAnimationFrame: key => frames.delete(key),
  });
  for (const [key, value] of Object.entries({ window, document, location, innerWidth: 1280, innerHeight: 800, Element: class Element {},
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => { requests.push({ url, ...options }); return { ok: true, json: async () => structuredClone(data) }; },
    setTimeout: (callback, delay = 0) => { timers.set(++id, { callback, at: clock + delay }); return id; }, clearTimeout: key => timers.delete(key),
  })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.mock.method(performance, 'now', () => clock);
  t.mock.method(Date, 'now', () => 1000000 + clock);
  const engine = createSpace(canvas, { tooltip }, { change: value => changes.push(value) });
  engine.setAutoSpin(false);
  const pump = async (ms = 100) => {
    clock += ms;
    const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(clock);
    for (const [key, timer] of [...timers]) if (timer.at <= clock && timers.delete(key)) timer.callback();
    await flush();
  };
  const until = async predicate => {
    for (let n = 0; n < 500 && !predicate(); n++) await pump();
    assert.ok(predicate(), 'navigation completes');
  };
  const finish = async promise => {
    let done = false, result, error;
    Promise.resolve(promise).then(value => { result = value; done = true; }, value => { error = value; done = true; });
    await until(() => done); if (error) throw error; return result;
  };
  return { engine, canvas, window, location, draws, arcs, texts, routeLines, routeMarkers, requests, tooltip, tipNodes, storage, frames, pump, until, finish,
    data: value => { data = value; }, state: () => changes.filter(value => 'scan' in value).at(-1),
    errors: () => changes.filter(value => value.error).map(value => value.error), idle: () => !busy,
    async ready() { await engine.refresh(150); for (let n = 0; n < 30; n++) { draws.length = arcs.length = texts.length = 0; await pump(); } },
    camera() { Object.assign(engine.cam, { tx: 0, ty: 0, tz: 0, dist: 600, yaw: 0, pitch: 0, roll: 0 }); Object.assign(engine.goal, engine.cam); },
    dispose() { engine.dispose(); for (const [key, descriptor] of old) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; },
  };
}

const coordinates = body => [body.x, body.y, body.z];

// 配下の空フォルダは数えず、直下とさらに深いファイルを混在させる。
const countedFolder = (name, count) => {
  const files = Array.from({ length: count }, (_, i) => [`file-${i}.png`, 0, 100]);
  const split = Math.floor(count / 3);
  return dir(name, files.slice(0, split), [dir('empty'), dir('nested', [], [dir('deep', files.slice(split))])]);
};
const countFixture = counts => snapshot(dir('project', [], [dir('src', [['reference.png', 0, 100]], counts.map(count => countedFolder(`count-${count}`, count)))]));
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

function positionSizeSamples(h) {
  const g = h.engine.world.galaxies[0];
  Object.assign(g, { x: 200, y: 170, z: 0 });
  g.stars.forEach((body, i) => Object.assign(body, { x: -250 + i * 65, y: -100, z: 0, lr: 0 }));
  h.camera();
}

// サイズの計算値だけでなく、実エンジンがCanvasへ渡す画像寸法と不透明な円の直径を調べる。
function renderedStar(h, body) {
  const k = 840 / h.engine.cam.dist, x = 640 + body.x * k, y = 400 - body.y * k;
  const images = h.draws.filter(([, left, top, width, height]) => Math.abs(left + width / 2 - x) < 1e-8 && Math.abs(top + height / 2 - y) < 1e-8);
  const cores = h.arcs.filter(({ args, fill, alpha, composite }) => fill === '#000' && alpha === 1 && composite === 'source-over' && Math.abs(args[0] - x) < 1e-8 && Math.abs(args[1] - y) < 1e-8);
  assert.ok(images.length > 0, `${body.path} の星画像を描画する`);
  assert.equal(cores.length, 1, `${body.path} の不透明な本体は1つ`);
  close(images[0][3], images[0][4], '星画像は正方形');
  return { diameter: images[0][3], coreDiameter: cores[0].args[2] * 2, images };
}

const drawFrame = async (h, ms = 0) => { h.draws.length = 0; h.arcs.length = 0; await h.pump(ms); };

// 9666e8fe（集約前）の実エンジンから取得。位置だけでなく色分類・サイズ・瞬きも戻す。
const originalStars = [
  ['src/main.js', [-1287.094993252392, 770.5859495855996, 158.51373522191983], 1, 0.9435155605979273, 0.9999357101520574, 2.855862915730748, 1.387221697345376],
  ['src/nested/note.txt', [-1323.442265304685, 843.005565732635, 86.39906998281603], 3, 0.9695817984269325, 0.9999357165812719, 0.09397950173204343, 1.7690207693260165],
  ['src/nested/deeper/deep.py', [-1329.9472666354989, 719.6928918141099, -2.6542807862116717], 0, 0.990965704627961, 0.9999357230104864, 4.571496422729848, 1.3289340399205685],
  ['root.js', [-103.40645984901799, 451.1363381595604, -863.8148677667513], 1, 0.9435155605979273, 0.9999357101520574, 1.123878483078534, 1.5061903343070298],
];

test('全階層の個別星: 集約前の位置・色分類・大きさ・明るさ・瞬きを維持する', async t => {
  const h = space(t);
  try {
    await h.ready();
    for (const [path, position, kind, mag, glow, phase, speed] of originalStars) {
      const body = h.engine.world.byPath.get(path);
      assert.ok(body, `${path} の天体を作る`);
      coordinates(body).forEach((value, i) => close(value, position[i], `${path} の座標`));
      assert.equal(body.kind, kind, `${path} の色分類`);
      for (const [key, expected] of Object.entries({ mag, glow, phase, speed })) close(body[key], expected, `${path}.${key}`);
      assert.equal(body.born, 0); assert.equal(body.isDirectory, undefined);
    }
    assert.deepEqual(h.engine.world.galaxies[0].kinds, [1, 1, 0, 1, 0, 0, 0, 0, 0, 0]);
  } finally { h.dispose(); }
});

test('3D表示深度: 直下は惑星、銀河内は全子孫ファイルを個別の星にし、空フォルダの星は作らない', async t => {
  const h = space(t);
  try {
    await h.ready();
    const { world } = h.engine, src = world.galaxies.find(g => g.path === 'src');
    assert.deepEqual(world.planets.map(p => p.path), ['root.js']);
    assert.deepEqual(src.stars.map(s => s.path), ['src/main.js', 'src/nested/note.txt', 'src/nested/deeper/deep.py']);
    assert.equal(world.stars.length, 3); assert.equal(world.byPath.size, 4);
    assert.equal(src.files.length, 3); assert.equal(src.sub, 2); assert.equal(src.fresh, 2);
    assert.equal(world.byPath.has('src/nested'), false); assert.equal(world.byPath.has('src/empty'), false);
    assert.deepEqual(world.galaxies.find(g => g.path === 'vacant').stars, [], '直下の空フォルダは星なしの銀河として残す');
    assert.ok(h.texts.some(([name]) => name === 'src (3)'), '銀河ラベルは全ファイル数');
    for (const body of world.stars) for (const value of ['x', 'y', 'z', 'mag', 'glow', 'mtime']) assert.ok(Number.isFinite(body[value]), `${body.path}.${value}`);
    const before = new Map([...world.planets, ...world.stars].map(body => [body.path, coordinates(body)]));
    const data = fixture(); data.tree.d[0].d[0].d[0].f.push(['another.py', 90, 400]);
    h.data(data); await h.engine.refresh();
    assert.equal(h.engine.world.stars.length, 4); assert.equal(h.engine.world.galaxies[0].files.length, 4);
    for (const [path, position] of before) assert.deepEqual(coordinates(h.engine.world.byPath.get(path)), position, 'ファイル追加で既存配置を動かさない');
    const newPath = 'src/nested/deeper/another.py';
    assert.equal(h.engine.world.byPath.get(newPath).born, Date.now(), '新規ファイル自身だけを強調する');
    assert.equal(h.engine.world.byPath.get('src/nested/deeper/deep.py').born, 0);
    await h.engine.refresh(); assert.equal(h.engine.world.byPath.get(newPath).born, 0, '既存ファイルを毎回新規扱いしない');
    data.tree.d[0].d = [dir('new-empty')]; h.data(data); await h.engine.refresh();
    assert.deepEqual(h.engine.world.stars.map(body => body.path), ['src/main.js']);
    assert.equal(h.engine.world.byPath.has(newPath), false); assert.equal(h.engine.world.galaxies[0].files.length, 1);
  } finally { h.dispose(); }
});

test('深い同名ファイル: 相対パスで別々の座標・色・サイズを持ち、兄弟追加と更新で配置を変えない', async t => {
  const data = snapshot(dir('project', [], [dir('src', [], [
    dir('one', [], [dir('deep', [['same.js', 40, 100]])]),
    dir('two', [], [dir('deep', [['same.js', 102400, 300]])]),
  ])]));
  const h = space(t, data);
  try {
    await h.ready();
    const first = h.engine.world.byPath.get('src/one/deep/same.js'), second = h.engine.world.byPath.get('src/two/deep/same.js');
    assert.notDeepEqual(coordinates(first), coordinates(second)); assert.equal(first.kind, second.kind);
    assert.ok(second.mag > first.mag * 3, '通常ファイル自身の容量補正を代表星の上限で抑えない');
    data.tree.d[0].d.push(dir('three', [], [dir('deep', ['same.js'])]));
    data.tree.d[0].d[0].d[0].f[0] = ['same.js', 50000, 900];
    h.data(data); await h.engine.refresh();
    for (const body of [first, second]) assert.deepEqual(coordinates(h.engine.world.byPath.get(body.path)), coordinates(body));
    const updated = h.engine.world.byPath.get(first.path);
    assert.ok(updated.mag > first.mag); assert.equal(updated.mtime, 900); assert.equal(updated.kind, first.kind);
    assert.equal(h.engine.world.stars.length, 3);
  } finally { h.dispose(); }
});

test('深い星のCanvas実寸: ファイル固有のサイズ・遠近倍率と更新パルスを維持する', async t => {
  const data = snapshot(dir('project', [], [dir('src', [['reference.png', 0, 100]], [dir('nested', [], [dir('deep', [['image.png', 10000, 300], ['large.js', 102400, 400]])])])]));
  const h = space(t, data);
  try {
    await h.ready(); h.engine.marks({ mode: 'since', since: null }); positionSizeSamples(h);
    let previous;
    for (const distance of [600, 1200]) {
      h.engine.cam.dist = h.engine.goal.dist = distance;
      await drawFrame(h);
      const sizes = h.engine.world.stars.map(body => {
        const drawn = renderedStar(h, body), mag = (1 + Math.log10(body.size + 1) * 0.55) * fileSizeScale(body.name, body.size);
        close(body.mag, mag, `${body.path} の容量・種類補正`);
        close(drawn.diameter, mag * (840 / distance) * 4, `${body.path} の画像直径`);
        close(drawn.coreDiameter, drawn.diameter * .2, `${body.path} の不透明本体`);
        return drawn.diameter;
      });
      if (previous) sizes.forEach((size, i) => close(previous[i] / size, 2, '距離2倍で直径は半分'));
      previous = sizes;
    }
    const target = h.engine.world.byPath.get('src/nested/deep/large.js'), sibling = h.engine.world.byPath.get('src/nested/deep/image.png');
    const base = renderedStar(h, target), siblingBase = renderedStar(h, sibling);
    for (const mode of ['grep', 'ai']) {
      h.engine.marks({ mode, paths: [target.path] }); await drawFrame(h, 400);
      const blink = .5 + .5 * Math.sin(performance.now() / 1000 * 1.8), fresh = renderedStar(h, target);
      close(fresh.diameter / base.diameter, 1 + .08 * blink, '対象ファイル自身を明滅・拡大する');
      close(fresh.coreDiameter / base.coreDiameter, 1 + .08 * blink, '不透明本体も同じ倍率');
      close(renderedStar(h, sibling).diameter, siblingBase.diameter, '同じフォルダ内の非対象星は拡大しない');
    }
  } finally { h.dispose(); }
});

test('新規の深い星: 実際のrefreshで誕生し、通常の4倍から6秒で元の大きさと光輪へ戻る', async t => {
  const data = countFixture([0]), h = space(t, data);
  try {
    await h.ready(); h.engine.marks({ mode: 'since', since: null });
    data.tree.d[0].d[0].d[1].d[0].f.push(['newborn.png', 0, Date.now()]);
    h.data(data); await h.engine.refresh(); positionSizeSamples(h);
    const body = h.engine.world.byPath.get('src/count-0/nested/deep/newborn.png');
    assert.equal(body.born, Date.now(), '実時刻で生成されたbornをそのまま検証する');
    const baselineDiameter = body.mag * (840 / h.engine.cam.dist) * 4;
    for (const [ms, age] of [[0, 0], [1000, 1], [2000, 3], [2999, 5.999], [1, 6], [1000, 7]]) {
      await drawFrame(h, ms);
      const drawn = renderedStar(h, body), scale = age < 6 ? 1 + 3 * (1 - age / 6) : 1;
      close(drawn.diameter / baselineDiameter, scale, `${age}秒の通常星サイズ`);
      close(drawn.coreDiameter / (baselineDiameter * .2), scale, `${age}秒の本体サイズ`);
      assert.equal(drawn.images.length, age < 6 ? 2 : 1, '新規光輪は6秒で終える');
      assert.ok(drawn.diameter <= baselineDiameter * 4, '時計の基準差で巨大な星を描かない');
    }
  } finally { h.dispose(); }
});

test('深い更新/grep/AI: ファイル単位の一致と銀河の件数を保ち、描画・hoverで元ツリーを再走査しない', async t => {
  const h = space(t);
  try {
    await h.ready();
    const g = h.engine.world.galaxies[0];
    for (const [marks, count] of [
      [{ mode: 'since', since: 250 }, 1],
      [{ mode: 'grep', paths: ['src/nested/deeper/deep.py', 'src/nested/note.txt', 'src/nested-extra/no.py'] }, 2],
      [{ mode: 'ai', paths: ['src/nested/deeper/deep.py'] }, 1],
      [{ mode: 'since', since: null }, 0],
    ]) { h.engine.marks(marks); assert.equal(g.fresh, count); }
    h.engine.marks({ mode: 'grep', paths: ['src/nested/deeper/deep.py'] });
    for (const file of g.files) for (const key of ['path', 'mtime']) Object.defineProperty(file, key, { get() { assert.fail('描画・hover中に元ファイルのメタデータを再走査しない'); } });
    const blockTraversal = node => {
      for (const child of node.d) blockTraversal(child);
      for (const key of ['d', 'f']) Object.defineProperty(node, key, { get() { assert.fail('描画・hover中に走査ツリーを再帰しない'); } });
    };
    blockTraversal(h.state().scan.tree);
    for (let n = 0; n < 5; n++) await h.pump();
    h.canvas.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 30, clientY: 30 }));
    assert.equal(g.fresh, 1); assert.equal(g.stars.length, 3);
  } finally { h.dispose(); }
});

for (const action of ['click', 'double-click', 'approach']) test(`深い個別星の${action}: 隠れた先行天体があっても正しいファイルを実際の親フォルダで開く`, async t => {
  const h = space(t);
  try {
    await h.ready(); h.engine.marks({ mode: 'since', since: null });
    const world = h.engine.world, g = world.galaxies[0], target = world.byPath.get('src/nested/deeper/deep.py');
    Object.assign(g, { x: 200, y: 0, z: 0 });
    Object.assign(world.galaxies[1], { x: -10000, y: 0, z: 0 });
    Object.assign(world.planets[0], { x: -10000, y: 0, z: 0 });
    Object.assign(world.byPath.get('src/main.js'), { x: 0, y: 0, z: -1000 });
    Object.assign(world.byPath.get('src/nested/note.txt'), { x: 200, y: -50, z: 0 });
    Object.assign(target, { x: 180, y: 30, z: 0 });
    h.camera(); await h.pump();
    const pointer = { pointerId: 1, clientX: 892, clientY: 358 };
    h.canvas.dispatchEvent(event('pointermove', pointer));
    assert.equal(h.tipNodes['.t-name'].textContent, 'deep.py'); assert.match(h.tipNodes['.t-sub'].textContent, /クリックでズームとプレビュー/);
    if (action === 'click') { h.canvas.dispatchEvent(event('pointerdown', pointer)); h.canvas.dispatchEvent(event('pointerup', pointer)); }
    else if (action === 'double-click') h.canvas.dispatchEvent(event('dblclick', pointer));
    else await h.finish(h.engine.approach(target));
    await h.until(() => h.engine.selected?.path === target.path && h.idle());
    assert.deepEqual(h.engine.trail, ['src', 'nested', 'deeper']); assert.equal(h.location.hash, '#/src/nested/deeper');
    assert.equal(h.engine.selected.isPlanet, true); assert.equal(h.engine.selected.isDirectory, undefined);
    assert.equal(h.state().journal[0].type, 'file'); assert.equal(h.state().journal[0].path, target.path);
    assert.ok(h.requests.every(request => request.url.startsWith('/api/galaxy')));
    assert.deepEqual(h.engine.world.planets.map(body => body.path), [target.path]);
  } finally { h.dispose(); }
});

test('空フォルダ・深い検索・閲覧履歴・latest・新規/削除パスは本来のフォルダへ解決する', async t => {
  const h = space(t);
  try {
    await h.ready(); h.engine.setFastWarp(true);
    await h.finish(h.engine.goTo({ type: 'dir', path: 'src' }));
    const empty = h.engine.world.galaxies.find(g => g.path === 'src/empty');
    assert.ok(empty); assert.equal(empty.stars.length, 0);
    await h.finish(h.engine.dive(empty));
    assert.deepEqual(h.engine.trail, ['src', 'empty']); assert.equal(h.engine.world.stars.length, 0); assert.equal(h.engine.selected, null);
    for (const source of ['grep', 'ai', 'history', 'latest']) {
      await h.finish(h.engine.goTo({ type: 'dir', path: '' }));
      const entry = { type: 'file', path: 'src/nested/deeper/deep.py', source, line: 9, column: 2, query: 'needle', matchMtime: 300, matchLength: 6 };
      assert.equal(await h.finish(h.engine.goTo(entry)), true);
      assert.deepEqual(h.engine.trail, ['src', 'nested', 'deeper']);
      assert.equal(h.engine.selected.path, entry.path); assert.equal(h.engine.selected.isDirectory, undefined); assert.equal(h.engine.selected.line, 9);
      assert.equal(h.state().journal[0].type, 'file'); assert.equal(h.state().journal[0].path, entry.path);
      await h.engine.refresh(); assert.equal(h.engine.selected.line, 9);
    }
    const data = fixture(); data.tree.d[0].d[0].d.push(dir('new', [], [dir('inner', [['created.js', 200, 700]])])); h.data(data);
    const path = 'src/nested/new/inner/created.js';
    assert.equal(await h.finish(h.engine.goTo({ type: 'file', path, source: 'latest', mtime: 700 })), true);
    assert.deepEqual(h.engine.trail, ['src', 'nested', 'new', 'inner']); assert.equal(h.engine.selected.path, path); assert.match(h.requests.at(-1).url, /fresh=1/);
    data.tree.d[0].d[0].d.pop(); h.data(data); await h.engine.refresh();
    assert.deepEqual(h.engine.trail, ['src', 'nested']); assert.equal(h.engine.selected, null);
    assert.equal(await h.finish(h.engine.goTo({ type: 'file', path, source: 'history' })), false);
    assert.deepEqual(h.engine.trail, ['src', 'nested']); assert.match(h.errors().at(-1), /見つかりません/);
    h.engine.setViewMode('2d');
    assert.equal(await h.engine.goTo({ type: 'file', path: 'src/nested/deeper/deep.py', source: 'grep', line: 3 }), true);
    assert.deepEqual(h.engine.trail, ['src', 'nested', 'deeper']); assert.equal(h.engine.selected.line, 3); assert.equal(h.frames.size, 0);
  } finally { h.dispose(); }
});

for (const count of [10, 12000]) test(`深い${count}ファイル: 省略せず全ファイルを描画・投影・当たり判定する`, async t => {
  const deep = branch => dir(branch, [], [dir('deep', Array.from({ length: count / 2 }, (_, i) => [`file-${i}.js`, 40, 100]))]);
  const h = space(t, snapshot(dir('project', ['root.js'], [dir('src', ['a.js', 'b.js', 'c.js'], [deep('one'), deep('two')])])));
  try {
    await h.ready(); h.engine.marks({ mode: 'since', since: null });
    const { world } = h.engine, g = world.galaxies[0];
    assert.equal(g.files.length, count + 3); assert.equal(world.stars.length, count + 3); assert.equal(world.planets.length, 1); assert.equal(world.byPath.size, count + 4);
    assert.ok(world.byPath.has(`src/one/deep/file-${count / 2 - 1}.js`)); assert.ok(world.byPath.has(`src/two/deep/file-${count / 2 - 1}.js`));
    Object.assign(g, { x: 200, y: 0, z: 0 });
    Object.assign(world.planets[0], { x: -250, y: -100, z: 0 });
    world.stars.forEach((body, i) => Object.assign(body, { x: 100 + (i % 300), y: 90 - (i % 180), z: 0, lr: 0 }));
    let projections = 0, hitVisits = 0;
    for (const body of world.stars) {
      const x = body.x;
      Object.defineProperty(body, 'x', { get() { projections++; return x; } });
      Object.defineProperty(body, 'isPlanet', { get() { hitVisits++; return false; } });
    }
    for (const file of g.files) for (const key of ['path', 'mtime']) Object.defineProperty(file, key, { get() { assert.fail('フレーム中に元のメタデータを再走査しない'); } });
    h.camera(); h.draws.length = 0; h.arcs.length = 0; await h.pump();
    assert.equal(projections, count + 3); assert.equal(h.draws.length, count + 9, '全星+銀河2+惑星1+ゲート2+直下の静止電子1のdrawImage');
    hitVisits = 0;
    h.canvas.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 30, clientY: 30 }));
    assert.equal(hitVisits, count + 3, '深い星を含めて当たり判定する');
    t.diagnostic(`${count + 3} descendant files -> ${count + 3} individual stars; no depth aggregation (CPU% is not measured)`);
  } finally { h.dispose(); }
});

test('保存済みの深い航路: 実ファイルの星へ正確に結び、削除・種類変更済みパスは復活しない', async t => {
  const data = fixture(); data.tree.d[0].d.push(dir('nested-extra', ['other.py']));
  const h = space(t, data);
  try {
    h.storage.set('aidiy_ide:/project', JSON.stringify({ voyages: { '': [
      'f:root.js', 'f:src/nested/deeper/deep.py', 'f:src/nested-extra/other.py',
      'f:src/nested/deleted.py', 'f:src/nested', 'g:root.js',
    ] }, journal: [] }));
    await h.ready(); h.engine.marks({ mode: 'since', since: null });
    const root = h.engine.world.byPath.get('root.js'), nested = h.engine.world.byPath.get('src/nested/deeper/deep.py'), sibling = h.engine.world.byPath.get('src/nested-extra/other.py');
    Object.assign(root, { x: -250, y: -100, z: 0 }); Object.assign(nested, { x: 180, y: 30, z: 0 }); Object.assign(sibling, { x: 200, y: -50, z: 0 });
    h.camera(); h.routeLines.length = 0; await h.pump();
    assert.deepEqual(h.routeLines, [[892, 358], [920, 470]], '似た名前の隣接フォルダを混同しない');
    data.tree.d[0].d.pop(); h.data(data); await h.engine.refresh();
    Object.assign(h.engine.world.byPath.get('root.js'), { x: -250, y: -100, z: 0 });
    Object.assign(h.engine.world.byPath.get('src/nested/deeper/deep.py'), { x: 180, y: 30, z: 0 });
    h.routeLines.length = 0; await h.pump(); assert.deepEqual(h.routeLines, [[892, 358]]);
  } finally { h.dispose(); }
});

test('古い深い星: 削除後は移動せず、航行中の新しいファイル選択が最後に残る', async t => {
  const h = space(t);
  try {
    await h.ready(); const previous = h.engine.world.byPath.get('src/nested/deeper/deep.py');
    const data = fixture(); data.tree.d[0].d.shift(); h.data(data); await h.engine.refresh();
    assert.equal(await h.finish(h.engine.approach(previous)), false);
    assert.deepEqual(h.engine.trail, []); assert.equal(h.engine.selected, null);
    h.data(fixture()); await h.engine.refresh();
    const first = h.engine.approach(h.engine.world.byPath.get('src/nested/deeper/deep.py'));
    const latest = h.engine.goTo({ type: 'file', path: 'root.js' });
    const result = await h.finish(Promise.all([first, latest]));
    assert.notEqual(result[0], true); assert.equal(result[1], true);
    assert.deepEqual(h.engine.trail, []); assert.equal(h.engine.selected.path, 'root.js');
    for (let n = 0; n < 20; n++) await h.pump(); assert.equal(h.engine.selected.path, 'root.js');
  } finally { h.dispose(); }
});


test('閲覧の分岐: 再訪で明細を増やさず、現在点を保存して再開する', async t => {
  const data=snapshot(dir('project',['A','B','C','D'],[dir('child',['A','B'])]));
  const h=space(t,data);let saved;
  try {
    await h.ready();h.engine.setViewMode('2d');
    for(const path of ['A','B','B','A','C','A'])await h.engine.goTo({type:'file',path});
    saved=JSON.parse(h.storage.get('aidiy_ide:/project'));
    assert.deepEqual(saved.voyages[''],[{from:null,to:'f:A'},{from:'f:A',to:'f:B'},{from:'f:A',to:'f:C'}]);
    assert.equal(saved.voyageCurrent[''],'f:A');
    await h.engine.goTo({type:'file',path:'child/A'});await h.engine.goTo({type:'file',path:'child/B'});
    const childSaved=JSON.parse(h.storage.get('aidiy_ide:/project'));
    assert.deepEqual(childSaved.voyages.child,[{from:null,to:'f:child/A'},{from:'f:child/A',to:'f:child/B'}]);
    assert.deepEqual(childSaved.voyages[''],saved.voyages['']);
  } finally {h.dispose();}
  const reopened=space(t,data);
  try {
    reopened.storage.set('aidiy_ide:/project',JSON.stringify(saved));
    await reopened.ready();reopened.engine.setViewMode('2d');
    await reopened.engine.goTo({type:'file',path:'D'});
    const after=JSON.parse(reopened.storage.get('aidiy_ide:/project'));
    assert.deepEqual(after.voyages[''].at(-1),{from:'f:A',to:'f:D'});
    assert.equal(after.voyages[''].length,4);
  } finally {reopened.dispose();}
});

test('分岐の描画: 明細間を連結せず、途中の削除点を飛び越す線も作らない',async t=>{
  const h=space(t,snapshot(dir('project',['A','B','C','D'])));
  try {
    h.storage.set('aidiy_ide:/project',JSON.stringify({version:2,voyages:{'':[
      {from:null,to:'f:A'},{from:'f:A',to:'f:B'},
      {from:'f:A',to:'f:C'},{from:'f:deleted',to:'f:D'},
    ]},voyageCurrent:{'':'f:A'},journal:[]}));
    await h.ready();h.engine.marks({mode:'since',since:null});
    for(const [i,path] of ['A','B','C','D'].entries())Object.assign(h.engine.world.byPath.get(path),{x:i*100-200,y:0,z:0});
    h.camera();h.routeLines.length=0;await h.pump();
    assert.equal(h.routeLines.length,2,'A→B と A→C のみ。C→D で穴を埋めない');
  } finally {h.dispose();}
});

for(const mode of ['2d','3d'])test(`${mode}のフォルダ移動: 親階層の点として記録し、子階層の現在点へ混ぜない`,async t=>{
  const h=space(t,snapshot(dir('project',['A'],[dir('child',['B'])])));
  try{
    await h.ready();h.engine.setViewMode(mode);
    await h.finish(h.engine.goTo({type:'file',path:'A'}));
    await h.finish(h.engine.goTo({type:'dir',path:'child'}));
    let saved=JSON.parse(h.storage.get('aidiy_ide:/project'));
    assert.deepEqual(saved.voyages[''],[{from:null,to:'f:A'},{from:'f:A',to:'g:child'}]);
    assert.equal(saved.voyageCurrent[''],'g:child');assert.equal(saved.voyages.child,undefined);
    await h.finish(h.engine.goTo({type:'file',path:'child/B'}));
    saved=JSON.parse(h.storage.get('aidiy_ide:/project'));
    assert.deepEqual(saved.voyages.child,[{from:null,to:'f:child/B'}]);
    await h.finish(h.engine.goTo({type:'dir',path:''}));
    assert.equal(h.state().trail.length,0);
    assert.equal(JSON.parse(h.storage.get('aidiy_ide:/project')).voyages[''].length,2,'ルート自身の不正な点を追加しない');
  }finally{h.dispose();}
});

test('検索の再登場点: A→B→Aでも最後の到着点の強調を落とさない',async t=>{
  const h=space(t,snapshot(dir('project',[],[dir('src',['A','C']),dir('other',['B'])])));
  try {
    await h.ready();h.engine.marks({mode:'since',since:null});
    h.engine.route({mode:'ai',paths:['src/A','other/B','src/C']});
    for(const [i,galaxy] of h.engine.world.galaxies.entries())Object.assign(galaxy,{x:i*200-100,y:0,z:0});
    h.camera();h.routeMarkers.length=0;h.routeLines.length=0;await h.pump();
    assert.equal(h.routeLines.length,2,'src→other と other→src は同じ線として1本だけ描く');
    assert.equal(h.routeMarkers.filter(marker=>marker.alpha===.95).length,1,'再登場した最終点srcを強調する');
  } finally {h.dispose();}
});

test('検索明細のUI受渡: Explorerのroute通知からengine保持・描画へ渡し、旧通知も補完する',async t=>{
  const h=space(t,snapshot(dir('project',['A','B'])));
  try {
    await h.ready();
    const records=[{from:null,to:'f:A'},{from:'f:A',to:'f:B'}];
    const source=readFileSync(new URL('../src/components/ファイル閲覧/ファイル一覧.vue',import.meta.url),'utf8');
    const notification=source.split('\n').find(line=>line.startsWith('watch([routeMode,aiRoute,searchRoute]'));
    assert.ok(notification);
    const dispatch=result=>runInNewContext(notification,{
      watch:(_sources,callback)=>callback(),routeMode:{value:'ai'},aiRoute:{value:['A','B']},searchRoute:{value:[]},
      aiResult:{value:result},emit:(event,value)=>{assert.equal(event,'route');h.engine.route(value);},
    });
    dispatch({routeRecords:records});
    assert.deepEqual(structuredClone(h.engine.searchRouteRecords),records);
    records[0].to='f:changed';
    assert.equal(h.engine.searchRouteRecords[0].to,'f:A','外部配列から切り離して保持する');
    dispatch({});
    assert.deepEqual(structuredClone(h.engine.searchRouteRecords),[{from:null,to:'f:A'},{from:'f:A',to:'f:B'}]);
    h.engine.marks({mode:'since',since:null});
    Object.assign(h.engine.world.byPath.get('A'),{x:-100,y:0,z:0});
    Object.assign(h.engine.world.byPath.get('B'),{x:100,y:0,z:0});
    h.camera();h.routeLines.length=0;await h.pump();
    assert.equal(h.routeLines.length,2,'中心→A→Bを保持した明細から描く');
  } finally {h.dispose();}
});


test('始点行なしの逆辺復元: from側の現在点にもマーカーを残す',async t=>{
  const h=space(t,snapshot(dir('project',['A','B'])));
  try {
    h.storage.set('aidiy_ide:/project',JSON.stringify({voyages:{'':[
      {from:'f:A',to:'f:B'},{from:'f:B',to:'f:A'},
    ]},journal:[]}));
    await h.ready();h.engine.marks({mode:'since',since:null});
    Object.assign(h.engine.world.byPath.get('A'),{x:-100,y:0,z:0});
    Object.assign(h.engine.world.byPath.get('B'),{x:100,y:0,z:0});
    h.camera();h.routeMarkers.length=0;h.routeLines.length=0;await h.pump();
    assert.equal(h.routeLines.length,1,'往復は同じ経路1本');
    assert.equal(h.routeMarkers.length,2,'from/toの両端を示す');
    assert.equal(h.routeMarkers.filter(marker=>marker.alpha===.95).length,1,'現在点Aも強調する');
  }finally{h.dispose();}
});


test('更新の目印: 30秒監視スナップショットと手動更新が同じ基準を使い、選択・フォルダ・日付を守る', async t => {
  const h=space(t,snapshot(dir('project',[['a.txt',1,100],['b.txt',1,200]],[dir('child',[['nested.txt',1,300]])])));
  try {
    h.engine.setViewMode('2d');await h.ready();
    assert.deepEqual({...h.engine.updateMarks.levels},{'a.txt':1,'b.txt':2});
    assert.deepEqual(h.engine.updateMarks.flashes,{});
    await h.engine.goTo({type:'file',path:'a.txt'});h.engine.setAutoSpin(true);
    const tree=dir('project',[['a.txt',2,400],['b.txt',1,200],['added.txt',1,400]],[dir('child',[['nested.txt',1,300]])]);
    assert.equal(h.engine.applyFolderSnapshot({path:'',filter:'backup'},{tree,truncated:false}),true);
    assert.deepEqual(Object.keys(h.engine.updateMarks.flashes),['a.txt','added.txt']);
    assert.equal(h.engine.selected.path,'a.txt');
    const id=h.engine.updateMarks.flashes['a.txt'].id;
    assert.equal(h.engine.applyFolderSnapshot({path:'',filter:'backup'},{tree,truncated:false}),true);
    assert.equal(h.engine.updateMarks.flashes['a.txt'].id,id);
    await h.pump(1200);assert.deepEqual(h.engine.updateMarks.flashes,{});
    h.data(snapshot(tree));await h.engine.refresh();assert.deepEqual(h.engine.updateMarks.flashes,{});
    await h.engine.goTo({type:'dir',path:'child'});assert.deepEqual({...h.engine.updateMarks.levels},{'child/nested.txt':2});
    assert.deepEqual(h.engine.updateMarks.flashes,{});
    await h.pump(86400000);assert.deepEqual({...h.engine.updateMarks.levels},{});
    assert.equal(h.engine.updateMarks.latest,null);
  } finally {h.dispose();}
});
