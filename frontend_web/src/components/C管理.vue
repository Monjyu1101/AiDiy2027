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
    <h2 class="page-title">【 管理 】</h2>

    <div class="content">
      <p>管理機能へのアクセスリンクです。下記から選択してください。</p>

      <div class="manage-menu-sections">
        <div class="menu-row">
          <a class="menu-card menu-card-fixed" href="/AiDiy" target="_blank" rel="noopener noreferrer">
            <div class="menu-card-title">
              <span class="icon">AI</span>
              AiDiy
            </div>
            <div class="menu-card-description">
              マルチAI対話・WebSocket音声認識・画像生成・CodeAgentsによるコード支援
            </div>
          </a>
        </div>

        <div class="menu-hairline"></div>

        <div class="menu-row">
          <router-link class="menu-card menu-card-fixed" to="/C管理/C権限/一覧?URLメニュー=／C管理">
            <div class="menu-card-title">
              <span class="icon">C権</span>
              C権限
            </div>
            <div class="menu-card-description">
              ロール・機能別アクセス制御の管理と利用者への権限割り当て
            </div>
          </router-link>

          <router-link class="menu-card menu-card-fixed" to="/C管理/C利用者/一覧?URLメニュー=／C管理">
            <div class="menu-card-title">
              <span class="icon">C利</span>
              C利用者
            </div>
            <div class="menu-card-description">
              利用者ID・パスワード・権限・端末情報の登録・編集・一覧管理
            </div>
          </router-link>

          <router-link class="menu-card menu-card-fixed" to="/C管理/C採番/一覧?URLメニュー=／C管理">
            <div class="menu-card-title">
              <span class="icon">C採</span>
              C採番
            </div>
            <div class="menu-card-description">
              テーブルごとの採番レンジ・現在値・増分を管理するシーケンス台帳
            </div>
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../assets/menu-common.css"></style>
<style scoped>
.manage-menu-sections {
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


