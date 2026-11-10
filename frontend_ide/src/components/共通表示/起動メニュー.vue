<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
// IDE上部の起動ボタン列。広いときは「＋」に続けて各項目を横に並べ、狭いときは「＋」だけを出して、押すと下へ起動メニューを開く。
// 「＋」は文字ではなく枠付きの図形（バーガーと同じ見た目）。項目名に「＋」は付けない。表示する項目だけを items に渡す（text / title / disabled / pressed / class / run）。
import {ref, onMounted, onBeforeUnmount} from 'vue';
const props = defineProps({items: {type: Array, required: true}, label: {type: String, default: ''}, breakpoint: {type: Number, default: 900}});
const compact = ref(false), open = ref(false), root = ref();
let media;
function sync() {compact.value = !!media?.matches; if (!compact.value) open.value = false;}
function away(event) {if (open.value && root.value && !root.value.contains(event.target)) open.value = false;}
function key(event) {if (open.value && event.key === 'Escape') {open.value = false; event.stopPropagation(); event.preventDefault();}}
function run(item) {open.value = false; item.run?.();}
onMounted(() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  media = window.matchMedia(`(max-width:${props.breakpoint}px)`);
  sync(); media.addEventListener('change', sync);
  document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true);
});
onBeforeUnmount(() => {
  media?.removeEventListener('change', sync);
  document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true);
});
</script>

<template>
  <nav ref="root" class="ai-launchers" :class="{compact}" :aria-label="label">
    <template v-if="compact">
      <button type="button" class="launch-plus" aria-haspopup="menu" :aria-expanded="open" title="起動メニュー" @click="open = !open"><span class="plus-mark" aria-hidden="true"></span></button>
      <div v-if="open" class="launch-popup" role="menu">
        <button v-for="item in items" :key="item.key" type="button" role="menuitem" :class="item.class" :disabled="item.disabled" :title="item.title" :aria-label="item.ariaLabel" :aria-pressed="item.pressed" @click="run(item)"><span v-if="item.shortLabel" class="layout-launch-mark" aria-hidden="true"><span>{{ item.shortLabel }}</span><span class="layout-launch-arrow">{{ item.arrow }}</span></span><template v-else>{{ item.text }}</template></button>
      </div>
    </template>
    <template v-else>
      <span class="plus-mark" aria-hidden="true"></span>
      <button v-for="item in items" :key="item.key" type="button" :class="item.class" :disabled="item.disabled" :title="item.title" :aria-label="item.ariaLabel" :aria-pressed="item.pressed" @click="run(item)"><span v-if="item.shortLabel" class="layout-launch-mark" aria-hidden="true"><span>{{ item.shortLabel }}</span><span class="layout-launch-arrow">{{ item.arrow }}</span></span><template v-else>{{ item.text }}</template></button>
    </template>
  </nav>
</template>
