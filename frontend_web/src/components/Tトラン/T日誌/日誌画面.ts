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
