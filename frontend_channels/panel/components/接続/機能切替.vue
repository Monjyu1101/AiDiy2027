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
defineProps({ id: String, 有効: Boolean, 無効: Boolean, 説明: String });
defineEmits(['切替']);
</script>
<template>
  <button :id="id" class="feature-switch" role="switch" :aria-checked="有効" :disabled="無効" :title="説明" @click="$emit('切替')"><span class="switch-off">OFF</span><span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span><span class="switch-on">ON</span></button>
</template>
