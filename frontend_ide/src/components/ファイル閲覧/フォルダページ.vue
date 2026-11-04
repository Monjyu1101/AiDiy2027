<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import RefreshButton from '../共通表示/再読込ボタン.vue';
import { computed, ref, shallowRef, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { fileDateInfo, nextLocalMidnight } from './ファイル日時.js';
import FileTypeIcon from '../ファイル閲覧/ファイル種別アイコン.vue';
import { indexFolderPages, createFolderPageMemory, folderPageTurnPlan } from '../ファイル閲覧/フォルダページ構成.js';
const props = defineProps({ tree: Object, current: { type: String, default: '' }, selected: String, unlistedParent: String, monitorMessage: String, reload: Function, marks: Object, updateMarks: Object, active: Boolean, color: Function });
const emit = defineEmits(['select', 'clear', 'refresh', 'toggle-explorer', 'activity']);
const pages = computed(() => props.active ? indexFolderPages(props.tree, props.marks) : new Map());
const page = computed(() => pages.value.get(props.current));
const entries = computed(() => page.value?.entries || []);
const trail = computed(() => props.current.split('/').filter(Boolean));
const memory = createFolderPageMemory(), body = ref(), folderStrip = ref(), cursor = ref(''), turn = shallowRef(null);
const canSlideLeft = ref(false), canSlideRight = ref(false);
const draggingFolders = ref(false), draggingFiles = ref(false);
const folderSlide = createSlideInteraction(folderStrip, canSlideLeft, canSlideRight, draggingFolders);
const fileSlide = createSlideInteraction(body, ref(false), ref(false), draggingFiles, 'y');
const pageTurn = computed(() => turn.value?.direction || '');
const turnPath = computed(() => turn.value?.incoming.path || ''), turnSkipped = computed(() => turn.value?.skipped || 0);
const turnDuration = ref(800);
let turnSteps = [], turnSerial = 0, pointerTurn = false;
// 操作・現在地は常に最終目的地。重ねる経由ページと旧ページは表示専用にする。
const layers = computed(() => {
  const live = { id: `live:${props.current}`, path: props.current, entries: entries.value, cursor: cursor.value, selected: props.selected, live: true };
  if (!turn.value) return [live];
  const { id, incoming, outgoing } = turn.value;
  return [live, ...(incoming.path === props.current ? [] : [{ ...incoming, id: `${id}:incoming` }]), { ...outgoing, id, outgoing: true }];
});
function bindBody(element, layer) {
  if (layer.live) fileSlide.bind(element);
  else if (element) element.scrollTop = layer.scrollTop;
}
// フォルダだけを横一列にし、ファイル行とoption IDは従来の自然順を維持する。
function entryGroups(layer) {
  const firstFile = layer.entries.findIndex(entry => entry.type !== 'dir');
  const count = firstFile < 0 ? layer.entries.length : firstFile;
  return [
    { folders: true, offset: 0, entries: layer.entries.slice(0, count) },
    { folders: false, offset: count, entries: layer.entries.slice(count) },
  ].filter(group => group.entries.length);
}
// フォルダは横、ファイルは従来のページ本文を縦にドラッグする。RAFは矢印の移動中だけ予約する。
function createSlideInteraction(elementRef, canLeft, canRight, dragging, axis = 'x') {
  const position = axis === 'x' ? 'scrollLeft' : 'scrollTop';
  const extent = axis === 'x' ? 'scrollWidth' : 'scrollHeight', size = axis === 'x' ? 'clientWidth' : 'clientHeight';
  let observer, frame = 0, target, gesture, suppressClick = false;
  function update() {
    const element = elementRef.value;
    canLeft.value = !!element && element[position] > 1;
    canRight.value = !!element && element[position] < element[extent] - element[size] - 1;
  }
  function stop() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0; target = undefined;
  }
  function finish(event) {
    if (!gesture || (event?.pointerId !== undefined && event.pointerId !== gesture.id)) return;
    // touchの暗黙captureから移す時、元の子要素のlost通知では終了しない。
    if (event?.type === 'lostpointercapture' && event.target !== gesture.element) return;
    const previous = gesture; gesture = undefined; dragging.value = false;
    if (previous.moved) suppressClick = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    window.removeEventListener('lostpointercapture', finish);
    window.removeEventListener('blur', finish);
    window.removeEventListener('keydown', escape, true);
    try { if (previous.element.hasPointerCapture?.(previous.id)) previous.element.releasePointerCapture(previous.id); } catch {}
  }
  function escape(event) {
    if (event.key !== 'Escape') return;
    if (gesture?.moved) { event.preventDefault(); event.stopPropagation(); }
    finish();
  }
  function bind(element) {
    if (elementRef.value === element) return;
    stop(); finish(); observer?.disconnect(); elementRef.value = element;
    if (element && typeof ResizeObserver !== 'undefined') {
      observer ||= new ResizeObserver(update); observer.observe(element);
    }
    void nextTick(update);
  }
  function slide(direction) {
    const element = elementRef.value;
    if (disposed || !props.active || !element) return;
    cancelTurns(); activity(); finish();
    const destination = Math.max(0, Math.min(element[extent] - element[size],
      (target ?? element[position]) + direction * Math.max(1, element[size] - 16)));
    stop(); target = destination;
    const from = element[position], started = window.performance.now();
    if (Math.abs(destination - from) < 1) { target = undefined; update(); return; }
    const tick = now => {
      frame = 0;
      if (disposed || !props.active || elementRef.value !== element) { target = undefined; return; }
      const progress = Math.max(0, Math.min(1, (now - started) / 420));
      element[position] = from + (destination - from) * progress * progress * (3 - 2 * progress);
      update();
      if (progress < 1) frame = window.requestAnimationFrame(tick);
      else target = undefined;
    };
    frame = window.requestAnimationFrame(tick);
  }
  function down(event) {
    if (disposed || event.button !== 0 || event.isPrimary === false || !props.active) return;
    finish(); suppressClick = false; stop();
    // ファイルのタッチ操作はブラウザー本来の縦スワイプと慣性を保つ。
    if (axis === 'y' && event.pointerType === 'touch') return;
    const element = elementRef.value;
    if (!element || element[extent] <= element[size] + 1) return;
    // ネイティブのスクロールバーはつかまず、その操作をブラウザーへ残す。
    const bounds = element.getBoundingClientRect();
    if (axis === 'x' ? event.clientY >= bounds.top + element.clientTop + element.clientHeight
      : event.clientX >= bounds.left + element.clientLeft + element.clientWidth) return;
    gesture = { id: event.pointerId, element, x: event.clientX, y: event.clientY, start: element[position], moved: false };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('lostpointercapture', finish);
    window.addEventListener('blur', finish);
    window.addEventListener('keydown', escape, true);
  }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!(event.buttons & 1)) { finish(event); return; }
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    const delta = axis === 'x' ? dx : dy, across = axis === 'x' ? dy : dx;
    if (!gesture.moved) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      if (Math.abs(across) > Math.abs(delta)) { finish(); return; }
      gesture.moved = true; dragging.value = true; suppressClick = true;
      cancelTurns();
      try { gesture.element.setPointerCapture(event.pointerId); } catch {}
    }
    event.preventDefault(); activity();
    gesture.element[position] = Math.max(0, Math.min(gesture.element[extent] - gesture.element[size], gesture.start - delta));
    update();
  }
  function click(event) {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault(); event.stopPropagation();
  }
  function restore(value) { stop(); finish(); if (elementRef.value) elementRef.value[position] = value || 0; update(); }
  function dispose() { stop(); finish(); observer?.disconnect(); }
  return { bind, update, slide, down, finish, click, stop, restore, dispose };
}
function interaction(folders) { return folders ? folderSlide : fileSlide; }
function bindStrip(element, layer, folders) {
  if (!folders) return;
  if (layer.live) folderSlide.bind(element);
  else if (element) element.scrollLeft = layer.scrollLeft || 0;
}
function stripScroll(layer, folders) {
  if (disposed || !props.active || !layer.live || layer.path !== props.current) return;
  interaction(folders).update(); save(layer.path);
}
function manualSlide() { folderSlide.stop(); fileSlide.stop(); }
const manualRefresh = ref(false);
async function refreshPage() {
  if (manualRefresh.value) return;
  if (!props.reload) { emit('refresh'); return; }
  const path = props.current, outgoing = snapshot(path, true);
  manualRefresh.value = true;
  try {
    const ok = await props.reload();
    if (ok !== false && !disposed && props.active && props.current === path) {
      cancelTurns(); turnDuration.value = 650;
      turn.value = { id: ++turnSerial, direction: 'refresh', outgoing, incoming: snapshot(path) };
    }
  } finally { manualRefresh.value = false; }
}
let disposed = false, restoration = 0, pendingFocus = false, presentedPath = props.current;
const formatSize = size => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
const dateClock = ref(Date.now()), dateCache = new Map();
let dateTimer, dateMounted = false;
function dateInfo(mtime) {
  const clock = dateClock.value;
  if (dateCache.size > 4096) dateCache.clear();
  if (!dateCache.has(mtime)) dateCache.set(mtime, fileDateInfo(mtime, clock));
  return dateCache.get(mtime);
}
function syncDateClock() {
  clearTimeout(dateTimer); dateCache.clear(); dateClock.value = Date.now();
  if (dateMounted && props.active && !disposed) dateTimer = setTimeout(syncDateClock, nextLocalMidnight(dateClock.value) - dateClock.value + 20);
}
watch(()=>props.active,()=>{if(dateMounted)syncDateClock();});
onMounted(()=>{dateMounted=true;syncDateClock();if(typeof document!=='undefined')document.addEventListener('visibilitychange',syncDateClock);});

function save(path = props.current) {
  memory.save(path, { cursor: cursor.value, scrollTop: body.value?.scrollTop || 0, scrollLeft: folderStrip.value?.scrollLeft || 0 });
}
async function restore(focus = false, preferSelected = false) {
  pendingFocus ||= focus;
  const run = ++restoration, path = props.current;
  const state = memory.restore(path, entries.value, preferSelected ? props.selected : '');
  cursor.value = state.cursor;
  await nextTick();
  if (disposed || run !== restoration || path !== props.current || !props.active) return;
  fileSlide.restore(state.scrollTop); folderSlide.restore(state.scrollLeft);
  if (pendingFocus) { pendingFocus = false; body.value?.focus({ preventScroll: true }); }
}
function select(entry) {
  cursor.value = entry.path; save();
  body.value?.focus({ preventScroll: true });
  emit('select', { type: entry.type, path: entry.path, source: 'page' });
}
function navigate(path) { save(); emit('select', { type: 'dir', path, source: 'page' }); }
function back() { if (trail.value.length) navigate(trail.value.slice(0, -1).join('/')); }
function snapshot(path, visible = false) {
  const items = pages.value.get(path)?.entries || [];
  const state = visible ? { cursor: cursor.value, scrollTop: body.value?.scrollTop || 0, scrollLeft: folderStrip.value?.scrollLeft || 0 } : memory.restore(path, items);
  return { path, entries: items.map(entry => ({ ...entry })), ...state, selected: props.selected };
}
function cancelTurns() { turnSteps = []; turn.value = null; }
function pointerStart() { pointerTurn = !!turn.value; }
function pointerCancel() { pointerTurn = false; }
function settleClick(event) {
  const covered = pointerTurn || !!turn.value; pointerTurn = false;
  if (!covered) return;
  // 旧ページに見える行へのクリックで、下に隠れた別の項目を開かない。
  cancelTurns(); event.preventDefault(); event.stopPropagation();
}
function showNextTurn(outgoing) {
  const step = turnSteps.shift();
  turn.value = step ? { ...step, id: ++turnSerial, outgoing, incoming: snapshot(step.path) } : null;
}
function startTurns(previous, path, enabled) {
  cancelTurns();
  turnSteps = enabled ? folderPageTurnPlan(previous, path) : [];
  // 実際に重ねる枚数へ総時間を配り、1枚でも深い移動でも全体を約0.8秒に揃える。
  turnDuration.value = 800 / Math.max(1, turnSteps.length);
  if (turnSteps.length) showNextTurn(snapshot(previous, true));
}
function finishTurn(event, id) {
  // 同じ方向の連打や経由ページでも、破棄済みの旧要素から届く終了通知を再適用しない。
  if (!turn.value || id !== turn.value.id || event.target !== event.currentTarget || event.animationName !== `folder-page-${pageTurn.value}`) return;
  if (event.type === 'animationcancel') cancelTurns();
  else showNextTurn(turn.value.incoming);
}
async function move(index) {
  const entry = entries.value[Math.max(0, Math.min(entries.value.length - 1, index))];
  if (!entry) return;
  const path = props.current;
  manualSlide(); cursor.value = entry.path; save();
  await nextTick();
  if (!disposed && props.active && path === props.current && cursor.value === entry.path) body.value?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
// 復元・scrollIntoView・レイアウトによるscrollは保存だけ。実際の入力だけを手動操作として伝える。
function activity() { if (props.active) emit('activity'); }
function pointerMove(event) { if (event.buttons && event.target === body.value) { cancelTurns(); activity(); } }
function keydown(event) {
  if (!props.active || event.defaultPrevented || event.isComposing) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); event.stopPropagation(); emit('toggle-explorer'); return; }
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (event.key === 'Backspace' || (event.altKey && event.key === 'ArrowLeft')) { event.preventDefault(); event.stopPropagation(); back(); return; }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (props.selected) emit('clear'); else back(); return; }
  if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); void refreshPage(); return; }
  // パンくずと親ボタンは通常のTab/Enter操作。項目リストだけにロービング選択を適用する。
  if (!body.value?.contains(event.target)) return;
  if (turn.value && ['Enter', ' ', 'ArrowRight'].includes(event.key)) { event.preventDefault(); cancelTurns(); activity(); return; }
  cancelTurns();
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) activity();
  const index = entries.value.findIndex(entry => entry.path === cursor.value);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    void move(event.key === 'Home' ? 0 : event.key === 'End' ? entries.value.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'ArrowLeft') { event.preventDefault(); back(); }
  else if (event.key === 'ArrowRight' && entries.value[index]?.type === 'dir') { event.preventDefault(); select(entries.value[index]); }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (entries.value[index]) select(entries.value[index]); }
}
watch([() => props.current, () => props.active, pages, () => props.tree], ([path, active, index, tree], [previous, wasActive, previousIndex, previousTree]) => {
  manualSlide(); folderSlide.finish(); fileSlide.finish();
  // 一覧更新と移動が同じtickでも、旧ページのカーソルを保存してから一度だけ復元する。
  const moved = path !== previous || active !== wasActive;
  if (moved && wasActive) save(previous);
  if (moved) startTurns(previous || '', path, active && wasActive && index === previousIndex);
  else {
    save(path); cancelTurns();
    const oldEntries = previousIndex?.get(path)?.entries || [];
    if (active && !manualRefresh.value && previousTree && tree !== previousTree && JSON.stringify(oldEntries) !== JSON.stringify(entries.value)) {
      turnDuration.value = 650;
      turn.value = { id: ++turnSerial, direction: 'refresh', incoming: snapshot(path),
        outgoing: { path, entries: oldEntries.map(entry=>({...entry})), cursor: cursor.value, selected: props.selected, scrollTop: body.value?.scrollTop || 0, scrollLeft: folderStrip.value?.scrollLeft || 0 } };
    }
  }
  presentedPath = path;
  if (active) void restore(moved, moved);
}, { immediate: true });
watch(() => props.selected, selected => {
  if (presentedPath === props.current && entries.value.some(entry => entry.path === selected)) { cursor.value = selected; memory.save(props.current, { cursor: selected }); }
});
onBeforeUnmount(() => { disposed = true; folderSlide.dispose(); fileSlide.dispose(); clearTimeout(dateTimer); if(typeof document!=='undefined')document.removeEventListener('visibilitychange',syncDateClock); restoration++; cancelTurns(); memory.clear(); });
</script>
<template>
  <section v-if="active" class="folder-pages" aria-label="2D フォルダページ" @keydown="keydown" @wheel.passive="activity" @touchmove.passive="activity" @pointerdown="activity" @pointermove="pointerMove">
    <header class="folder-page-heading">
      <button v-if="trail.length" title="親フォルダへ戻る（Backspace）" @click="back">← 親へ</button>
      <nav aria-label="現在のフォルダ">
        <button :aria-current="!trail.length ? 'location' : undefined" @click="navigate('')">{{ tree?.n }}</button>
        <template v-for="(name, index) in trail" :key="index"><span aria-hidden="true">›</span><button :aria-current="index===trail.length-1 ? 'location' : undefined" @click="navigate(trail.slice(0,index+1).join('/'))">{{ name }}</button></template>
      </nav>
      <RefreshButton class="folder-page-refresh" title="一覧を更新" aria-label="一覧を更新" :disabled="manualRefresh" :busy="manualRefresh" @click="refreshPage" />
    </header>
    <p v-if="unlistedParent!==undefined" class="folder-page-reference-note" role="status">検索ファイルの親フォルダ「{{ unlistedParent || '/' }}」は現在の一覧にありません。プレビューは開いたままです。該当ページへ移動するには、フィルターをOFFにして一覧を更新し、検索結果を選び直してください。</p>
    <div class="folder-page-summary">
      <div role="status">{{ page?.folders.length || 0 }} フォルダ · {{ page?.files.length || 0 }} ファイル</div>
      <span v-if="pageTurn" class="folder-page-turn-status" aria-hidden="true">{{ pageTurn==='refresh' ? '更新中' : 'ページ移動' }} {{ turnPath || '/' }}{{ turnSkipped ? '（'+turnSkipped+'階層省略）' : '' }}</span><span v-else>この階層の直下</span>
      <div v-if="page?.folders.length" class="folder-page-slide-controls" role="group" aria-label="フォルダの横スクロール">
        <span>フォルダ</span>
        <button type="button" aria-label="フォルダを左へスライド" aria-controls="folder-page-folders" title="フォルダを左へスライド" :disabled="!canSlideLeft" @click="folderSlide.slide(-1)">◀︎</button>
        <button type="button" aria-label="フォルダを右へスライド" aria-controls="folder-page-folders" title="フォルダを右へスライド" :disabled="!canSlideRight" @click="folderSlide.slide(1)">▶︎</button>
      </div>

    </div>
    <p v-if="monitorMessage" class="folder-page-monitor-status" role="status">{{ monitorMessage }}</p>
    <div class="folder-page-stack" :style="{'--page-turn-duration':turnDuration+'ms'}" @pointerdown.capture="pointerStart" @pointercancel.capture="pointerCancel" @click.capture="settleClick" @wheel.capture.passive="cancelTurns" @touchmove.capture.passive="cancelTurns">
      <div v-for="layer in layers" :key="layer.id" :ref="element => bindBody(element,layer)" class="folder-page-body" :class="layer.live ? '' : ['folder-page-sheet',layer.outgoing ? 'page-turn-'+pageTurn : 'folder-page-underlay']" :data-page-path="layer.path" :data-page-layer="layer.live ? 'live' : layer.outgoing ? 'outgoing' : 'incoming'" :tabindex="layer.live ? 0 : undefined" :role="layer.live ? 'listbox' : undefined" :aria-label="layer.live ? 'フォルダとファイル' : undefined" :aria-hidden="layer.live ? undefined : true" :inert="!layer.live" :aria-activedescendant="layer.live && cursor ? 'folder-page-entry-'+entries.findIndex(entry=>entry.path===cursor) : undefined" @scroll="layer.live && layer.path===current && save(layer.path)" @animationend="finishTurn($event,layer.id)" @animationcancel="finishTurn($event,layer.id)">
        <div class="folder-page-items">
          <div v-for="group in entryGroups(layer)" :key="group.folders ? 'folders' : 'files'" :ref="element => bindStrip(element,layer,group.folders)" :id="layer.live && group.folders ? 'folder-page-folders' : undefined" :class="[group.folders ? 'folder-page-folder-strip' : 'folder-page-files', {'slide-dragging':layer.live && (group.folders ? draggingFolders : draggingFiles)}]" data-aidiy-no-window-move @scroll.stop="stripScroll(layer,group.folders)" @pointerdown="layer.live && interaction(group.folders).down($event)" @lostpointercapture="interaction(group.folders).finish($event)" @click.capture="interaction(group.folders).click($event)" @dblclick.capture="interaction(group.folders).click($event)" @dragstart.prevent @wheel.passive="manualSlide" @touchmove.passive="manualSlide">
            <div :class="group.folders ? 'folder-page-cards' : 'folder-page-file-list'">
              <div v-for="(entry,index) in group.entries" :id="layer.live ? 'folder-page-entry-'+(group.offset+index) : undefined" :key="entry.path" class="folder-page-entry" :class="{folder:entry.type==='dir',striped:!!entry.striped,marked:!!entry.marked,selected:layer.selected===entry.path,'updated-today':layer.live&&entry.type!=='dir'&&updateMarks?.levels[entry.path]>0,'updated-latest':layer.live&&entry.type!=='dir'&&updateMarks?.levels[entry.path]===2}" :data-cursor="layer.cursor===entry.path" :role="layer.live ? 'option' : undefined" :aria-selected="layer.live ? cursor===entry.path : undefined" :aria-label="layer.live ? entry.name+(entry.type==='dir'?' フォルダ':' ファイル') : undefined" :title="entry.path" @click="layer.live && select(entry)">
                <span v-if="layer.live&&updateMarks?.flashes[entry.path]" :key="updateMarks.flashes[entry.path].id" class="file-update-pulse" aria-hidden="true"></span>
                <span class="folder-page-icon" aria-hidden="true"><FileTypeIcon :name="entry.name" :directory="entry.type==='dir'" /></span>
                <span class="folder-page-name">{{ entry.name }}</span>
                <span v-if="entry.type==='dir'" class="folder-page-meta">{{ entry.count }} ファイル<span v-if="entry.marked" class="folder-page-mark"> · 対象 {{ entry.marked }}</span></span>
                <span v-else class="folder-page-meta"><span class="folder-page-size">{{ formatSize(entry.size) }}</span><time :datetime="dateInfo(entry.mtime).iso" :title="dateInfo(entry.mtime).title" :class="{'is-today':dateInfo(entry.mtime).today}">{{ dateInfo(entry.mtime).text }}</time></span>
              </div>
            </div>
          </div>
          <p v-if="!layer.entries.length" class="folder-page-empty">この階層に表示できるフォルダ・ファイルはありません</p>
        </div>
      </div>
      <svg v-if="turn" :key="'edge:'+turn.id" class="folder-page-turn-edge" :class="'page-turn-'+pageTurn" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><line :x1="pageTurn==='refresh'?'0':'100'" y1="0" :x2="pageTurn==='refresh'?'100':'0'" :y2="pageTurn==='refresh'?'0':'100'" vector-effect="non-scaling-stroke" /></svg>
    </div>
    <footer>フォルダは ◀︎ ▶︎ / 横ドラッグ · ファイルは上下ドラッグ · フォルダを開くと次のページへ · ↑↓ 選択 · Enter 開く · Backspace 親へ</footer>
  </section>
</template>
