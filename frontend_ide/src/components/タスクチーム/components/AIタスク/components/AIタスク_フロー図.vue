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
// AIタスク_フロー図: タスク明細から開始〜終了のフローを mermaid 図で表示し、
// クリティカルパス（最長所要経路）を強調表示する
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { PropType } from 'vue';
import mermaid from 'mermaid';

const props = defineProps({
  タスクID: { type: String, default: '' },
  タイトル: { type: String, default: '' },
  マーメイド記号: { type: String, default: '' },
  明細: { type: Array as PropType<Record<string, any>[]>, default: () => [] },
  showHeader: { type: Boolean, default: true }
});

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  themeVariables: {
    background: '#12101a',
    primaryColor: '#ffffff',
    primaryBorderColor: '#8f68dd',
    primaryTextColor: '#333333',
    lineColor: '#9c8fd0'
  }
});

const diagramHost = ref<HTMLElement | null>(null);
const renderError = ref('');
let renderSeq = 0;

interface パス結果 {
  経路SEQ: number[];
  予測合計: number;
}

// 経路の重みは予測分数（分）。未見積り（0・未設定）は 1 として扱うので、
// 予測分数が 1 件も入っていないタスクでは従来どおりステップ数の最長経路になる。
function 所要重み(row: Record<string, any>): number {
  const 分 = Number(row?.予測分数 ?? 0);
  return Number.isFinite(分) && 分 > 0 ? 分 : 1;
}

// 先行SEQ の 1 要素は `5`（通常のエッジ）か `5=Y` `5=N`（if 明細の判定値で選ばれるエッジ）。
// 同期元: backend_taskteam/task_proc/tasks_db.py の 先行SEQ解析。
interface 先行エッジ {
  先行SEQ: number;
  条件: string;
}

function 先行SEQ解析(先行SEQ: any): 先行エッジ[] {
  return String(先行SEQ || '')
    .split(',')
    .map((要素) => 要素.trim().toUpperCase())
    .filter((要素) => 要素 !== '')
    .map((要素) => {
      const m = /^(\d+)(?:=([YN]))?$/.exec(要素);
      return m ? { 先行SEQ: Number(m[1]), 条件: m[2] || '' } : null;
    })
    .filter((e): e is 先行エッジ => e !== null);
}

// クリティカルパス（最長依存経路）を求める
function クリティカルパス計算(rows: Record<string, any>[]): パス結果 {
  const dist: Record<number, number> = {};
  const prev: Record<number, number | null> = {};
  const sorted = [...rows].sort((a, b) => Number(a.明細SEQ) - Number(b.明細SEQ));

  for (const row of sorted) {
    const seq = Number(row.明細SEQ);
    const preds = 先行SEQ解析(row.先行SEQ)
      .map((e) => e.先行SEQ)
      .filter((n) => dist[n] !== undefined);
    let base = 0;
    let bestPred: number | null = null;
    for (const p of preds) {
      const 距離 = dist[p] ?? 0;
      if (bestPred === null || 距離 > base) {
        base = 距離;
        bestPred = p;
      }
    }
    dist[seq] = base + 所要重み(row);
    prev[seq] = bestPred;
  }

  // 後続を持たない工程のうち、最長のものを終点とする
  const hasSuccessor = new Set<number>();
  for (const row of sorted) {
    for (const e of 先行SEQ解析(row.先行SEQ)) {
      if (e.先行SEQ > 0) hasSuccessor.add(e.先行SEQ);
    }
  }
  let goal: number | null = null;
  let goalDist = -1;
  for (const row of sorted) {
    const seq = Number(row.明細SEQ);
    const 距離 = dist[seq] ?? 0;
    if (!hasSuccessor.has(seq) && 距離 > goalDist) {
      goal = seq;
      goalDist = 距離;
    }
  }

  const 経路SEQ: number[] = [];
  let cursor = goal;
  while (cursor !== null && cursor !== undefined) {
    経路SEQ.unshift(cursor);
    cursor = prev[cursor] ?? null;
  }
  const 明細マップ = new Map(sorted.map((row) => [Number(row.明細SEQ), row]));
  const 予測合計 = 経路SEQ.reduce((合計, seq) => {
    const 分 = Number(明細マップ.get(seq)?.予測分数 ?? 0);
    return 合計 + (Number.isFinite(分) && 分 > 0 ? 分 : 0);
  }, 0);
  return { 経路SEQ, 予測合計 };
}

const クリティカルパス = computed(() => クリティカルパス計算(props.明細));

const クリティカルパス表示 = computed(() => {
  const { 経路SEQ, 予測合計 } = クリティカルパス.value;
  if (経路SEQ.length === 0) return '';
  const byName = new Map(props.明細.map((row) => [Number(row.明細SEQ), String(row.タイトル || '')]));
  const names = 経路SEQ.map((seq) => byName.get(seq) ?? String(seq));
  const 経路 = names.join(' → ');
  // 予測分数が 1 件も入っていないタスクでは所要見込みを出さない
  return 予測合計 > 0 ? `${経路}（予測 ${予測合計} 分）` : 経路;
});

// mermaid 図テキストを生成する（標準は上から下の TD）
function マーメイド生成(rows: Record<string, any>[], direction: string): string {
  const { 経路SEQ } = クリティカルパス.value;
  const critNodes = new Set(経路SEQ);
  const critEdges = new Set<string>();
  for (let i = 0; i < 経路SEQ.length - 1; i += 1) {
    critEdges.add(`${経路SEQ[i]}>${経路SEQ[i + 1]}`);
  }

  const lines: string[] = [`flowchart ${direction}`];

  const sorted = [...rows].sort((a, b) => Number(a.明細SEQ) - Number(b.明細SEQ));
  const predsMap = new Map<number, 先行エッジ[]>();
  for (const row of sorted) {
    const seq = Number(row.明細SEQ);
    const preds = 先行SEQ解析(row.先行SEQ).filter((e) => e.先行SEQ !== seq);
    predsMap.set(seq, preds);
    const タイトル = String(row.タイトル || '').replace(/["\[\]<>{}|]/g, '');
    // 形はタイプで決める。開始・終了は端点（横長のラウンド四角）、if は判断（両端が三角の四角）、or は合流（円）
    const タイプ = String(row.タイプ || '');
    if (タイプ === 'start' || タイプ === 'end' || seq === 0 || seq === 9999) {
      lines.push(`  N${seq}(["${タイトル}"])`);
    } else if (タイプ === 'if') {
      // 判断は四角の両端を三角にした形（hexagon）。Mermaid の菱形 `{}` は
      // 幅・高さとも「ラベル幅 + ラベル高」の正方形になり、他のノードと釣り合わないため使わない。
      // hexagon は高さ=ラベル高+余白、幅=ラベル幅+両端の三角ぶん で、四角と同じくラベル比例に収まる。
      lines.push(`  N${seq}{{"${タイトル}"}}`);
    } else if (タイプ === 'or') {
      lines.push(`  N${seq}(("${タイトル}"))`);
    } else {
      lines.push(`  N${seq}["${タイトル}"]`);
    }
  }

  // エッジ定義（linkStyle 用に出現順を記録する）
  const edgeKeys: string[] = [];
  for (const row of sorted) {
    const seq = Number(row.明細SEQ);
    const preds = predsMap.get(seq) ?? [];
    for (const e of preds) {
      // if からのエッジは判定値をラベルにして、どちらの枝か図で分かるようにする
      const 矢印 = e.条件 ? `-->|${e.条件}|` : '-->';
      lines.push(`  N${e.先行SEQ} ${矢印} N${seq}`);
      edgeKeys.push(`${e.先行SEQ}>${seq}`);
    }
  }

  // クリティカルパスの強調
  lines.push('  classDef crit fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20;');
  lines.push('  classDef term fill:#f5f1e8,stroke:#2e7d32,color:#2e7d32;');
  if (sorted.some((row) => Number(row.明細SEQ) === 0)) {
    lines.push('  class N0 term;');
  }
  if (sorted.some((row) => Number(row.明細SEQ) === 9999)) {
    lines.push('  class N9999 term;');
  }
  if (critNodes.size > 0) {
    lines.push(`  class ${[...critNodes].map((seq) => `N${seq}`).join(',')} crit;`);
  }

  // 明細状態の反映（一覧の配色と同じ: 完了/エラーは灰色、実行中は薄緑＋ブリンク）
  // done/running を crit/term より後に定義して状態色を優先する
  lines.push('  classDef done fill:#d9d9d9,stroke:#9e9e9e,color:#555555;');
  lines.push('  classDef running fill:#d9f2e0,stroke:#15803d,stroke-width:2px,color:#14532d;');
  // パス: 分岐で通らなかった枝。失敗ではないので破線＋薄いグレーにする
  lines.push('  classDef passed fill:#efefef,stroke:#bdbdbd,stroke-dasharray:4 3,color:#9e9e9e;');
  const doneNodes = sorted
    .filter((row) => ['完了', 'エラー'].includes(String(row.状態 ?? '')))
    .map((row) => `N${Number(row.明細SEQ)}`);
  const runningNodes = sorted
    .filter((row) => String(row.状態 ?? '') === '実行中')
    .map((row) => `N${Number(row.明細SEQ)}`);
  if (doneNodes.length > 0) {
    lines.push(`  class ${doneNodes.join(',')} done;`);
  }
  if (runningNodes.length > 0) {
    lines.push(`  class ${runningNodes.join(',')} running;`);
  }
  const passedNodes = sorted
    .filter((row) => String(row.状態 ?? '') === 'パス')
    .map((row) => `N${Number(row.明細SEQ)}`);
  if (passedNodes.length > 0) {
    lines.push(`  class ${passedNodes.join(',')} passed;`);
  }

  edgeKeys.forEach((key, index) => {
    if (critEdges.has(key)) {
      lines.push(`  linkStyle ${index} stroke:#66bb6a,stroke-width:2.5px;`);
    }
  });

  return lines.join('\n');
}

async function 図描画() {
  renderError.value = '';
  await nextTick();
  const host = diagramHost.value;
  if (!host) return;
  if (props.明細.length === 0) {
    host.innerHTML = '';
    return;
  }
  renderSeq += 1;
  const seq = renderSeq;
  try {
    // 標準は縦表示 TD。明示的な縦方向指定だけ反映する
    const 指定 = props.マーメイド記号.trim().toUpperCase();
    const direction = ['TD', 'TB'].includes(指定)
      ? 指定
      : 'TD';
    const code = マーメイド生成(props.明細, direction);
    const { svg } = await mermaid.render(`taskflow${seq}`, code);
    if (seq !== renderSeq) return; // 後発の描画が始まっていたら古い結果は捨てる
    host.innerHTML = svg;
  } catch (e) {
    if (seq !== renderSeq) return;
    host.innerHTML = '';
    renderError.value = 'フロー図の描画に失敗しました。';
  }
}

watch([() => props.明細, () => props.マーメイド記号], 図描画, { deep: true });

let resizeTimer: ReturnType<typeof setTimeout> | null = null;
const handleResize = () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(図描画, 300);
};

onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  if (resizeTimer) clearTimeout(resizeTimer);
});
</script>

<template>
  <div class="flow-panel">
    <div v-if="props.showHeader" class="panel-header">
      <span class="panel-title">【フロー図】</span>
      <span v-if="props.タスクID" class="panel-subtitle">{{ props.タスクID }}</span>
    </div>

    <div class="panel-body">
      <div v-if="!props.タスクID" class="panel-placeholder">
        タスク要求を選択してください
      </div>
      <template v-else>
        <div v-if="renderError" class="panel-error">{{ renderError }}</div>
        <!-- タイトルは図の左上にプレーン表示する（見出しはタスクIDだけにする） -->
        <div v-if="props.タイトル" class="diagram-title">{{ props.タイトル }}</div>
        <div ref="diagramHost" class="diagram-host"></div>
        <div v-if="クリティカルパス表示" class="critical-path">
          <span class="critical-label">クリティカルパス:</span>
          {{ クリティカルパス表示 }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.flow-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: #ddd;
}

/* 見出しはアバター画面の紫タイトルバー（_WindowShell purple）と同色 */
.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  height: 28px;
  box-sizing: border-box;
  background: linear-gradient(135deg, rgba(108, 78, 196, 0.94), rgba(143, 104, 221, 0.9));
  border-bottom: 1px solid rgba(93, 68, 168, 0.95);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(44, 24, 101, 0.3);
  flex-shrink: 0;
}

.panel-title {
  font-size: 13px;
  color: #fff;
  font-weight: bold;
  letter-spacing: 1px;
}

.panel-subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: 8px;
}

.panel-placeholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(220, 214, 247, 0.55);
  font-size: 13px;
}

.panel-error {
  color: #ef5350;
  font-size: 12px;
  padding: 4px;
}

.diagram-title {
  flex-shrink: 0;
  padding: 0 2px 6px;
  font-size: 13px;
  color: #ddd;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diagram-host {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

/* viewBox を保ったままパネル一杯に拡大表示する（mermaid の inline max-width を打ち消す） */
.diagram-host :deep(svg) {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
}

/* 実行中の明細ノードはブリンクさせる（mermaid が class 名を SVG に付与する） */
.diagram-host :deep(.node.running) {
  animation: node-blink 1s ease-in-out infinite;
}

@keyframes node-blink {
  50% {
    opacity: 0.35;
  }
}

.critical-path {
  flex-shrink: 0;
  border-top: 1px solid rgba(118, 97, 204, 0.5);
  padding: 8px 4px 2px;
  font-size: 12px;
  color: #bbb;
  line-height: 1.5;
}

.critical-label {
  color: #66bb6a;
  margin-right: 6px;
}
</style>
