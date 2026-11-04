/*! COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 */

export const DRAFT_LIMITS = Object.freeze({ code: 200000, live: 20000 });
export const DRAFT_HANDOFF_LIMIT = 200000;
const bounded = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !value.includes('\0');

// 既存の下書きを切り詰めたり置き換えたりしない。上限を超える場合は全体を拒否する。
export function appendDraft(current, text, kind) {
  const limit = DRAFT_LIMITS[kind];
  if (!limit || typeof current !== 'string' || !bounded(text, limit) || !text.trim()) return { ok: false, error: '下書きに追加する内容が不正、または長すぎます。' };
  const draft = current + (current ? '\n\n' : '') + text;
  if (draft.length > limit) return { ok: false, error: `既存の下書きと合わせて${limit.toLocaleString('ja-JP')}文字以内にしてください。` };
  return { ok: true, draft };
}

// Webはコンポーネント参照から、Electronは限定されたpreloadのIPCから同じ受信処理を使う。
// window.postMessage / BroadcastChannel / localStorageを使わず、他のタブへ内容を公開しない。
export function createDraftReceiver({ kind, project, scope, ready, draft, setDraft, focus, label = () => '', api, uuid = () => crypto.randomUUID(), now = () => Date.now() }) {
  if (!Object.hasOwn(DRAFT_LIMITS, kind)) throw Error('下書きの対象が不正です。');
  let mounted = false, disposed = false, previous = '', contextId = '', unsubscribe, published = '';
  const received = new Map();
  function target() {
    const path = project(), currentScope = scope();
    if (!mounted || disposed || !ready() || !bounded(path, 4096) || !bounded(currentScope, 1024)) { previous = ''; return null; }
    const identity = JSON.stringify([path, currentScope]);
    if (identity !== previous) { previous = identity; contextId = uuid(); }
    return { kind, contextId, projectPath: path, label: String(label() || '').slice(0, 200), maxLength: DRAFT_LIMITS[kind] };
  }
  function insert(data) {
    const current = target();
    if (!current || !data || data.contextId !== current.contextId || data.projectPath !== current.projectPath) return { ok: false, error: '選んだ画面や会話が変わりました。渡し先を選び直してください。' };
    if (data.expiresAt !== undefined && (!Number.isFinite(data.expiresAt) || data.expiresAt <= now())) return { ok: false, error: '下書きの受け渡しが期限切れになりました。' };
    if (data.requestId !== undefined && !bounded(data.requestId, 128)) return { ok: false, error: '受け渡しの識別子が不正です。' };
    // 遅延した同じIPCを再配送しても、下書きには一度だけ追加する。
    for (const [id, time] of received) if (time < now() - 60000) received.delete(id);
    if (data.requestId && received.has(data.requestId)) return { ok: true };
    const result = appendDraft(draft(), data.text, kind);
    if (!result.ok) return result;
    setDraft(result.draft);
    if (data.requestId) { received.set(data.requestId, now()); if (received.size > 100) received.delete(received.keys().next().value); }
    try { void Promise.resolve(focus()).catch(() => {}); } catch { /* 追加済みの下書きはフォーカス失敗で再追加させない。 */ }
    return { ok: true };
  }
  function publish() {
    if (!mounted || disposed) return;
    const current = target(), value = JSON.stringify(current);
    if (value === published) return;
    published = value;
    // 起動直後の購読登録と状態通知は、preloadから同一IPC順序で届く。
    void api?.registerDraftTarget?.(current)?.catch(() => {});
  }
  return {
    target, insert, publish,
    mount() { if (mounted || disposed) return; mounted = true; unsubscribe = api?.onDraftHandoff?.(insert); publish(); },
    dispose() { if (disposed) return; disposed = true; unsubscribe?.(); void api?.registerDraftTarget?.(null)?.catch(() => {}); received.clear(); },
  };
}
