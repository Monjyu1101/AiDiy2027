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
import { ref, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import 得意先一覧テーブル from './components/M得意先一覧テーブル.vue';
import { useListSessionState, consumeReturnMessage } from '../../../utils/listSessionState';

const router = useRouter();
const route = useRoute();
const 得意先一覧テーブルRef = ref(null);
const message = ref('');
const messageType = ref('success');
const normalizeQueryValue = (value: string | string[] | null | undefined): string | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;
const toHalfwidthUrl = (value: string): string => value.replace(/／/g, '/').replace(/？/g, '?').replace(/＆/g, '&').replace(/＝/g, '=');
const {
  URLメニュー,
  URL戻り先,
  現在URL戻り先,
  saveListSession,
  resetOrRestoreListSession
} = useListSessionState(route, router);
resetOrRestoreListSession();

const handleReload = () => {
  saveListSession();
  得意先一覧テーブルRef.value?.loadData();
};

const openCreate = () => {
  saveListSession();
  const query: Record<string, string> = { モード: '新規', URL戻り先: 現在URL戻り先.value };
  if (URLメニュー.value) query.URLメニュー = URLメニュー.value;
  router.push({ path: '/Mマスタ/M得意先/編集', query });
};

const showMessage = (msg, type) => {
  message.value = msg;
  messageType.value = type || 'success';
  setTimeout(() => {
    message.value = '';
  }, 3000);
};

onMounted(() => {
  const pendingMessage = consumeReturnMessage(route);
  if (pendingMessage) {
    showMessage(pendingMessage.message, pendingMessage.type);
  } else if (route.query.message) {
    const text = normalizeQueryValue(route.query.message as string | string[] | undefined);
    const type = normalizeQueryValue(route.query.type as string | string[] | undefined);
    showMessage(String(text ?? ''), type ? String(type) : undefined);
    const nextQuery = { ...route.query };
    delete nextQuery.message;
    delete nextQuery.type;
    router.replace({ path: route.path, query: nextQuery });
  }
});

watch(() => route.query.message, (newMessage) => {
  if (newMessage) {
    const text = normalizeQueryValue(newMessage as string | string[] | undefined);
    const type = normalizeQueryValue(route.query.type as string | string[] | undefined);
    showMessage(String(text ?? ''), type ? String(type) : undefined);
    const nextQuery = { ...route.query };
    delete nextQuery.message;
    delete nextQuery.type;
    router.replace({ path: route.path, query: nextQuery });
  }
});

const handleMenu = () => {
  if (!URLメニュー.value) return;
  router.push(toHalfwidthUrl(URLメニュー.value));
};

const handleCancel = () => {
  if (!URL戻り先.value) return;
  router.push(toHalfwidthUrl(URL戻り先.value));
};
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">
      <span class="title-text">【 M得意先 】</span>
      <div class="header-actions">
        <button v-if="URLメニュー" class="btn-menu" @click="handleMenu">メニュー</button>
        <button v-if="URL戻り先 && URL戻り先 !== URLメニュー" class="btn-return" @click="handleCancel">戻る</button>
      </div>
    </h2>

    <div class="content">
      <div class="section">
        <div class="toolbar">
          <button class="btn btn-primary" @click="handleReload">再検索</button>
          <button class="btn btn-success" @click="openCreate">新規</button>
          <div
            v-if="message"
            :class="['message', messageType === 'error' ? 'message-error' : 'message-success']"
          >
            {{ message }}
          </div>
        </div>

        <component
          :is="得意先一覧テーブル"
          ref="得意先一覧テーブルRef"
          :URLメニュー="URLメニュー"
          :URL戻り先="現在URL戻り先"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #faf7f2 0%, #f5f1e8 50%, #f0ebe0 100%);
}
.page-title {
  background: linear-gradient(135deg, #e6d5b7 0%, #dcc8a6 50%, #d2bb95 100%);
  margin: 0 0 5px 0;
  font-size: 14px;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 20px 10px 40px;
  height: 35px;
  line-height: 20px;
  color: #5a4a3a;
  font-weight: bold;
  box-shadow: 0 2px 4px rgba(210, 187, 149, 0.3);
  display: flex;
  align-items: center;
}
.title-text { flex: 1; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.btn-menu {
  background: linear-gradient(135deg, #6c757d 0%, #5a6268 100%);
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.2;
}
.btn-menu:hover { background: linear-gradient(135deg, #5a6268 0%, #495057 100%); }
.btn-return {
  background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.2;
}
.btn-return:hover { background: linear-gradient(135deg, #c82333 0%, #a71d2a 100%); }
.content {
  padding: 8px 20px 20px 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.section {
  margin-bottom: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.toolbar {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-size: 14px;
  margin-right: 10px;
  margin-bottom: 0;
}
.btn-primary { background-color: #007bff; color: white; }
.btn-primary:hover { background-color: #0056b3; }
.btn-success { background-color: #28a745; color: white; }
.btn-success:hover { background-color: #1e7e34; }
.message {
  padding: 10px;
  border-radius: 0;
  flex: 1;
  min-width: 220px;
}
.message-success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
.message-error { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
</style>
