<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
defineProps({ busy: Boolean, disabled: Boolean, stop: Boolean });
</script>
<template>
  <button type="button" class="reload-control" :class="{ 'refresh-button': !stop, 'has-label': !!$slots.default }" :disabled="disabled" :aria-busy="busy || undefined">
    <span v-if="stop" class="close-icon" aria-hidden="true"></span>
    <span v-else class="refresh-icon" aria-hidden="true">↺</span>
    <slot />
  </button>
</template>
<style scoped>
/* frontend_web の AiDiy/AIファイル.vue の再読込に合わせる。配置は各画面が保持する。 */
.reload-control[type=button]{display:inline-flex;align-items:center;justify-content:center;flex:none;gap:5px;width:24px;height:24px;min-width:24px;min-height:24px;padding:0;border-radius:2px;font-size:18px;line-height:22px;text-align:center;vertical-align:middle;cursor:pointer;transition:background .15s ease,border-color .15s ease,transform .15s ease}
.reload-control.has-label[type=button]{width:auto;padding:0 6px;font:inherit;white-space:nowrap}
.reload-control.refresh-button[type=button]{background:#22c55e;border:1px solid #16a34a;color:#fff}
.reload-control.refresh-button[type=button]:hover:not(:disabled){background:#34d399;border-color:#22c55e;color:#fff;transform:scale(1.2)}
.reload-control.refresh-button.has-label[type=button]:hover:not(:disabled){transform:none}
.reload-control.has-label[type=button]:hover:not(:disabled) .refresh-icon{transform:scale(1.2)}
.reload-control.refresh-button[type=button]:disabled{opacity:.4;background:#1f8a4b;border-color:#166a39;color:#fff;cursor:not-allowed}
.reload-control[type=button]:focus-visible{outline:2px solid #86efac;outline-offset:2px}
.reload-control[type=button] .refresh-icon{display:inline-block;flex:none;min-width:0;font:18px/22px Arial,'Yu Gothic UI',sans-serif;color:inherit;overflow:visible}
.reload-control[aria-busy=true] .refresh-icon{animation:refresh-spin 1s linear infinite}
@keyframes refresh-spin{to{transform:rotate(-360deg)}}
</style>
