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
import { ref, onMounted, reactive, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import apiClient from '../../../api/client';
import { qConfirm, qMessage } from '../../../utils/qAlert';
import { saveReturnMessage } from '../../../utils/listSessionState';

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
const detailData = ref(null);
const message = ref('');
const messageType = ref('success');

const form = reactive({
  車両ID: '',
  車両名: '',
  車両備考: '',
  有効: true
});

const errors = reactive({
  車両ID: '',
  車両名: '',
  車両備考: ''
});

const touched = reactive({
  車両ID: false,
  車両名: false,
  車両備考: false
});

// ==================================================
// 計算プロパティ
// ==================================================
const isCreateMode = computed(() => mode.value === 'create');
const isEditMode = computed(() => mode.value === 'edit');
const isViewMode = computed(() => mode.value === 'view');
const requiredFields = computed(() => ['車両ID', '車両名']);

// ==================================================
// ユーティリティ関数
// ==================================================
const showMessage = (text, type = 'success') => {
  void qMessage(text, type);
};

const resetValidation = () => {
  Object.keys(errors).forEach((key) => {
    errors[key] = '';
  });
  Object.keys(touched).forEach((key) => {
    touched[key] = false;
  });
};

const resetForm = () => {
  form.車両ID = '';
  form.車両名 = '';
  form.車両備考 = '';
  form.有効 = true;
};

const applyDataToForm = (data) => {
  form.車両ID = data?.車両ID || '';
  form.車両名 = data?.車両名 || '';
  form.車両備考 = data?.車両備考 || '';
  form.有効 = data?.有効 ?? true;
};

// ==================================================
// バリデーション
// ==================================================
const validateField = (field, showMessage = true) => {
  const value = String(form[field] ?? '').trim();

  if (!requiredFields.value.includes(field)) {
    errors[field] = '';
    return true;
  }
  if (!value) {
    errors[field] = showMessage ? `${field}は必須です。` : 'ERROR';
    return false;
  }

  errors[field] = '';
  return true;
};

const handleBlur = (field) => {
  touched[field] = true;
  validateField(field);
};

const handleInput = (field) => {
  if (touched[field]) {
    validateField(field);
  }
};

const validateForm = () => {
  let isValid = true;
  let firstErrorField = null;

  requiredFields.value.forEach((field) => {
    touched[field] = true;
    if (!validateField(field, false)) {
      isValid = false;
      if (!firstErrorField) firstErrorField = field;
    }
  });

  if (firstErrorField) {
    const fieldMap = {
      '車両ID': 'form-vehicle-id',
      '車両名': 'form-vehicle-name'
    };
    const elementId = fieldMap[firstErrorField];
    if (elementId) {
      const element = document.getElementById(elementId);
      if (element) element.focus();
    }
  }

  return isValid;
};

// ==================================================
// 詳細データ取得
// ==================================================
const loadDetail = async (vehicleId) => {
  message.value = '';
  try {
    const res = await apiClient.post('/apps/M車両/取得', { 車両ID: String(vehicleId) });
    if (res.data.status === 'OK' && res.data.data) {
      detailData.value = res.data.data;
      applyDataToForm(res.data.data);
    } else {
      showMessage(res.data.message || '車両情報の取得に失敗しました。', 'error');
    }
  } catch (e) {
    showMessage('車両情報の取得でエラーが発生しました。', 'error');
  }
};

// ==================================================
// ルーティング処理
// ==================================================
const applyQueryParams = async (query) => {
  message.value = '';
  resetValidation();
  activeTab.value = 'content';

  if (query.モード === '新規') {
    mode.value = 'create';
    detailData.value = null;
    resetForm();
    return;
  }

  if (query.モード === '表示' && query.車両ID) {
    mode.value = 'view';
    await loadDetail(query.車両ID);
    return;
  }

  if (query.車両ID) {
    mode.value = 'edit';
    await loadDetail(query.車両ID);
    return;
  }

  mode.value = 'create';
  detailData.value = null;
  resetForm();
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

const handleSuccess = (messageText) => {
  if (pushReturnTarget(messageText)) return;
  router.push({
    path: '/Mマスタ/M車両/一覧',
    query: buildListQuery({ message: messageText, type: 'success' })
  });
};

const backToList = () => {
  if (pushReturnTarget()) return;
  router.push({ path: '/Mマスタ/M車両/一覧', query: buildListQuery() });
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
  message.value = '';
  if (!validateForm()) {
    showMessage('入力内容を確認してください。', 'error');
    activeTab.value = 'content';
    return;
  }
  try {
    let res;
    if (isCreateMode.value) {
      res = await apiClient.post('/apps/M車両/登録', {
        車両ID: form.車両ID,
        車両名: form.車両名,
        車両備考: form.車両備考,
        有効: form.有効
      });
    } else {
      res = await apiClient.post('/apps/M車両/変更', {
        車両ID: form.車両ID,
        車両名: form.車両名,
        車両備考: form.車両備考,
        有効: form.有効
      });
    }

    if (res.data.status === 'OK') {
      handleSuccess(res.data.message);
    } else {
      showMessage(res.data.message || (isCreateMode.value ? '登録に失敗しました。' : '更新に失敗しました。'), 'error');
    }
  } catch (e) {
    showMessage(isCreateMode.value ? '登録に失敗しました。' : '更新に失敗しました。', 'error');
  }
};

const deleteData = async () => {
  if (!form.車両ID) return;

  const confirmed = await qConfirm(`M車両「${form.車両ID}」を削除しますか？この操作は取り消せません。`);
  if (!confirmed) return;

  try {
    const res = await apiClient.post('/apps/M車両/削除', { 車両ID: form.車両ID });
    if (res.data.status === 'OK') {
      handleSuccess(res.data.message);
    } else {
      showMessage(res.data.message || '削除に失敗しました。', 'error');
    }
  } catch (e) {
    showMessage('削除に失敗しました。', 'error');
  }
};

// ==================================================
// 初期化
// ==================================================
onMounted(async () => {
  await applyQueryParams(route.query);
});

watch(() => route.query, async (query) => {
  await applyQueryParams(query);
});
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">
      <span class="title-text">【 M車両 】</span>
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
              <div class="detail-row row-id">
                <div class="detail-label">車両ID<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <input
                        id="form-vehicle-id"
                        type="text"
                        v-model="form.車両ID"
                        :readonly="!isCreateMode || isViewMode"
                        class="detail-input id-input"
                        :class="{ 'input-error': errors.車両ID }"
                        @blur="handleBlur('車両ID')"
                        @input="handleInput('車両ID')"
                      />
                      <span v-if="errors.車両ID" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.車両ID && errors.車両ID !== 'ERROR'" class="field-error">{{ errors.車両ID }}</div>
                  </div>
                </div>
              </div>

              <div class="detail-row row-name">
                <div class="detail-label">車両名<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <input
                        id="form-vehicle-name"
                        type="text"
                        v-model="form.車両名"
                        class="detail-input name-input"
                        :class="{ 'input-error': errors.車両名 }"
                        :readonly="isViewMode"
                        @blur="handleBlur('車両名')"
                        @input="handleInput('車両名')"
                      />
                      <span v-if="errors.車両名" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.車両名 && errors.車両名 !== 'ERROR'" class="field-error">{{ errors.車両名 }}</div>
                  </div>
                </div>
              </div>

              <div class="detail-row row-remarks">
                <div class="detail-label">車両備考</div>
                <div class="detail-value">
                  <div class="input-wrap">
                    <textarea
                      id="form-vehicle-remarks"
                      v-model="form.車両備考"
                      class="detail-textarea remarks-textarea"
                      rows="3"
                      :readonly="isViewMode"
                    ></textarea>
                  </div>
                </div>
              </div>
            </template>

            <template v-if="activeTab === 'others'">
              <div class="detail-row row-valid">
                <div class="detail-label">有効</div>
                <div class="detail-value">
                  <label
                    class="valid-checkbox-label"
                    :class="{ 'valid-checkbox-label-disabled': isViewMode }"
                  >
                    <input
                      type="checkbox"
                      v-model="form.有効"
                      :disabled="isViewMode"
                      class="valid-checkbox"
                      aria-label="有効の切り替え"
                    />
                    <span
                      class="valid-checkbox-mark"
                      :class="{ 'valid-checkbox-inactive': !form.有効 }"
                    >{{ form.有効 ? '✅' : '☐' }}</span>
                  </label>
                </div>
              </div>
              <div class="detail-row row-datetime">
                <div class="detail-label">登録日時</div>
                <div class="detail-value">
                  <input
                    type="text"
                    :value="detailData?.登録日時 || ''"
                    class="detail-input w-2x center-input"
                    readonly
                  />
                </div>
              </div>
              <div class="detail-row row-user">
                <div class="detail-label">登録利用者</div>
                <div class="detail-value">
                  <input
                    type="text"
                    :value="detailData?.登録利用者名 || ''"
                    class="detail-input w-2x center-input"
                    readonly
                  />
                </div>
              </div>
              <div class="detail-row row-terminal">
                <div class="detail-label">登録端末</div>
                <div class="detail-value">
                  <input
                    type="text"
                    :value="detailData?.登録端末ID || ''"
                    class="detail-input w-2x center-input"
                    readonly
                  />
                </div>
              </div>
              <div class="detail-row row-datetime">
                <div class="detail-label">更新日時</div>
                <div class="detail-value">
                  <input
                    type="text"
                    :value="detailData?.更新日時 || ''"
                    class="detail-input w-2x center-input"
                    readonly
                  />
                </div>
              </div>
              <div class="detail-row row-user">
                <div class="detail-label">更新利用者</div>
                <div class="detail-value">
                  <input
                    type="text"
                    :value="detailData?.更新利用者名 || ''"
                    class="detail-input w-2x center-input"
                    readonly
                  />
                </div>
              </div>
              <div class="detail-row row-terminal">
                <div class="detail-label">更新端末</div>
                <div class="detail-value">
                  <input
                    type="text"
                    :value="detailData?.更新端末ID || ''"
                    class="detail-input w-2x center-input"
                    readonly
                  />
                </div>
              </div>
            </template>
          </div>

          <div class="form-buttons" v-if="!isViewMode">
            <button type="submit" class="btn btn-success">
              {{ isCreateMode ? '登録' : '更新' }}
            </button>
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
  background-color: #b52a37;
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

.tab-btn:hover:not(.active) {
  background: #e9e9e9;
}

.detail-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 700px;
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
.detail-row.row-name,
.detail-row.row-remarks,
.detail-row.row-datetime,
.detail-row.row-user,
.detail-row.row-terminal {
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
.row-name .detail-value,
.row-remarks .detail-value,
.row-datetime .detail-value,
.row-user .detail-value,
.row-terminal .detail-value {
  width: auto;
}

.value-column {
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.detail-input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  padding-right: 26px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  font-size: 14px;
  box-sizing: border-box;
  margin: 0;
}

.detail-input:focus,
.detail-textarea:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: inset 0 0 0 1px rgba(0, 123, 255, 0.2);
}

.detail-input.input-error,
.detail-textarea.input-error {
  border-color: #dc2626;
  background-color: #fff8f8;
}

.detail-input.input-error:focus {
  border-color: #dc2626;
  box-shadow: inset 0 0 0 1px rgba(220, 38, 38, 0.2);
}

.detail-input[readonly] {
  color: #555;
  background-color: #f8f9fa;
}

.id-input {
  width: 160px;
  text-align: center;
}

.name-input {
  width: 320px;
}

.center-input {
  text-align: center;
}

.remarks-textarea {
  width: 320px;
}

.detail-textarea {
  height: auto;
  min-height: 60px;
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

.w-2x {
  width: 320px !important;
}

.input-wrap {
  position: relative;
  width: 100%;
  margin: 0;
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
  border-radius: 0;
  background: #dc2626;
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.field-error {
  font-size: 11px;
  color: #dc2626;
  line-height: 1;
  margin: 0;
  padding: 0;
}

.required-mark {
  color: #dc2626;
  font-weight: 700;
  margin-left: 4px;
}

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

.btn-success {
  background-color: #28a745;
  color: white;
}

.btn-success:hover {
  background-color: #1e7e34;
}

.btn-danger {
  background-color: #dc3545;
  color: white;
}

.btn-danger:hover {
  background-color: #c82333;
}

.btn-secondary {
  background-color: #ffffff;
  color: #000000;
  border: 1px solid #000000;
}

.btn-secondary:hover {
  background-color: #f2f2f2;
}

.message {
  padding: 10px;
  border-radius: 5px;
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

@media (max-width: 720px) {
  .detail-panel {
    max-width: 100%;
    grid-template-columns: 1fr;
    row-gap: 4px;
    padding: 8px;
  }

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
}

.row-valid {
  width: fit-content;
}

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
  gap: 0;
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

.valid-checkbox-inactive {
  color: #222;
}

.valid-checkbox-label-disabled {
  cursor: default;
}

.valid-checkbox-label:focus-within {
  border-color: #007bff;
  box-shadow: inset 0 0 0 1px rgba(0, 123, 255, 0.2);
}
</style>
