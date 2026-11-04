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

type 生産明細Form = {
  明細SEQ: number
  払出商品ID: string
  計算分子数量: string
  計算分母数量: string
  最小ロット構成数量: string
  払出数量: string
  所要数量備考: string
  isUserAdded: boolean
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
const detailData = ref(null);
const 商品一覧 = ref([]);
const 生産工程一覧 = ref([]);
const 生産区分一覧 = ref([]);
const detailError = ref('');
const isLoading = ref(false);
const numberFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });
const 数値編集中 = reactive<Record<string, boolean>>({});
const 数値入力開始値 = reactive<Record<string, string>>({});

const form = reactive({
  生産伝票ID: '',
  生産開始日時: '',
  生産終了日時: '',
  生産区分ID: '',
  生産工程ID: '',
  段取分数: '',
  時間生産数量: '',
  生産時間: '',
  受入商品ID: '',
  最小ロット数量: '',
  受入数量: '',
  生産内容: '',
  生産備考: '',
  有効: true
});

const errors = reactive({
  生産開始日時: '',
  生産終了日時: '',
  受入商品ID: '',
  最小ロット数量: '',
  受入数量: '',
  生産区分ID: '',
  生産工程ID: '',
  段取分数: '',
  時間生産数量: '',
  生産時間: ''
});

const touched = reactive({
  生産開始日時: false,
  生産終了日時: false,
  受入商品ID: false,
  最小ロット数量: false,
  受入数量: false,
  生産区分ID: false,
  生産工程ID: false,
  段取分数: false,
  時間生産数量: false,
  生産時間: false
});

const 明細一覧 = ref<生産明細Form[]>([]);

// ==================================================
// 計算プロパティ
// ==================================================
const isCreateMode = computed(() => mode.value === 'create');
const isEditMode = computed(() => mode.value === 'edit');
const isViewMode = computed(() => mode.value === 'view');
const requiredFields = computed(() => ['生産開始日時', '生産終了日時', '受入商品ID', '最小ロット数量', '受入数量', '生産区分ID', '生産工程ID']);
type HeaderField = '生産開始日時' | '生産終了日時' | '受入商品ID' | '最小ロット数量' | '受入数量' | '生産区分ID' | '生産工程ID' | '段取分数' | '時間生産数量' | '生産時間';

const 表示用生産工程一覧 = computed(() => isCreateMode.value
  ? 生産工程一覧.value.filter((item: any) => item?.有効 !== false)
  : 生産工程一覧.value);
const 表示用生産区分一覧 = computed(() => isCreateMode.value
  ? 生産区分一覧.value.filter((item: any) => item?.有効 !== false)
  : 生産区分一覧.value);
const 表示用商品一覧 = computed(() => isCreateMode.value
  ? 商品一覧.value.filter((item: any) => item?.有効 !== false)
  : 商品一覧.value);

const 商品マップ = computed<Record<string, any>>(() => {
  const result: Record<string, any> = {};
  (商品一覧.value as any[]).forEach((item) => { result[item.商品ID] = item; });
  return result;
});

const 選択商品 = computed(() => 商品マップ.value[form.受入商品ID] || null);
const 商品名表示 = computed(() => 選択商品.value?.商品名 || '');
const 商品単位表示 = computed(() => 選択商品.value?.単位 || '');

// ==================================================
// ユーティリティ
// ==================================================
const showMessage = (text: string, type = 'success') => { void qMessage(text, type); };

const toNumber = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};
const formatNumber = (value: number) => value.toLocaleString('ja-JP', { maximumFractionDigits: 3 });
const get払出商品 = (商品ID: string) => 商品マップ.value[String(商品ID)] || null;
const normalizeNumericInput = (value: any) => String(value ?? '').replace(/,/g, '').trim();
const formatNumericDisplay = (value: any) => {
  const normalized = normalizeNumericInput(value);
  if (!normalized) return '';
  const num = Number(normalized);
  return Number.isFinite(num) ? numberFormatter.format(num) : normalized;
};
const formatHourDisplay = (value: any) => {
  const normalized = normalizeNumericInput(value);
  if (!normalized) return '';
  const num = Number(normalized);
  return Number.isFinite(num) ? num.toFixed(2) : normalized;
};
const clearNumericEditing = () => {
  Object.keys(数値編集中).forEach((key) => { delete 数値編集中[key]; });
  Object.keys(数値入力開始値).forEach((key) => { delete 数値入力開始値[key]; });
};
const isNumericEditing = (key: string) => Boolean(数値編集中[key]);
const setNumericValue = (target: Record<string, any>, field: string, value: any) => {
  target[field] = normalizeNumericInput(value);
};
const handleNumericFocus = async (key: string, target: Record<string, any>, field: string, event: FocusEvent) => {
  数値編集中[key] = true;
  setNumericValue(target, field, target[field]);
  数値入力開始値[key] = String(target[field] ?? '');
  await nextTick();
  const input = event.target as HTMLInputElement | null;
  input?.select();
};
const handleNumericInput = (
  target: Record<string, any>,
  field: string,
  event: Event,
  after?: () => void
) => {
  const input = event.target as HTMLInputElement | null;
  setNumericValue(target, field, input?.value ?? '');
  after?.();
};
const handleNumericBlur = (
  key: string,
  target: Record<string, any>,
  field: string,
  after?: (changed: boolean) => void
) => {
  setNumericValue(target, field, target[field]);
  const changed = String(target[field] ?? '') !== String(数値入力開始値[key] ?? '');
  delete 数値編集中[key];
  delete 数値入力開始値[key];
  after?.(changed);
};
const calcProductionHours = () => {
  const 受入数量 = toNumber(form.受入数量);
  const 時間生産数量 = toNumber(form.時間生産数量);
  if (受入数量 <= 0 || 時間生産数量 <= 0) return '';
  return String(Math.round((受入数量 / 時間生産数量) * 100) / 100);
};
const recalcProductionHours = () => {
  form.生産時間 = calcProductionHours();
};
const calcHourlyQuantity = () => {
  const 受入数量 = toNumber(form.受入数量);
  const 生産時間 = toNumber(form.生産時間);
  if (受入数量 <= 0 || 生産時間 <= 0) return '';
  return String(Math.round((受入数量 / 生産時間) * 100) / 100);
};
const recalcHourlyQuantity = () => {
  form.時間生産数量 = calcHourlyQuantity();
};

const calc最小ロット構成数量 = (row: 生産明細Form) => {
  const 受入 = toNumber(form.受入数量);
  const numerator = toNumber(row.計算分子数量);
  const denominator = toNumber(row.計算分母数量);
  if (!denominator) return 0;
  return Math.ceil(numerator / denominator * 受入);
};

const recalcRow = (row: 生産明細Form) => {
  const val = calc最小ロット構成数量(row);
  const str = val === 0 ? '' : String(val);
  if (row.isUserAdded) {
    // 追加行：計算値をそのままセット
    row.最小ロット構成数量 = str;
    row.払出数量 = str;
  } else {
    // 流し込み行：受入数量が最小ロット数量の整数倍なら最小ロット構成数量の整数倍を優先
    const 受入 = toNumber(form.受入数量);
    const 最小ロット = toNumber(form.最小ロット数量);
    const 最小ロット構成 = toNumber(row.最小ロット構成数量);
    if (最小ロット > 0 && 最小ロット構成 > 0) {
      const 倍数 = 受入 / 最小ロット;
      if (Number.isInteger(Math.round(倍数 * 1e9) / 1e9)) {
        row.払出数量 = String(最小ロット構成 * 倍数);
      } else {
        row.払出数量 = str;
      }
    } else {
      row.払出数量 = str;
    }
  }
};

const recalcAll = () => { 明細一覧.value.forEach(recalcRow); };

const createEmptyDetail = (明細SEQ = 1): 生産明細Form => ({
  明細SEQ,
  払出商品ID: '',
  計算分子数量: '',
  計算分母数量: '1000',
  最小ロット構成数量: '',
  払出数量: '',
  所要数量備考: '',
  isUserAdded: true
});

const renumberDetails = () => {
  clearNumericEditing();
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
  clearNumericEditing();
  form.生産伝票ID = '';
  form.生産開始日時 = '';
  form.生産終了日時 = '';
  form.生産区分ID = '';
  form.生産工程ID = '';
  form.段取分数 = '';
  form.時間生産数量 = '';
  form.生産時間 = '';
  form.受入商品ID = '';
  form.最小ロット数量 = '';
  form.受入数量 = '';
  form.生産内容 = '';
  form.生産備考 = '';
  form.有効 = true;
  明細一覧.value = [];
};

const applyDataToForm = async (data: any) => {
  isLoading.value = true;
  clearNumericEditing();
  form.生産伝票ID = data?.生産伝票ID || '';
  form.生産開始日時 = data?.生産開始日時 || '';
  form.生産終了日時 = data?.生産終了日時 || '';
  form.生産区分ID = data?.生産区分ID || '';
  form.生産工程ID = data?.生産工程ID || '';
  form.段取分数 = data?.段取分数 === null || data?.段取分数 === undefined ? '' : String(data.段取分数);
  form.時間生産数量 = data?.時間生産数量 === null || data?.時間生産数量 === undefined ? '' : String(data.時間生産数量);
  form.生産時間 = data?.生産時間 === null || data?.生産時間 === undefined ? '' : String(data.生産時間);
  form.受入商品ID = data?.受入商品ID || '';
  form.最小ロット数量 = data?.最小ロット数量 === null || data?.最小ロット数量 === undefined ? '' : String(data.最小ロット数量);
  form.受入数量 = data?.受入数量 === null || data?.受入数量 === undefined ? '' : String(data.受入数量);
  form.生産内容 = data?.生産内容 || '';
  form.生産備考 = data?.生産備考 || '';
  form.有効 = data?.有効 ?? true;
  明細一覧.value = Array.isArray(data?.明細一覧) && data.明細一覧.length
    ? data.明細一覧.map((item: any, index: number) => ({
        明細SEQ: Number(item?.明細SEQ ?? index + 1),
        払出商品ID: item?.払出商品ID || '',
        計算分子数量: item?.計算分子数量 === null || item?.計算分子数量 === undefined ? '' : String(item.計算分子数量),
        計算分母数量: item?.計算分母数量 === null || item?.計算分母数量 === undefined ? '1000' : String(item.計算分母数量),
        最小ロット構成数量: item?.最小ロット構成数量 !== null && item?.最小ロット構成数量 !== undefined ? String(item.最小ロット構成数量) : '',
        払出数量: item?.払出数量 !== null && item?.払出数量 !== undefined ? String(item.払出数量) : '',
        所要数量備考: item?.所要数量備考 || '',
        isUserAdded: false
      }))
    : [];
  renumberDetails();
  await nextTick();
  isLoading.value = false;
};

// ==================================================
// バリデーション
// ==================================================
const validateField = (field: HeaderField, showError = true) => {
  const value = String(form[field] ?? '').trim();
  if (!requiredFields.value.includes(field)) {
    if (field === '段取分数' && value) {
      const num = Number(value);
      if (!Number.isInteger(num) || num < 0) {
        errors[field] = showError ? '段取分数は0以上の整数を入力してください。' : 'ERROR';
        return false;
      }
    }
    if (field === '時間生産数量' && value && toNumber(value) <= 0) {
      errors[field] = showError ? '時間生産数量は0より大きい値を入力してください。' : 'ERROR';
      return false;
    }
    errors[field] = '';
    return true;
  }
  if (!value) { errors[field] = showError ? `${field}は必須です。` : 'ERROR'; return false; }
  if (field === '最小ロット数量' && toNumber(value) <= 0) {
    errors[field] = showError ? '最小ロット数量は0より大きい値を入力してください。' : 'ERROR';
    return false;
  }
  errors[field] = '';
  return true;
};

const handleBlur = (field: HeaderField) => { touched[field] = true; validateField(field); };
const handleInput = (field: HeaderField) => { if (touched[field]) validateField(field); };

const sanitizeDetails = () => {
  return 明細一覧.value
    .map((row, index) => ({
      明細SEQ: index + 1,
      払出商品ID: String(row.払出商品ID || '').trim(),
      計算分子数量: String(row.計算分子数量 || '').trim(),
      計算分母数量: String(row.計算分母数量 || '').trim(),
      最小ロット構成数量: String(row.最小ロット構成数量 || '').trim(),
      払出数量: String(row.払出数量 || '').trim(),
      所要数量備考: String(row.所要数量備考 || '').trim()
    }))
    .filter((row) => row.払出商品ID || row.計算分子数量 || row.最小ロット構成数量);
};

const validateDetails = () => {
  const rows = sanitizeDetails();
  if (!rows.length) return [];  // 明細なしは許可

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 1;
    if (!row.払出商品ID) { detailError.value = `${rowNo}行目の払出商品IDを選択してください。`; return null; }
    if (row.計算分子数量 && !row.計算分母数量) { detailError.value = `${rowNo}行目の計算分母数量を入力してください。`; return null; }
    if (row.計算分母数量 && toNumber(row.計算分母数量) <= 0) { detailError.value = `${rowNo}行目の計算分母数量は0より大きい値を入力してください。`; return null; }
  }

  detailError.value = '';
  return rows.map((row, index) => ({
    明細SEQ: index + 1,
    払出商品ID: row.払出商品ID,
    計算分子数量: row.計算分子数量 ? toNumber(row.計算分子数量) : null,
    計算分母数量: row.計算分母数量 ? toNumber(row.計算分母数量) : null,
    最小ロット構成数量: row.最小ロット構成数量 ? toNumber(row.最小ロット構成数量) : null,
    払出数量: row.払出数量 ? toNumber(row.払出数量) : null,
    所要数量備考: row.所要数量備考 || null
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
  if (!validateField('生産時間', false)) {
    isValid = false;
    if (!firstErrorField) firstErrorField = '生産時間';
  }

  if (form.生産開始日時 && form.生産終了日時 &&
      new Date(form.生産終了日時).getTime() < new Date(form.生産開始日時).getTime()) {
    errors.生産終了日時 = '終了日時は開始日時以降にしてください。';
    touched.生産終了日時 = true;
    isValid = false;
    if (!firstErrorField) firstErrorField = '生産終了日時';
  }

  if (firstErrorField) {
    const fieldMap: Record<string, string> = {
      '生産開始日時': 'form-start-datetime',
      '生産終了日時': 'form-end-datetime',
      '受入商品ID': 'form-product-id',
      '最小ロット数量': 'form-lot',
      '受入数量': 'form-receipt-qty',
      '生産区分ID': 'form-production-type',
      '生産工程ID': 'form-process-id',
      '段取分数': 'form-setup-minutes',
      '時間生産数量': 'form-hourly-qty',
      '生産時間': 'form-production-hours'
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
  detailError.value = '';
};

// ==================================================
// マスターデータ取得
// ==================================================
const loadMasterData = async () => {
  try {
    const [resProcess, resCategory, resProduct] = await Promise.all([
      apiClient.post('/apps/M生産工程/一覧'),
      apiClient.post('/apps/M生産区分/一覧'),
      apiClient.post('/apps/M商品/一覧')
    ]);
    if (resProcess.data.status === 'OK') {
      const data = resProcess.data.data;
      生産工程一覧.value = Array.isArray(data) ? data : data?.items ?? [];
    }
    if (resCategory.data.status === 'OK') {
      const data = resCategory.data.data;
      生産区分一覧.value = Array.isArray(data) ? data : data?.items ?? [];
    }
    if (resProduct.data.status === 'OK') {
      const data = resProduct.data.data;
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
    const res = await apiClient.post('/apps/T生産/取得', { 生産伝票ID: String(id) });
    if (res.data.status === 'OK' && res.data.data) {
      detailData.value = res.data.data;
      await applyDataToForm(res.data.data);
    } else {
      showMessage(res.data.message || '生産情報の取得に失敗しました。', 'error');
    }
  } catch (_e) {
    showMessage('生産情報の取得でエラーが発生しました。', 'error');
  }
};

// ==================================================
// ルーティング処理
// ==================================================
const formatLocalDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const applyQueryParams = async (query: any) => {
  resetValidation();
  activeTab.value = 'content';

  if (query.モード === '新規') {
    mode.value = 'create';
    detailData.value = null;
    resetForm();
    const today = new Date();
    const todayStr = formatLocalDate(today);
    form.生産開始日時 = `${todayStr}T08:00`;
    form.生産終了日時 = `${todayStr}T17:00`;
    const queryDate = normalizeQueryValue(query.生産開始日付);
    const queryStartDateTime = normalizeQueryValue(query.生産開始日時);
    const queryEndDateTime = normalizeQueryValue(query.生産終了日時);
    const queryProcessId = normalizeQueryValue(query.生産工程ID);
    if (queryDate) { form.生産開始日時 = `${String(queryDate)}T08:00`; form.生産終了日時 = `${String(queryDate)}T17:00`; }
    if (queryStartDateTime) form.生産開始日時 = String(queryStartDateTime);
    if (queryEndDateTime) form.生産終了日時 = String(queryEndDateTime);
    if (queryProcessId) form.生産工程ID = String(queryProcessId);
    return;
  }

  if (query.モード === '表示' && query.生産伝票ID) { mode.value = 'view'; await loadDetail(query.生産伝票ID); return; }
  if (query.生産伝票ID) { mode.value = 'edit'; await loadDetail(query.生産伝票ID); return; }

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

const handleSuccess = (messageText: string) => {
  if (pushReturnTarget(messageText)) return;
  router.push({ path: '/Tトラン/T生産/一覧', query: buildListQuery({ message: messageText, type: 'success' }) });
};
const backToList = () => {
  if (pushReturnTarget()) return;
  router.push({ path: '/Tトラン/T生産/一覧', query: buildListQuery() });
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
  if (!validateForm()) { showMessage('入力内容を確認してください。', 'error'); activeTab.value = 'content'; return; }

  const detailPayload = validateDetails();
  if (detailPayload === null) {
    showMessage(detailError.value || '明細の入力内容を確認してください。', 'error');
    activeTab.value = 'content';
    return;
  }

  const payload: any = {
    生産開始日時: form.生産開始日時,
    生産終了日時: form.生産終了日時,
    生産区分ID: form.生産区分ID || null,
    生産工程ID: form.生産工程ID,
    段取分数: form.段取分数 ? Math.trunc(Number(form.段取分数)) : null,
    時間生産数量: form.時間生産数量 ? toNumber(form.時間生産数量) : null,
    生産時間: calcProductionHours() ? Number(calcProductionHours()) : null,
    受入商品ID: form.受入商品ID || null,
    最小ロット数量: form.最小ロット数量 ? toNumber(form.最小ロット数量) : null,
    受入数量: form.受入数量 ? toNumber(form.受入数量) : null,
    生産内容: form.生産内容 || null,
    生産備考: form.生産備考 || null,
    有効: form.有効,
    明細一覧: detailPayload
  };

  try {
    let res;
    if (isCreateMode.value) {
      res = await apiClient.post('/apps/T生産/登録', payload);
    } else {
      res = await apiClient.post('/apps/T生産/変更', payload, { params: { 生産伝票ID: form.生産伝票ID } });
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
  if (!form.生産伝票ID) return;
  const confirmed = await qConfirm(`T生産「${form.生産伝票ID}」の有効をオフにしますか？`);
  if (!confirmed) return;
  try {
    const res = await apiClient.post('/apps/T生産/削除', { 生産伝票ID: form.生産伝票ID });
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
// M商品構成から自動取得
// ==================================================
const loadM商品構成 = async (受入商品ID: string) => {
  clearNumericEditing();
  if (!受入商品ID) {
    form.段取分数 = '';
    form.時間生産数量 = '';
    form.生産時間 = '';
    form.最小ロット数量 = '';
    form.受入数量 = '';
    form.生産区分ID = '';
    form.生産工程ID = '';
    form.生産備考 = '';
    明細一覧.value = [];
    return;
  }
  try {
    const res = await apiClient.post('/apps/M商品構成/取得', { 商品ID: 受入商品ID });
    if (res.data.status === 'OK' && res.data.data) {
      const data = res.data.data;
      form.最小ロット数量 = data.最小ロット数量 !== null && data.最小ロット数量 !== undefined ? String(data.最小ロット数量) : '';
      form.受入数量 = data.最小ロット数量 !== null && data.最小ロット数量 !== undefined ? String(data.最小ロット数量) : '';
      form.生産区分ID = data.生産区分ID || '';
      form.生産工程ID = data.生産工程ID || '';
      form.段取分数 = data.段取分数 !== null && data.段取分数 !== undefined ? String(data.段取分数) : '';
      form.時間生産数量 = data.時間生産数量 !== null && data.時間生産数量 !== undefined ? String(data.時間生産数量) : '';
      form.生産時間 = calcProductionHours();
      form.生産備考 = data.商品構成備考 || '';
      明細一覧.value = Array.isArray(data.明細一覧) && data.明細一覧.length
        ? data.明細一覧.map((item: any, index: number) => ({
            明細SEQ: index + 1,
            払出商品ID: item.構成商品ID || '',
            計算分子数量: item.計算分子数量 !== null && item.計算分子数量 !== undefined ? String(item.計算分子数量) : '',
            計算分母数量: item.計算分母数量 !== null && item.計算分母数量 !== undefined ? String(item.計算分母数量) : '1000',
            最小ロット構成数量: item.最小ロット構成数量 !== null && item.最小ロット構成数量 !== undefined ? String(item.最小ロット構成数量) : '',
            払出数量: item.最小ロット構成数量 !== null && item.最小ロット構成数量 !== undefined ? String(item.最小ロット構成数量) : '',
            所要数量備考: item.構成商品備考 || '',
            isUserAdded: false
          }))
        : [];
    }
  } catch (_e) {
    // 商品構成が未登録の場合はスキップ
  }
};

// ==================================================
// 初期化
// ==================================================
onMounted(async () => {
  await loadMasterData();
  await applyQueryParams(route.query);
});

watch(() => route.query, async (query) => { await applyQueryParams(query); });

watch(() => form.受入商品ID, async (newValue) => {
  if (isViewMode.value || isLoading.value) return;
  await loadM商品構成(newValue);
});
</script>

<template>
  <div class="page-container">
    <h2 class="page-title">
      <span class="title-text">【 T生産 】{{ isCreateMode ? '新規登録' : '編集' }}</span>
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

              <!-- 生産伝票ID -->
              <div v-if="!isCreateMode" class="detail-row row-id">
                <div class="detail-label">生産伝票ID</div>
                <div class="detail-value">
                  <input type="text" v-model="form.生産伝票ID" class="detail-input id-input center-input" readonly />
                </div>
              </div>

              <!-- 生産開始日時 -->
              <div class="detail-row row-datetime">
                <div class="detail-label">生産開始日時<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <input id="form-start-datetime" type="datetime-local" v-model="form.生産開始日時"
                        class="detail-input datetime-input" :class="{ 'input-error': errors.生産開始日時 }"
                        :readonly="isViewMode" @blur="handleBlur('生産開始日時')" @input="handleInput('生産開始日時')" />
                      <span v-if="errors.生産開始日時" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.生産開始日時 && errors.生産開始日時 !== 'ERROR'" class="field-error">{{ errors.生産開始日時 }}</div>
                  </div>
                </div>
              </div>

              <!-- 生産終了日時 -->
              <div class="detail-row row-datetime">
                <div class="detail-label">生産終了日時<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <input id="form-end-datetime" type="datetime-local" v-model="form.生産終了日時"
                        class="detail-input datetime-input" :class="{ 'input-error': errors.生産終了日時 }"
                        :readonly="isViewMode" @blur="handleBlur('生産終了日時')" @input="handleInput('生産終了日時')" />
                      <span v-if="errors.生産終了日時" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.生産終了日時 && errors.生産終了日時 !== 'ERROR'" class="field-error">{{ errors.生産終了日時 }}</div>
                  </div>
                </div>
              </div>

              <!-- 受入商品 -->
              <div class="detail-row row-select">
                <div class="detail-label">受入商品<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <select id="form-product-id" v-model="form.受入商品ID"
                        class="detail-input select-input" :class="{ 'input-error': errors.受入商品ID }"
                        :disabled="isViewMode" @blur="handleBlur('受入商品ID')" @change="handleInput('受入商品ID')">
                        <option value="">選択してください</option>
                        <option v-for="item in 表示用商品一覧" :key="item.商品ID" :value="item.商品ID">
                          {{ item.商品ID }} : {{ item.商品名 }}
                        </option>
                      </select>
                      <span v-if="errors.受入商品ID" class="input-alert">!</span>
                    </div>
                    <div v-if="errors.受入商品ID && errors.受入商品ID !== 'ERROR'" class="field-error">{{ errors.受入商品ID }}</div>
                  </div>
                </div>
              </div>

              <!-- 最小ロット数量 -->
              <div class="detail-row row-lot">
                <div class="detail-label">最小ロット数量<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                      <div class="lot-wrap">
                        <div class="input-wrap">
                        <input id="form-lot" type="text" :value="formatNumericDisplay(form.最小ロット数量)"
                          class="detail-input number-input" :class="{ 'input-error': errors.最小ロット数量 }"
                          :readonly="true" @blur="handleBlur('最小ロット数量')" />
                        <span v-if="errors.最小ロット数量" class="input-alert">!</span>
                      </div>
                      <span class="unit-text">{{ 商品単位表示 }}</span>
                    </div>
                    <div v-if="errors.最小ロット数量 && errors.最小ロット数量 !== 'ERROR'" class="field-error">{{ errors.最小ロット数量 }}</div>
                  </div>
                </div>
              </div>

              <!-- 受入数量 -->
              <div class="detail-row row-lot">
                <div class="detail-label">受入数量<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="lot-wrap">
                      <div class="input-wrap lot-input-wrap">
                        <input
                          id="form-receipt-qty"
                          :value="isNumericEditing('form-受入数量') ? form.受入数量 : formatNumericDisplay(form.受入数量)"
                          type="text"
                          inputmode="decimal"
                          class="detail-input number-input"
                          :class="{ 'input-error': errors.受入数量 }"
                          :readonly="isViewMode"
                          @focus="handleNumericFocus('form-受入数量', form, '受入数量', $event)"
                          @input="handleNumericInput(form, '受入数量', $event, () => { handleInput('受入数量'); recalcAll(); recalcProductionHours(); })"
                          @blur="handleNumericBlur('form-受入数量', form, '受入数量', (changed) => { handleBlur('受入数量'); recalcAll(); if (changed) recalcProductionHours(); })"
                        />
                        <span v-if="errors.受入数量" class="input-alert">!</span>
                      </div>
                      <span class="unit-text">{{ 商品単位表示 }}</span>
                    </div>
                    <div v-if="errors.受入数量 && errors.受入数量 !== 'ERROR'" class="field-error">{{ errors.受入数量 }}</div>
                  </div>
                </div>
              </div>

              <!-- 生産区分 -->
              <div class="detail-row row-select">
                <div class="detail-label">生産区分<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <select id="form-production-type" v-model="form.生産区分ID"
                        class="detail-input select-input" :class="{ 'input-error': errors.生産区分ID }"
                        :disabled="isViewMode" @blur="handleBlur('生産区分ID')" @change="handleInput('生産区分ID')">
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

              <!-- 生産工程 -->
              <div class="detail-row row-select">
                <div class="detail-label">生産工程<span class="required-mark">*</span></div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="input-wrap">
                      <select id="form-process-id" v-model="form.生産工程ID"
                        class="detail-input select-input" :class="{ 'input-error': errors.生産工程ID }"
                        :disabled="isViewMode" @blur="handleBlur('生産工程ID')" @change="handleInput('生産工程ID')">
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

              <div class="detail-row row-lot">
                <div class="detail-label">段取分数</div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="lot-wrap">
                      <div class="input-wrap lot-input-wrap">
                        <input
                          id="form-setup-minutes"
                          :value="isNumericEditing('form-段取分数') ? form.段取分数 : formatNumericDisplay(form.段取分数)"
                          type="text"
                          inputmode="numeric"
                          class="detail-input number-input"
                          :class="{ 'input-error': errors.段取分数 }"
                          :readonly="isViewMode"
                          @focus="handleNumericFocus('form-段取分数', form, '段取分数', $event)"
                          @input="handleNumericInput(form, '段取分数', $event, () => handleInput('段取分数'))"
                          @blur="handleNumericBlur('form-段取分数', form, '段取分数', () => handleBlur('段取分数'))"
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
                      <div class="input-wrap lot-input-wrap">
                        <input
                          id="form-hourly-qty"
                          :value="isNumericEditing('form-時間生産数量') ? form.時間生産数量 : formatNumericDisplay(form.時間生産数量)"
                          type="text"
                          inputmode="decimal"
                          class="detail-input number-input"
                          :class="{ 'input-error': errors.時間生産数量 }"
                          :readonly="isViewMode"
                          @focus="handleNumericFocus('form-時間生産数量', form, '時間生産数量', $event)"
                          @input="handleNumericInput(form, '時間生産数量', $event, () => { handleInput('時間生産数量'); recalcProductionHours(); })"
                          @blur="handleNumericBlur('form-時間生産数量', form, '時間生産数量', (changed) => { handleBlur('時間生産数量'); if (changed) recalcProductionHours(); })"
                        />
                        <span v-if="errors.時間生産数量" class="input-alert">!</span>
                      </div>
                      <span class="unit-text">{{ 商品単位表示 }}</span>
                    </div>
                    <div v-if="errors.時間生産数量 && errors.時間生産数量 !== 'ERROR'" class="field-error">{{ errors.時間生産数量 }}</div>
                  </div>
                </div>
              </div>

              <div class="detail-row row-number">
                <div class="detail-label">生産時間</div>
                <div class="detail-value">
                  <div class="value-column">
                    <div class="lot-wrap">
                      <div class="input-wrap lot-input-wrap">
                        <input
                          id="form-production-hours"
                          :value="isNumericEditing('form-生産時間') ? form.生産時間 : formatHourDisplay(form.生産時間)"
                          type="text"
                          inputmode="decimal"
                          class="detail-input number-input"
                          :class="{ 'input-error': errors.生産時間 }"
                          :readonly="isViewMode"
                          @focus="handleNumericFocus('form-生産時間', form, '生産時間', $event)"
                          @input="handleNumericInput(form, '生産時間', $event, () => { handleInput('生産時間'); recalcHourlyQuantity(); })"
                          @blur="handleNumericBlur('form-生産時間', form, '生産時間', (changed) => { handleBlur('生産時間'); if (changed) recalcHourlyQuantity(); })"
                        />
                        <span v-if="errors.生産時間" class="input-alert">!</span>
                      </div>
                      <span class="unit-text">ｈ</span>
                    </div>
                  </div>
                  <div v-if="errors.生産時間 && errors.生産時間 !== 'ERROR'" class="field-error">{{ errors.生産時間 }}</div>
                </div>
              </div>

              <!-- 生産内容 -->
              <div class="detail-row row-remarks">
                <div class="detail-label">生産内容</div>
                <div class="detail-value">
                  <textarea v-model="form.生産内容" class="detail-textarea remarks-textarea" rows="2" :readonly="isViewMode"></textarea>
                </div>
              </div>

              <!-- 生産備考 -->
              <div class="detail-row row-remarks">
                <div class="detail-label">生産備考</div>
                <div class="detail-value">
                  <textarea v-model="form.生産備考" class="detail-textarea remarks-textarea" rows="2" :readonly="isViewMode"></textarea>
                </div>
              </div>

              <!-- 明細テーブル（所要量計算） -->
              <div class="composition-block">
                <div class="composition-header">
                  <div class="composition-title">所要量計算</div>
                  <button v-if="!isViewMode" type="button" class="btn btn-add-row" @click="addDetailRow">行追加</button>
                </div>

                <div class="composition-table-wrap">
                  <table class="composition-table">
                    <thead>
                      <tr>
                        <th class="w-seq">SEQ</th>
                        <th class="w-product">払出商品</th>
                        <th class="w-ratio">計算分子数量</th>
                        <th class="w-ratio">計算分母数量</th>
                        <th class="w-result">計算式(参考:切上整数)</th>
                        <th class="w-qty">最小ロット構成数量</th>
                        <th class="w-qty">払出数量</th>
                        <th class="w-unit">単位</th>
                        <th class="w-note">所要量備考</th>
                        <th v-if="!isViewMode" class="w-action">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="明細一覧.length === 0">
                        <td :colspan="isViewMode ? 9 : 10" class="cell-center no-data">明細なし</td>
                      </tr>
                      <tr v-for="(row, index) in 明細一覧" :key="`detail-${index}`">
                        <td class="cell-center">{{ row.明細SEQ }}</td>
                        <td>
                          <select v-model="row.払出商品ID" class="table-input select-cell" :disabled="isViewMode || !row.isUserAdded">
                            <option value="">選択</option>
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
                            :readonly="isViewMode || !row.isUserAdded"
                            @focus="handleNumericFocus(`detail-${row.明細SEQ}-計算分子数量`, row, '計算分子数量', $event)"
                            @input="handleNumericInput(row, '計算分子数量', $event, () => recalcRow(row))"
                            @blur="handleNumericBlur(`detail-${row.明細SEQ}-計算分子数量`, row, '計算分子数量', () => recalcRow(row))"
                          />
                        </td>
                        <td>
                          <input
                            :value="isNumericEditing(`detail-${row.明細SEQ}-計算分母数量`) ? row.計算分母数量 : formatNumericDisplay(row.計算分母数量)"
                            type="text"
                            inputmode="decimal"
                            class="table-input number-cell"
                            :readonly="isViewMode || !row.isUserAdded"
                            @focus="handleNumericFocus(`detail-${row.明細SEQ}-計算分母数量`, row, '計算分母数量', $event)"
                            @input="handleNumericInput(row, '計算分母数量', $event, () => recalcRow(row))"
                            @blur="handleNumericBlur(`detail-${row.明細SEQ}-計算分母数量`, row, '計算分母数量', () => recalcRow(row))"
                          />
                        </td>
                        <td class="formula-cell">
                          {{ row.計算分子数量 || '0' }} / {{ row.計算分母数量 || '0' }} × {{ form.受入数量 || '0' }} = {{ calc最小ロット構成数量(row) }}
                        </td>
                        <td>
                          <input
                            :value="isNumericEditing(`detail-${row.明細SEQ}-最小ロット構成数量`) ? row.最小ロット構成数量 : formatNumericDisplay(row.最小ロット構成数量)"
                            type="text"
                            inputmode="decimal"
                            class="table-input number-cell"
                            :readonly="isViewMode || !row.isUserAdded"
                            @focus="handleNumericFocus(`detail-${row.明細SEQ}-最小ロット構成数量`, row, '最小ロット構成数量', $event)"
                            @input="handleNumericInput(row, '最小ロット構成数量', $event)"
                            @blur="handleNumericBlur(`detail-${row.明細SEQ}-最小ロット構成数量`, row, '最小ロット構成数量')"
                          />
                        </td>
                        <td>
                          <input
                            :value="isNumericEditing(`detail-${row.明細SEQ}-払出数量`) ? row.払出数量 : formatNumericDisplay(row.払出数量)"
                            type="text"
                            inputmode="decimal"
                            class="table-input number-cell"
                            :readonly="isViewMode"
                            @focus="handleNumericFocus(`detail-${row.明細SEQ}-払出数量`, row, '払出数量', $event)"
                            @input="handleNumericInput(row, '払出数量', $event)"
                            @blur="handleNumericBlur(`detail-${row.明細SEQ}-払出数量`, row, '払出数量')"
                          />
                        </td>
                        <td class="cell-center">{{ get払出商品(row.払出商品ID)?.単位 || '' }}</td>
                        <td>
                          <input v-model="row.所要数量備考" type="text" class="table-input note-cell" :readonly="isViewMode" />
                        </td>
                        <td v-if="!isViewMode && row.isUserAdded" class="cell-center">
                          <button type="button" class="btn btn-row-delete" @click="removeDetailRow(index)">削除</button>
                        </td>
                        <td v-else-if="!isViewMode" class="cell-center"></td>
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
                <div class="detail-value"><input type="text" :value="detailData?.登録日時 || ''" class="detail-input w-2x center-input" readonly /></div>
              </div>
              <div class="detail-row row-user">
                <div class="detail-label">登録利用者</div>
                <div class="detail-value"><input type="text" :value="detailData?.登録利用者名 || ''" class="detail-input w-2x center-input" readonly /></div>
              </div>
              <div class="detail-row row-terminal">
                <div class="detail-label">登録端末</div>
                <div class="detail-value"><input type="text" :value="detailData?.登録端末ID || ''" class="detail-input w-2x center-input" readonly /></div>
              </div>
              <div class="detail-row row-datetime">
                <div class="detail-label">更新日時</div>
                <div class="detail-value"><input type="text" :value="detailData?.更新日時 || ''" class="detail-input w-2x center-input" readonly /></div>
              </div>
              <div class="detail-row row-user">
                <div class="detail-label">更新利用者</div>
                <div class="detail-value"><input type="text" :value="detailData?.更新利用者名 || ''" class="detail-input w-2x center-input" readonly /></div>
              </div>
              <div class="detail-row row-terminal">
                <div class="detail-label">更新端末</div>
                <div class="detail-value"><input type="text" :value="detailData?.更新端末ID || ''" class="detail-input w-2x center-input" readonly /></div>
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
.detail-row.row-datetime,
.detail-row.row-select,
.detail-row.row-name,
.detail-row.row-lot,
.detail-row.row-number,
.detail-row.row-remarks,
.detail-row.row-valid,
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
.row-datetime .detail-value,
.row-select .detail-value,
.row-name .detail-value,
.row-lot .detail-value,
.row-number .detail-value,
.row-remarks .detail-value,
.row-valid .detail-value,
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

.id-input { width: 160px; text-align: center; }
.datetime-input { width: 320px; text-align: center; }
.select-input { width: 320px; padding-right: 8px; }
.wide-input { width: 320px; }
.number-input { width: 160px; text-align: right; }

.lot-wrap {
  display: flex;
  align-items: center;
  width: 160px;
  gap: 0;
}
.lot-input-wrap { width: 100px; }
.lot-wrap .number-input {
  width: 100%;
  min-width: 0;
}
.unit-text {
  width: 60px;
  min-width: 60px;
  font-weight: 600;
  color: #4b5563;
  text-align: center;
}

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
.w-unit { width: 60px; }
.w-action { width: 70px; }

.cell-center { text-align: center; }
.no-data { color: #888; padding: 16px; }

.w-product { width: 220px; }
.select-cell { width: 220px; }
.number-cell { width: 110px; text-align: right; }
.note-cell { width: 170px; }

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

.btn-add-row-top {
  display: block;
  margin-left: auto;
  margin-bottom: 4px;
}

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
</style>
