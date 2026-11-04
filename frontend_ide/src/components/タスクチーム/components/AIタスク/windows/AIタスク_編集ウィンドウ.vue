<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup lang="ts">
import { taskChannelName } from '../../../task-session';
import { ref, onMounted, onBeforeUnmount } from 'vue';
import RequestEdit from '../dialog/AIタスク_要求編集.vue';
import DetailEdit from '../dialog/AIタスク_明細編集.vue';
import ResponseView from '../dialog/AIタスク_応答内容.vue';
const props = defineProps<{ 利用者ID: string }>();
const payload = ref<Record<string, any> | null>(null), error = ref('');
let disposed = false, closing = false;
async function close() { if (closing) return; closing = true; try { await window.aidiyWindow?.close?.(); } catch { closing = false; if (!disposed) error.value = '編集画面を閉じられませんでした。もう一度閉じてください。'; } }
function registered(item: Record<string, any> | null) {
  if (disposed) return;
  const channel = new BroadcastChannel(taskChannelName('dialog'));
  channel.postMessage({ type: 'task-dialog-registered', kind: payload.value?.kind, item });
  channel.close(); void close();
}
onMounted(async () => {
  try {
    const result = await window.aidiyWindow?.taskWindows('dialog-payload');
    if (disposed) return;
    const value = result?.payload ?? result;
    if (!['request', 'detail', 'response'].includes(value?.kind)) throw Error('編集内容を取得できません。要求・明細から開き直してください。');
    payload.value = value;
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : '編集内容を取得できません。'; }
});
onBeforeUnmount(() => { disposed = true; });
</script>
<template>
  <div class="task-editor-window">
    <p v-if="error" role="alert" class="error">{{ error }}</p><p v-else-if="!payload" role="status">読み込み中…</p>
    <DetailEdit v-else-if="payload.kind === 'detail'" :is-open="true" :編集明細="payload.編集明細 || null" @close="close" @registered="registered" />
    <ResponseView v-else-if="payload.kind === 'response'" :is-open="true" :タイトル="payload.タイトル || '応答内容'" :要求内容="payload.要求内容 || ''" :内容="payload.内容 || ''" @close="close" />
    <RequestEdit v-else :is-open="true" :利用者ID="props.利用者ID" :編集タスク="payload.編集タスク || null" @close="close" @registered="registered" />
  </div>
</template>
<style scoped>
/* 独立編集面の描画を自身へ閉じ込め、GPU描画時の外側ホバーによる黒抜けを防ぐ。 */
.task-editor-window{width:100%;height:100%;background:#080a10;contain:paint}
.task-editor-window :deep(.dialog-overlay){position:static;inset:auto;background:transparent;z-index:auto;width:100%;height:100%;align-items:stretch;justify-content:stretch}
.task-editor-window :deep(.dialog-content){width:100%;max-width:none;height:100%;border:none;border-radius:0;box-shadow:none}
.task-editor-window :deep(.dialog-body){flex:1;overflow:auto}
</style>
