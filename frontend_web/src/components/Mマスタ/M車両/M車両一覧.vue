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
import { ref, onMounted, watch, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import 車両一覧テーブル from './components/M車両一覧テーブル.vue';
import { qMessage } from '../../../utils/qAlert';
import { useListSessionState, consumeReturnMessage } from '../../../utils/listSessionState';

const router = useRouter();
const route = useRoute();
const 車両一覧テーブルRef = ref(null);
const 件数制限 = ref(true);
const 無効も表示 = ref(false);
const 有効列表示 = computed(() => 無効も表示.value);
const normalizeQueryValue = (value: string | string[] | null | undefined): string | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;
const toHalfwidthUrl = (value: string): string => value.replace(/／/g, '/').replace(/？/g, '?').replace(/＆/g, '&').replace(/＝/g, '=');
const {
  URLメニュー,
  URL戻り先,
  現在URL戻り先,
  saveListSession,
  resetOrRestoreListSession
} = useListSessionState(route, router, {
  getState: () => ({
    件数制限: 件数制限.value,
    無効も表示: 無効も表示.value
  }),
  applyState: (state) => {
    件数制限.value = state.件数制限 ?? true;
    無効も表示.value = state.無効も表示 ?? false;
  }
});
resetOrRestoreListSession();

const handleReload = () => {
  saveListSession();
  車両一覧テーブルRef.value?.loadData();
};

const openCreate = () => {
  saveListSession();
  const query: Record<string, string> = { モード: '新規', URL戻り先: 現在URL戻り先.value };
  if (URLメニュー.value) query.URLメニュー = URLメニュー.value;
  router.push({ path: '/Mマスタ/M車両/編集', query });
};

const showMessage = (msg: string, type?: string) => {
  void qMessage(msg, type || 'success');
};

const clearMessageQuery = (query: typeof route.query) => {
  const nextQuery = { ...query };
  delete nextQuery.message;
  delete nextQuery.type;
  router.replace({ path: route.path, query: nextQuery });
};

const handleMenu = () => {
  if (!URLメニュー.value) return;
  router.push(toHalfwidthUrl(URLメニュー.value));
};

const handleCancel = () => {
  if (!URL戻り先.value) return;
  router.push(toHalfwidthUrl(URL戻り先.value));
};

onMounted(() => {
  const pendingMessage = consumeReturnMessage(route);
  if (pendingMessage) {
    showMessage(pendingMessage.message, pendingMessage.type);
  } else if (route.query.message) {
    const text = normalizeQueryValue(route.query.message as string | string[] | undefined);
    const type = normalizeQueryValue(route.query.type as string | string[] | undefined);
    showMessage(String(text ?? ''), type ? String(type) : undefined);
    clearMessageQuery(route.query);
  }
});

watch(() => route.query.message, (newMessage) => {
  if (newMessage) {
    const text = normalizeQueryValue(newMessage as string | string[] | undefined);
    const type = normalizeQueryValue(route.query.type as string | string[] | undefined);
    showMessage(String(text ?? ''), type ? String(type) : undefined);
    clearMessageQuery(route.query);
  }
});
watch([件数制限, 無効も表示], () => {
  saveListSession();
});

</script>

<template>
  <div class="page-container">
    <h2 class="page-title">
      <span class="title-text">【 M車両 】</span>
      <div class="header-actions">
        <button v-if="URLメニュー" class="btn-menu" @click="handleMenu">メニュー</button>
        <button v-if="URL戻り先 && URL戻り先 !== URLメニュー" class="btn-return" @click="handleCancel">戻る</button>
      </div>
    </h2>

    <div class="content">
      <div class="section">
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="search-area">
              <button class="btn btn-primary" @click="handleReload">再検索</button>
            </div>
          </div>
          <div class="toolbar-right">
            <button class="btn btn-success" @click="openCreate">新規</button>
          </div>
        </div>

        <div class="table-options">
          <label class="checkbox-label">
            <input type="checkbox" v-model="件数制限" @change="handleReload" />
            件数制限
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="無効も表示" @change="handleReload" />
            無効も表示
          </label>
        </div>

        <component :is="車両一覧テーブル" ref="車両一覧テーブルRef" :件数制限="件数制限" :無効も表示="無効も表示" :有効列表示="有効列表示" :URLメニュー="URLメニュー" :URL戻り先="現在URL戻り先" />
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

.title-text {
  flex: 1;
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-menu {
  height: 24px;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-size: 12px;
  background-color: #6c757d;
  color: #fff;
}

.btn-menu:hover {
  background-color: #5a6268;
}

.btn-return {
  height: 24px;
  padding: 0 12px;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-size: 12px;
  background-color: #dc3545;
  color: #fff;
}

.btn-return:hover {
  background-color: #c82333;
}

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
  align-items: flex-start;
  justify-content: space-between;
}

.toolbar-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.search-area {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.toolbar-right {
  display: flex;
  align-items: flex-start;
}

.table-options {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-size: 14px;
  margin-bottom: 0;
}

.btn-primary {
  background-color: #007bff;
  color: white;
}

.btn-primary:hover {
  background-color: #0056b3;
}

.btn-success {
  background-color: #28a745;
  color: white;
}

.btn-success:hover {
  background-color: #1e7e34;
}

.message {
  padding: 10px;
  border-radius: 0;
  flex: 1;
  min-width: 220px;
}

.message-success {
  background-color: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.message-error {
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  cursor: pointer;
  color: #5a4a3a;
  user-select: none;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  margin: 0;
}
</style>
