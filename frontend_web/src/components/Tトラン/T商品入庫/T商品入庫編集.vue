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
import { ref, onMounted, reactive, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import apiClient from '../../../api/client';
import { qConfirm, qMessage } from '../../../utils/qAlert';
import { saveReturnMessage } from '../../../utils/listSessionState';

type 入庫明細Form = {
  明細SEQ: number
  商品ID: string
  入庫数量: string
  明細備考: string
}

const route = useRoute();
const router = useRouter();
const normalizeQueryValue = (value: any): string | null => (Array.isArray(value) ? value[0] : value);
const toHalfwidthUrl = (value: string): string => value.replace(/／/g, '/').replace(/？/g, '?').replace(/＆/g, '&').replace(/＝/g, '=');
const URLメニュー = computed(() => {
  const value = normalizeQueryValue(route.query.URLメニュー);
  return value ? String(value) : '';
});
const URL戻り先 = computed(() => {
  const value = normalizeQueryValue(route.query.URL戻り先);
  return value ? String(value) : '';
});

// ==================================================
// 状態管理
// ==================================================
const mode = ref('edit');
const activeTab = ref('content');
const detailData = ref<any>(null);
const 商品一覧 = ref<any[]>([]);
const detailError = ref('');
const numberFormatter = new Intl.NumberFormat('ja-JP');
const 数量編集中 = reactive<Record<number, boolean>>({});

const form = reactive({
  入庫伝票ID: '',
  入庫日: '',
  入庫備考: '',
  有効: true
});

const errors = reactive({
  入庫日: ''
});

const touched = reactive({
  入庫日: false
});

const 明細一覧 = ref<入庫明細Form[]>([]);

// ==================================================
// 計算プロパティ
// ==================================================
const isCreateMode = computed(() => mode.value === 'create');
const isEditMode = computed(() => mode.value === 'edit');
const isViewMode = computed(() => mode.value === 'view');
const requiredFields = computed(() => ['入庫日']);
const 表示用商品一覧 = computed(() => isCreateMode.value
  ? 商品一覧.value.filter((item: any) => item?.有効 !== false)
  : 商品一覧.value);
const 商品マップ = computed<Record<string, any>>(() => {
  const result: Record<string, any> = {};
  商品一覧.value.forEach((item: any) => { result[item.商品ID] = item; });
  return result;
});

// ==================================================
// ユーティリティ
// ==================================================
const showMessage = (text: string, type = 'success') => {
  void qMessage(text, type);
};

const toNumber = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
};

const get商品 = (商品ID: string) => 商品マップ.value[String(商品ID)] || null;

const createEmptyDetail = (明細SEQ = 1, 商品ID = ''): 入庫明細Form => ({
  明細SEQ,
  商品ID,
  入庫数量: '',
  明細備考: ''
});

const normalizeNumericInput = (value: any) => String(value ?? '').replace(/,/g, '').trim();

const formatNumericDisplay = (value: any) => {
  const normalized = normalizeNumericInput(value);
  if (!normalized) return '';
  const num = Number(normalized);
  return Number.isFinite(num) ? numberFormatter.format(num) : normalized;
};

const clearQuantityEditing = () => {
  Object.keys(数量編集中).forEach((key) => { delete 数量編集中[Number(key)]; });
};

const isQuantityEditing = (明細SEQ: number) => Boolean(数量編集中[明細SEQ]);

const handleQuantityFocus = async (row: 入庫明細Form, event: FocusEvent) => {
  数量編集中[row.明細SEQ] = true;
  row.入庫数量 = normalizeNumericInput(row.入庫数量);
  await nextTick();
  const target = event.target as HTMLInputElement | null;
  target?.select();
};

const handleQuantityInput = (row: 入庫明細Form, event: Event) => {
  const target = event.target as HTMLInputElement | null;
  row.入庫数量 = normalizeNumericInput(target?.value ?? '');
};

const handleQuantityBlur = (row: 入庫明細Form) => {
  row.入庫数量 = normalizeNumericInput(row.入庫数量);
  delete 数量編集中[row.明細SEQ];
};

const renumberDetails = () => {
  明細一覧.value.forEach((row, index) => { row.明細SEQ = index + 1; });
};

// ==================================================
// フォームリセット・適用
// ==================================================
const resetValidation = () => {
  Object.keys(errors).forEach((key) => { errors[key] = ''; });
  Object.keys(touched).forEach((key) => { touched[key] = false; });
  detailError.value = '';
};

const resetForm = () => {
  form.入庫伝票ID = '';
  form.入庫日 = '';
  form.入庫備考 = '';
  form.有効 = true;
  明細一覧.value = [];
  clearQuantityEditing();
};

const applyDataToForm = (data: any) => {
  clearQuantityEditing();
  form.入庫伝票ID = data?.入庫伝票ID || '';
  form.入庫日 = data?.入庫日 || '';
  form.入庫備考 = data?.入庫備考 || '';
  form.有効 = data?.有効 ?? true;
  明細一覧.value = Array.isArray(data?.明細一覧) && data.明細一覧.length
    ? data.明細一覧.map((item: any, index: number) => ({
      明細SEQ: Number(item?.明細SEQ ?? index + 1),
      商品ID: item?.商品ID || '',
      入庫数量: item?.入庫数量 === null || item?.入庫数量 === undefined ? '' : String(item.入庫数量),
      明細備考: item?.明細備考 || ''
    }))
    : [];
  if (!明細一覧.value.length && !isViewMode.value) {
    明細一覧.value = [createEmptyDetail(1)];
  }
  renumberDetails();
};

// ==================================================
// バリデーション
// ==================================================
const validateField = (field: string, showError = true) => {
  const value = String(form[field] ?? '').trim();
  if (!requiredFields.value.includes(field)) {
    errors[field] = '';
    return true;
  }
  if (!value) {
    errors[field] = showError ? `${field}は必須です。` : 'ERROR';
    return false;
  }

  errors[field] = '';
  return true;
};

const handleBlur = (field: string) => {
  touched[field] = true;
  validateField(field);
};

const handleInput = (field: string) => {
  if (touched[field]) {
    validateField(field);
  }
};

const sanitizeDetails = () => {
  return 明細一覧.value
    .map((row, index) => ({
      明細SEQ: index + 1,
      商品ID: String(row.商品ID || '').trim(),
      入庫数量: String(row.入庫数量 || '').trim(),
      明細備考: String(row.明細備考 || '').trim()
    }))
    .filter((row) => row.商品ID || row.入庫数量 || row.明細備考);
};

const validateDetails = () => {
  const rows = sanitizeDetails();
  if (!rows.length) {
    detailError.value = '明細を1件以上入力してください。';
    return null;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 1;
    if (!row.商品ID) {
      detailError.value = `${rowNo}行目の商品を選択してください。`;
      return null;
    }
    if (!row.入庫数量) {
      detailError.value = `${rowNo}行目の入庫数量を入力してください。`;
      return null;
    }
    const 数量 = toNumber(row.入庫数量);
    if (!Number.isInteger(数量) || 数量 <= 0) {
      detailError.value = `${rowNo}行目の入庫数量は1以上の整数を入力してください。`;
      return null;
    }
  }

  detailError.value = '';
  return rows.map((row, index) => ({
    明細SEQ: index + 1,
    商品ID: row.商品ID,
    入庫数量: Number(row.入庫数量),
    明細備考: row.明細備考 || null
  }));
};

const validateForm = () => {
  let isValid = true;
  let firstErrorField: string | null = null;

  requiredFields.value.forEach((field) => {
    touched[field] = true;
    if (!validateField(field, false)) {
      isValid = false;
      if (!firstErrorField) firstErrorField = field;
    }
  });

  if (firstErrorField) {
    const fieldMap: Record<string, string> = {
      '入庫日': 'form-date'
    };
    const el = document.getElementById(fieldMap[firstErrorField]);
    if (el) el.focus();
  }

  return isValid;
};

// ==================================================
// 明細操作
// ==================================================
const addDetailRow = () => {
  明細一覧.value.push(createEmptyDetail(明細一覧.value.length + 1));
  detailError.value = '';
};

const removeDetailRow = (index: number) => {
  if (明細一覧.value.length === 1) {
    明細一覧.value = [];
  } else {
    明細一覧.value.splice(index, 1);
    renumberDetails();
  }
  clearQuantityEditing();
  detailError.value = '';
};

// ==================================================
// マスターデータ取得
// ==================================================
const loadMasterData = async () => {
  try {
    const res = await apiClient.post('/apps/M商品/一覧');
    if (res.data.status === 'OK') {
      const data = res.data.data;
      商品一覧.value = Array.isArray(data) ? data : data?.items ?? [];
    }
  } catch (_e) {
    showMessage('マスターデータの取得でエラーが発生しました。', 'error');
  }
};

// ==================================================
// 詳細データ取得
// ==================================================
const loadDetail = async (id: string) => {
  try {
    const res = await apiClient.post('/apps/T商品入庫/取得', { 入庫伝票ID: String(id) });
    if (res.data.status === 'OK' && res.data.data) {
      detailData.value = res.data.data;
      applyDataToForm(res.data.data);
    } else {
      showMessage(res.data.message || '商品入庫情報の取得に失敗しました。', 'error');
    }
  } catch (_e) {
    showMessage('商品入庫情報の取得でエラーが発生しました。', 'error');
  }
};

// ==================================================
// ルーティング処理
// ==================================================
const applyQueryParams = async (query: any) => {
  resetValidation();
  activeTab.value = 'content';

  if (query.モード === '新規') {
    mode.value = 'create';
    detailData.value = null;
    resetForm();

    const now = new Date();
    form.入庫日 = now.toISOString().slice(0, 10);
    const queryDate = normalizeQueryValue(query.入庫日);
    const queryProductId = normalizeQueryValue(query.商品ID);
    if (queryDate) {
      form.入庫日 = String(queryDate);
    }
    明細一覧.value = [createEmptyDetail(1, queryProductId ? String(queryProductId) : '')];
    return;
  }

  if (query.モード === '表示' && query.入庫伝票ID) {
    mode.value = 'view';
    await loadDetail(String(query.入庫伝票ID));
    return;
  }

  if (query.入庫伝票ID) {
    mode.value = 'edit';
    await loadDetail(String(query.入庫伝票ID));
    return;
  }

  mode.value = 'create';
  detailData.value = null;
  resetForm();
  明細一覧.value = [createEmptyDetail(1)];
};

const buildListQuery = (extra = {}) => {
  const query: Record<string, any> = { ...extra };
  if (URLメニュー.value) {
    query.URLメニュー = URLメニュー.value;
  }
  return Object.keys(query).length ? query : undefined;
};

const pushReturnTarget = (messageText?: string): boolean => {
  const target = URL戻り先.value || URLメニュー.value;
  if (!target) return false;
  const halfwidthTarget = toHalfwidthUrl(target);
  if (messageText) saveReturnMessage(halfwidthTarget, messageText, 'success');
  router.push(halfwidthTarget);
  return true;
};

const handleSuccess = (messageText: string) => {
  if (pushReturnTarget(messageText)) return;
  router.push({
    path: '/Tトラン/T商品入庫/一覧',
    query: buildListQuery({ message: messageText, type: 'success' })
  });
};

const backToList = () => {
  if (pushReturnTarget()) return;
  router.push({ path: '/Tトラン/T商品入庫/一覧', query: buildListQuery() });
};

const handleMenu = () => {
  if (!URLメニュー.value) return;
  router.push(toHalfwidthUrl(URLメニュー.value));
};

const handleReturn = () => {
  if (!URL戻り先.value) return;
  router.push(toHalfwidthUrl(URL戻り先.value));
};

// ==================================================
// CRUD操作
// ==================================================
const saveData = async () => {
  if (!validateForm()) {
    showMessage('入力内容を確認してください。', 'error');
    activeTab.value = 'content';
    return;
  }

  const detailPayload = validateDetails();
  if (detailPayload === null) {
    showMessage(detailError.value || '明細の入力内容を確認してください。', 'error');
    activeTab.value = 'content';
    return;
  }

  const payload = {
    入庫日: form.入庫日,
    入庫備考: form.入庫備考 || null,
    有効: form.有効,
    明細一覧: detailPayload
  };

  try {
    let res;
    if (isCreateMode.value) {
      res = await apiClient.post('/apps/T商品入庫/登録', payload);
    } else {
      res = await apiClient.post('/apps/T商品入庫/変更', payload, {
        params: { 入庫伝票ID: form.入庫伝票ID }
      });
    }

    if (res.data.status === 'OK') {
      handleSuccess(res.data.message);
    } else {
      showMessage(res.data.message || (isCreateMode.value ? '登録に失敗しました。' : '更新に失敗しました。'), 'error');
    }
  } catch (_e) {
    showMessage(isCreateMode.value ? '登録に失敗しました。' : '更新に失敗しました。', 'error');
  }
};

const deleteData = async () => {
  if (!form.入庫伝票ID) return;

  const confirmed = await qConfirm(`T商品入庫「${form.入庫伝票ID}」の有効をオフにしますか？`);
  if (!confirmed) return;

  try {
    const res = await apiClient.post('/apps/T商品入庫/削除', { 入庫伝票ID: form.入庫伝票ID });
    if (res.data.status === 'OK') {
      handleSuccess(res.data.message);
    } else {
      showMessage(res.data.message || '削除に失敗しました。', 'error');
    }
  } catch (_e) {
    showMessage('削除に失敗しました。', 'error');
  }
};

// ==================================================
// 初期化
// ==================================================
onMounted(async () => {
  await loadMasterData();
  await applyQueryParams(route.query);
});

watch(() => route.query, async (query) => {
  await applyQueryParams(query);
});
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">
      <span class="title-text">【 T商品入庫 】{{ isCreateMode ? '新規登録' : '編集' }}</span>
      <div class="header-actions">
        <button v-if="URLメニュー" class="btn-menu" @click="handleMenu">メニュー</button>
        <button v-if="URL戻り先 && URL戻り先 !== URLメニュー" class="btn-return" @click="handleReturn">戻る</button>
      </div>
    </h2>

    <div class="content">
      <div class="section">
        <div class="toolbar">
          <button class="btn btn-secondary" @click="backToList">一覧に戻る</button>
        </div>

        <form class="detail-form" @submit.prevent="saveData">
          <div class="tab-header">
            <button
              type="button"
              class="tab-btn"
              :class="{ active: activeTab === 'content' }"
              @click="activeTab = 'content'"
            >
              内容
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ active: activeTab === 'others' }"
              @click="activeTab = 'others'"
            >
              その他
            </button>
          </div>

          <div class="detail-panel">
            <template v-if="activeTab === 'content'">
              <div v-if="!isCreateMode" class="detail-row row-id">
                <div class="detail-label">入庫伝票ID</div>
                <div class="detail-value">
                  <input type="text" v-model="form.入庫伝票ID" class="detail-input id-input center-input" readonly />
                </div>
              </div>

              <div class="detail-row row-date">
                <div class="detail-label">入庫日<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <input
                        id="form-date"
                        type="date"
                        v-model="form.入庫日"
                        class="detail-input date-input"
                        :class="{ 'input-error': errors.入庫日 }"
                        :readonly="isViewMode"
                        @blur="handleBlur('入庫日')"
                        @input="handleInput('入庫日')"
                      />
                      <span v-if="errors.入庫日" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.入庫日 && errors.入庫日 !== 'ERROR'" class="field-error">{{ errors.入庫日 }}</div>
                  </div>
                </div>
              </div>

              <div class="detail-row row-remarks">
                <div class="detail-label">入庫備考</div>
                <div class="detail-value">
                  <textarea
                    v-model="form.入庫備考"
                    class="detail-textarea remarks-textarea"
                    rows="2"
                    :readonly="isViewMode"
                  ></textarea>
                </div>
              </div>

              <div class="composition-block">
                <div class="composition-header">
                  <div class="composition-title">入庫明細</div>
                  <button v-if="!isViewMode" type="button" class="btn btn-add-row" @click="addDetailRow">行追加</button>
                </div>

                <div class="composition-table-wrap">
                  <table class="composition-table">
                    <thead>
                      <tr>
                        <th class="w-seq">SEQ</th>
                        <th class="w-product">商品</th>
                        <th class="w-qty">入庫数量</th>
                        <th class="w-unit">単位</th>
                        <th class="w-note">明細備考</th>
                        <th v-if="!isViewMode" class="w-action">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="明細一覧.length === 0">
                        <td :colspan="isViewMode ? 5 : 6" class="cell-center no-data">明細なし</td>
                      </tr>
                      <tr v-for="(row, index) in 明細一覧" :key="`detail-${index}`">
                        <td class="cell-center">{{ row.明細SEQ }}</td>
                        <td>
                          <select v-model="row.商品ID" class="table-input select-cell" :disabled="isViewMode">
                            <option value="">選択</option>
                            <option v-for="item in 表示用商品一覧" :key="`${index}-${item.商品ID}`" :value="item.商品ID">
                              {{ item.商品ID }}:{{ item.商品名 }}
                            </option>
                          </select>
                        </td>
                        <td>
                          <input
                            :value="isQuantityEditing(row.明細SEQ) ? row.入庫数量 : formatNumericDisplay(row.入庫数量)"
                            type="text"
                            inputmode="numeric"
                            class="table-input number-cell"
                            :readonly="isViewMode"
                            @focus="handleQuantityFocus(row, $event)"
                            @input="handleQuantityInput(row, $event)"
                            @blur="handleQuantityBlur(row)"
                          />
                        </td>
                        <td class="cell-center">{{ get商品(row.商品ID)?.単位 || '' }}</td>
                        <td>
                          <input
                            v-model="row.明細備考"
                            type="text"
                            class="table-input note-cell"
                            :readonly="isViewMode"
                          />
                        </td>
                        <td v-if="!isViewMode" class="cell-center">
                          <button type="button" class="btn btn-row-delete" @click="removeDetailRow(index)">削除</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-if="detailError" class="detail-error">{{ detailError }}</div>
              </div>
            </template>

            <template v-if="activeTab === 'others'">
              <div class="detail-row row-valid">
                <div class="detail-label">有効</div>
                <div class="detail-value">
                  <label class="valid-checkbox-label" :class="{ 'valid-checkbox-label-disabled': isViewMode }">
                    <input
                      type="checkbox"
                      v-model="form.有効"
                      :disabled="isViewMode"
                      class="valid-checkbox"
                      aria-label="有効の切り替え"
                    />
                    <span class="valid-checkbox-mark" :class="{ 'valid-checkbox-inactive': !form.有効 }">{{ form.有効 ? '✅' : '☐' }}</span>
                  </label>
                </div>
              </div>
              <div class="detail-row row-datetime">
                <div class="detail-label">登録日時</div>
                <div class="detail-value">
                  <input type="text" :value="detailData?.登録日時 || ''" class="detail-input w-2x center-input" readonly />
                </div>
              </div>
              <div class="detail-row row-user">
                <div class="detail-label">登録利用者</div>
                <div class="detail-value">
                  <input type="text" :value="detailData?.登録利用者名 || ''" class="detail-input w-2x center-input" readonly />
                </div>
              </div>
              <div class="detail-row row-terminal">
                <div class="detail-label">登録端末</div>
                <div class="detail-value">
                  <input type="text" :value="detailData?.登録端末ID || ''" class="detail-input w-2x center-input" readonly />
                </div>
              </div>
              <div class="detail-row row-datetime">
                <div class="detail-label">更新日時</div>
                <div class="detail-value">
                  <input type="text" :value="detailData?.更新日時 || ''" class="detail-input w-2x center-input" readonly />
                </div>
              </div>
              <div class="detail-row row-user">
                <div class="detail-label">更新利用者</div>
                <div class="detail-value">
                  <input type="text" :value="detailData?.更新利用者名 || ''" class="detail-input w-2x center-input" readonly />
                </div>
              </div>
              <div class="detail-row row-terminal">
                <div class="detail-label">更新端末</div>
                <div class="detail-value">
                  <input type="text" :value="detailData?.更新端末ID || ''" class="detail-input w-2x center-input" readonly />
                </div>
              </div>
            </template>
          </div>

          <div class="form-buttons" v-if="!isViewMode">
            <button type="submit" class="btn btn-success">{{ isCreateMode ? '登録' : '更新' }}</button>
            <button v-if="isEditMode" type="button" class="btn btn-danger" @click="deleteData">削除</button>
          </div>
        </form>
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

.btn-return:hover { background-color: #c82333; }

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

.detail-form {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.tab-header {
  display: flex;
  gap: 2px;
  margin-bottom: 0;
  border-bottom: 1px solid #ccc;
  padding-left: 0;
}

.tab-btn {
  padding: 8px 24px;
  background: #f1f1f1;
  border: 1px solid #ccc;
  border-bottom: none;
  cursor: pointer;
  font-size: 14px;
  color: #555;
  border-radius: 4px 4px 0 0;
  margin-bottom: -1px;
  position: relative;
  top: 1px;
}

.tab-btn.active {
  background: #fff;
  color: #007bff;
  font-weight: bold;
  border-bottom: 1px solid #fff;
  z-index: 1;
}

.tab-btn:hover:not(.active) { background: #e9e9e9; }

.detail-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
  box-sizing: border-box;
}

.detail-row {
  display: flex;
  width: 100%;
  margin-top: -1px;
}

.detail-row.row-id,
.detail-row.row-date,
.detail-row.row-remarks,
.detail-row.row-valid,
.detail-row.row-user,
.detail-row.row-terminal,
.detail-row.row-datetime {
  width: fit-content;
}

.detail-label {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: #333;
  font-weight: 600;
  text-align: right;
  padding: 8px 12px;
  border: 1px solid #b3e5fc;
  background: #e1f5fe;
  min-height: 40px;
  width: 160px;
  flex-shrink: 0;
  box-sizing: border-box;
  border-radius: 0;
  z-index: 1;
}

.detail-value {
  display: flex;
  align-items: center;
  width: 100%;
  color: #333;
  padding: 4px 12px;
  border: 1px solid #ccc;
  border-left: none;
  background: #fff;
  min-height: 40px;
  box-sizing: border-box;
  border-radius: 0;
}

.row-id .detail-value,
.row-date .detail-value,
.row-remarks .detail-value,
.row-valid .detail-value,
.row-user .detail-value,
.row-terminal .detail-value,
.row-datetime .detail-value {
  width: auto;
}

.value-column {
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.detail-input,
.table-input {
  height: 28px;
  padding: 0 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  font-size: 14px;
  box-sizing: border-box;
  margin: 0;
}

.detail-input:focus,
.detail-textarea:focus,
.table-input:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: inset 0 0 0 1px rgba(0, 123, 255, 0.2);
}

.detail-input.input-error {
  border-color: #dc2626;
  background-color: #fff8f8;
}

.detail-input[readonly],
.detail-input[disabled],
.table-input[readonly],
.table-input[disabled] {
  color: #555;
  background-color: #f8f9fa;
}

.id-input { width: 160px; text-align: center; }
.date-input { width: 160px; text-align: center; }
.remarks-textarea { width: 320px; }

.detail-textarea {
  height: auto;
  min-height: 50px;
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  font-size: 14px;
  box-sizing: border-box;
  margin: 4px 0;
  resize: vertical;
  font-family: inherit;
}

.center-input { text-align: center; }
.w-2x { width: 320px !important; }

.input-wrap {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
}

.input-alert {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  background: #dc2626;
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.field-error,
.detail-error {
  font-size: 11px;
  color: #dc2626;
  line-height: 1.3;
  margin-top: 4px;
}

.required-mark {
  color: #dc2626;
  font-weight: 700;
  margin-left: 4px;
}

.composition-block {
  margin-top: 12px;
  border: 1px solid #d1d5db;
  background: #fff;
}

.composition-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}

.composition-title {
  font-size: 14px;
  font-weight: 700;
  color: #334155;
}

.composition-table-wrap {
  overflow-x: auto;
  position: relative;
}

.composition-table {
  width: auto;
  table-layout: auto;
  border-collapse: collapse;
  font-size: 13px;
}

.composition-table th,
.composition-table td {
  border: 1px solid #d1d5db;
  padding: 6px 8px;
  white-space: nowrap;
  vertical-align: middle;
}

.composition-table th {
  background: #37474f;
  color: #fff;
  font-weight: 600;
}

.w-seq { width: 50px; }
.w-unit { width: 70px; }
.w-note { width: 180px; }
.w-action { width: 70px; }

.cell-center { text-align: center; }
.no-data { color: #888; padding: 16px; }

.select-cell { width: 240px; }
.number-cell { width: 110px; text-align: right; }
.note-cell { width: 180px; }

.form-buttons {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #ccc;
  display: flex;
  justify-content: flex-start;
  gap: 10px;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-size: 14px;
  margin: 0;
}

.btn-success { background-color: #28a745; color: white; }
.btn-success:hover { background-color: #1e7e34; }
.btn-danger { background-color: #dc3545; color: white; }
.btn-danger:hover { background-color: #c82333; }
.btn-secondary { background-color: #ffffff; color: #000000; border: 1px solid #000000; }
.btn-secondary:hover { background-color: #f2f2f2; }

.btn-add-row {
  padding: 6px 14px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
}

.btn-add-row:hover { background: #1d4ed8; }

.btn-row-delete {
  padding: 4px 8px;
  background: #dc3545;
  color: #fff;
  font-size: 12px;
}

.btn-row-delete:hover { background: #c82333; }

.valid-checkbox-label {
  width: 320px;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #f8f9fa;
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
  user-select: none;
  color: #16a34a;
  font-weight: 700;
}

.valid-checkbox {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.valid-checkbox-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  font-size: 16px;
  color: #16a34a;
}

.valid-checkbox-inactive { color: #222; }
.valid-checkbox-label-disabled { cursor: default; }
.valid-checkbox-label:focus-within { border-color: #007bff; }

@media (max-width: 720px) {
  .detail-row {
    display: contents;
  }

  .detail-value {
    width: 100%;
    padding: 2px 12px;
    align-items: center;
  }

  .detail-label {
    width: 100%;
    text-align: left;
    justify-content: flex-start;
    border-right: none;
  }

  .remarks-textarea {
    width: 100%;
  }
}
</style>
