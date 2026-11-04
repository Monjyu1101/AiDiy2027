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
    <h2 class="page-title">【 スケジュール 】</h2>

    <div class="content">
      <p>スケジュール管理機能へのアクセスリンクです。下記から選択してください。</p>

      <div class="schedule-menu-sections">
        <div class="menu-row">
          <!-- S配車_週表示カード -->
          <RouterLink class="menu-card menu-card-fixed" to="/Sスケジュール/S配車_週表示?URLメニュー=／Sスケジュール">
            <div class="menu-card-title">
              <span class="icon">S週</span>
              S配車_週表示
            </div>
            <div class="menu-card-description">
              週単位カレンダーで配車の割り当て・調整・ステータスを一覧確認
            </div>
          </RouterLink>

          <!-- S配車_日表示カード -->
          <RouterLink class="menu-card menu-card-fixed" to="/Sスケジュール/S配車_日表示?URLメニュー=／Sスケジュール">
            <div class="menu-card-title">
              <span class="icon">S日</span>
              S配車_日表示
            </div>
            <div class="menu-card-description">
              日単位タイムラインで配車の時間帯・担当・積荷を詳細管理
            </div>
          </RouterLink>
        </div>

        <div class="menu-hairline"></div>

        <div class="menu-row">
          <!-- S生産_週表示カード -->
          <RouterLink class="menu-card menu-card-fixed" to="/Sスケジュール/S生産_週表示?URLメニュー=／Sスケジュール">
            <div class="menu-card-title">
              <span class="icon">S生週</span>
              S生産_週表示
            </div>
            <div class="menu-card-description">
              週単位カレンダーで生産計画の割り当て・進捗・調整を確認
            </div>
          </RouterLink>

          <!-- S生産_日表示カード -->
          <RouterLink class="menu-card menu-card-fixed" to="/Sスケジュール/S生産_日表示?URLメニュー=／Sスケジュール">
            <div class="menu-card-title">
              <span class="icon">S生日</span>
              S生産_日表示
            </div>
            <div class="menu-card-description">
              日単位タイムラインで生産工程・数量・担当ラインを詳細管理
            </div>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../assets/menu-common.css"></style>
<style scoped>
.schedule-menu-sections {
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

