<!--

 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------


-->
<script setup>
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { パネル状態作成 } from './パネル状態.js';
import 機能切替 from './機能切替.vue';
import EscapingMark from './逃げるマーク.vue';
// Discord 版と同じ構成から、音声会話（Live）の設定・円型インジケーター・モニターを除いた画面。
const 画面 = パネル状態作成(window.slackPanel);
const 本文 = ref(), 詳細 = ref();
const ピン = ref({ pinned: false, locked: false }), ピン切替中 = ref(false), 最大化中 = ref(false);
const ピン説明 = computed(() => ピン.value.locked ? 'VRモード中はピン止めを解除できません' : ピン.value.pinned ? 'ピン止めを解除（最前面 OFF）' : 'ピン止め（最前面 ON）');
let ピン購読解除, 終了済み = false, ピン通知世代 = 0;
function ピン反映(value) { if (!終了済み && typeof value?.pinned === 'boolean' && typeof value?.locked === 'boolean') ピン.value = value; }
async function ピン切替() {
  if (ピン切替中.value || ピン.value.locked) return;
  ピン切替中.value = true;
  try { ピン反映(await window.slackPanel.togglePin?.()); } catch {} finally { ピン切替中.value = false; }
}
async function 最大化反映() { try { 最大化中.value = !!(await window.slackPanel.isMaximized?.()); } catch {} }
async function 最大化切替() { await 画面.ウィンドウ操作('maximize'); await 最大化反映(); }
// 未接続では設定欄そのものへ移る。接続中は設定を開き、適用時に再接続する。
function モデル押下() { if (!画面.モデル設定()) document.getElementById('code-model')?.focus(); }
onMounted(() => {
  画面.開始(本文.value, 詳細.value);
  ピン購読解除 = window.slackPanel.onPinState?.(value => { ピン通知世代++; ピン反映(value); });
  const 世代 = ピン通知世代;
  Promise.resolve(window.slackPanel.getPinState?.()).then(value => { if (世代 === ピン通知世代) ピン反映(value); }).catch(() => {});
  void 最大化反映(); window.addEventListener('resize', 最大化反映);
});
onBeforeUnmount(() => { 終了済み = true; ピン購読解除?.(); window.removeEventListener('resize', 最大化反映); 画面.終了(); });
</script>
<template>
  <header><div id="status" role="status" aria-live="polite"><i id="dot" :data-phase="画面.接続状態.phase"></i><span id="status-text">{{ 画面.状態名 }}</span></div><div class="brand"><strong>AiDiy Slack</strong></div><div class="window-actions"><button id="minimize" title="最小化" aria-label="最小化" @click="画面.ウィンドウ操作('minimize')">−</button><button id="maximize" :class="{ maximized: 最大化中 }" :title="最大化中 ? '元のサイズに戻す' : '最大化'" :aria-label="最大化中 ? '元のサイズに戻す' : '最大化'" @click="最大化切替"><span class="window-maximize"></span></button><button id="pin" class="window-pin" :class="{ pinned: ピン.pinned }" :aria-pressed="ピン.pinned" :disabled="ピン.locked || ピン切替中" :title="ピン説明" :aria-label="ピン説明" @click="ピン切替"><span aria-hidden="true">📌</span></button><button id="close" title="閉じる" aria-label="閉じる" @click="画面.ウィンドウ操作('close')">×</button></div></header>
  <div id="activity-bar" aria-hidden="true"></div>
  <div class="conversation-toolbar"><div class="conversation-context"><span class="project-label">プロジェクト:</span><span id="project-folder" :title="画面.フォルダ.path">{{ 画面.フォルダ.name }}</span></div><button id="toggle" :class="{ awaiting: 画面.編集可能 }" :disabled="画面.接続操作不可" @click="画面.接続切替">{{ 画面.接続ボタン }}</button></div>
  <div id="features" role="group" aria-label="有効な機能"><span id="feature-code" class="feature-chip"><i aria-hidden="true"></i><em>CODE</em><b>ON</b></span></div>
  <main>
    <div id="settings">
      <div class="section-label code-section">コード <component :is="機能切替" id="code-toggle" :有効="true" :無効="true" 説明="コードは常に ON です" /></div>
      <div class="row"><label for="code-cli">コード</label><span id="code-cli" class="fixed-value" title="コードは aidiy_hermes 固定です">{{ 画面.コードCLI }}</span></div>
      <div class="row code-last"><label for="code-model">モデル</label><select id="code-model" v-model="画面.コードモデル" :disabled="画面.コード編集不可" @change="画面.保存"><option v-for="item in 画面.コードモデル一覧" :key="item.id" :value="item.id">{{ item.label }}</option></select></div>
      <textarea id="error-detail" ref="詳細" readonly :hidden="!画面.接続状態.details" :value="画面.接続状態.details || ''" aria-label="接続エラーの詳細（選択してコピーできます）"></textarea>
      <p class="hint">専用チャンネルに投稿すると、スレッドで返信します。</p>
      <p id="note" class="note" :class="{ error: 画面.案内エラー }" role="status">{{ 画面.案内 }}</p>
      <div v-if="画面.設定表示" id="settings-actions"><button id="settings-cancel" type="button" :disabled="画面.操作中" @click="画面.設定取消">キャンセル</button><button id="settings-apply" type="button" :disabled="画面.操作中" @click="画面.設定適用">適用して再接続</button></div>
    </div>
    <section id="stage" aria-label="最後のやり取り">
      <EscapingMark icon="AiDiy.png" />
      <div id="stage-log" aria-live="polite"><div id="stage-idle" class="stage-entry" :hidden="画面.発言表示"><span class="stage-who">接続先</span><span class="stage-text">専用チャンネルに投稿すると、スレッドで返信します。</span></div><div id="stage-message" class="stage-entry" :hidden="!画面.発言表示" :class="{ fading: 画面.発言消去中 }" :data-role="画面.発言役割"><span id="stage-who" class="stage-who">{{ 画面.発言者 }}</span><span id="stage-text" ref="本文" class="stage-text"><span>{{ 画面.発言本文 }}</span><span v-if="画面.文字表示中" class="terminal-cursor"></span></span></div></div>
    </section>
  </main>
  <footer id="model-bar"><button id="choose-model" type="button" :disabled="画面.モデル操作不可" title="モデルを設定（接続中は適用時に再接続）" @click="モデル押下"><span class="model-caption">モデル</span> <span class="model-chevron">▾</span></button><span id="model-label" :title="画面.モデル表示">{{ 画面.モデル表示 }}</span></footer>
</template>
