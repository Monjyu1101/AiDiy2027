// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const docxRenderer = require('docx-preview');
const source = await readFile(new URL('../web/office.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../web/office.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../web/office.css', import.meta.url), 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {};
    this.hidden = false; this.disabled = false; this.style = {}; this.className = '';
    this._text = ''; this.events = new Map(); this.scrollTop = 0; this.scrollLeft = 0;
    this.clientWidth = 600; this.offsetWidth = 600;
    this.classList = { toggle: (name, enabled) => {
      const values = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) values.add(name); else values.delete(name);
      this.className = [...values].join(' ');
    } };
  }
  get textContent() { return this._text || this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get firstChild() { return this.children[0] || null; }
  get isConnected() { return !!(this.connectedRoot || this.parentNode?.isConnected); }
  append(...nodes) {
    for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); }
  }
  appendChild(node) { this.append(node); return node; }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  replaceChildren(...nodes) {
    for (const node of this.children) node.parentNode = null;
    this.children = []; this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { this.events.set(name, callback); }
  scrollTo(left, top) { this.scrollLeft = left; this.scrollTop = top; }
  scrollIntoView(options) { this.scrollCalls = (this.scrollCalls || 0) + 1; this.scrollOptions = options; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  createTHead() { const node = new Element('thead'); this.append(node); return node; }
  createTBody() { const node = new Element('tbody'); this.append(node); return node; }
  insertRow() { const node = new Element('tr'); this.append(node); return node; }
  insertCell() { const node = new Element('td'); this.append(node); return node; }
  getContext() { return { canvas: this, drawImage: source => { this.paint = source.paint; } }; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(selector === 'section.docx' && child.tagName === 'SECTION' && child.className === 'docx' ? [child] : []),
      ...(selector === '[id]' && child.id ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}
class Select extends Element {}
class Input extends Element {}

function docxElement(element) {
  if (element instanceof Element) return element;
  if (typeof element === 'string') { const text = new Element('#text'); text.textContent = element; return text; }
  const { tagName, ns, className, style, children, ...properties } = element;
  const node = new Element(tagName); node.className = className || '';
  Object.assign(node.style, style); Object.assign(node, properties);
  if (style?.width) node.offsetWidth = parseFloat(style.width);
  if (children) node.append(...children.map(docxElement));
  return node;
}

function workbook(sizes = { 長いシート: 401, 短いシート: 2, 空のシート: 0 }) {
  const book = XLSX.utils.book_new();
  for (const [name, count] of Object.entries(sizes)) {
    const sheet = XLSX.utils.aoa_to_sheet(Array.from({ length: count }, (_, i) => [`${name} ${i + 1}`]));
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  return book;
}

function harness(format = 'excel', options = {}) {
  const nodes = new Map();
  for (const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = match[1] === 'select' ? new Select(match[1]) : new Element(match[1]);
    node.hidden = /\bhidden\b/.test(match[2]); nodes.set(match[3], node);
  }
  const get = id => nodes.get(id);
  get('content').connectedRoot = true;
  get('content').append(get('page-top'), get('document-page'), get('page-bottom'));
  get('page-top').append(get('page-previous')); get('page-bottom').append(get('page-next'));
  get('zoom').value = 'fit'; get('notice').textContent = '読み込み中…';
  const listeners = new Map(), timers = new Map(), frames = new Map(), scripts = [], renders = [], gets = [], fetches = [], messages = [];
  const state = { destroyed: 0, disconnected: 0, activeRenders: 0, maxActiveRenders: 0, failSheet: null };
  let timerId = 0, frameId = 0, resize;
  const requestFrame = callback => {
    const id = ++frameId; frames.set(id, callback);
    if (options.autoFrames !== false) queueMicrotask(() => { if (frames.delete(id)) callback(); });
    return id;
  };
  const dispatch = (name, event = {}) => {
    for (const item of [...(listeners.get(name) || [])]) {
      if (item.once) listeners.set(name, listeners.get(name).filter(other => other !== item));
      item.callback(event);
    }
  };
  const render = (canvas, index) => {
    const task = deferred();
    const record = { canvas, index, ...task };
    renders.push(record); state.activeRenders++; state.maxActiveRenders = Math.max(state.maxActiveRenders, state.activeRenders);
    const promise = task.promise.then(() => { canvas.paint = index; }).finally(() => { state.activeRenders--; });
    if (options.autoRender !== false) task.resolve();
    return promise;
  };
  class Viewer {
    constructor(config) { state.viewerOptions = config; this.processor = { getSlideDimensions: () => ({ cx: 1600, cy: 900 }) }; }
    async loadFile() { if (options.load) await options.load.promise; }
    getSlideCount() { return options.pages ?? 3; }
    render(canvas, { slideIndex }) { return render(canvas, slideIndex); }
    destroy() { state.destroyed++; }
  }
  const doc = {
    numPages: options.pages ?? 3,
    async getPage(number) {
      gets.push(number);
      if (options.getPage) await options.getPage.promise;
      return {
        getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
        render: ({ canvasContext }) => ({ promise: render(canvasContext.canvas, number - 1) }),
      };
    },
  };
  const pdfTask = { promise: options.load ? options.load.promise.then(() => doc) : Promise.resolve(doc), destroy: () => { state.destroyed++; } };
  const pdfjs = { GlobalWorkerOptions: {}, getDocument: () => pdfTask };
  const head = new Element('head');
  head.append = script => { scripts.push(script); if (options.autoScript !== false) queueMicrotask(() => script.onload?.()); };
  const book = options.book || workbook();
  const xlsx = {
    ...XLSX, read: () => book,
    utils: { ...XLSX.utils, format_cell: cell => {
      if (state.failSheet && String(cell.v).startsWith(state.failSheet)) throw new Error('sheet render failed');
      return XLSX.utils.format_cell(cell);
    } },
  };
  const docx = { async renderAsync(_data, pages, _styles, config) {
    state.wordOptions = config;
    if (options.load) await options.load.promise;
    if (options.wordDocument) {
      pages.append(...await docxRenderer.renderDocument(options.wordDocument, { ...config, h: docxElement }));
      return;
    }
    const style = new Element('style'); style.textContent = '.docx { color: black; }';
    const wrapper = new Element('div'); wrapper.className = 'docx-wrapper';
    pages.append(style, wrapper);
    for (let i = 0; i < (options.pages ?? 2); i++) {
      const section = new Element('section'); section.className = 'docx';
      section.offsetWidth = options.widths?.[i] ?? 600;
      for (const tag of ['header', 'article', 'footer', 'aside']) {
        const child = new Element(tag); child.textContent = `${tag} ${i + 1}`; section.append(child);
      }
      const bookmark = new Element('span'); bookmark.id = `見出し ${i + 1}`; section.children[1].append(bookmark);
      wrapper.append(section);
    }
    if (options.vml) {
      requestFrame(() => {
        state.vmlMeasurement = pages.querySelectorAll('section.docx').map(section => ({ connected: section.isConnected, hidden: section.hidden }));
      });
    }
  } };
  const context = createContext({
    URLSearchParams, AbortController, TextDecoder, Uint8Array,
    location: { search: `?path=sample.${format === 'excel' ? 'xlsx' : format}&format=${format}`, origin: 'http://127.0.0.1' },
    document: { getElementById: get, createElement: tag => new Element(tag), head },
    window: { XLSX: xlsx, PptxViewJS: { PPTXViewer: Viewer }, docx, currentProcessor: {} },
    parent: { postMessage: (...args) => messages.push(args) },
    HTMLSelectElement: Select, HTMLInputElement: Input, devicePixelRatio: 2,
    fetch: async (_url, config) => {
      fetches.push(config);
      if (options.fetch) await options.fetch.promise;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
    },
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect() { state.disconnected++; }
    },
    addEventListener: (name, callback, config = {}) => listeners.set(name, [...(listeners.get(name) || []), { callback, once: config.once }]),
    removeEventListener: (name, callback) => listeners.set(name, (listeners.get(name) || []).filter(item => item.callback !== callback)),
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: id => frames.delete(id),
    // 動的importの境界だけ差し替え、画面側の起動・操作・描画制御は実装をそのまま実行する。
    mockPdfImport: () => Promise.resolve(pdfjs),
  });
  assert.equal(source.split("import('/office-vendor/pdf.mjs')").length, 2);
  runInContext(source.replace("import('/office-vendor/pdf.mjs')", 'mockPdfImport()'), context);
  const click = id => { const node = get(id); if (!node.disabled) node.onclick?.(); };
  const sheet = name => get('sheets').children.find(node => node.textContent === name).onclick();
  const key = (key, target = get('document-page'), extra = {}) => {
    const event = { key, target, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    dispatch('keydown', event); return event;
  };
  const runTimers = () => { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); };
  const runFrames = () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); };
  const link = href => {
    const anchor = new Element('a'); anchor.setAttribute('href', href); anchor.closest = () => anchor;
    const event = { target: anchor, prevented: false, preventDefault() { this.prevented = true; } };
    get('content').events.get('click')(event); return event;
  };
  const snapshot = () => [...nodes].map(([id, node]) => [id, node.hidden, node.disabled, node.textContent, node.attributes, node.style, node.className, node.scrollTop, node.scrollLeft, node.children.length]);
  return { get, click, sheet, key, link, resize: () => resize(), runTimers, timers, runFrames, frames, renders, gets, scripts, fetches, state, dispatch, messages, snapshot, context };
}

function cues(h, previous, next, status) {
  assert.equal(h.get('page-top').hidden, !previous, '先頭の前ページ案内');
  assert.equal(h.get('page-bottom').hidden, !next, '末尾の次ページ案内');
  if (status) assert.equal(h.get('page-status').textContent, status);
}
function rowNumbers(h) { return h.get('document-page').firstChild.children[1].children.map(row => row.firstChild.textContent); }

// DOMモックで操作・状態遷移を検証する。実ブラウザでの配置・描画確認を代替するものではない。
test('Office本文は先頭・内容・末尾の順で、先頭右端に前ページ操作を配置する', () => {
  assert.match(html, /<main id="content">\s*<nav id="page-top"[\s\S]*?id="page-previous"[^>]*>前のページへ<\/button>[\s\S]*?id="document-page"[\s\S]*?id="page-bottom"[\s\S]*?id="page-next"[^>]*>次のページへ<\/button>/);
  assert.match(css, /\.page-navigation\s*\{[^}]*justify-content:\s*flex-end/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(html, /id="previous"/); assert.match(html, /id="next"/);
});

test('Excelの先頭・中間・末尾は本文ボタン・ツールバー・キーで同じページへ移る', async () => {
  const h = harness(); await flush();
  cues(h, false, true, '1–200 / 401 行'); assert.deepEqual(rowNumbers(h), Array.from({ length: 200 }, (_, i) => String(i + 1)));
  h.get('content').scrollTo(80, 900); h.click('page-next');
  assert(h.get('page-next').disabled); h.click('next'); h.key('PageDown');
  cues(h, false, true, '1–200 / 401 行'); await flush();
  cues(h, true, true, '201–400 / 401 行'); assert.equal(rowNumbers(h)[0], '201');
  assert.equal(h.get('content').scrollTop, 0); assert.equal(h.get('content').scrollLeft, 0);
  h.click('next'); await flush(); cues(h, true, false, '401–401 / 401 行'); assert.deepEqual(rowNumbers(h), ['401']);
  h.key('PageDown'); await flush(); cues(h, true, false, '401–401 / 401 行');
  h.click('page-previous'); await flush(); cues(h, true, true, '201–400 / 401 行');
  assert(h.key('PageUp').prevented); await flush(); cues(h, false, true, '1–200 / 401 行');
  h.click('previous'); await flush(); cues(h, false, true, '1–200 / 401 行');
});

test('Excelのシート切替は先頭に戻り、空・1ページ・200行境界では不要な案内を出さない', async () => {
  const h = harness('excel', { book: workbook({ 長いシート: 401, 短いシート: 2, 空のシート: 0, 境界: 200, 境界超過: 201 }) }); await flush();
  h.click('next'); await flush(); h.get('content').scrollTo(100, 900);
  h.sheet('短いシート'); await flush(); cues(h, false, false, '1–2 / 2 行');
  assert.equal(h.get('content').scrollTop, 0); assert(h.get('previous').hidden && h.get('next').hidden);
  h.sheet('空のシート'); await flush(); cues(h, false, false, '空のシート'); assert.equal(h.get('document-page').firstChild, null);
  h.sheet('境界'); await flush(); cues(h, false, false, '1–200 / 200 行');
  h.sheet('境界超過'); await flush(); cues(h, false, true, '1–200 / 201 行');
  h.click('page-next'); await flush(); cues(h, true, false, '201–201 / 201 行');
  h.sheet('長いシート'); h.sheet('短いシート'); h.sheet('空のシート'); await flush(); cues(h, false, false, '空のシート');
  assert.deepEqual(h.get('sheets').children.filter(node => node.getAttribute('aria-selected') === 'true').map(node => node.textContent), ['空のシート']);
});

test('Excelの描画失敗は表示済みシートと送り先を保ち、再試行で回復する', async () => {
  const h = harness(); await flush(); h.click('next'); await flush();
  const previous = h.get('document-page').firstChild;
  h.state.failSheet = '短いシート'; h.sheet('短いシート'); await flush();
  assert.equal(h.get('document-page').firstChild, previous); cues(h, true, true, '201–400 / 401 行');
  assert.match(h.get('notice').textContent, /sheet render failed/);
  h.click('page-next'); await flush(); cues(h, true, false, '401–401 / 401 行');
  assert(h.get('notice').hidden);
  h.state.failSheet = null; h.sheet('短いシート'); await flush(); cues(h, false, false, '1–2 / 2 行');
});

for (const format of ['pdf', 'powerpoint']) {
  test(`${format}: 遅い描画中は表示済みページを保持し、連打を抑制して完成時に切り替える`, async () => {
    const h = harness(format, { autoRender: false }); await flush(); cues(h, false, false);
    h.renders[0].resolve(); await flush(); cues(h, false, true, '1 / 3');
    const first = h.get('document-page').firstChild;
    h.get('content').scrollTo(100, 500); h.click('page-next'); await flush();
    assert.equal(h.renders.length, 2); assert.equal(h.renders[1].index, 1);
    assert.equal(h.get('document-page').firstChild, first); cues(h, false, true, '1 / 3');
    h.click('page-next'); h.click('next'); h.key('ArrowRight'); await flush(); assert.equal(h.renders.length, 2);
    h.renders[1].resolve(); await flush(); cues(h, true, true, '2 / 3');
    assert.equal(h.get('content').scrollTop, 0); assert.equal(h.get('document-page').firstChild.paint, 1);
    h.key('PageDown'); await flush(); h.renders[2].resolve(); await flush(); cues(h, true, false, '3 / 3');
    h.click('page-previous'); await flush(); h.renders[3].resolve(); await flush(); cues(h, true, true, '2 / 3');
    assert.equal(h.state.maxActiveRenders, 1);
  });

  test(`${format}: 倍率・リサイズの連続要求を直列化し、古い結果・古いエラーを反映しない`, async () => {
    const h = harness(format, { autoRender: false }); await flush();
    h.renders[0].resolve(); await flush(); const first = h.get('document-page').firstChild;
    h.click('next'); await flush();
    h.get('zoom').value = '2'; h.get('zoom').onchange(); h.get('content').clientWidth = 900; h.resize(); h.runTimers();
    h.renders[1].reject(new Error('古い描画エラー')); await flush();
    assert.equal(h.get('document-page').firstChild, first); assert(h.get('notice').hidden);
    assert.equal(h.renders.length, 3); assert.equal(h.renders[2].index, 1);
    h.get('zoom').value = 'fit'; h.get('zoom').onchange(); h.renders[2].resolve(); await flush();
    assert.equal(h.get('document-page').firstChild, first); assert.equal(h.renders.length, 4);
    assert(Math.abs(parseFloat(h.renders[3].canvas.style.width) - 874) < 0.001);
    h.renders[3].resolve(); await flush(); cues(h, true, true, '2 / 3');
    assert.equal(h.get('document-page').firstChild.paint, 1); assert.equal(h.state.maxActiveRenders, 1);
    if (format === 'powerpoint') assert(h.renders.every(item => item.canvas === h.state.viewerOptions.canvas));
    h.get('content').scrollTo(20, 300); h.resize(); h.runTimers(); await flush(); h.renders[4].resolve(); await flush();
    assert.equal(h.get('content').scrollTop, 300); assert.equal(h.get('content').scrollLeft, 20);
  });

  test(`${format}: 描画失敗時は内容と番号を一致させ、同じ送り先へ再試行できる`, async () => {
    const h = harness(format, { autoRender: false }); await flush(); h.renders[0].resolve(); await flush();
    const first = h.get('document-page').firstChild; h.click('next'); await flush();
    h.renders[1].reject(new Error('render failed')); await flush();
    assert.equal(h.get('document-page').firstChild, first); cues(h, false, true, '1 / 3');
    assert.match(h.get('notice').textContent, /render failed/); assert.equal(h.get('page-next').disabled, false);
    h.click('page-next'); await flush(); assert.equal(h.renders[2].index, 1);
    h.renders[2].resolve(); await flush(); cues(h, true, true, '2 / 3'); assert(h.get('notice').hidden);
  });

  test(`${format}: 1ページと空文書に前後案内を出さない`, async () => {
    const single = harness(format, { pages: 1 }); await flush(); cues(single, false, false, '1 / 1');
    assert(single.get('next').hidden); assert(single.get('previous').hidden);
    single.key('ArrowRight'); await flush(); assert.equal(single.renders.length, 1);
    const empty = harness(format, { pages: 0 }); await flush(); cues(empty, false, false);
    assert.match(empty.get('notice').textContent, /見つかりません/); assert.equal(empty.renders.length, 0);
  });

  test(`${format}: 破棄後の描画完了・失敗は画面を更新せず、タイマーと監視を解除する`, async () => {
    for (const reject of [false, true]) {
      const h = harness(format, { autoRender: false }); await flush(); h.renders[0].resolve(); await flush();
      h.click('next'); await flush(); h.resize(); assert.equal(h.timers.size, 1);
      h.dispatch('pagehide'); const snapshot = JSON.stringify(h.snapshot());
      assert.equal(h.timers.size, 0); assert.equal(h.state.disconnected, 1); assert.equal(h.state.destroyed, 1);
      assert(h.fetches[0].signal.aborted);
      if (reject) h.renders[1].reject(new Error('late error')); else h.renders[1].resolve();
      await flush(); h.resize(); h.runTimers(); h.key('PageDown'); await flush();
      assert.equal(JSON.stringify(h.snapshot()), snapshot); assert.equal(h.renders.length, 2);
    }
  });

  test(`${format}: 読込中に閉じても後着結果を表示しない`, async () => {
    const load = deferred(), h = harness(format, { load }); await flush();
    h.dispatch('pagehide'); const snapshot = JSON.stringify(h.snapshot()); load.resolve(); await flush();
    assert.equal(JSON.stringify(h.snapshot()), snapshot); assert.equal(h.renders.length, 0); assert(h.state.destroyed >= 1);
  });
}

test('Wordは生成済みページを前後送りし、本文・ヘッダー・脚注・スタイルを保持する', async () => {
  const h = harness('word', { pages: 3 }); await flush(); cues(h, false, true, '1 / 3');
  const pages = h.get('document-page').firstChild, wrapper = pages.children[1], style = pages.firstChild;
  const sections = pages.querySelectorAll('section.docx');
  const originalChildren = sections.map(section => [...section.children]);
  assert.deepEqual(sections.map(section => section.hidden), [false, true, true]);
  assert(sections.every(section => section.isConnected)); assert.equal(pages.style.visibility, '');
  h.get('content').scrollTo(80, 900); h.click('page-next'); h.click('next'); await flush();
  cues(h, true, true, '2 / 3'); assert.deepEqual(sections.map(section => section.hidden), [true, false, true]);
  assert.equal(h.get('content').scrollTop, 0); assert.equal(h.get('content').scrollLeft, 0);
  h.key('PageDown'); await flush(); cues(h, true, false, '3 / 3');
  assert.deepEqual(sections.map(section => section.hidden), [true, true, false]);
  h.key('PageDown'); await flush(); cues(h, true, false, '3 / 3');
  h.click('page-previous'); await flush(); cues(h, true, true, '2 / 3');
  h.click('previous'); await flush(); cues(h, false, true, '1 / 3');
  assert.equal(h.get('document-page').firstChild, pages); assert.equal(pages.firstChild, style); assert.equal(pages.children[1], wrapper);
  sections.forEach((section, i) => assert.deepEqual(section.children, originalChildren[i]));
  for (const key of ['breakPages', 'renderHeaders', 'renderFooters', 'renderFootnotes', 'renderEndnotes']) assert.equal(h.state.wordOptions[key], true);
  assert.equal(h.state.wordOptions.ignoreLastRenderedPageBreak, false); assert.equal(h.state.wordOptions.renderAltChunks, false);
});

test('Wordはページごとの幅・倍率を維持し、リサイズで現在ページやスクロールを変えない', async () => {
  const h = harness('word', { pages: 3, widths: [600, 800, 400] }); await flush();
  const pages = h.get('document-page').firstChild;
  assert.equal(pages.style.width, '624px'); assert.equal(pages.style.zoom, 598 / 624);
  h.get('zoom').value = '1.5'; h.get('zoom').onchange(); await flush();
  assert.equal(pages.style.zoom, 1.5); cues(h, false, true, '1 / 3');
  h.click('next'); await flush(); assert.equal(pages.style.width, '824px'); assert.equal(pages.style.zoom, 1.5);
  h.get('content').scrollTo(90, 300); h.get('content').clientWidth = 400;
  h.get('zoom').value = 'fit'; h.get('zoom').onchange(); h.resize(); h.runTimers(); await flush();
  cues(h, true, true, '2 / 3'); assert.equal(pages.style.zoom, 398 / 824);
  assert.equal(h.get('content').scrollTop, 300); assert.equal(h.get('content').scrollLeft, 90);
  h.key('ArrowRight'); await flush(); cues(h, true, false, '3 / 3'); assert.equal(pages.style.width, '424px');
  h.get('content').clientWidth = 0; h.resize(); h.runTimers(); await flush(); assert(pages.style.zoom > 0);
});

test('Wordの1ページ・空文書は前後案内を隠す', async () => {
  const single = harness('word', { pages: 1 }); await flush(); cues(single, false, false, '1 / 1');
  assert(single.get('previous').hidden && single.get('next').hidden);
  single.key('ArrowRight'); await flush(); cues(single, false, false, '1 / 1');
  assert.equal(single.get('document-page').firstChild.querySelectorAll('section.docx')[0].hidden, false);
  const empty = harness('word', { pages: 0 }); await flush(); cues(empty, false, false);
  assert.match(empty.get('notice').textContent, /ページが見つかりません/);
});

test('Wordの先行VML計測は接続済み・非hiddenの全ページを見てから最初のページを選ぶ', async () => {
  const h = harness('word', { pages: 3, autoFrames: false, vml: true }); await flush();
  const pages = h.get('document-page').firstChild, sections = pages.querySelectorAll('section.docx');
  assert.equal(pages.style.visibility, 'hidden'); assert.deepEqual(sections.map(section => section.hidden), [false, false, false]);
  cues(h, false, false); assert.equal(h.frames.size, 2);
  h.runFrames(); await flush();
  assert.deepEqual(h.state.vmlMeasurement, Array.from({ length: 3 }, () => ({ connected: true, hidden: false })));
  cues(h, false, true, '1 / 3'); assert.deepEqual(sections.map(section => section.hidden), [false, true, true]);
});

test('WordのRAF待機中・ページ切替中の破棄は後着更新を止める', async () => {
  const waiting = harness('word', { autoFrames: false }); await flush(); assert.equal(waiting.frames.size, 1);
  const callback = [...waiting.frames.values()][0]; waiting.dispatch('pagehide'); assert.equal(waiting.frames.size, 0);
  const before = JSON.stringify(waiting.snapshot()); callback(); await flush();
  assert.equal(JSON.stringify(waiting.snapshot()), before); assert.equal(waiting.get('document-page').children.length, 0);
  const h = harness('word', { pages: 3 }); await flush();
  h.click('page-next'); h.dispatch('pagehide'); const closed = JSON.stringify(h.snapshot()); await flush();
  h.key('PageDown'); h.resize(); h.runTimers(); await flush(); assert.equal(JSON.stringify(h.snapshot()), closed);
});

test('Wordのブックマークは対象ページへ切替後に移動し、新しいリンク・破棄で古い移動を取り消す', async () => {
  const h = harness('word', { pages: 3 }); await flush();
  const targets = h.get('document-page').firstChild.querySelectorAll('[id]');
  assert(h.link('#' + encodeURIComponent('見出し 3')).prevented);
  assert.equal(targets[2].scrollCalls, undefined); await flush(); cues(h, true, false, '3 / 3');
  assert.equal(targets[2].scrollCalls, 1); assert.equal(targets[2].scrollOptions.block, 'start');
  h.get('zoom').value = '2'; h.get('zoom').onchange(); await flush(); assert.equal(targets[2].scrollCalls, 1);
  h.link('#' + encodeURIComponent('見出し 1')); h.link('#' + encodeURIComponent('見出し 2')); await flush();
  cues(h, true, true, '2 / 3'); assert.equal(targets[0].scrollCalls, undefined); assert.equal(targets[1].scrollCalls, 1);
  h.click('previous'); await flush(); cues(h, false, true, '1 / 3'); assert.equal(targets[1].scrollCalls, 1);
  assert(h.link('https://example.invalid/').prevented); assert(h.link('#missing').prevented); assert(h.link('#%zz').prevented);
  h.link('#' + encodeURIComponent('見出し 3')); h.dispatch('pagehide'); await flush(); assert.equal(targets[2].scrollCalls, 1);
});

test('fetch・ライブラリ取得中に閉じた場合も遅い結果を反映しない', async () => {
  const fetch = deferred(), pending = harness('excel', { fetch }); await flush();
  pending.dispatch('pagehide'); const before = JSON.stringify(pending.snapshot()); fetch.resolve(); await flush();
  assert.equal(pending.scripts.length, 0); assert.equal(JSON.stringify(pending.snapshot()), before);
  const loading = harness('excel', { autoScript: false }); await flush(); assert.equal(loading.scripts.length, 1);
  const late = loading.scripts[0].onload; loading.dispatch('pagehide'); const initial = JSON.stringify(loading.snapshot());
  late(); await flush(); assert.equal(JSON.stringify(loading.snapshot()), initial); assert.equal(loading.get('sheets').children.length, 0);
});

test('倍率欄・入力欄のキーを奪わず、Esc・Ctrl+Bは親画面へ通知する', async () => {
  const h = harness(); await flush();
  assert.equal(h.key('ArrowRight', h.get('zoom')).prevented, false);
  assert.equal(h.key('PageDown', new Input()).prevented, false);
  await flush(); cues(h, false, true, '1–200 / 401 行');
  assert(h.key('Escape').prevented); assert(h.key('b', h.get('zoom'), { ctrlKey: true }).prevented);
  assert.deepEqual(h.messages.map(item => item[0].key), ['close', 'explorer']);
});

test('PDFのページ取得中に破棄すると後着ページを描画しない', async () => {
  const getPage = deferred(), h = harness('pdf', { getPage }); await flush();
  assert.deepEqual(h.gets, [1]); h.dispatch('pagehide'); const before = JSON.stringify(h.snapshot());
  getPage.resolve(); await flush(); assert.equal(h.renders.length, 0); assert.equal(JSON.stringify(h.snapshot()), before);
});

test('Wordの変換中に破棄しても遅れて生成されたページを本文へ挿入しない', async () => {
  const load = deferred(), h = harness('word', { load }); await flush();
  assert.equal(h.get('document-page').children.length, 1, '変換中の描画先は接続したままにする');
  h.dispatch('pagehide'); assert.equal(h.get('document-page').children.length, 0);
  const before = JSON.stringify(h.snapshot()); load.resolve(); await flush();
  assert.equal(JSON.stringify(h.snapshot()), before);
});

test('PowerPointの遅延グラフ更新も同じ描画キューを使い、破棄後は止まる', async () => {
  const h = harness('powerpoint', { autoRender: false }); await flush();
  const chart = h.context.window.currentProcessor;
  chart.reRenderShape(); chart.reRenderShape(); assert.equal(h.renders.length, 1);
  h.renders[0].resolve(); await flush(); cues(h, false, false); assert.equal(h.renders.length, 2);
  h.renders[1].resolve(); await flush(); cues(h, false, true, '1 / 3');
  h.click('next'); await flush(); chart.reRenderShape(); h.renders[2].resolve(); await flush();
  cues(h, false, true, '1 / 3'); assert.equal(h.renders[3].index, 1);
  h.renders[3].resolve(); await flush(); cues(h, true, true, '2 / 3');
  h.dispatch('pagehide'); const before = JSON.stringify(h.snapshot()); chart.reRenderShape(); await flush();
  assert.equal(JSON.stringify(h.snapshot()), before); assert.equal(h.renders.length, 4); assert.equal(h.state.maxActiveRenders, 1);
});

test('導入済みPptxViewJSの描画入口は固定canvasへ渡し、CSS寸法を表示領域なしで解決できる', async () => {
  // 実ライブラリの該当クラスと寸法計算を実行する。描画エンジン自体の視覚検証ではない。
  const installed = await readFile(require.resolve('pptxviewjs'), 'utf8');
  const classStart = installed.indexOf('class PPTXViewer {');
  const classEnd = installed.indexOf('// Simple helper to mount a basic viewer', classStart);
  const sizeStart = installed.indexOf('    calculateCanvasRect(canvas, slideSize) {');
  const sizeEnd = installed.indexOf('    /**', sizeStart);
  assert(classStart >= 0 && classEnd > classStart && sizeStart >= 0 && sizeEnd > sizeStart);
  const calls = [], canvas = new Element('canvas');
  canvas.clientWidth = 0; canvas.style.width = '960px'; canvas.style.height = '540px';
  const context = createContext({ window: { devicePixelRatio: 2 }, console });
  const Viewer = runInContext(`${installed.slice(classStart, classEnd)}\nPPTXViewer`, context);
  const viewer = new Viewer({ canvas, autoChartRerenderDelayMs: 0 });
  viewer.isLoaded = true; viewer.slideCount = 3;
  viewer.processor = { renderSlide: async (target, index) => calls.push([target, index]) };
  await viewer.render(canvas, { slideIndex: 0 }); await viewer.render(canvas, { slideIndex: 1 });
  assert.deepEqual(calls, [[canvas, 0], [canvas, 1]]); assert.equal(viewer.getCurrentSlideIndex(), 1);
  const geometry = runInContext(`({ ${installed.slice(sizeStart, sizeEnd)} })`, context);
  const rect = geometry.calculateCanvasRect(canvas, { cx: 9144000, cy: 5143500 });
  assert.equal(rect.widthPx, 960); assert.equal(rect.heightPx, 540);
  viewer.destroy(); assert.equal(viewer.processor, null); assert.equal(viewer.isLoaded, false);
});

test('導入済みdocx-previewの生成ページを共通ページ送りに使い、ヘッダー・フッター・脚注を残す', async () => {
  // XML解析後の文書モデルから実ライブラリでDOMを生成する。ブラウザレイアウトはモック。
  const text = value => ({ type: 'paragraph', children: [{ type: 'run', children: [{ type: 'text', text: value }] }] });
  const parts = {
    header: { path: 'header1.xml', rootElement: { type: 'header', children: [text('共通ヘッダー')] } },
    footer: { path: 'footer1.xml', rootElement: { type: 'footer', children: [text('共通フッター')] } },
  };
  const wordDocument = {
    documentPart: { body: {
      props: {
        pageSize: { width: '600px', height: '800px' },
        headerRefs: [{ id: 'header', type: 'default' }], footerRefs: [{ id: 'footer', type: 'default' }],
      },
      children: Array.from({ length: 3 }, (_, i) => ({
        ...text(`生成ページ${i + 1}`), pageBreakBefore: i > 0,
        children: [
          { type: 'run', children: [{ type: 'text', text: `生成ページ${i + 1}` }, { type: 'footnoteReference', id: String(i + 1) }] },
          { type: 'bookmarkStart', name: `見出し ${i + 1}` },
        ],
      })),
    } },
    footnotesPart: { notes: Array.from({ length: 3 }, (_, i) => ({ type: 'footnote', id: String(i + 1), children: [text(`脚注${i + 1}`)] })) },
    findPartByRelId: id => parts[id],
  };
  const h = harness('word', { wordDocument }); await flush(); cues(h, false, true, '1 / 3');
  const pages = h.get('document-page').firstChild, sections = pages.querySelectorAll('section.docx');
  assert.equal(sections.length, 3); assert(pages.children.some(node => node.tagName === 'STYLE'));
  for (const [i, section] of sections.entries()) {
    assert(section.textContent.includes(`生成ページ${i + 1}`)); assert(section.textContent.includes(`脚注${i + 1}`));
    assert(section.children.some(node => node.tagName === 'HEADER')); assert(section.children.some(node => node.tagName === 'FOOTER'));
  }
  h.click('page-next'); await flush(); cues(h, true, true, '2 / 3');
  assert.deepEqual(sections.map(section => section.hidden), [true, false, true]);
  h.link('#' + encodeURIComponent('見出し 3')); await flush(); cues(h, true, false, '3 / 3');
  assert.equal(sections[2].querySelectorAll('[id]')[0].scrollCalls, 1);
  assert.equal(h.get('document-page').firstChild, pages);
});
