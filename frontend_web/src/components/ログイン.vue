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
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';

const username = ref('admin'); // 開発用にプリフィル
const password = ref('********'); // 開発用にプリフィル
const errorMsg = ref('');
const isLoading = ref(false);
const authStore = useAuthStore();

const handleLogin = async () => {
  errorMsg.value = '';
  if (!username.value || !password.value) {
    errorMsg.value = '利用者IDとパスワードを入力してください';
    return;
  }
  
  isLoading.value = true;
  const result = await authStore.login(username.value, password.value);
  isLoading.value = false;
  
  if (!result.success) {
    errorMsg.value = result.message || 'ログインに失敗しました';
  }
};
</script>

<template>
  <div class="login-container">
    <div class="login-card">
        <h2 class="title">AiDiy</h2>
        <form @submit.prevent="handleLogin">
            <div class="form-group">
                <label>利用者ID</label>
                <input v-model="username" type="text" placeholder="利用者ID" autofocus />
            </div>
            
            <div class="form-group">
                <label>パスワード</label>
                <input v-model="password" type="password" placeholder="パスワード" />
            </div>
            
            <div v-if="errorMsg" class="error-box">{{ errorMsg }}</div>
            
            <button type="submit" class="btn btn-primary login-btn" :disabled="isLoading">
                {{ isLoading ? 'ログイン中...' : 'ログイン' }}
            </button>
        </form>
    </div>
  </div>
</template>

<style scoped>
/* 全体のスタイル */
.login-container {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #faf7f2 0%, #f5f1e8 50%, #f0ebe0 100%);
  margin: 0;
  padding: 0;
}

/* ログインカード */
.login-card {
  background-color: #fff;
  padding: 2.5rem;
  border-radius: 10px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
}

/* タイトル部分 */
.title {
  background: linear-gradient(135deg, #e6d5b7 0%, #dcc8a6 50%, #d2bb95 100%);
  margin: -2.5rem -2.5rem 1.5rem -2.5rem;
  padding: 1rem 2.5rem;
  border-radius: 10px 10px 0 0;
  font-size: 1.125rem;
  color: #5a4a3a;
  font-weight: bold;
  box-shadow: 0 2px 4px rgba(210, 187, 149, 0.3);
  text-align: center;
}

/* フォームグループ */
.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.375rem;
  color: #333;
  font-weight: bold;
  font-size: 0.875rem;
}

.form-group input {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #e6d5b7;
  border-radius: 8px;
  font-size: 1rem;
  box-sizing: border-box;
  background-color: #fefdf8 !important;
  transition: all 0.3s ease;
}

.form-group input:focus {
  border-color: #d2bb95 !important;
  outline: none !important;
  background-color: #fefdf8 !important;
  box-shadow: 0 0 5px rgba(210, 187, 149, 0.3) !important;
}

/* ログインボタン */
.login-btn {
  width: 100%;
  padding: 0.875rem;
  background: linear-gradient(135deg, #e6d5b7 0%, #dcc8a6 50%, #d2bb95 100%);
  color: #5a4a3a;
  border: 2px solid #d2bb95;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 2px 4px rgba(210, 187, 149, 0.3);
  margin-top: 1rem;
}

.login-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #d2bb95 0%, #c8b08a 50%, #bea580 100%);
  border-color: #bea580;
  box-shadow: 0 4px 8px rgba(210, 187, 149, 0.4);
  transform: translateY(-1px);
}

.login-btn:disabled {
  background: linear-gradient(135deg, #f0f0f0 0%, #e0e0e0 50%, #d0d0d0 100%);
  color: #999;
  border-color: #ccc;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

/* エラーボックス */
.error-box {
  background-color: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  padding: 0.75rem;
  border-radius: 0.375rem;
  margin-bottom: 1rem;
  font-size: 0.875rem;
  text-align: center;
}
</style>

