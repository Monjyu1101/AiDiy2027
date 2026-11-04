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
const baseUrl = import.meta.env.BASE_URL || '/';
const frameSrc = `${baseUrl}X動画再生BGM/index.html`;
</script>

<template>
  <div class="page-container">
    <iframe
      class="bgm-frame"
      :src="frameSrc"
      title="X動画再生BGM"
      frameborder="0"
      allow="autoplay; fullscreen"
      loading="lazy"
    ></iframe>
  </div>
</template>

<style scoped>
.page-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: #09090f;
}

.bgm-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
</style>
