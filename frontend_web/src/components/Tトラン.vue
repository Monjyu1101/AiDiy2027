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
import { RouterLink } from 'vue-router';
</script>

<template>
  <div class="menu-view">
    <h2 class="page-title">【 トラン 】</h2>

    <div class="content">
      <p>トランザクション管理機能へのアクセスリンクです。下記から選択してください。</p>

      <div class="transaction-menu-sections">
        <div class="menu-row">
          <RouterLink class="menu-card menu-card-fixed" to="/Tトラン/T配車/一覧?URLメニュー=／Tトラン">
            <div class="menu-card-title">
              <span class="icon">T配</span>
              T配車
            </div>
            <div class="menu-card-description">
              配車日・車両・担当・積荷情報の登録・編集・ステータス管理
            </div>
          </RouterLink>
        </div>

        <div class="menu-hairline"></div>

        <div class="menu-row">
          <RouterLink class="menu-card menu-card-fixed" to="/Tトラン/T商品入庫/一覧?URLメニュー=／Tトラン">
            <div class="menu-card-title">
              <span class="icon">T入</span>
              T商品入庫
            </div>
            <div class="menu-card-description">
              入庫日・仕入先・商品・数量・ロットの登録と在庫反映
            </div>
          </RouterLink>

          <RouterLink class="menu-card menu-card-fixed" to="/Tトラン/T商品出庫/一覧?URLメニュー=／Tトラン">
            <div class="menu-card-title">
              <span class="icon">T出</span>
              T商品出庫
            </div>
            <div class="menu-card-description">
              出庫日・得意先・商品・数量の登録と在庫引き当て
            </div>
          </RouterLink>

          <RouterLink class="menu-card menu-card-fixed" to="/Tトラン/T商品棚卸/一覧?URLメニュー=／Tトラン">
            <div class="menu-card-title">
              <span class="icon">T棚</span>
              T商品棚卸
            </div>
            <div class="menu-card-description">
              棚卸日・商品・理論在庫と実在庫の差異登録・調整
            </div>
          </RouterLink>
        </div>

        <div class="menu-hairline"></div>

        <div class="menu-row">
          <RouterLink class="menu-card menu-card-fixed" to="/Tトラン/T生産/一覧?URLメニュー=／Tトラン">
            <div class="menu-card-title">
              <span class="icon">T生</span>
              T生産
            </div>
            <div class="menu-card-description">
              生産日・工程・製品・数量・ステータスの登録と進捗管理
            </div>
          </RouterLink>
          <RouterLink class="menu-card menu-card-fixed" to="/Tトラン/T生産払出/一覧?URLメニュー=／Tトラン">
            <div class="menu-card-title">
              <span class="icon">T払</span>
              T生産払出
            </div>
            <div class="menu-card-description">
              生産に使用した原材料の払出数量・在庫控除の一覧確認
            </div>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../assets/menu-common.css"></style>
<style scoped>
.transaction-menu-sections {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 20px;
}

.menu-row {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.menu-hairline {
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, rgba(90, 74, 58, 0.12) 0%, rgba(90, 74, 58, 0.45) 50%, rgba(90, 74, 58, 0.12) 100%);
}

@media (max-width: 768px) {
  .menu-row {
    flex-direction: column;
  }

  .menu-card-fixed {
    width: 100%;
    min-width: 0;
    height: auto;
    min-height: 158px;
  }
}
</style>

