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
    <h2 class="page-title">【 マスタ 】</h2>

    <div class="content">
      <p>マスタ管理機能へのアクセスリンクです。下記から選択してください。</p>

      <div class="master-menu-sections">
        <div class="menu-row">
          <router-link class="menu-card menu-card-fixed" to="/Mマスタ/M車両/一覧?URLメニュー=／Mマスタ">
            <div class="menu-card-title">
              <span class="icon">M車</span>
              M車両
            </div>
            <div class="menu-card-description">
              車番・車種・最大積載量・担当ドライバーなど車両情報の登録・編集
            </div>
          </router-link>

          <router-link class="menu-card menu-card-fixed" to="/Mマスタ/M配車区分/一覧?URLメニュー=／Mマスタ">
            <div class="menu-card-title">
              <span class="icon">M配</span>
              M配車区分
            </div>
            <div class="menu-card-description">
              配車カテゴリの名称・色コードを管理するマスタ
            </div>
          </router-link>
        </div>

        <div class="menu-hairline"></div>

        <div class="menu-row">
          <router-link class="menu-card menu-card-fixed" to="/Mマスタ/M商品分類/一覧?URLメニュー=／Mマスタ">
            <div class="menu-card-title">
              <span class="icon">M分</span>
              M商品分類
            </div>
            <div class="menu-card-description">
              牛飼料系・原材料など商品カテゴリの階層管理
            </div>
          </router-link>

          <router-link class="menu-card menu-card-fixed" to="/Mマスタ/M商品/一覧?URLメニュー=／Mマスタ">
            <div class="menu-card-title">
              <span class="icon">M商</span>
              M商品
            </div>
            <div class="menu-card-description">
              品番・品名・単位・分類・在庫設定を一元管理する商品台帳
            </div>
          </router-link>

          <router-link class="menu-card menu-card-fixed" to="/Mマスタ/M取引先分類/一覧?URLメニュー=／Mマスタ">
            <div class="menu-card-title">
              <span class="icon">M取分</span>
              M取引先分類
            </div>
            <div class="menu-card-description">
              仕入先・得意先・委託先などの取引先カテゴリ管理
            </div>
          </router-link>

          <router-link class="menu-card menu-card-fixed" to="/Mマスタ/M取引先/一覧?URLメニュー=／Mマスタ">
            <div class="menu-card-title">
              <span class="icon">M取</span>
              M取引先
            </div>
            <div class="menu-card-description">
              会社名・住所・連絡先・取引先分類の登録・編集・一覧
            </div>
          </router-link>

          <router-link class="menu-card menu-card-fixed" to="/Mマスタ/M商品構成/一覧?URLメニュー=／Mマスタ">
            <div class="menu-card-title">
              <span class="icon">M構</span>
              M商品構成
            </div>
            <div class="menu-card-description">
              製品1ロットあたりの構成原料・比率・数量を定義するBOM台帳
            </div>
          </router-link>
        </div>

        <div class="menu-hairline"></div>

        <div class="menu-row">

          <router-link class="menu-card menu-card-fixed" to="/Mマスタ/M生産区分/一覧?URLメニュー=／Mマスタ">
            <div class="menu-card-title">
              <span class="icon">M生</span>
              M生産区分
            </div>
            <div class="menu-card-description">
              生産カテゴリの名称・色コードを管理するマスタ
            </div>
          </router-link>

          <router-link class="menu-card menu-card-fixed" to="/Mマスタ/M生産工程/一覧?URLメニュー=／Mマスタ">
            <div class="menu-card-title">
              <span class="icon">M工</span>
              M生産工程
            </div>
            <div class="menu-card-description">
              ライン名・順序・設備情報を登録する生産工程台帳
            </div>
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../assets/menu-common.css"></style>
<style scoped>
.master-menu-sections {
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

  .menu-hairline {
    width: 100%;
  }
}
</style>

