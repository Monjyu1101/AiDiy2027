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
import type { M取引先分類 } from '../../../types';
import qQRcode from '../../_share/qQRcode.vue';
import qGoogleMap from '../../_share/qGoogleMap.vue';

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

const mode = ref('edit');
const activeTab = ref('content');
const detailData = ref(null);
const 取引先分類一覧 = ref<M取引先分類[]>([]);
const form = reactive({
  取引先ID: '',
  取引先名: '',
  取引先分類ID: '',
  取引先郵便番号: '',
  取引先住所: '',
  取引先電話番号: '',
  取引先メールアドレス: '',
  取引先備考: '',
  有効: true
});
const errors = reactive({
  取引先ID: '',
  取引先名: '',
  取引先分類ID: ''
});
const touched = reactive({
  取引先ID: false,
  取引先名: false,
  取引先分類ID: false
});
const isCreateMode = computed(() => mode.value === 'create');
const isEditMode = computed(() => mode.value === 'edit');
const isViewMode = computed(() => mode.value === 'view');
const requiredFields = computed(() => ['取引先ID', '取引先名', '取引先分類ID']);
const 表示用取引先分類一覧 = computed(() => {
  if (!isCreateMode.value) return 取引先分類一覧.value;
  return 取引先分類一覧.value.filter((item) => item.有効 !== false);
});

const 住所URL = computed(() => {
  const 住所 = (form.取引先住所 || '').trim();
  if (!住所) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(住所)}`;
});

const showMessage = (text, type = 'success') => {
  void qMessage(text, type);
};
const resetValidation = () => {
  Object.keys(errors).forEach((key) => { errors[key] = ''; });
  Object.keys(touched).forEach((key) => { touched[key] = false; });
};
const resetForm = () => {
  form.取引先ID = '';
  form.取引先名 = '';
  form.取引先分類ID = '';
  form.取引先郵便番号 = '';
  form.取引先住所 = '';
  form.取引先電話番号 = '';
  form.取引先メールアドレス = '';
  form.取引先備考 = '';
  form.有効 = true;
};
const applyDataToForm = (data) => {
  form.取引先ID = data?.取引先ID || '';
  form.取引先名 = data?.取引先名 || '';
  form.取引先分類ID = data?.取引先分類ID || '';
  form.取引先郵便番号 = data?.取引先郵便番号 || '';
  form.取引先住所 = data?.取引先住所 || '';
  form.取引先電話番号 = data?.取引先電話番号 || '';
  form.取引先メールアドレス = data?.取引先メールアドレス || '';
  form.取引先備考 = data?.取引先備考 || '';
  form.有効 = data?.有効 ?? true;
};
const validateField = (field, showFieldMessage = true) => {
  const value = String(form[field] ?? '').trim();
  if (!requiredFields.value.includes(field)) {
    errors[field] = '';
    return true;
  }
  if (!value) {
    errors[field] = showFieldMessage ? `${field}は必須です。` : 'ERROR';
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
  if (touched[field]) validateField(field);
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
      取引先ID: 'form-partner-id',
      取引先名: 'form-partner-name',
      取引先分類ID: 'form-partner-category-id'
    };
    const element = document.getElementById(fieldMap[firstErrorField]);
    if (element) element.focus();
  }
  return isValid;
};
const loadDetail = async (取引先ID) => {
  try {
    const res = await apiClient.post('/apps/M取引先/取得', { 取引先ID: String(取引先ID) });
    if (res.data.status === 'OK' && res.data.data) {
      detailData.value = res.data.data;
      applyDataToForm(res.data.data);
    } else {
      showMessage(res.data.message || '取引先情報の取得に失敗しました。', 'error');
    }
  } catch {
    showMessage('取引先情報の取得でエラーが発生しました。', 'error');
  }
};
const loadMasterData = async () => {
  try {
    const res = await apiClient.post('/apps/M取引先分類/一覧', {});
    if (res.data.status === 'OK') {
      const data = res.data.data;
      取引先分類一覧.value = Array.isArray(data) ? data : data?.items ?? [];
      return;
    }
  } catch {
    // 候補未取得時は保存時バリデーションで止める
  }
  取引先分類一覧.value = [];
};
const applyQueryParams = async (query) => {
  resetValidation();
  activeTab.value = 'content';
  if (query.モード === '新規') {
    mode.value = 'create';
    detailData.value = null;
    resetForm();
    return;
  }
  if (query.モード === '表示' && query.取引先ID) {
    mode.value = 'view';
    await loadDetail(query.取引先ID);
    return;
  }
  if (query.取引先ID) {
    mode.value = 'edit';
    await loadDetail(query.取引先ID);
    return;
  }
  mode.value = 'create';
  detailData.value = null;
  resetForm();
};
const buildListQuery = (extra = {}) => {
  const query: Record<string, any> = { ...extra };
  if (URLメニュー.value) query.URLメニュー = URLメニュー.value;
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
    path: '/Mマスタ/M取引先/一覧',
    query: buildListQuery({ message: messageText, type: 'success' })
  });
};
const backToList = () => {
  if (pushReturnTarget()) return;
  router.push({ path: '/Mマスタ/M取引先/一覧', query: buildListQuery() });
};
const handleMenu = () => {
  if (!URLメニュー.value) return;
  router.push(toHalfwidthUrl(URLメニュー.value));
};

const handleReturn = () => {
  if (!URL戻り先.value) return;
  router.push(toHalfwidthUrl(URL戻り先.value));
};
const saveData = async () => {
  if (!validateForm()) {
    showMessage('入力内容を確認してください。', 'error');
    activeTab.value = 'content';
    return;
  }
  try {
    const payload = {
      取引先ID: form.取引先ID,
      取引先名: form.取引先名,
      取引先分類ID: form.取引先分類ID,
      取引先郵便番号: form.取引先郵便番号,
      取引先住所: form.取引先住所,
      取引先電話番号: form.取引先電話番号,
      取引先メールアドレス: form.取引先メールアドレス,
      取引先備考: form.取引先備考,
      有効: form.有効
    };
    const res = await apiClient.post(isCreateMode.value ? '/apps/M取引先/登録' : '/apps/M取引先/変更', payload);
    if (res.data.status === 'OK') handleSuccess(res.data.message);
    else showMessage(res.data.message || '保存に失敗しました。', 'error');
  } catch {
    showMessage('保存に失敗しました。', 'error');
  }
};
const deleteData = async () => {
  if (!form.取引先ID) return;
  const confirmed = await qConfirm(`M取引先「${form.取引先ID}」を削除しますか？この操作は取り消せません。`);
  if (!confirmed) return;
  try {
    const res = await apiClient.post('/apps/M取引先/削除', { 取引先ID: form.取引先ID });
    if (res.data.status === 'OK') handleSuccess(res.data.message);
    else showMessage(res.data.message || '削除に失敗しました。', 'error');
  } catch {
    showMessage('削除に失敗しました。', 'error');
  }
};
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
      <span class="title-text">【 M取引先 】</span>
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
          <div class="form-layout">
            <div class="form-left">
          <div class="tab-header">
            <button type="button" class="tab-btn" :class="{ active: activeTab === 'content' }" @click="activeTab = 'content'">内容</button>
            <button type="button" class="tab-btn" :class="{ active: activeTab === 'others' }" @click="activeTab = 'others'">その他</button>
          </div>
          <div class="detail-panel">
            <template v-if="activeTab === 'content'">
              <div class="detail-row">
                <div class="detail-label">取引先ID<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <input id="form-partner-id" v-model="form.取引先ID" type="text" :readonly="!isCreateMode || isViewMode" class="detail-input id-input" :class="{ 'input-error': errors.取引先ID }" @blur="handleBlur('取引先ID')" @input="handleInput('取引先ID')" />
                      <span v-if="errors.取引先ID" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.取引先ID && errors.取引先ID !== 'ERROR'" class="field-error">{{ errors.取引先ID }}</div>
                  </div>
                </div>
              </div>
              <div class="detail-row">
                <div class="detail-label">取引先名<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <input id="form-partner-name" v-model="form.取引先名" type="text" class="detail-input w-2x" :class="{ 'input-error': errors.取引先名 }" :readonly="isViewMode" @blur="handleBlur('取引先名')" @input="handleInput('取引先名')" />
                      <span v-if="errors.取引先名" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.取引先名 && errors.取引先名 !== 'ERROR'" class="field-error">{{ errors.取引先名 }}</div>
                  </div>
                </div>
              </div>
              <div class="detail-row">
                <div class="detail-label">取引先分類<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <select id="form-partner-category-id" v-model="form.取引先分類ID" class="detail-input w-2x" :class="{ 'input-error': errors.取引先分類ID }" :disabled="isViewMode" @blur="handleBlur('取引先分類ID')" @change="handleInput('取引先分類ID')">
                        <option value=""></option>
                        <option v-for="item in 表示用取引先分類一覧" :key="item.取引先分類ID" :value="item.取引先分類ID">
                          {{ item.取引先分類ID }} : {{ item.取引先分類名 }}
                        </option>
                      </select>
                      <span v-if="errors.取引先分類ID" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.取引先分類ID && errors.取引先分類ID !== 'ERROR'" class="field-error">{{ errors.取引先分類ID }}</div>
                  </div>
                </div>
              </div>
              <div class="detail-row">
                <div class="detail-label">郵便番号</div>
                <div class="detail-value"><input v-model="form.取引先郵便番号" type="text" class="detail-input id-input center-input" :readonly="isViewMode" /></div>
              </div>
              <div class="detail-row">
                <div class="detail-label">住所</div>
                <div class="detail-value"><input v-model="form.取引先住所" type="text" class="detail-input address-input" :readonly="isViewMode" /></div>
              </div>
              <div class="detail-row">
                <div class="detail-label">電話番号</div>
                <div class="detail-value"><input v-model="form.取引先電話番号" type="text" class="detail-input w-2x center-input" :readonly="isViewMode" /></div>
              </div>
              <div class="detail-row">
                <div class="detail-label">メールアドレス</div>
                <div class="detail-value"><input v-model="form.取引先メールアドレス" type="email" class="detail-input address-input" :readonly="isViewMode" /></div>
              </div>
              <div class="detail-row">
                <div class="detail-label">取引先備考</div>
                <div class="detail-value"><textarea v-model="form.取引先備考" class="detail-textarea" rows="3" :readonly="isViewMode"></textarea></div>
              </div>
            </template>
            <template v-if="activeTab === 'others'">
              <div class="detail-row">
                <div class="detail-label">有効</div>
                <div class="detail-value">
                  <label class="valid-checkbox-label" :class="{ 'valid-checkbox-label-disabled': isViewMode }">
                    <input type="checkbox" v-model="form.有効" :disabled="isViewMode" class="valid-checkbox" aria-label="有効の切り替え" />
                    <span class="valid-checkbox-mark" :class="{ 'valid-checkbox-inactive': !form.有効 }">{{ form.有効 ? '✅' : '☐' }}</span>
                  </label>
                </div>
              </div>
              <div v-for="field in ['登録日時', '登録利用者名', '登録端末ID', '更新日時', '更新利用者名', '更新端末ID']" :key="field" class="detail-row">
                <div class="detail-label">{{ field }}</div>
                <div class="detail-value"><input type="text" :value="detailData?.[field] || ''" class="detail-input w-2x center-input" readonly /></div>
              </div>
            </template>
          </div>
          <div class="form-buttons" v-if="!isViewMode">
            <button type="submit" class="btn btn-success">{{ isCreateMode ? '登録' : '更新' }}</button>
            <button v-if="isEditMode" type="button" class="btn btn-danger" @click="deleteData">削除</button>
          </div>
            </div>

            <div class="form-right">
              <div class="addr-panel">
                <div class="addr-header">
                  <div class="addr-title">住所</div>
                  <div class="addr-text">{{ form.取引先住所 || '—' }}</div>
                  <div v-if="住所URL" class="addr-url">
                    <a :href="住所URL" target="_blank" rel="noopener noreferrer">地図で開く</a>
                  </div>
                </div>
                <div v-if="form.取引先住所" class="map-box">
                  <qGoogleMap
                    :query="form.取引先住所"
                    width="100%"
                    height="100%"
                  />
                  <div v-if="住所URL" class="qr-overlay">
                    <qQRcode :value="住所URL" :size="80" :margin="1" />
                  </div>
                </div>
                <div v-else class="map-empty">住所 未入力</div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-container { width: 100%; height: 100%; display: flex; flex-direction: column; background: linear-gradient(135deg, #faf7f2 0%, #f5f1e8 50%, #f0ebe0 100%); }
.page-title { background: linear-gradient(135deg, #e6d5b7 0%, #dcc8a6 50%, #d2bb95 100%); margin: 0 0 5px 0; font-size: 14px; width: 100%; box-sizing: border-box; padding: 10px 20px 10px 40px; height: 35px; line-height: 20px; color: #5a4a3a; font-weight: bold; box-shadow: 0 2px 4px rgba(210, 187, 149, 0.3); display: flex; align-items: center; }
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

.btn-return { height: 24px; padding: 0 12px; border: none; border-radius: 0; cursor: pointer; font-size: 12px; background-color: #dc3545; color: #fff; }
.content { padding: 8px 20px 20px 20px; flex: 1; min-height: 0; }
.toolbar { margin-bottom: 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.detail-form { display: flex; flex-direction: column; gap: 0; }
.form-layout { display: flex; flex-direction: row; align-items: flex-start; gap: 16px; width: 100%; }
.form-left { display: flex; flex-direction: column; flex: 0 0 auto; min-width: 0; }
.form-right { flex: 1; padding-top: 36px; display: flex; justify-content: center; align-items: flex-start; min-width: 0; }
.addr-panel { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid #b3e5fc; background: #f6fbff; box-sizing: border-box; width: 480px; }
.addr-header { display: flex; flex-direction: column; gap: 2px; }
.addr-title { font-size: 12px; font-weight: 700; color: #333; }
.addr-text { font-size: 13px; color: #333; line-height: 1.4; word-break: break-all; }
.addr-url a { font-size: 11px; color: #007bff; text-decoration: underline; word-break: break-all; }
.map-box { position: relative; width: 100%; height: 360px; }
.qr-overlay { position: absolute; right: 8px; bottom: 8px; padding: 4px; background: #fff; border: 1px solid #b3c5d1; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18); line-height: 0; }
.map-empty { width: 100%; height: 360px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 11px; background: #fff; border: 1px dashed #c7d0d8; }
@media (max-width: 720px) {
  .form-layout { flex-direction: column; gap: 12px; }
  .form-right { padding-top: 0; }
  .addr-panel { width: 100%; }
}
.tab-header { display: flex; gap: 2px; border-bottom: 1px solid #ccc; }
.tab-btn { padding: 8px 24px; background: #f1f1f1; border: 1px solid #ccc; border-bottom: none; cursor: pointer; font-size: 14px; color: #555; border-radius: 4px 4px 0 0; margin-bottom: -1px; position: relative; top: 1px; }
.tab-btn.active { background: #fff; color: #007bff; font-weight: bold; border-bottom: 1px solid #fff; z-index: 1; }
.detail-panel { display: flex; flex-direction: column; width: 100%; max-width: 860px; }
.detail-row { display: flex; width: fit-content; margin-top: -1px; }
.detail-label { display: flex; align-items: center; justify-content: flex-end; color: #333; font-weight: 600; text-align: right; padding: 8px 12px; border: 1px solid #b3e5fc; background: #e1f5fe; min-height: 40px; width: 160px; flex-shrink: 0; box-sizing: border-box; border-radius: 0; z-index: 1; }
.detail-value { display: flex; align-items: center; color: #333; padding: 4px 12px; border: 1px solid #ccc; border-left: none; background: #fff; min-height: 40px; box-sizing: border-box; border-radius: 0; }
.value-column { display: flex; flex-direction: column; gap: 2px; }
.detail-input { width: 100%; height: 28px; padding: 0 8px; padding-right: 26px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; font-size: 14px; box-sizing: border-box; margin: 0; }
.detail-input[readonly] { color: #555; background-color: #f8f9fa; }
.id-input { width: 160px; }
.w-2x, .detail-textarea, .valid-checkbox-label { width: 320px; }
.address-input { width: 640px; }
.center-input { text-align: center; }
.detail-textarea { min-height: 60px; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; font-size: 14px; box-sizing: border-box; margin: 4px 0; resize: vertical; font-family: inherit; }
.input-wrap { position: relative; width: 100%; display: flex; align-items: center; }
.input-error { border-color: #dc2626; background-color: #fff8f8; }
.input-alert { position: absolute; top: 50%; right: 8px; transform: translateY(-50%); width: 18px; height: 18px; border-radius: 0; background: #dc2626; color: #fff; font-weight: 700; font-size: 12px; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.field-error { font-size: 11px; color: #dc2626; line-height: 1; margin: 0; padding: 0; }
.required-mark { color: #dc2626; font-weight: 700; margin-left: 4px; }
.form-buttons { margin-top: 8px; padding-top: 8px; border-top: 1px solid #ccc; display: flex; justify-content: flex-start; gap: 10px; }
.btn { padding: 10px 20px; border: none; border-radius: 0; cursor: pointer; font-size: 14px; margin: 0; }
.btn-success { background-color: #28a745; color: white; }
.btn-danger { background-color: #dc3545; color: white; }
.btn-secondary { background-color: #ffffff; color: #000000; border: 1px solid #000000; }
.valid-checkbox-label { min-height: 28px; padding: 0 8px; border: 1px solid #d1d5db; border-radius: 4px; background: #f8f9fa; box-sizing: border-box; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #16a34a; font-weight: 700; }
.valid-checkbox { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.valid-checkbox-mark { display: inline-flex; align-items: center; justify-content: center; line-height: 1; font-size: 16px; color: #16a34a; }
.valid-checkbox-inactive { color: #222; }
.valid-checkbox-label-disabled { cursor: default; }
</style>
