// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// 文書ごとの iframe 内で描画する。Monaco の AMD ローダーや星図のキー操作と分離する。
// 表示ライブラリは frontend_ide/viewer 自身の node_modules から遅延ロードする。
const $ = id => document.getElementById(id);
const content = $('content');
const documentPage = $('document-page');
const params = new URLSearchParams(location.search);
const path = params.get('path');
const format = params.get('format');
const selectedBlob = params.get('blob');
const documentSource = selectedBlob && selectedBlob.startsWith('blob:' + location.origin + '/') ? selectedBlob : `/api/document?path=${encodeURIComponent(path)}`;
const labels = { word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint', pdf: 'PDF' };
let page = 0, pageCount = 1, renderPage = null, busy = false, pending = false;
let source = '', displayed = null, revision = 0, destroyed = false, resetScroll = false;
let scrollTarget = null, followBookmark = null;
let resizeTimer;
const abort = new AbortController();
const cleanups = [];

function notice(text = '', error = false) {
  if (destroyed) return;
  $('notice').hidden = !text;
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (destroyed) { reject(new Error('表示を終了しました。')); return; }
    const script = document.createElement('script');
    const cancel = () => { script.remove(); finish(new Error('表示を終了しました。')); };
    const finish = error => {
      script.onload = script.onerror = null;
      abort.signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve();
    };
    script.src = src;
    script.onload = () => finish();
    script.onerror = () => finish(new Error('表示ライブラリを読み込めません。frontend_ide/viewer のセットアップを実行してください。'));
    abort.signal.addEventListener('abort', cancel, { once: true });
    document.head.append(script);
  });
}
function controls() {
  if (destroyed) return;
  const hasPages = !!displayed && displayed.count > 1;
  const first = !hasPages || displayed.page <= 0;
  const last = !hasPages || displayed.page >= displayed.count - 1;
  $('previous').hidden = $('next').hidden = !hasPages;
  $('previous').disabled = $('page-previous').disabled = busy || first;
  $('next').disabled = $('page-next').disabled = busy || last;
  $('page-top').hidden = first;
  $('page-bottom').hidden = last;
  content.setAttribute('aria-busy', String(busy));
}
function commitPage(result) {
  if (destroyed) return;
  // ページ内容・番号・案内は描画成功時にまとめて更新する。
  if (documentPage.firstChild !== result.node) documentPage.replaceChildren(...(result.node ? [result.node] : []));
  page = result.page;
  pageCount = result.count;
  source = result.source;
  displayed = result;
  result.commit?.();
  $('page-status').textContent = result.status;
  notice(result.notice);
  if (resetScroll) { content.scrollTo(0, 0); resetScroll = false; }
  result.scrollTarget?.scrollIntoView({ block: 'start', inline: 'nearest' });
  scrollTarget = null;
  controls();
}
// サイズ変更とページ操作を直列化し、古い描画結果は画面へ反映しない。
async function refresh() {
  if (destroyed || !renderPage) return;
  revision++;
  pending = true;
  if (busy) return;
  busy = true;
  controls();
  try {
    while (pending && !destroyed) {
      pending = false;
      const current = revision;
      const request = { page, source, zoom: $('zoom').value, width: content.clientWidth, scrollTarget };
      try {
        const result = await renderPage(request);
        if (!destroyed && current === revision) commitPage(result);
      } catch (error) {
        if (destroyed || current !== revision) continue;
        // 描画失敗時は表示済みの内容と送り先を保持して再試行できるようにする。
        page = displayed?.page ?? 0;
        source = displayed?.source ?? source;
        resetScroll = false;
        scrollTarget = null;
        notice(`表示できませんでした: ${error.message || error}`, true);
      }
    }
  } finally {
    busy = false;
    controls();
  }
}
function requestPage(index, target = null) {
  if (destroyed || !displayed) return;
  const nextPage = Math.max(0, Math.min(pageCount - 1, index));
  if (nextPage === displayed.page && !target && !busy) return;
  page = nextPage;
  scrollTarget = target;
  resetScroll = true;
  refresh();
}
function move(delta) {
  if (destroyed || busy || !displayed) return;
  requestPage(displayed.page + delta);
}
$('previous').onclick = $('page-previous').onclick = () => move(-1);
$('next').onclick = $('page-next').onclick = () => move(1);
$('zoom').onchange = () => refresh();
function keydown(event) {
  if (destroyed) return;
  const toggleExplorer = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b';
  if (toggleExplorer || event.key === 'Escape') {
    event.preventDefault();
    parent.postMessage({ type: 'aidiy-ide-document-key', key: toggleExplorer ? 'explorer' : 'close' }, location.origin);
    return;
  }
  if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
  if (pageCount <= 1) return;
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); move(-1); }
  if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); move(1); }
}
addEventListener('keydown', keydown);
const resizeObserver = new ResizeObserver(() => {
  if (destroyed) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => refresh(), 120);
});
resizeObserver.observe(content);
addEventListener('pagehide', () => {
  destroyed = true;
  pending = false;
  clearTimeout(resizeTimer);
  resizeObserver.disconnect();
  removeEventListener('keydown', keydown);
  abort.abort();
  for (const cleanup of cleanups) {
    try { Promise.resolve(cleanup()).catch(() => {}); } catch { /* 破棄中の失敗は表示しない。 */ }
  }
}, { once: true });
content.addEventListener('click', event => {
  const link = event.target.closest?.('a');
  if (!link) return;
  if (link.getAttribute('href')?.startsWith('#')) followBookmark?.(link, event);
  else event.preventDefault();
});
function displayWidth(naturalWidth, request) {
  return request.zoom === 'fit'
    ? Math.max(100, request.width - 26)
    : naturalWidth * Number(request.zoom);
}
function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  return canvas;
}

async function word(data) {
  await loadScript('/office-vendor/jszip.js');
  await loadScript('/office-vendor/docx.js');
  if (destroyed) return;
  content.className = 'word-view';
  const pages = document.createElement('div');
  pages.className = 'word-pages';
  pages.style.visibility = 'hidden';
  // docx-preview の VML 図形は RAF 内で SVG の寸法を測るため、描画先は
  // 接続しておく。破棄時に外せば後着処理が表示中の DOM を更新しない。
  documentPage.replaceChildren(pages);
  cleanups.push(() => pages.remove());
  await window.docx.renderAsync(data, pages, pages, {
    inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false,
    renderHeaders: true, renderFooters: true, renderFootnotes: true,
    renderEndnotes: true, renderAltChunks: false, useBase64URL: true,
  });
  if (destroyed) return;
  // renderAsync は VML の RAF 計測を待たない。全ページを計測できる状態で
  // 先に登録された RAF を終えてから、選択ページ以外を非表示にする。
  await new Promise(resolve => {
    const finish = () => { abort.signal.removeEventListener('abort', cancel); resolve(); };
    const frame = requestAnimationFrame(finish);
    const cancel = () => { cancelAnimationFrame(frame); finish(); };
    abort.signal.addEventListener('abort', cancel, { once: true });
  });
  if (destroyed) return;
  const sections = [...pages.querySelectorAll('section.docx')];
  if (!sections.length) throw new Error('文書のページが見つかりません。');
  const widths = sections.map(section => section.offsetWidth + 24);
  const count = sections.length;
  $('zoom-label').hidden = false;
  renderPage = async request => {
    const index = Math.max(0, Math.min(count - 1, request.page));
    const width = widths[index];
    return {
      node: pages, page: index, count, source: '', status: `${index + 1} / ${count}`, scrollTarget: request.scrollTarget,
      commit: () => {
        // ライブラリのページ・スタイル・ヘッダー・脚注はそのまま保持する。
        sections.forEach((section, i) => { section.hidden = i !== index; });
        pages.style.width = `${width}px`;
        pages.style.zoom = request.zoom === 'fit' ? Math.min(1, Math.max(1, request.width - 2) / width) : Number(request.zoom);
        pages.style.visibility = '';
      },
    };
  };
  followBookmark = (link, event) => {
    event.preventDefault();
    if (destroyed) return;
    let id;
    try { id = decodeURIComponent(link.getAttribute('href').slice(1)); } catch { return; }
    const target = [...pages.querySelectorAll('[id]')].find(element => element.id === id);
    if (!target) return;
    const index = sections.findIndex(section => section.contains(target));
    if (index >= 0) requestPage(index, target);
  };
}

async function excel(data) {
  await loadScript('/office-vendor/xlsx.js');
  if (destroyed) return;
  const XLSX = window.XLSX;
  let input = data;
  const isDelimited = /\.(csv|tsv)$/i.test(path);
  if (isDelimited) {
    try { input = new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { input = new TextDecoder('shift_jis').decode(data); }
  }
  const book = XLSX.read(input, { type: isDelimited ? 'string' : 'array', cellStyles: true, sheetRows: 100000 });
  if (!book.SheetNames.length) throw new Error('シートが見つかりません。');
  source = book.SheetNames[0];
  const ROWS = 200, COLS = 100;
  content.className = 'sheet-view';
  $('sheets').hidden = false;
  $('sheets').setAttribute('role', 'tablist');
  for (const name of book.SheetNames) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = name;
    button.setAttribute('role', 'tab');
    button.onclick = () => {
      if (destroyed) return;
      source = name; page = 0; scrollTarget = null; resetScroll = true; refresh();
    };
    $('sheets').append(button);
  }
  renderPage = async request => {
    const sheetName = request.source;
    const sheet = book.Sheets[sheetName];
    const commit = () => {
      for (const button of $('sheets').children) button.setAttribute('aria-selected', String(button.textContent === sheetName));
    };
    if (!sheet['!ref']) {
      return { node: null, page: 0, count: 1, source: sheetName, status: '空のシート', commit };
    }
    const range = XLSX.utils.decode_range(sheet['!ref']);
    // 値のない結合先は !ref の外になることがあるため、結合範囲まで含める。
    for (const merge of sheet['!merges'] || []) {
      range.e.r = Math.max(range.e.r, Math.min(99999, merge.e.r));
      range.e.c = Math.max(range.e.c, merge.e.c);
    }
    const count = Math.max(1, Math.ceil((range.e.r - range.s.r + 1) / ROWS));
    const index = Math.max(0, Math.min(count - 1, request.page));
    const first = range.s.r + index * ROWS, last = Math.min(range.e.r, first + ROWS - 1);
    const lastCol = Math.min(range.e.c, range.s.c + COLS - 1);
    const status = `${first + 1}–${last + 1} / ${range.e.r + 1} 行`;
    const message = lastCol < range.e.c || sheet['!fullref'] ? '大きいシートのため先頭100列・最大100,000行まで表示します。' : '';
    const table = document.createElement('table'); table.className = 'sheet-table';
    table.setAttribute('aria-label', sheetName);
    const head = table.createTHead().insertRow(); head.append(document.createElement('th'));
    for (let c = range.s.c; c <= lastCol; c++) {
      const cell = document.createElement('th'); cell.textContent = XLSX.utils.encode_col(c); cell.scope = 'col';
      const column = sheet['!cols']?.[c];
      const width = Math.min(360, Math.max(80, column?.wpx || (column?.wch || 12) * 7));
      cell.style.width = `${width}px`; cell.style.minWidth = `${width}px`; head.append(cell);
    }
    const merges = (sheet['!merges'] || []).filter(m => m.e.r >= first && m.s.r <= last && m.e.c >= range.s.c && m.s.c <= lastCol);
    const covered = new Set(), starts = new Map();
    for (const m of merges) {
      const r0 = Math.max(m.s.r, first), c0 = Math.max(m.s.c, range.s.c);
      const r1 = Math.min(m.e.r, last), c1 = Math.min(m.e.c, lastCol);
      starts.set(`${r0}:${c0}`, { rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1, source: m.s });
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r !== r0 || c !== c0) covered.add(`${r}:${c}`);
    }
    const tbody = table.createTBody();
    for (let r = first; r <= last; r++) {
      const row = tbody.insertRow();
      const number = document.createElement('th'); number.textContent = String(r + 1); number.scope = 'row'; row.append(number);
      for (let c = range.s.c; c <= lastCol; c++) {
        if (covered.has(`${r}:${c}`)) continue;
        const cell = row.insertCell();
        const merge = starts.get(`${r}:${c}`);
        if (merge) { cell.rowSpan = merge.rowSpan; cell.colSpan = merge.colSpan; }
        const value = sheet[XLSX.utils.encode_cell(merge?.source || { r, c })];
        // 文書の値を HTML として解釈しない。数式は保存済みの計算結果を表示する。
        cell.textContent = value ? XLSX.utils.format_cell(value) : '';
        if (value?.f) cell.title = `数式: =${value.f}`;
        if (value?.t === 'n') cell.className = 'numeric';
        const fill = value?.s?.fgColor?.rgb;
        if (/^[0-9a-f]{6}$/i.test(fill || '')) cell.style.backgroundColor = `#${fill}`;
      }
    }
    return { node: table, page: index, count, source: sheetName, status, notice: message, commit };
  };
}

async function powerpoint(data) {
  await loadScript('/office-vendor/jszip.js');
  await loadScript('/office-vendor/chart.js');
  await loadScript('/office-vendor/pptx.js');
  if (destroyed) return;
  // ライブラリが保持する描画先は固定し、表示用には完成した画像だけを渡す。
  const canvas = makeCanvas();
  const viewer = new window.PptxViewJS.PPTXViewer({ canvas, autoChartRerenderDelayMs: 0 });
  cleanups.push(() => viewer.destroy());
  await viewer.loadFile(data);
  if (destroyed) { viewer.destroy(); return; }
  // 遅れて解析されたグラフも同じ直列描画を通す。ライブラリから直接
  // canvas を再描画させると、ページ移動・破棄と競合する。
  const chartContext = window.currentProcessor;
  if (chartContext) {
    chartContext.reRenderShape = () => refresh();
    cleanups.push(() => { chartContext.reRenderShape = () => {}; });
  }
  if (!viewer.getSlideCount()) throw new Error('スライドが見つかりません。');
  const count = viewer.getSlideCount();
  content.className = 'canvas-view';
  $('zoom-label').hidden = false;
  // ライブラリは canvas の CSS サイズを描画サイズとして扱う。
  const size = viewer.processor.getSlideDimensions();
  const ratio = size.cx / size.cy;
  renderPage = async request => {
    const width = displayWidth(960, request);
    canvas.style.width = `${width}px`; canvas.style.height = `${width / ratio}px`;
    await viewer.render(canvas, { slideIndex: request.page });
    if (destroyed) return;
    const snapshot = makeCanvas();
    snapshot.width = canvas.width; snapshot.height = canvas.height;
    snapshot.style.width = canvas.style.width; snapshot.style.height = canvas.style.height;
    snapshot.getContext('2d').drawImage(canvas, 0, 0);
    snapshot.setAttribute('aria-label', `スライド ${request.page + 1}`);
    return { node: snapshot, page: request.page, count, source: '', status: `${request.page + 1} / ${count}` };
  };
}

async function pdf(data) {
  const pdfjs = await import('/office-vendor/pdf.mjs');
  if (destroyed) return;
  pdfjs.GlobalWorkerOptions.workerSrc = '/office-vendor/pdf.worker.mjs';
  const task = pdfjs.getDocument({
    data, cMapUrl: '/office-vendor/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/office-vendor/standard_fonts/', wasmUrl: '/office-vendor/wasm/',
    isEvalSupported: false,
  });
  cleanups.push(() => task.destroy());
  task.onPassword = () => { notice('パスワード付きPDFは表示できません。', true); task.destroy(); };
  const doc = await task.promise;
  if (destroyed) return;
  if (!doc.numPages) throw new Error('文書のページが見つかりません。');
  const count = doc.numPages;
  content.className = 'canvas-view';
  $('zoom-label').hidden = false;
  renderPage = async request => {
    const pdfPage = await doc.getPage(request.page + 1);
    if (destroyed) return;
    const canvas = makeCanvas();
    const natural = pdfPage.getViewport({ scale: 1 });
    const width = displayWidth(natural.width, request);
    const viewport = pdfPage.getViewport({ scale: width / natural.width });
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(viewport.width * dpr); canvas.height = Math.ceil(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;
    if (destroyed) return;
    canvas.setAttribute('aria-label', `PDF ${request.page + 1} ページ`);
    return { node: canvas, page: request.page, count, source: '', status: `${request.page + 1} / ${count}` };
  };
}

async function main() {
  if (!path || !labels[format]) throw new Error('文書の指定が正しくありません。');
  $('format-name').textContent = labels[format];
  document.title = `${path.split('/').at(-1)} - ${labels[format]}`;
  const response = await fetch(documentSource, { cache: 'no-store', signal: abort.signal });
  if (destroyed) return;
  if (!response.ok) throw new Error(response.status === 404 ? 'ファイルが見つかりません。' : await response.text());
  const data = await response.arrayBuffer();
  if (destroyed) return;
  await ({ word, excel, powerpoint, pdf })[format](data);
  if (destroyed) return;
  notice();
  await refresh();
}
main().catch(error => notice(`表示できませんでした: ${error.message || error}`, true));
