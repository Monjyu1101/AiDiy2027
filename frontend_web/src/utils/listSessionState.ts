// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';
import { computed, ref } from 'vue';

export type ListSessionState = Record<string, any>;

export interface ReturnMessage {
  message: string;
  type?: string;
}

const STORAGE_PREFIX = 'AiDiy:list:';

const normalizeQueryValue = (value: any): string => {
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized == null ? '' : String(normalized);
};

// URLを sessionStorage のキーや保存値として扱う際、'/' '?' '&' '=' を全角化して
// 1本の安全な文字列にする（URLをクエリ値へ埋め込むときの変換と揃える）。
const toFullwidthUrl = (value: string): string =>
  value.replace(/\//g, '／').replace(/\?/g, '？').replace(/&/g, '＆').replace(/=/g, '＝');

const storageKeyForPath = (path: string) => `${STORAGE_PREFIX}${toFullwidthUrl(path)}`;
const storageKey = (route: RouteLocationNormalizedLoaded) => storageKeyForPath(route.path);

const loadStoredData = (key: string): ListSessionState | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const saveStoredData = (key: string, data: ListSessionState) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {
    // sessionStorage が使えない環境では、画面遷移だけ継続する。
  }
};

export const clearListSessionState = (route: RouteLocationNormalizedLoaded) => {
  try {
    sessionStorage.removeItem(storageKey(route));
  } catch {
    // sessionStorage が使えない環境では何もしない。
  }
};

export const buildCurrentReturnUrl = (
  route: RouteLocationNormalizedLoaded,
  router: Router
) => {
  const query = { ...route.query };
  delete query.message;
  delete query.type;
  delete query.URLメニュー;
  delete query.URL戻り先;
  return router.resolve({ path: route.path, query }).fullPath;
};

// 編集画面が URL戻り先/URLメニュー のクエリ無しURLへ戻る際、通常のクエリ経由の
// message/type ではメッセージを運べないため、一覧側の遷移先パスと同じキーに
// message/type を書き込み、ワンショットで引き継ぐ。
export const saveReturnMessage = (targetUrl: string, message: string, type?: string) => {
  try {
    const key = storageKeyForPath(targetUrl.split('?')[0]);
    const current = loadStoredData(key) ?? {};
    saveStoredData(key, { ...current, message, type });
  } catch {
    // sessionStorage が使えない環境では、メッセージ表示だけ諦めて遷移は継続する。
  }
};

export const consumeReturnMessage = (route: RouteLocationNormalizedLoaded): ReturnMessage | null => {
  try {
    const key = storageKey(route);
    const current = loadStoredData(key);
    if (!current || typeof current.message !== 'string') return null;
    const { message, type, ...rest } = current;
    if (Object.keys(rest).length > 0) {
      saveStoredData(key, rest);
    } else {
      sessionStorage.removeItem(key);
    }
    return { message, type };
  } catch {
    return null;
  }
};

export interface UseListSessionStateOptions {
  getState?: () => ListSessionState;
  applyState?: (state: ListSessionState) => void;
}

export const useListSessionState = (
  route: RouteLocationNormalizedLoaded,
  router: Router,
  options: UseListSessionStateOptions = {}
) => {
  const key = storageKey(route);
  const stored = ref<ListSessionState | null>(loadStoredData(key));

  const routeURLメニュー = computed(() => normalizeQueryValue(route.query.URLメニュー));
  const routeURL戻り先 = computed(() => normalizeQueryValue(route.query.URL戻り先));

  const URLメニュー = computed(() => routeURLメニュー.value || stored.value?.URLメニュー || '');
  const URL戻り先 = computed(() => routeURL戻り先.value || stored.value?.URL戻り先 || '');
  const 現在URL戻り先 = computed(() => buildCurrentReturnUrl(route, router));

  const buildPatch = (): ListSessionState => ({
    ...(options.getState?.() ?? {}),
    URLメニュー: URLメニュー.value || undefined,
    URL戻り先: URL戻り先.value || undefined
  });

  const save = () => {
    const current = loadStoredData(key) ?? {};
    const next = { ...current, ...buildPatch() };
    stored.value = next;
    saveStoredData(key, next);
  };

  const resetOrRestore = () => {
    if (routeURLメニュー.value) {
      const next: ListSessionState = {
        URLメニュー: routeURLメニュー.value,
        URL戻り先: routeURL戻り先.value || undefined,
        ...(options.getState?.() ?? {})
      };
      stored.value = next;
      saveStoredData(key, next);
      return;
    }

    const saved = loadStoredData(key);
    if (!saved) return;
    stored.value = saved;
    options.applyState?.(saved);
  };

  return {
    URLメニュー,
    URL戻り先,
    現在URL戻り先,
    saveListSession: save,
    resetOrRestoreListSession: resetOrRestore
  };
};
