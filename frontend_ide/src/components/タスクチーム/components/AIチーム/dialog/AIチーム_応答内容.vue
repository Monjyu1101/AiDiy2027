<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup lang="ts">
// AIチーム_応答内容: 依頼一覧・経験一覧の行ダブルクリックで開く読み取り専用ダイアログ
// 渡された 要求内容 / 応答内容 / まとめ内容 のうち、中身のあるものだけをセクション表示する
// 各内容が JSON としてパースできれば整形（json.dumps 相当）して表示する
import { computed } from 'vue';

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  タイトル: { type: String, default: '応答内容' },
  要求内容: { type: String, default: '' },
  内容: { type: String, default: '' },
  まとめ内容: { type: String, default: '' }
});
const emit = defineEmits(['close']);

const 整形 = (値: string) => {
  const raw = String(値 ?? '');
  if (!raw.trim()) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

// セクションは「見出し + 本文」の配列にまとめ、依頼一覧と経験一覧で同じ形で表示する
const セクション一覧 = computed(() => {
  const 候補: { 見出し: string; 本文: string }[] = [
    { 見出し: '要求内容', 本文: 整形(props.要求内容) },
    { 見出し: '応答内容', 本文: 整形(props.内容) },
    { 見出し: 'まとめ内容', 本文: 整形(props.まとめ内容) }
  ];
  return 候補.filter((項目) => 項目.本文.trim() !== '');
});
</script>

<template>
  <div v-if="props.isOpen" class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog-content">
      <header class="dialog-header">
        <h3>{{ props.タイトル }}</h3>
        <button class="dialog-close" @click="emit('close')">×</button>
      </header>
      <div class="dialog-body">
        <template v-for="セクション in セクション一覧" :key="セクション.見出し">
          <div v-if="セクション一覧.length > 1" class="section-label">{{ セクション.見出し }}</div>
          <pre class="content-pre">{{ セクション.本文 }}</pre>
        </template>
        <div v-if="セクション一覧.length === 0" class="section-empty">表示できる内容がありません。</div>
      </div>
      <footer class="dialog-footer">
        <button class="dialog-button" @click="emit('close')">閉じる</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog-content {
  background: #07080c;
  color: #e5e7eb;
  width: 1200px;
  max-width: 94vw;
  height: 90vh;
  max-height: 90vh;
  border: 1px solid rgba(143, 104, 221, 0.75);
  border-radius: 4px;
  box-shadow: 0 0 24px rgba(60, 42, 128, 0.65);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 14px;
  height: 32px;
  box-sizing: border-box;
  background: linear-gradient(135deg, rgba(70, 104, 205, 0.96), rgba(108, 78, 196, 0.96), rgba(143, 104, 221, 0.92));
  border-bottom: 1px solid rgba(93, 68, 168, 0.95);
  border-radius: 4px 4px 0 0;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(18, 18, 38, 0.45);
}

.dialog-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: bold;
  color: #fff;
  letter-spacing: 1px;
}

.dialog-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.86);
  font-size: 18px;
  cursor: pointer;
}

.dialog-close:hover {
  color: #fff;
}

.dialog-body {
  padding: 10px 12px;
  background: #07080c;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.section-label {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: #b39ddb;
  letter-spacing: 1px;
}

.section-label + .content-pre {
  margin-bottom: 10px;
}

.content-pre:last-child {
  margin-bottom: 0;
}

.section-empty {
  padding: 12px;
  color: #9ca3af;
  font-size: 12px;
}

.content-pre {
  margin: 0;
  padding: 10px;
  background: #05070b;
  border: 1px solid #4b5563;
  border-radius: 4px;
  color: #f3f4f6;
  font-size: 11px;
  font-family: 'Consolas', 'Menlo', 'Monaco', monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.dialog-footer {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid rgba(93, 68, 168, 0.85);
  background: #07080c;
}

.dialog-button {
  background: #1f2937;
  color: #f3f4f6;
  border: 1px solid #4b5563;
  border-radius: 0;
  padding: 6px 16px;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dialog-button:hover {
  border-color: #8f68dd;
}
</style>
