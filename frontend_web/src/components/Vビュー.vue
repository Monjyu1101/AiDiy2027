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

<template>
  <div class="menu-view">
    <h2 class="page-title">【 ビュー 】</h2>

    <div class="content">
      <p>ビュー機能へのアクセスリンクです。下記から選択してください。</p>

      <div class="menu-grid">
        <!-- V商品推移表カード -->
        <router-link class="menu-card menu-card-fixed" to="/Vビュー/V商品推移表?URLメニュー=／Vビュー">
          <div class="menu-card-title">
            <span class="icon">V推</span>
            V商品推移表
          </div>
          <div class="menu-card-description">
            商品ごとの入出庫・在庫量を時系列グラフで可視化するビュー（生SQL集計）
          </div>
        </router-link>
      </div>
    </div>
  </div>
</template>

<style scoped src="../assets/menu-common.css"></style>
<style scoped>
@media (max-width: 768px) {
  .menu-card-fixed {
    width: 100%;
    min-width: 0;
    height: auto;
    min-height: 158px;
  }
}
</style>

