/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

// 発言の登場演出（AiDiy Code / AiDiy Live 共通）。
// 発言は透明のまま通常どおり配置して場所を確保し、そこへ枠を飛ばしてから白い光とぼかしで浮かび上がらせる。
// ユーザー発言は送信した入力枠、AI回答は画面中央の受信通知（ターミナル演出）を飛ばす。
// OS の「動きを減らす」設定には従わず、Windows / macOS / Linux で同じ演出にする。
// 見た目のクラス（.input-flight / .answer-popup / arrival-waiting / arrival-pending / arrival-reveal）は
// Code / Live 共通の Vue 画面の frontend_ide/src/components/共通表示/会話表示.css に定義する。

// ターミナル演出。frontend_web の AIコード.vue（演出初期化 / 演出キュー追加 / 演出実行 / 速度設定）と同じ実装。
// 文字列をキューに積み、ストリームは2msごとに max(8, floor(文字数 / 12) + 2) 文字、通常メッセージは10msごとに
// floor(文字数 / 50) + 1 文字ずつ追記する（長いほど速く流れる）。開始前の待機はストリーム30ms・通常500ms、
// カーソルは0.3秒ごとに明滅させ、キューを流し切った完了時に外す。
export type ターミナル演出 = { 追加: (文字列: string, finalize?: boolean) => void; 停止: () => void };
export const 速度設定 = (文字数: number, isStream: boolean) => isStream
  ? { interval: 2, batch: Math.max(8, Math.floor(文字数 / 12) + 2) }
  : { interval: 10, batch: Math.floor(文字数 / 50) + 1 };
export const 演出初期化 = (表示領域: HTMLElement, options: {
  カーソル色: string; isStream: boolean; 初期文字列?: string; 表示更新?: () => void; 完了?: () => void;
}): ターミナル演出 => {
  const doc = 表示領域.ownerDocument, win = doc.defaultView!;
  const textSpan = doc.createElement('span'); textSpan.className = 'terminal-text'; textSpan.textContent = options.初期文字列 ?? '';
  const cursorSpan = doc.createElement('span'); cursorSpan.className = 'terminal-cursor'; cursorSpan.textContent = ' ';
  Object.assign(cursorSpan.style, { display: 'inline-block', width: '8px', backgroundColor: options.カーソル色, color: '#000000' });
  表示領域.replaceChildren(textSpan, cursorSpan);
  let blinkVisible = true;
  const blinkInterval = win.setInterval(() => {
    cursorSpan.style.backgroundColor = blinkVisible ? 'transparent' : options.カーソル色;
    blinkVisible = !blinkVisible;
  }, 300);
  const queue: string[] = [];
  let running = false, ready = false, finalizeOnEmpty = false, stopped = false;
  let timer: number | undefined;
  const 表示更新 = () => options.表示更新?.();
  const 停止 = () => { stopped = true; win.clearTimeout(timer); win.clearInterval(blinkInterval); cursorSpan.remove(); };
  const 演出実行 = () => {
    if (stopped || running || !ready) return;
    if (!queue.length) {
      if (finalizeOnEmpty) { 停止(); 表示更新(); options.完了?.(); }
      return;
    }
    running = true;
    const chunk = queue.shift() ?? '';
    const { interval, batch } = 速度設定(chunk.length, options.isStream);
    let index = 0;
    const tick = () => {
      if (stopped) return;
      const end = Math.min(index + batch, chunk.length);
      if (end > index) { textSpan.textContent += chunk.slice(index, end); index = end; 表示更新(); }
      if (index >= chunk.length) { running = false; 演出実行(); return; }
      timer = win.setTimeout(tick, interval);
    };
    tick();
  };
  timer = win.setTimeout(() => { ready = true; 演出実行(); }, options.isStream ? 30 : 500);
  表示更新();
  return {
    追加: (文字列, finalize = false) => { if (文字列) queue.push(文字列); if (finalize) finalizeOnEmpty = true; 演出実行(); },
    停止,
  };
};

/** 場所を確保していた発言を、白い光とぼかしから浮かび上がらせる。 */
export const 到着表示 = (target?: HTMLElement) => {
  if (!target) return;
  target.classList.remove('arrival-waiting');
  target.classList.remove('arrival-pending');
  target.classList.add('arrival-reveal');
  target.addEventListener('animationend', () => target.classList.remove('arrival-reveal'), { once: true });
};
/** 演出を省いてすぐに表示する（次の発言の到着や切断など）。 */
export const 即時表示 = (target?: HTMLElement) => {
  target?.classList.remove('arrival-waiting');
  target?.classList.remove('arrival-pending');
};

/** 枠を起点から到着先（場所を確保した発言の表示枠）へ飛ばす。飛び終えたら枠を外して 完了 を呼ぶ。 */
export const 枠飛行 = (frame: HTMLElement, 起点: DOMRect, 到着先: () => HTMLElement | null | undefined, 完了: () => void) => {
  const doc = frame.ownerDocument, win = doc.defaultView!;
  let 終了済み = false;
  let firstFrame = 0, secondFrame = 0;
  let flight: Animation | undefined;
  const 取消 = () => { 終了済み = true; win.clearTimeout(安全期限); win.cancelAnimationFrame(firstFrame); win.cancelAnimationFrame(secondFrame); flight?.cancel(); frame.remove(); };
  const 終了 = () => { if (終了済み) return; 終了済み = true; win.clearTimeout(安全期限); frame.remove(); 完了(); };
  // 画面が裏にあると描画更新が止まるため、演出せずに表示する。止まっても発言を透明のまま残さない。
  const 安全期限 = win.setTimeout(終了, 1500);
  if (doc.hidden) { 終了(); return 取消; }
  firstFrame = win.requestAnimationFrame(() => { secondFrame = win.requestAnimationFrame(() => {
    if (終了済み) return;
    const target = 到着先(), goal = frame.ownerDocument === doc && target?.ownerDocument === doc ? target.getBoundingClientRect?.() : undefined;
    if (!goal || !goal.width || !goal.height || !起点.width) { 終了(); return; }
    // パネル内通知は飛行中も同じ領域内に置き、IDEの別領域へはみ出さない。
    const local = frame.classList.contains('answer-popup-local') ? frame.parentElement : null;
    const bounds = local?.getBoundingClientRect();
    const box = (rect: DOMRect) => ({ left: `${rect.left - (bounds?.left ?? 0) + (local?.scrollLeft ?? 0) - (local?.clientLeft ?? 0)}px`, top: `${rect.top - (bounds?.top ?? 0) + (local?.scrollTop ?? 0) - (local?.clientTop ?? 0)}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    // 中央寄せなどの配置を外し、現在の位置・大きさから飛ばす。
    Object.assign(frame.style, { position: local ? 'absolute' : 'fixed', inset: 'auto', margin: '0', transform: 'none', maxHeight: 'none', ...box(起点) });
    if (!frame.isConnected) doc.body.append(frame);
    flight = frame.animate([
      { ...box(起点), opacity: 1 },
      { ...box(goal), opacity: 1, offset: .8 },
      { ...box(goal), opacity: 0 },
    ], { duration: 560, easing: 'cubic-bezier(.6, 0, .2, 1)', fill: 'forwards' });
    (frame.firstElementChild as HTMLElement | null)?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
    flight.finished.then(終了, () => {});
  }); });
  return 取消;
};

/** 送信した入力欄を模した、飛ばすための枠。 */
export const 入力枠作成 = (本文: string, doc: Document = document) => {
  const frame = doc.createElement('div'); frame.className = 'input-flight'; frame.setAttribute('aria-hidden', 'true');
  const text = doc.createElement('span'); text.textContent = 本文; frame.append(text);
  return frame;
};

/** 受信元の画面またはCode領域へ通知する。移動した別窓から元IDEのbodyへ戻さない。 */
export const 受信通知作成 = (種別 = '', host: HTMLElement = document.body) => {
  const doc = host.ownerDocument;
  const popup = doc.createElement('div'); popup.className = `answer-popup${host !== doc.body ? ' answer-popup-local' : ''}${種別 ? ` ${種別}` : ''}`; popup.setAttribute('aria-hidden', 'true');
  const body = doc.createElement('div'); body.className = 'answer-popup-text';
  popup.append(body); host.append(popup);
  return { popup, body };
};
