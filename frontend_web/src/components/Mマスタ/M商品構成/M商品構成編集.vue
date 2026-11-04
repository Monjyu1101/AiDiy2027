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
import type { M商品, M生産区分, M生産工程 } from '../../../types';

type 商品構成明細Form = {
  明細SEQ: number
  構成商品ID: string
  計算分子数量: string
  計算分母数量: string
  最小ロット構成数量: string
  構成商品備考: string
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

const mode = ref('edit');
const activeTab = ref('content');
const detailData = ref<any>(null);
const 商品一覧 = ref<M商品[]>([]);
const 生産区分一覧 = ref<M生産区分[]>([]);
const 生産工程一覧 = ref<M生産工程[]>([]);
const detailError = ref('');
const numberFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });
const 数値編集中 = reactive<Record<string, boolean>>({});

const form = reactive({
  商品ID: '',
  最小ロット数量: '',
  生産区分ID: '',
  生産工程ID: '',
  段取分数: '',
  時間生産数量: '',
  商品構成備考: '',
  有効: true
});

const errors = reactive({
  商品ID: '',
  最小ロット数量: '',
  生産区分ID: '',
  生産工程ID: '',
  段取分数: '',
  時間生産数量: ''
});

const touched = reactive({
  商品ID: false,
  最小ロット数量: false,
  生産区分ID: false,
  生産工程ID: false,
  段取分数: false,
  時間生産数量: false
});

const 明細一覧 = ref<商品構成明細Form[]>([]);

const isCreateMode = computed(() => mode.value === 'create');
const isEditMode = computed(() => mode.value === 'edit');
const isViewMode = computed(() => mode.value === 'view');
const requiredFields = computed(() => ['商品ID', '最小ロット数量', '生産区分ID', '生産工程ID']);
type HeaderField = '商品ID' | '最小ロット数量' | '生産区分ID' | '生産工程ID' | '段取分数' | '時間生産数量';
type HeaderNumericField = '最小ロット数量' | '段取分数' | '時間生産数量';
type DetailNumericField = '計算分子数量' | '計算分母数量' | '最小ロット構成数量';
const 表示用商品一覧 = computed(() => isCreateMode.value
  ? 商品一覧.value.filter((item) => item?.有効 !== false)
  : 商品一覧.value);
const 表示用生産区分一覧 = computed(() => isCreateMode.value
  ? 生産区分一覧.value.filter((item) => item?.有効 !== false)
  : 生産区分一覧.value);
const 表示用生産工程一覧 = computed(() => isCreateMode.value
  ? 生産工程一覧.value.filter((item) => item?.有効 !== false)
  : 生産工程一覧.value);

const 商品マップ = computed<Record<string, M商品>>(() => {
  const result: Record<string, M商品> = {};
  商品一覧.value.forEach((item) => {
    result[item.商品ID] = item;
  });
  return result;
});

const 選択商品 = computed(() => 商品マップ.value[form.商品ID] || null);
const 商品単位表示 = computed(() => 選択商品.value?.単位 || '');

const createEmptyDetail = (明細SEQ = 1): 商品構成明細Form => ({
  明細SEQ,
  構成商品ID: '',
  計算分子数量: '',
  計算分母数量: '1000',
  最小ロット構成数量: '',
  構成商品備考: ''
});

const showMessage = (text: string, type = 'success') => {
  void qMessage(text, type);
};

const resetValidation = () => {
  Object.keys(errors).forEach((key) => {
    errors[key as keyof typeof errors] = '';
  });
  Object.keys(touched).forEach((key) => {
    touched[key as keyof typeof touched] = false;
  });
  detailError.value = '';
};

const renumberDetails = () => {
  clearNumericEditing();
  明細一覧.value.forEach((row, index) => {
    row.明細SEQ = index + 1;
  });
};

const resetForm = () => {
  clearNumericEditing();
  form.商品ID = '';
  form.最小ロット数量 = '';
  form.生産区分ID = '';
  form.生産工程ID = 'L99';
  form.段取分数 = '';
  form.時間生産数量 = '';
  form.商品構成備考 = '';
  form.有効 = true;
  明細一覧.value = [createEmptyDetail(1)];
};

const applyDataToForm = (data: any) => {
  clearNumericEditing();
  form.商品ID = data?.商品ID || '';
  form.最小ロット数量 = data?.最小ロット数量 === null || data?.最小ロット数量 === undefined ? '' : String(data.最小ロット数量);
  form.生産区分ID = data?.生産区分ID || '';
  form.生産工程ID = data?.生産工程ID || '';
  form.段取分数 = data?.段取分数 === null || data?.段取分数 === undefined ? '' : String(data.段取分数);
  form.時間生産数量 = data?.時間生産数量 === null || data?.時間生産数量 === undefined ? '' : String(data.時間生産数量);
  form.商品構成備考 = data?.商品構成備考 || '';
  form.有効 = data?.有効 ?? true;
  明細一覧.value = Array.isArray(data?.明細一覧) && data.明細一覧.length
    ? data.明細一覧.map((item: any, index: number) => ({
        明細SEQ: Number(item?.明細SEQ ?? index + 1),
        構成商品ID: item?.構成商品ID || '',
        計算分子数量: item?.計算分子数量 === null || item?.計算分子数量 === undefined ? '' : String(item.計算分子数量),
        計算分母数量: item?.計算分母数量 === null || item?.計算分母数量 === undefined ? '1000' : String(item.計算分母数量),
        最小ロット構成数量: item?.最小ロット構成数量 !== null && item?.最小ロット構成数量 !== undefined ? String(item.最小ロット構成数量) : '',
        構成商品備考: item?.構成商品備考 || ''
      }))
    : [createEmptyDetail(1)];
  renumberDetails();
};

const toNumber = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const formatNumber = (value: number) => value.toLocaleString('ja-JP', { maximumFractionDigits: 3 });
const get構成商品 = (商品ID: string) => 商品マップ.value[String(商品ID)] || null;
const normalizeNumericInput = (value: any) => String(value ?? '').replace(/,/g, '').trim();
const formatNumericDisplay = (value: any) => {
  const normalized = normalizeNumericInput(value);
  if (!normalized) return '';
  const num = Number(normalized);
  return Number.isFinite(num) ? numberFormatter.format(num) : normalized;
};
const clearNumericEditing = () => {
  Object.keys(数値編集中).forEach((key) => { delete 数値編集中[key]; });
};
const isNumericEditing = (key: string) => Boolean(数値編集中[key]);
const handleHeaderNumericFocus = async (field: HeaderNumericField, event: FocusEvent) => {
  const key = `form-${field}`;
  数値編集中[key] = true;
  form[field] = normalizeNumericInput(form[field]);
  await nextTick();
  const target = event.target as HTMLInputElement | null;
  target?.select();
};
const handleHeaderNumericInput = (field: HeaderNumericField, event: Event, after?: () => void) => {
  const target = event.target as HTMLInputElement | null;
  form[field] = normalizeNumericInput(target?.value ?? '');
  handleInput(field);
  after?.();
};
const handleHeaderNumericBlur = (field: HeaderNumericField, after?: () => void) => {
  form[field] = normalizeNumericInput(form[field]);
  delete 数値編集中[`form-${field}`];
  handleBlur(field);
  after?.();
};
const handleDetailNumericFocus = async (row: 商品構成明細Form, field: DetailNumericField, event: FocusEvent) => {
  const key = `detail-${row.明細SEQ}-${field}`;
  数値編集中[key] = true;
  row[field] = normalizeNumericInput(row[field]);
  await nextTick();
  const target = event.target as HTMLInputElement | null;
  target?.select();
};
const handleDetailNumericInput = (
  row: 商品構成明細Form,
  field: DetailNumericField,
  event: Event,
  after?: () => void
) => {
  const target = event.target as HTMLInputElement | null;
  row[field] = normalizeNumericInput(target?.value ?? '');
  after?.();
};
const handleDetailNumericBlur = (
  row: 商品構成明細Form,
  field: DetailNumericField,
  after?: () => void
) => {
  row[field] = normalizeNumericInput(row[field]);
  delete 数値編集中[`detail-${row.明細SEQ}-${field}`];
  after?.();
};

const calc最小ロット構成数量 = (row: 商品構成明細Form) => {
  const lot = toNumber(form.最小ロット数量);
  const numerator = toNumber(row.計算分子数量);
  const denominator = toNumber(row.計算分母数量);
  if (!denominator) return 0;
  return Math.ceil(numerator / denominator * lot);
};

const recalcRow = (row: 商品構成明細Form) => {
  const val = calc最小ロット構成数量(row);
  row.最小ロット構成数量 = val === 0 ? '' : String(val);
};

const recalcAll = () => {
  明細一覧.value.forEach(recalcRow);
};

const sanitizeDetails = () => {
  return 明細一覧.value
    .map((row, index) => ({
      明細SEQ: index + 1,
      構成商品ID: String(row.構成商品ID || '').trim(),
      計算分子数量: String(row.計算分子数量 || '').trim(),
      計算分母数量: String(row.計算分母数量 || '').trim(),
      最小ロット構成数量: String(row.最小ロット構成数量 || '').trim(),
      構成商品備考: String(row.構成商品備考 || '').trim()
    }))
    .filter((row) => row.構成商品ID || row.計算分子数量 || row.計算分母数量 || row.構成商品備考);
};

const validateField = (field: HeaderField, showErrorMessage = true) => {
  const value = String(form[field] ?? '').trim();
  if (!requiredFields.value.includes(field)) {
    if (field === '段取分数' && value) {
      const num = Number(value);
      if (!Number.isInteger(num) || num < 0) {
        errors[field] = showErrorMessage ? '段取分数は0以上の整数を入力してください。' : 'ERROR';
        return false;
      }
    }
    if (field === '時間生産数量' && value && toNumber(value) <= 0) {
      errors[field] = showErrorMessage ? '時間生産数量は0より大きい値を入力してください。' : 'ERROR';
      return false;
    }
    errors[field] = '';
    return true;
  }
  if (!value) {
    errors[field] = showErrorMessage ? `${field}は必須です。` : 'ERROR';
    return false;
  }
  if (field === '最小ロット数量' && toNumber(value) <= 0) {
    errors[field] = showErrorMessage ? '最小ロット数量は0より大きい値を入力してください。' : 'ERROR';
    return false;
  }
  errors[field] = '';
  return true;
};

const handleBlur = (field: HeaderField) => {
  touched[field] = true;
  validateField(field);
};

const handleInput = (field: HeaderField) => {
  if (touched[field]) {
    validateField(field);
  }
};

const validateDetails = () => {
  const rows = sanitizeDetails();
  if (!rows.length) {
    detailError.value = '構成商品を1件以上入力してください。';
    return null;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNo = index + 1;
    if (!row.構成商品ID) {
      detailError.value = `${rowNo}行目の構成商品を選択してください。`;
      return null;
    }
    if (!row.計算分子数量) {
      detailError.value = `${rowNo}行目の計算分子数量を入力してください。`;
      return null;
    }
    if (!row.計算分母数量) {
      detailError.value = `${rowNo}行目の計算分母数量を入力してください。`;
      return null;
    }
    if (toNumber(row.計算分母数量) <= 0) {
      detailError.value = `${rowNo}行目の計算分母数量は0より大きい値を入力してください。`;
      return null;
    }
  }

  detailError.value = '';
  return rows.map((row, index) => ({
    明細SEQ: index + 1,
    構成商品ID: row.構成商品ID,
    計算分子数量: toNumber(row.計算分子数量),
    計算分母数量: toNumber(row.計算分母数量),
    最小ロット構成数量: row.最小ロット構成数量 !== '' ? toNumber(row.最小ロット構成数量) : null,
    構成商品備考: row.構成商品備考 || null
  }));
};

const validateForm = () => {
  let isValid = true;
  let firstErrorField: string | null = null;

  requiredFields.value.forEach((field) => {
    touched[field as HeaderField] = true;
    if (!validateField(field as HeaderField, false)) {
      isValid = false;
      if (!firstErrorField) firstErrorField = field;
    }
  });

  if (!validateField('段取分数', false)) {
    isValid = false;
    if (!firstErrorField) firstErrorField = '段取分数';
  }
  if (!validateField('時間生産数量', false)) {
    isValid = false;
    if (!firstErrorField) firstErrorField = '時間生産数量';
  }

  if (firstErrorField) {
    const fieldMap: Record<string, string> = {
      商品ID: 'form-product-id',
      最小ロット数量: 'form-lot',
      生産区分ID: 'form-production-type-id',
      生産工程ID: 'form-process-id',
      段取分数: 'form-setup-minutes',
      時間生産数量: 'form-hourly-quantity'
    };
    const elementId = fieldMap[firstErrorField];
    if (elementId) {
      const element = document.getElementById(elementId);
      if (element) element.focus();
    }
  }

  return isValid;
};

const addDetailRow = () => {
  明細一覧.value.push(createEmptyDetail(明細一覧.value.length + 1));
  detailError.value = '';
};

const removeDetailRow = (index: number) => {
  if (明細一覧.value.length === 1) {
    明細一覧.value = [createEmptyDetail(1)];
  } else {
    明細一覧.value.splice(index, 1);
    renumberDetails();
  }
  detailError.value = '';
};

const loadMasterData = async () => {
  try {
    const [resProducts, resProductionTypes, resProcesses] = await Promise.all([
      apiClient.post('/apps/M商品/一覧'),
      apiClient.post('/apps/M生産区分/一覧'),
      apiClient.post('/apps/M生産工程/一覧')
    ]);

    if (resProducts.data.status === 'OK') {
      const data = resProducts.data.data;
      商品一覧.value = Array.isArray(data) ? data : data?.items ?? [];
    }
    if (resProductionTypes.data.status === 'OK') {
      const data = resProductionTypes.data.data;
      生産区分一覧.value = Array.isArray(data) ? data : data?.items ?? [];
    }
    if (resProcesses.data.status === 'OK') {
      const data = resProcesses.data.data;
      生産工程一覧.value = Array.isArray(data) ? data : data?.items ?? [];
    }
  } catch (_e) {
    showMessage('商品マスタの取得でエラーが発生しました。', 'error');
  }
};

const loadDetail = async (商品ID: string) => {
  try {
    const res = await apiClient.post('/apps/M商品構成/取得', { 商品ID: String(商品ID) });
    if (res.data.status === 'OK' && res.data.data) {
      detailData.value = res.data.data;
      applyDataToForm(res.data.data);
    } else {
      showMessage(res.data.message || '商品構成情報の取得に失敗しました。', 'error');
    }
  } catch (_e) {
    showMessage('商品構成情報の取得でエラーが発生しました。', 'error');
  }
};

const applyQueryParams = async (query: any) => {
  resetValidation();
  activeTab.value = 'content';

  if (query.モード === '新規') {
    mode.value = 'create';
    detailData.value = null;
    resetForm();
    return;
  }

  if (query.モード === '表示' && query.商品ID) {
    mode.value = 'view';
    await loadDetail(String(query.商品ID));
    return;
  }

  if (query.商品ID) {
    mode.value = 'edit';
    await loadDetail(String(query.商品ID));
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

const handleSuccess = (messageText: string) => {
  if (pushReturnTarget(messageText)) return;
  router.push({
    path: '/Mマスタ/M商品構成/一覧',
    query: buildListQuery({ message: messageText, type: 'success' })
  });
};

const backToList = () => {
  if (pushReturnTarget()) return;
  router.push({ path: '/Mマスタ/M商品構成/一覧', query: buildListQuery() });
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

  const detailPayload = validateDetails();
  if (!detailPayload) {
    showMessage(detailError.value || '構成商品の入力内容を確認してください。', 'error');
    activeTab.value = 'content';
    return;
  }

  try {
    const payload = {
      商品ID: form.商品ID,
      最小ロット数量: toNumber(form.最小ロット数量),
      生産区分ID: form.生産区分ID,
      生産工程ID: form.生産工程ID,
      段取分数: form.段取分数 ? Math.trunc(Number(form.段取分数)) : null,
      時間生産数量: form.時間生産数量 ? toNumber(form.時間生産数量) : null,
      商品構成備考: form.商品構成備考 || null,
      有効: form.有効,
      明細一覧: detailPayload
    };

    const res = isCreateMode.value
      ? await apiClient.post('/apps/M商品構成/登録', payload)
      : await apiClient.post('/apps/M商品構成/変更', payload);

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
  if (!form.商品ID) return;
  const confirmed = await qConfirm(`M商品構成「${form.商品ID}」を削除しますか？この操作は取り消せません。`);
  if (!confirmed) return;

  try {
    const res = await apiClient.post('/apps/M商品構成/削除', { 商品ID: form.商品ID });
    if (res.data.status === 'OK') {
      handleSuccess(res.data.message);
    } else {
      showMessage(res.data.message || '削除に失敗しました。', 'error');
    }
  } catch (_e) {
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

watch(() => form.商品ID, (newValue) => {
  if (!isCreateMode.value) return;
  form.生産区分ID = newValue ? String(newValue).slice(0, 1) : '';
});
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">
      <span class="title-text">【 M商品構成 】{{ isCreateMode ? '新規登録' : '編集' }}</span>
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
            <button type="button" class="tab-btn" :class="{ active: activeTab === 'content' }" @click="activeTab = 'content'">内容</button>
            <button type="button" class="tab-btn" :class="{ active: activeTab === 'others' }" @click="activeTab = 'others'">その他</button>
          </div>

          <div class="detail-panel">
            <template v-if="activeTab === 'content'">
              <div class="detail-row row-select">
                <div class="detail-label">商品<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <select
                        id="form-product-id"
                        v-model="form.商品ID"
                        class="detail-input select-input"
                        :class="{ 'input-error': errors.商品ID }"
                        :disabled="!isCreateMode || isViewMode"
                        @blur="handleBlur('商品ID')"
                        @change="handleInput('商品ID')"
                      >
                        <option value="">選択してください</option>
                        <option v-for="item in 表示用商品一覧" :key="item.商品ID" :value="item.商品ID">
                          {{ item.商品ID }} : {{ item.商品名 }}
                        </option>
                      </select>
                      <span v-if="errors.商品ID" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.商品ID && errors.商品ID !== 'ERROR'" class="field-error">{{ errors.商品ID }}</div>
                  </div>
                </div>
              </div>

              <div class="detail-row row-lot">
                <div class="detail-label">最小ロット数量<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="lot-wrap">
                      <div class="input-wrap">
                        <input
                          id="form-lot"
                          :value="isNumericEditing('form-最小ロット数量') ? form.最小ロット数量 : formatNumericDisplay(form.最小ロット数量)"
                          type="text"
                          inputmode="decimal"
                          class="detail-input number-input"
                          :class="{ 'input-error': errors.最小ロット数量 }"
                          :readonly="isViewMode"
                          @focus="handleHeaderNumericFocus('最小ロット数量', $event)"
                          @input="handleHeaderNumericInput('最小ロット数量', $event, recalcAll)"
                          @blur="handleHeaderNumericBlur('最小ロット数量', recalcAll)"
                        />
                        <span v-if="errors.最小ロット数量" class="input-alert">!</span>
                      </div>
                      <span class="unit-text">{{ 商品単位表示 || '単位未設定' }}</span>
                    </div>
                    <div v-if="errors.最小ロット数量 && errors.最小ロット数量 !== 'ERROR'" class="field-error">{{ errors.最小ロット数量 }}</div>
                  </div>
                </div>
              </div>

              <div class="detail-row row-select">
                <div class="detail-label">生産区分<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <select
                        id="form-production-type-id"
                        v-model="form.生産区分ID"
                        class="detail-input select-input"
                        :class="{ 'input-error': errors.生産区分ID }"
                        :disabled="isViewMode"
                        @blur="handleBlur('生産区分ID')"
                        @change="handleInput('生産区分ID')"
                      >
                        <option value="">選択してください</option>
                        <option v-for="item in 表示用生産区分一覧" :key="item.生産区分ID" :value="item.生産区分ID">
                          {{ item.生産区分ID }} : {{ item.生産区分名 }}
                        </option>
                      </select>
                      <span v-if="errors.生産区分ID" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.生産区分ID && errors.生産区分ID !== 'ERROR'" class="field-error">{{ errors.生産区分ID }}</div>
                  </div>
                </div>
              </div>

              <div class="detail-row row-select">
                <div class="detail-label">生産工程<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <select
                        id="form-process-id"
                        v-model="form.生産工程ID"
                        class="detail-input select-input"
                        :class="{ 'input-error': errors.生産工程ID }"
                        :disabled="isViewMode"
                        @blur="handleBlur('生産工程ID')"
                        @change="handleInput('生産工程ID')"
                      >
                        <option value="">選択してください</option>
                        <option v-for="item in 表示用生産工程一覧" :key="item.生産工程ID" :value="item.生産工程ID">
                          {{ item.生産工程ID }} : {{ item.生産工程名 }}
                        </option>
                      </select>
                      <span v-if="errors.生産工程ID" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.生産工程ID && errors.生産工程ID !== 'ERROR'" class="field-error">{{ errors.生産工程ID }}</div>
                  </div>
                </div>
              </div>

              <div class="detail-row row-number">
                <div class="detail-label">段取分数</div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="lot-wrap">
                      <div class="input-wrap">
                        <input
                          id="form-setup-minutes"
                          :value="isNumericEditing('form-段取分数') ? form.段取分数 : formatNumericDisplay(form.段取分数)"
                          type="text"
                          inputmode="numeric"
                          class="detail-input number-input"
                          :class="{ 'input-error': errors.段取分数 }"
                          :readonly="isViewMode"
                          @focus="handleHeaderNumericFocus('段取分数', $event)"
                          @input="handleHeaderNumericInput('段取分数', $event)"
                          @blur="handleHeaderNumericBlur('段取分数')"
                        />
                        <span v-if="errors.段取分数" class="input-alert">!</span>
                      </div>
                      <span class="unit-text">分</span>
                    </div>
                    <div v-if="errors.段取分数 && errors.段取分数 !== 'ERROR'" class="field-error">{{ errors.段取分数 }}</div>
                  </div>
                </div>
              </div>

              <div class="detail-row row-lot">
                <div class="detail-label">時間生産数量</div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="lot-wrap">
                      <div class="input-wrap">
                        <input
                          id="form-hourly-quantity"
                          :value="isNumericEditing('form-時間生産数量') ? form.時間生産数量 : formatNumericDisplay(form.時間生産数量)"
                          type="text"
                          inputmode="decimal"
                          class="detail-input number-input"
                          :class="{ 'input-error': errors.時間生産数量 }"
                          :readonly="isViewMode"
                          @focus="handleHeaderNumericFocus('時間生産数量', $event)"
                          @input="handleHeaderNumericInput('時間生産数量', $event)"
                          @blur="handleHeaderNumericBlur('時間生産数量')"
                        />
                        <span v-if="errors.時間生産数量" class="input-alert">!</span>
                      </div>
                      <span class="unit-text">{{ 商品単位表示 || '単位未設定' }}</span>
                    </div>
                    <div v-if="errors.時間生産数量 && errors.時間生産数量 !== 'ERROR'" class="field-error">{{ errors.時間生産数量 }}</div>
                  </div>
                </div>
              </div>

              <div class="detail-row row-remarks">
                <div class="detail-label">商品構成備考</div>
                <div class="detail-value">
                  <textarea v-model="form.商品構成備考" class="detail-textarea remarks-textarea" rows="3" :readonly="isViewMode"></textarea>
                </div>
              </div>

              <div class="composition-block">
                <div class="composition-header">
                  <div class="composition-title">構成商品</div>
                  <button v-if="!isViewMode" type="button" class="btn btn-add-row" @click="addDetailRow">行追加</button>
                </div>

                <div class="composition-table-wrap">
                  <table class="composition-table">
                    <thead>
                      <tr>
                        <th class="w-seq">SEQ</th>
                        <th class="w-product">構成商品</th>
                        <th class="w-ratio">計算分子数量</th>
                        <th class="w-ratio">計算分母数量</th>
                        <th class="w-result">計算式(参考:切上整数)</th>
                        <th class="w-qty">最小ロット構成数量</th>
                        <th class="w-unit">構成単位</th>
                        <th class="w-note">備考</th>
                        <th v-if="!isViewMode" class="w-action">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, index) in 明細一覧" :key="`detail-${index}`">
                        <td class="cell-center">{{ row.明細SEQ }}</td>
                        <td>
                          <select v-model="row.構成商品ID" class="table-input select-cell" :disabled="isViewMode">
                            <option value="">選択してください</option>
                            <option v-for="item in 表示用商品一覧" :key="`${index}-${item.商品ID}`" :value="item.商品ID">
                              {{ item.商品ID }} : {{ item.商品名 }}
                            </option>
                          </select>
                        </td>
                        <td>
                          <input
                            :value="isNumericEditing(`detail-${row.明細SEQ}-計算分子数量`) ? row.計算分子数量 : formatNumericDisplay(row.計算分子数量)"
                            type="text"
                            inputmode="decimal"
                            class="table-input number-cell"
                            :readonly="isViewMode"
                            @focus="handleDetailNumericFocus(row, '計算分子数量', $event)"
                            @input="handleDetailNumericInput(row, '計算分子数量', $event, () => recalcRow(row))"
                            @blur="handleDetailNumericBlur(row, '計算分子数量', () => recalcRow(row))"
                          />
                        </td>
                        <td>
                          <input
                            :value="isNumericEditing(`detail-${row.明細SEQ}-計算分母数量`) ? row.計算分母数量 : formatNumericDisplay(row.計算分母数量)"
                            type="text"
                            inputmode="decimal"
                            class="table-input number-cell"
                            :readonly="isViewMode"
                            @focus="handleDetailNumericFocus(row, '計算分母数量', $event)"
                            @input="handleDetailNumericInput(row, '計算分母数量', $event, () => recalcRow(row))"
                            @blur="handleDetailNumericBlur(row, '計算分母数量', () => recalcRow(row))"
                          />
                        </td>
                        <td class="formula-cell">
                          {{ row.計算分子数量 || '0' }} / {{ row.計算分母数量 || '0' }} x {{ form.最小ロット数量 || '0' }} = {{ calc最小ロット構成数量(row) }}
                        </td>
                        <td>
                          <input
                            :value="isNumericEditing(`detail-${row.明細SEQ}-最小ロット構成数量`) ? row.最小ロット構成数量 : formatNumericDisplay(row.最小ロット構成数量)"
                            type="text"
                            inputmode="decimal"
                            class="table-input number-cell"
                            :readonly="isViewMode"
                            @focus="handleDetailNumericFocus(row, '最小ロット構成数量', $event)"
                            @input="handleDetailNumericInput(row, '最小ロット構成数量', $event)"
                            @blur="handleDetailNumericBlur(row, '最小ロット構成数量')"
                          />
                        </td>
                        <td class="cell-center">{{ get構成商品(row.構成商品ID)?.単位 || '' }}</td>
                        <td>
                          <input v-model="row.構成商品備考" type="text" class="table-input note-cell" :readonly="isViewMode" />
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
                    <input type="checkbox" v-model="form.有効" :disabled="isViewMode" class="valid-checkbox" aria-label="有効の切り替え" />
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

.detail-row.row-select,
.detail-row.row-lot,
.detail-row.row-number,
.detail-row.row-remarks,
.detail-row.row-valid,
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

.row-select .detail-value,
.row-lot .detail-value,
.row-number .detail-value,
.row-remarks .detail-value,
.row-valid .detail-value,
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

.select-input {
  width: 320px;
  padding-right: 8px;
}

.wide-input {
  width: 420px;
}

.number-input {
  width: 100px;
  text-align: right;
}

.lot-wrap {
  display: flex;
  align-items: center;
  width: 160px;
  gap: 0;
}

.lot-wrap .input-wrap {
  width: 100px;
}

.unit-text {
  width: 60px;
  min-width: 60px;
  font-weight: 600;
  color: #4b5563;
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

.center-input {
  text-align: center;
}

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
.w-product { width: 280px; }
.w-unit { width: 70px; }
.w-action { width: 90px; }

.cell-center {
  text-align: center;
}

.select-cell {
  width: 280px;
}

.number-cell {
  width: 110px;
  text-align: right;
}

.note-cell {
  width: 210px;
}

.formula-cell {
  color: #1f2937;
  font-weight: 600;
  background: #f8fafc;
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

.btn-add-row {
  padding: 6px 14px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
}

.btn-add-row:hover {
  background: #1d4ed8;
}

.btn-add-row-top {
  display: block;
  margin-left: auto;
  margin-bottom: 4px;
}

.btn-row-delete {
  padding: 6px 10px;
  background: #dc3545;
  color: #fff;
  font-size: 12px;
}

.btn-row-delete:hover {
  background: #c82333;
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

@media (max-width: 900px) {
  .detail-panel {
    max-width: 100%;
  }

  .detail-row {
    display: contents;
  }

  .detail-label {
    width: 100%;
    text-align: left;
    justify-content: flex-start;
    border-right: none;
  }

  .detail-value {
    width: 100%;
    padding: 6px 12px;
  }

  .wide-input,
  .remarks-textarea,
  .select-input {
    width: 100%;
  }
}
</style>
