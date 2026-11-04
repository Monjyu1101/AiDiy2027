<!--
  -*- coding: utf-8 -*-

  -------------------------------------------------------------------------
  COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
  Licensed under "AiDiy 公開利用ライセンス v1.1".
  Commercial use requires prior written consent from all copyright holders.
  See LICENSE for full terms. Thank you for keeping the rules.
  https://github.com/monjyu1101/AiDiy2027
  -------------------------------------------------------------------------
-->

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';

interface MenuItem { code: string; label: string; desc: string; to: string; }
interface MenuRow  { axis: string; title: string; accent: string; panelBg: string; panelBgStrong: string; items: MenuItem[]; }

const BACK = '/メニュー';
const toFullwidthUrl = (value: string): string =>
  value.replace(/\//g, '／').replace(/\?/g, '？').replace(/&/g, '＆').replace(/=/g, '＝');
const q = (base: string) => `${base}?URLメニュー=${toFullwidthUrl(BACK)}`;

const rows = ref<MenuRow[]>([
  {
    axis: 'C', title: '管理', accent: '#6d5a3e', panelBg: '#f4e7c8', panelBgStrong: '#ead5a8',
    items: [
      { code: 'C権', label: 'C権限',   desc: '権限管理・アクセス制御',           to: q('/C管理/C権限/一覧') },
      { code: 'C利', label: 'C利用者', desc: '利用者情報・アカウント設定',       to: q('/C管理/C利用者/一覧') },
      { code: 'C採', label: 'C採番',   desc: 'ID 自動生成・シーケンス管理',      to: q('/C管理/C採番/一覧') },
    ],
  },
  {
    axis: 'M', title: 'マスタ', accent: '#7a6250', panelBg: '#f1d6c8', panelBgStrong: '#e8bdad',
    items: [
      { code: 'M車', label: 'M車両',     desc: '車両マスタ・情報登録',           to: q('/Mマスタ/M車両/一覧') },
      { code: 'M配', label: 'M配車区分', desc: '配車カテゴリ・色設定',           to: q('/Mマスタ/M配車区分/一覧') },
      { code: 'M分', label: 'M商品分類', desc: '商品分類・カテゴリ管理',         to: q('/Mマスタ/M商品分類/一覧') },
      { code: 'M商', label: 'M商品',     desc: '商品マスタ・在庫設定',           to: q('/Mマスタ/M商品/一覧') },
      { code: 'M取分', label: 'M取引先分類', desc: '取引先分類・カテゴリ管理',   to: q('/Mマスタ/M取引先分類/一覧') },
      { code: 'M取', label: 'M取引先',   desc: '取引先マスタ・連絡先管理',       to: q('/Mマスタ/M取引先/一覧') },
      { code: 'M構', label: 'M商品構成', desc: '構成商品・構成比率管理',         to: q('/Mマスタ/M商品構成/一覧') },
      { code: 'M区', label: 'M生産区分', desc: '生産区分・色設定',               to: q('/Mマスタ/M生産区分/一覧') },
      { code: 'M工', label: 'M生産工程', desc: '生産ライン工程登録',             to: q('/Mマスタ/M生産工程/一覧') },
    ],
  },
  {
    axis: 'T', title: 'トラン', accent: '#5f6f4d', panelBg: '#dceccf', panelBgStrong: '#c8deb8',
    items: [
      { code: 'T配', label: 'T配車',     desc: '配車情報登録・スケジュール',     to: q('/Tトラン/T配車/一覧') },
      { code: 'T入', label: 'T商品入庫', desc: '入庫情報登録',                   to: q('/Tトラン/T商品入庫/一覧') },
      { code: 'T出', label: 'T商品出庫', desc: '出庫情報登録',                   to: q('/Tトラン/T商品出庫/一覧') },
      { code: 'T棚', label: 'T商品棚卸', desc: '棚卸情報登録',                   to: q('/Tトラン/T商品棚卸/一覧') },
      { code: 'T生', label: 'T生産',     desc: '生産情報登録・工程管理',         to: q('/Tトラン/T生産/一覧') },
      { code: 'T払', label: 'T生産払出', desc: '払出商品・原材料確認',           to: q('/Tトラン/T生産払出/一覧') },
    ],
  },
  {
    axis: 'S', title: 'スケジュール', accent: '#3f6f78', panelBg: '#cfeaf0', panelBgStrong: '#b8dce5',
    items: [
      { code: 'S配週', label: 'S配車_週表示', desc: '配車週表示・週単位管理',    to: q('/Sスケジュール/S配車_週表示') },
      { code: 'S配日', label: 'S配車_日表示', desc: '配車日表示・詳細管理',      to: q('/Sスケジュール/S配車_日表示') },
      { code: 'S生週', label: 'S生産_週表示', desc: '生産週表示・週単位管理',    to: q('/Sスケジュール/S生産_週表示') },
      { code: 'S生日', label: 'S生産_日表示', desc: '生産日表示・詳細管理',      to: q('/Sスケジュール/S生産_日表示') },
    ],
  },
  {
    axis: 'V', title: 'ビュー', accent: '#6f628a', panelBg: '#e4daf2', panelBgStrong: '#d3c3e8',
    items: [
      { code: 'V推', label: 'V商品推移表', desc: '在庫推移・トレンド分析',       to: q('/Vビュー/V商品推移表') },
    ],
  },
]);

const SHIFT_DELAY = 3600;
const ITEM_UNIT   = 240;
const STORAGE_KEY = 'メニュー_最終選択';

function loadSaved(): { rowIdx: number; colIdx: number[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    const r = Number(d?.rowIdx);
    if (!Number.isInteger(r) || r < 0 || r >= rows.value.length) return null;
    const cols = Array.isArray(d?.colIdx) ? d.colIdx : [];
    const col = rows.value.map((row, i) => {
      const v = Number(cols[i]);
      return Number.isInteger(v) && v >= 0 && v < row.items.length ? v : 0;
    });
    return { rowIdx: r, colIdx: col };
  } catch {
    return null;
  }
}
const saved = loadSaved();

const rowIdx = ref<number>(saved?.rowIdx ?? 1);
const colIdx = ref<number[]>(saved?.colIdx ?? rows.value.map(() => 0));
const mode   = ref<'center' | 'item'>(saved ? 'item' : 'center');

watch([rowIdx, colIdx], ([r, c]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rowIdx: r, colIdx: c }));
  } catch { /* noop */ }
}, { deep: true });

const router = useRouter();
const currentRow  = computed(() => rows.value[rowIdx.value]);
const currentItem = computed(() => currentRow.value.items[colIdx.value[rowIdx.value]]);

let shiftTimer: number | undefined;
const shiftKey = ref(0);

function scheduleShift() {
  cancelShift();
  shiftKey.value++;
  shiftTimer = window.setTimeout(() => { mode.value = 'item'; }, SHIFT_DELAY);
}
function cancelShift() {
  if (shiftTimer) { clearTimeout(shiftTimer); shiftTimer = undefined; }
}

function moveRow(delta: number) {
  const n = rows.value.length;
  rowIdx.value = (rowIdx.value + delta + n) % n;
  mode.value = 'center';
  scheduleShift();
}
function moveCol(delta: number) {
  if (mode.value !== 'item') {
    if (delta > 0) { mode.value = 'item'; cancelShift(); }
    return;
  }
  const cur = rowIdx.value;
  const len = rows.value[cur].items.length;
  colIdx.value[cur] = (colIdx.value[cur] + delta + len) % len;
}
function execute() {
  if (mode.value === 'center') { mode.value = 'item'; cancelShift(); return; }
  const target = currentItem.value?.to;
  if (target) router.push(target);
}
function backToCenter() {
  if (mode.value === 'item') { mode.value = 'center'; scheduleShift(); }
}

function selectRow(r: number) {
  if (r === rowIdx.value && mode.value === 'center') {
    mode.value = 'item'; cancelShift(); return;
  }
  rowIdx.value = r;
  mode.value = 'center';
  scheduleShift();
}
function selectItem(r: number, c: number) {
  if (rowIdx.value !== r) rowIdx.value = r;
  mode.value = 'item';
  cancelShift();
  if (colIdx.value[r] === c) execute();
  else colIdx.value[r] = c;
}

function axisStyle(r: number) {
  const off = r - rowIdx.value;
  const abs = Math.abs(off);
  if (mode.value === 'center') {
    if (off === 0) {
      return {
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%) scale(1.7)',
        opacity: 1, zIndex: 10,
      };
    }
    const sign = off > 0 ? 1 : -1;
    const y = sign * (170 + (abs - 1) * 44);
    return {
      top: '50%', left: '50%',
      transform: `translate(-50%, calc(-50% + ${y}px)) scale(${abs === 1 ? 0.78 : 0.62})`,
      opacity: abs === 1 ? 0.72 : 0.4,
      zIndex: 1,
    };
  } else {
    const y = off * 76;
    const s = off === 0 ? 0.95 : 0.75;
    return {
      top: '50%', left: '180px',
      transform: `translate(-50%, calc(-50% + ${y}px)) scale(${s})`,
      opacity: off === 0 ? 1 : 0.3,
      zIndex: off === 0 ? 10 : 1,
    };
  }
}

function onKey(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowUp':    e.preventDefault(); moveRow(-1); break;
    case 'ArrowDown':  e.preventDefault(); moveRow(1);  break;
    case 'ArrowLeft':  e.preventDefault(); moveCol(-1); break;
    case 'ArrowRight': e.preventDefault(); moveCol(1);  break;
    case 'Enter':
    case ' ':          e.preventDefault(); execute();   break;
    case 'Escape':     e.preventDefault(); backToCenter(); break;
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  if (mode.value === 'center') scheduleShift();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  cancelShift();
});
</script>

<template>
  <div class="stage" :class="[`mode-${mode}`]">

    <!-- ヘッダー -->
    <header class="stage-head">
      <div class="title">【 メニュー 】</div>
      <div class="mode-tag">
        <span class="dot" :style="{ background: currentRow.accent }"></span>
        <span class="tag-text">{{ mode === 'center' ? 'カテゴリ選択中' : '項目選択中' }}</span>
      </div>
    </header>

    <!-- 舞台 -->
    <div class="board">

      <!-- 縦軸タイル (全ての行を絶対配置で描画・モードで位置変化) -->
      <div
        v-for="(row, r) in rows"
        :key="row.axis"
        class="axis-tile"
        :class="{ selected: r === rowIdx }"
        :style="{ ...axisStyle(r), '--accent': row.accent, '--panel-bg': row.panelBg, '--panel-bg-strong': row.panelBgStrong }"
        @click="selectRow(r)"
      >
        <div class="axis-letter">{{ row.axis }}</div>
        <div class="axis-info">
          <div class="axis-title">{{ row.title }}</div>
          <div class="axis-count">{{ row.items.length }}項目</div>
        </div>
        <div class="axis-arrow">→</div>
        <div v-if="r === rowIdx && mode === 'center'" class="axis-progress">
          <div
            :key="shiftKey"
            class="axis-progress-bar"
            :style="{ animationDuration: `${SHIFT_DELAY}ms`, background: row.accent }"
          ></div>
        </div>
      </div>

      <!-- 項目パネル (item モードのみ表示) -->
      <div
        class="item-panel"
        :class="{ visible: mode === 'item' }"
        :style="{ '--accent': currentRow.accent, '--panel-bg': currentRow.panelBg, '--panel-bg-strong': currentRow.panelBgStrong }"
      >
        <div
          class="item-strip"
          :style="{ transform: `translate(calc(-${colIdx[rowIdx] + 0.5} * ${ITEM_UNIT}px), -50%)` }"
        >
          <div
            v-for="(it, c) in currentRow.items"
            :key="it.code"
            class="item-card"
            :class="{
              selected: c === colIdx[rowIdx],
              near: Math.abs(c - colIdx[rowIdx]) === 1,
            }"
            @click="selectItem(rowIdx, c)"
          >
            <div class="item-code">{{ it.code }}</div>
            <div class="item-label">{{ it.label }}</div>
            <div class="item-desc">{{ it.desc }}</div>
            <div class="item-action">開く →</div>
          </div>
        </div>
      </div>

    </div>

    <!-- フッター操作ガイド -->
    <footer class="stage-foot">
      <template v-if="mode === 'center'">
        <span class="hint"><kbd>↑</kbd><kbd>↓</kbd> カテゴリ</span>
        <span class="hint"><kbd>→</kbd> すぐ項目選択へ</span>
        <span class="hint mute">一定時間で自動遷移</span>
      </template>
      <template v-else>
        <span class="hint"><kbd>←</kbd><kbd>→</kbd> 項目</span>
        <span class="hint"><kbd>Enter</kbd> 決定</span>
        <span class="hint mute"><kbd>↑</kbd><kbd>↓</kbd> カテゴリへ戻る</span>
      </template>
      <span class="spacer"></span>
      <span class="counter">
        {{ currentRow.axis }}{{ currentRow.title }} / {{ colIdx[rowIdx] + 1 }}–{{ currentRow.items.length }}
      </span>
    </footer>

  </div>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  min-height: calc(100vh - 120px);
  background: linear-gradient(160deg, #faf7f2 0%, #f5f1e8 55%, #f0ebe0 100%);
  color: #5a4a3a;
  font-family: 'Segoe UI', 'Noto Sans JP', 'Hiragino Sans', sans-serif;
  overflow: hidden;
  display: flex; flex-direction: column;
}
.stage::before {
  content: '';
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 20% 20%, rgba(255,255,255,0.5), transparent 45%),
    radial-gradient(ellipse at 80% 80%, rgba(210,187,149,0.25), transparent 55%);
  pointer-events: none;
}

/* ---- ヘッダー ---- */
.stage-head {
  position: relative; z-index: 2;
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 28px 10px 40px;
  height: 35px;
  box-sizing: border-box;
  background: linear-gradient(135deg, #e6d5b7 0%, #dcc8a6 50%, #d2bb95 100%);
  box-shadow: 0 2px 4px rgba(210, 187, 149, 0.3);
}
.title {
  font-size: medium;
  font-weight: bold;
  color: #5a4a3a;
  line-height: 20px;
}
.mode-tag {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.55);
  border: 1px solid rgba(90,74,58,0.18);
  padding: 3px 12px; border-radius: 0;
  font-size: 12px; color: #5a4a3a;
}
.dot { width: 8px; height: 8px; border-radius: 0; transition: background 0.3s; }

/* ---- 舞台 ---- */
.board {
  position: relative; z-index: 1;
  flex: 1;
  overflow: hidden;
}

/* ---- 縦軸タイル ---- */
.axis-tile {
  position: absolute;
  width: 360px; height: 72px;
  display: flex; align-items: center; gap: 16px;
  padding: 0 20px;
  background: var(--panel-bg);
  border: 1px solid rgba(90,74,58,0.12);
  border-radius: 0;
  cursor: pointer;
  box-sizing: border-box;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.08);
  transition:
    top 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
    left 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
    transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.5s ease,
    background 0.3s,
    box-shadow 0.3s;
  overflow: visible;
  will-change: transform, opacity;
}
.axis-tile:hover { background: var(--panel-bg-strong); box-shadow: 0 6px 14px rgba(0,0,0,0.12); }
.axis-tile.selected {
  background: var(--panel-bg-strong);
  border-color: rgba(90,74,58,0.12);
  box-shadow: 0 10px 28px rgba(90,74,58,0.22), inset 0 -4px 0 rgba(255,255,255,0.55);
}

.axis-letter {
  font-size: 28px; font-weight: 700;
  color: var(--accent);
  min-width: 44px; text-align: center;
  letter-spacing: 1px;
}
.axis-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.axis-title { font-size: 16px; font-weight: 600; letter-spacing: 1px; white-space: nowrap; color: #5a4a3a; }
.axis-count { font-size: 11px; color: rgba(90,74,58,0.6); white-space: nowrap; }

.axis-arrow {
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
  opacity: 0.4;
  margin-left: auto;
  padding-left: 12px;
  transition: opacity 0.3s, transform 0.3s;
}
.axis-tile.selected .axis-arrow {
  opacity: 1;
  animation: arrow-nudge 1.6s ease-in-out infinite;
}
@keyframes arrow-nudge {
  0%, 100% { transform: translateX(0); }
  50%      { transform: translateX(4px); }
}

.axis-progress {
  position: absolute; left: 0; bottom: 0;
  height: 3px; width: 100%;
  background: rgba(90,74,58,0.08);
  overflow: hidden;
  border-radius: 0;
}
.axis-progress-bar {
  height: 100%; width: 100%;
  transform-origin: left center;
  animation: shrink linear forwards;
}
@keyframes shrink {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

/* ---- 項目パネル ---- */
.item-panel {
  position: absolute;
  top: 0; bottom: 0;
  left: 380px; right: 0;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
  transition: opacity 0.5s ease 0.15s;
  mask-image: linear-gradient(to right, transparent 0, black 40px, black calc(100% - 40px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0, black 40px, black calc(100% - 40px), transparent 100%);
}
.item-panel.visible { opacity: 1; pointer-events: auto; }

.item-strip {
  position: absolute;
  left: 33%; top: 50%;
  display: flex; gap: 20px;
  transition: transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: transform;
}
.item-card {
  flex-shrink: 0;
  width: 220px; height: 240px;
  padding: 20px;
  background: var(--panel-bg);
  border: 1px solid rgba(90,74,58,0.12);
  border-radius: 0;
  box-shadow: 0 4px 6px rgba(0,0,0,0.08);
  display: flex; flex-direction: column; gap: 10px;
  cursor: pointer;
  transition: all 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
  opacity: 0.45;
  transform: scale(0.82);
}
.item-card.near     { opacity: 0.8;  transform: scale(0.92); }
.item-card.selected {
  opacity: 1; transform: scale(1.08);
  background: var(--panel-bg-strong);
  border-color: rgba(90,74,58,0.12);
  box-shadow: 0 16px 36px rgba(90,74,58,0.25), inset 0 -5px 0 rgba(255,255,255,0.55);
}
.item-card:hover:not(.selected) { opacity: 0.95; transform: scale(0.95); box-shadow: 0 8px 18px rgba(0,0,0,0.12); }

.item-code {
  align-self: flex-start;
  padding: 4px 10px;
  font-size: 14px; font-weight: 700;
  color: var(--accent);
  background: rgba(255,255,255,0.58);
  border: 1px solid rgba(90,74,58,0.12);
  border-radius: 0;
  letter-spacing: 1px;
}
.item-label { font-size: 20px; font-weight: 600; letter-spacing: 1px; color: #5a4a3a; }
.item-desc  { font-size: 13px; color: rgba(90,74,58,0.7); line-height: 1.5; flex: 1; }
.item-action {
  align-self: flex-end;
  font-size: 12px; color: var(--accent); font-weight: bold;
  opacity: 0; transform: translateX(-6px);
  transition: opacity 0.3s, transform 0.3s;
}
.item-card.selected .item-action { opacity: 1; transform: translateX(0); }

/* ---- フッター ---- */
.stage-foot {
  position: relative; z-index: 2;
  display: flex; align-items: center; gap: 18px;
  padding: 12px 28px;
  border-top: 1px solid rgba(90,74,58,0.15);
  background: rgba(255,255,255,0.45);
  font-size: 12px; color: rgba(90,74,58,0.85);
}
.hint { display: inline-flex; align-items: center; gap: 6px; }
.hint.mute { color: rgba(90,74,58,0.55); }
.hint kbd {
  display: inline-block;
  min-width: 22px; padding: 2px 6px;
  font-family: 'Consolas', monospace; font-size: 11px;
  background: #fff;
  border: 1px solid rgba(90,74,58,0.25);
  border-radius: 4px; text-align: center;
  color: #5a4a3a;
  box-shadow: 0 1px 0 rgba(90,74,58,0.08);
}
.spacer { flex: 1; }
.counter { color: #5a4a3a; letter-spacing: 1px; font-weight: 600; }

/* ---- レスポンシブ ---- */
@media (max-width: 768px) {
  .axis-tile { width: 280px; height: 64px; }
  .item-panel { left: 220px; }
  .item-card { width: 180px; height: 210px; padding: 16px; }
  .item-label { font-size: 17px; }
  .stage-foot { flex-wrap: wrap; gap: 10px; padding: 10px 14px; }
}
</style>
