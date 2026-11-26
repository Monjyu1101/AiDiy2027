// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import type { Router } from 'vue-router';

export function 画面遷移先(router: Router, value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '';
  // 全角の区切りは呼出元 URL 自体にだけ適用し、クエリ内の値はそのまま保持する。
  const target = raw.startsWith('／') ? raw.replace(/／/g, '/').replace(/？/g, '?').replace(/＆/g, '&').replace(/＝/g, '=') : raw;
  if (!target.startsWith('/') || target.startsWith('//') || target.split(/[?#]/, 1)[0].includes('\\')) return '';
  const resolved = router.resolve(target);
  return resolved.name && resolved.matched.length ? resolved.fullPath : '';
}

// プロジェクトパスや検索語を URL に含めず、編集中から一覧へ戻る場合だけ引き継ぐ。
export function 日誌検索状態(router: Router, 認証利用者ID?: string) {
  const state = router.options.history.state;
  const 所有者 = state.日誌検索所有者;
  const 値 = (value: unknown) => 認証利用者ID && 所有者 === 認証利用者ID && typeof value === 'string' ? value : '';
  return {
    日誌検索所有者: 認証利用者ID ?? '',
    日誌検索利用者: 値(state.日誌検索利用者),
    日誌検索プロジェクト: 値(state.日誌検索プロジェクト),
    日誌検索キーワード: 値(state.日誌検索キーワード),
  };
}
