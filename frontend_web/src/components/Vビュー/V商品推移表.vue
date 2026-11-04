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
import { ref, onMounted, computed, watch, onBeforeUnmount } from 'vue';
import dayjs from 'dayjs';
import apiClient from '../../api/client';
import TransitionTable from './components/V商品推移表テーブル.vue';
import { useRoute, useRouter } from 'vue-router';
import { qMessage } from '../../utils/qAlert';
import { useListSessionState } from '../../utils/listSessionState';
import { useAuthStore } from '../../stores/auth';

const DISPLAY_DAYS = 32;

// 状態管理
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const currentDate = ref(dayjs().startOf('day')); // 表示開始日
const 日付リスト = ref<string[]>([]);
const 商品データ = ref<any[]>([]);
const 商品一覧 = ref<any[]>([]);
const 商品分類ID = ref('');
const 商品分類一覧 = ref<any[]>([]);
const isLoading = ref(false);
const message = ref('');
const messageType = ref('info');
let messageTimer: ReturnType<typeof setTimeout> | null = null;
const lastModifiedTime = ref<string | null>(null);
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

const normalizeQueryValue = (value: any): any => (Array.isArray(value) ? value[0] : value);
const toHalfwidthUrl = (value: string): string => value.replace(/／/g, '/').replace(/？/g, '?').replace(/＆/g, '&').replace(/＝/g, '=');

const parseStartDate = (value: any): any => {
  if (!value) return null;
  const normalized = String(value).trim().replace(/\//g, '-');
  if (!normalized) return null;
  const parsed = dayjs(normalized);
  if (!parsed.isValid()) return null;
  return parsed.startOf('day');
};

const {
  URLメニュー,
  URL戻り先,
  saveListSession,
  resetOrRestoreListSession
} = useListSessionState(route, router, {
  getState: () => ({
    開始日付: currentDate.value.format('YYYY-MM-DD'),
    商品分類ID: 商品分類ID.value
  }),
  applyState: (state) => {
    const parsed = parseStartDate(state.開始日付);
    currentDate.value = parsed || currentDate.value;
    商品分類ID.value = state.商品分類ID ?? '';
  }
});

const applyQueryParams = (query: any) => {
  const raw = normalizeQueryValue(query.開始日付);
  const parsed = parseStartDate(raw);
  currentDate.value = parsed || dayjs().startOf('day');
  const 分類ID = normalizeQueryValue(query.商品分類ID);
  if (分類ID) 商品分類ID.value = String(分類ID);
};

// 期間計算 (開始日から32日固定)
const startDate = computed(() => currentDate.value.format('YYYY-MM-DD'));
const endDate = computed(() => currentDate.value.add(DISPLAY_DAYS - 1, 'day').format('YYYY-MM-DD'));

// 表示用期間文字列
const periodDisplay = computed(() => {
  const startText = currentDate.value.format('MM/DD');
  const endText = currentDate.value.add(DISPLAY_DAYS - 1, 'day').format('MM/DD');
  return `${startText} ～ ${endText}`;
});

const buildDateList = (startDateStr: string): string[] => {
  const base = dayjs(startDateStr);
  if (!base.isValid()) return [];
  return Array.from({ length: DISPLAY_DAYS }, (_, index) =>
    base.add(index, 'day').format('YYYY-MM-DD')
  );
};

const applyFallbackDateList = () => {
  日付リスト.value = buildDateList(startDate.value);
};

const applyFallbackProducts = (items: any[]) => {
  if (!Array.isArray(items) || items.length === 0) return;
  商品データ.value = items.map((item: any) => ({
    商品ID: item.商品ID ?? '',
    商品名: item.商品名 ?? '',
    日別データ: []
  }));
};

const 表示商品データ = computed(() => {
  if (商品データ.value.length > 0) return 商品データ.value;
  if (商品一覧.value.length === 0) return [];
  return 商品一覧.value.map((item: any) => ({
    商品ID: item.商品ID ?? '',
    商品名: item.商品名 ?? '',
    日別データ: []
  }));
});

const loadProductList = async () => {
  try {
    const payload: Record<string, any> = {};
    if (商品分類ID.value) payload.商品分類ID = 商品分類ID.value;
    const response = await apiClient.post('/apps/V商品/一覧', Object.keys(payload).length ? payload : undefined);
    if (response.data.status === 'OK') {
      const data = response.data.data;
      const items = Array.isArray(data) ? data : data?.items ?? [];
      商品一覧.value = items;
      if (商品データ.value.length === 0) {
        applyFallbackProducts(items);
      }
    }
  } catch (error) {
    // 取得できない場合は空表示のままにする
  }
};

const loadCategoryList = async () => {
  try {
    const response = await apiClient.post('/apps/M商品分類/一覧');
    if (response.data.status === 'OK') {
      const data = response.data.data;
      商品分類一覧.value = Array.isArray(data) ? data : data?.items ?? [];
    }
  } catch { /* 無視 */ }
};

// APIデータ取得
const fetchData = async () => {
  isLoading.value = true;
  message.value = '';
  
  try {
    const payload: Record<string, any> = {
      開始日付: startDate.value,
      終了日付: endDate.value
    };
    if (商品分類ID.value) payload.商品分類ID = 商品分類ID.value;
    
    const response = await apiClient.post('/apps/V商品推移表/一覧', payload);
    
    if (response.data.status === 'OK') {
      const data = response.data.data;
      const list = Array.isArray(data?.日付リスト) ? data.日付リスト : [];
      const products = Array.isArray(data?.商品推移データ) ? data.商品推移データ : [];
      日付リスト.value = list.length ? list : buildDateList(startDate.value);
      商品データ.value = products.length ? products : 商品データ.value;
    } else {
      applyFallbackDateList();
    }
    
  } catch (error) {
    applyFallbackDateList();
  } finally {
    isLoading.value = false;
  }
};

const showMessage = (msg: string, type = 'info') => {
  void qMessage(msg, type);
};

const initLastModified = async () => {
  try {
    const response = await apiClient.post('/apps/V商品推移表/最終更新日時', {
      開始日付: startDate.value,
      終了日付: endDate.value
    });
    if (response.data.status === 'OK') {
      lastModifiedTime.value = response.data.data?.最終更新日時 ?? null;
    }
  } catch (error) {
    lastModifiedTime.value = null;
  }
};

const checkForUpdates = async () => {
  void authStore.refreshToken();
  try {
    const response = await apiClient.post('/apps/V商品推移表/最終更新日時', {
      開始日付: startDate.value,
      終了日付: endDate.value
    });
    if (response.data.status !== 'OK') return;
    const currentLastModified = response.data.data?.最終更新日時;
    // nullまたはundefinedまたは空文字列の場合は何もしない
    if (currentLastModified === null || currentLastModified === undefined || currentLastModified === '') {
      return;
    }
    if (lastModifiedTime.value === null || lastModifiedTime.value === undefined || lastModifiedTime.value === '') {
      lastModifiedTime.value = currentLastModified;
      return;
    }
    const currentTime = new Date(currentLastModified);
    const previousTime = new Date(lastModifiedTime.value);
    if (Number.isNaN(currentTime.getTime()) || Number.isNaN(previousTime.getTime())) return;
    if (currentTime > previousTime) {
      lastModifiedTime.value = currentLastModified;
      await fetchData();
      showMessage(`データが更新されました。[${previousTime.toISOString()}→${currentTime.toISOString()}]`, 'success');
    }
  } catch (error) {
    // 無視
  }
};

const startAutoRefresh = () => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(checkForUpdates, 30000);
};

const stopAutoRefresh = () => {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
};

const handleCategoryChange = async () => {
  saveListSession();
  商品データ.value = [];
  商品一覧.value = [];
  await fetchData();
  await initLastModified();
};

// ナビゲーション操作
const moveMonth = async (months: number) => {
  currentDate.value = currentDate.value.add(months, 'month');
  saveListSession();
  router.replace({ path: route.path, query: buildPageQuery(startDate.value) });
  await fetchData();
};

const moveDay = async (days: number) => {
  currentDate.value = currentDate.value.add(days, 'day');
  saveListSession();
  applyFallbackDateList();
  router.replace({ path: route.path, query: buildPageQuery(startDate.value) });
  await fetchData();
};

const buildPageQuery = (開始日付: string) => {
  const query: Record<string, string> = { 開始日付 };
  if (商品分類ID.value) query.商品分類ID = 商品分類ID.value;
  if (URLメニュー.value) query.URLメニュー = URLメニュー.value;
  if (URL戻り先.value) query.URL戻り先 = URL戻り先.value;
  return query;
};

const handleMenu = () => {
  if (!URLメニュー.value) return;
  router.push(toHalfwidthUrl(URLメニュー.value));
};

const handleReturn = () => {
  if (!URL戻り先.value) return;
  router.push(toHalfwidthUrl(URL戻り先.value));
};

onMounted(() => {
  applyQueryParams(route.query);
  resetOrRestoreListSession();
  applyFallbackDateList();
  loadCategoryList();
  loadProductList();
  fetchData();
  initLastModified();
  startAutoRefresh();
});

onBeforeUnmount(() => {
  stopAutoRefresh();
});

watch(() => route.query.開始日付, () => {
  applyQueryParams(route.query);
  applyFallbackDateList();
  fetchData();
  initLastModified();
});
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">
      <span class="title-text">【 V商品推移表 】</span>
      <div class="header-actions">
        <button v-if="URLメニュー" class="btn-menu" @click="handleMenu">メニュー</button>
        <button v-if="URL戻り先 && URL戻り先 !== URLメニュー" class="btn-return" @click="handleReturn">戻る</button>
      </div>
    </h2>
    
    <!-- ナビゲーション -->
    <div class="navigation">
      <button class="nav-button" @click="moveMonth(-1)">◀ 前月</button>
      <button class="nav-button period-nav" @click="moveDay(-1)">◁ 前日</button>
      
      <div class="current-period">{{ periodDisplay }}</div>
      
      <button class="nav-button period-nav" @click="moveDay(1)">翌日 ▷</button>
      <button class="nav-button" @click="moveMonth(1)">翌月 ▶</button>
    </div>

    <!-- 絞り込み -->
    <div class="filter-bar">
      <div class="category-label">商品分類</div>
      <div class="category-value">
        <select v-model="商品分類ID" class="category-select" @change="handleCategoryChange">
          <option value="">すべて</option>
          <option v-for="item in 商品分類一覧" :key="item.商品分類ID" :value="item.商品分類ID">
            {{ item.商品分類ID }} : {{ item.商品分類名 }}
          </option>
        </select>
      </div>
    </div>
    
    <!-- コンテンツ -->
    <div class="content">
        <div v-if="isLoading" class="loading">
            <div class="spinner"></div>
            <div>読み込み中...</div>
        </div>
        
        <TransitionTable
            v-else
            :日付リスト="日付リスト"
            :商品データ="表示商品データ"
            :URLメニュー="URLメニュー"
        />
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
  color: #333;
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

.navigation {
  display: flex;
  align-items: center;
  margin: 5px 10px;
  padding: 5px 10px;
  background-color: transparent;
  border-radius: 5px;
  gap: 10px;
}

.nav-button {
  padding: 5px 15px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 14px;
}
.nav-button:hover:not(:disabled) {
  background-color: #0056b3;
}
.nav-button:disabled {
    background-color: #ccc;
    cursor: not-allowed;
}

.nav-button.period-nav {
  background-color: #bfe3f6;
  color: #1f3b57;
}
.nav-button.period-nav:hover:not(:disabled) {
  background-color: #a9d4ee;
}

.filter-bar {
  display: flex;
  width: fit-content;
  margin: 0 10px 6px 10px;
}

.category-label {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: #333;
  font-size: 12px;
  font-weight: 600;
  text-align: right;
  padding: 4px 10px;
  border: 1px solid #b3e5fc;
  background: #e1f5fe;
  min-height: 30px;
  width: 160px;
  flex-shrink: 0;
  box-sizing: border-box;
}

.category-value {
  display: flex;
  align-items: center;
  width: 320px;
  padding: 3px 10px;
  border: 1px solid #ccc;
  border-left: none;
  background: #fff;
  min-height: 30px;
  box-sizing: border-box;
  border-radius: 0;
}

.category-select {
  height: 24px;
  padding: 0 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
  width: 100%;
  cursor: pointer;
  box-sizing: border-box;
  margin: 0;
}
.category-select:focus {
  outline: none;
  border-color: #81d4fa;
}

.current-period {
  font-weight: bold;
  font-size: 24px;
  text-align: center;
  flex-grow: 1;
  color: #5a4a3a;
}

.content {
  padding: 0 10px 10px 10px;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* テーブルのスクロールはテーブルコンテナに任せる */
}

.loading {
  text-align: center;
  padding: 40px;
  color: #5a4a3a;
}
.spinner {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #d2bb95;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  animation: spin 1s linear infinite;
  margin: 0 auto 10px;
}
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.message {
  padding: 10px;
  margin: 0 10px 5px;
  border-radius: 5px;
}
.message-info {
  background-color: #e3f2fd;
  color: #1565c0;
}
.message-success {
  background-color: #d4edda;
  color: #155724;
}
.message-error {
  background-color: #f8d7da;
  color: #721c24;
}
</style>
