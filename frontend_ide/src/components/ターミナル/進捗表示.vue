<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, onBeforeUnmount } from 'vue';
import { 演出初期化 } from '../../../host/src/arrival-effect';
import { streamControlOf, visibleStreamContent } from '../../../host/src/stream-control';
defineProps({ running: Boolean, hidden: Boolean });
const emit = defineEmits(['resize']);
const output = ref(), visible = ref(false), open = ref(false), title = ref('実行状況');
let effect, draining, target = '', active = false;
const scroll = () => { if (output.value) output.value.scrollTop = output.value.scrollHeight; emit('resize'); };
function reset() { effect?.停止(); draining?.停止(); effect = draining = undefined; active = false; }
function start() {
  reset(); active = true;
  effect = 演出初期化(output.value, { カーソル色: '#00ffff', isStream: true, 初期文字列: target ? target + '\n' : '', 表示更新: scroll, 完了: () => { active = false; draining = undefined; } });
}
function packet(content) {
  const control = streamControlOf(content);
  if (control === 'start') { visible.value = true; title.value = ''; open.value = true; start(); }
  else if (control === 'end' || control === 'cancel') { open.value = false; if (effect) { draining = effect; effect = undefined; draining.追加('', true); } }
  else {
    const line = visibleStreamContent(content);
    if (!line) return;
    if (!effect) start();
    visible.value = true; title.value = line.slice(0, 160); effect.追加(line + '\n'); target = target ? target + '\n' + line : line;
  }
  scroll();
}
function sync(text, direct = false) {
  if (direct) { reset(); open.value = false; }
  if (!direct && (active || text === target)) return;
  target = text; visible.value = !!text; title.value = text.split('\n').at(-1)?.slice(0, 160) || '実行中…'; output.value.textContent = text; scroll();
}
defineExpose({ packet, sync, reset, visible });
onBeforeUnmount(reset);
</script>
<template>
  <section v-show="visible && !hidden" class="progress" :class="{ running }"><details :open="open" @toggle="open = $event.target.open"><summary>{{ running ? title : '直前の実行状況' }}</summary><pre ref="output"></pre></details></section>
</template>
