// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { 演出初期化, 到着表示, 即時表示, 枠飛行, 入力枠作成, 受信通知作成 } from '../../../host/src/arrival-effect';

// Vue の描画後に旧 Code / Live 共通の演出を実行する。会話切替・破棄で全て解除する。
export function chatArrival(scroll, notificationHost = row => row.ownerDocument.body) {
  let inputStop, answerStop, reservation, activeAnswer, ownerDocument;
  const answers = [];
  function nextAnswer() {
    if (activeAnswer) return;
    while (answers.length) {
      const item = answers.shift();
      if (item.row.isConnected && !item.row.ownerDocument.hidden) { startAnswer(item.row, item.text, item.type); return; }
      即時表示(item.row);
    }
  }
  function stopAnswers() {
    for (const item of answers.splice(0)) 即時表示(item.row);
    answerStop?.();
  }
  function input(row, origin, text) {
    inputStop?.();
    row.classList.add('arrival-pending');
    const frame = 入力枠作成(text, row.ownerDocument);
    const cancel = 枠飛行(frame, origin, () => row.querySelector('.content') || row, () => {
      inputStop = undefined; 到着表示(row);
    });
    inputStop = () => { cancel?.(); frame.remove(); 即時表示(row); inputStop = undefined; };
  }
  function answer(row, text, type) {
    if (activeAnswer?.row === row) {
      if (activeAnswer.text === text && activeAnswer.type === type) return;
      // 同じ発言の本文が更新された場合は、最新の全文表示から3秒を数え直す。
      answerStop?.(); startAnswer(row, text, type); return;
    }
    const queued = answers.find(item => item.row === row);
    if (queued) { queued.text = text; queued.type = type; return; }
    row.classList.add('arrival-waiting');
    answers.push({ row, text, type }); nextAnswer();
  }
  function startAnswer(row, text, type) {
    activeAnswer = { row, text, type };
    row.classList.add('arrival-waiting');
    const host = notificationHost(row);
    if (!host || host.ownerDocument !== row.ownerDocument) { activeAnswer = undefined; 即時表示(row); nextAnswer(); return; }
    const { popup, body } = 受信通知作成(type, host), win = row.ownerDocument.defaultView;
    let timer, cancel, stopped = false;
    const color = type === 'output_request' ? '#00ffff' : type === 'recognition_output' ? '#9ae6b4' : '#00ff00';
    const finish = reveal => {
      if (stopped) return;
      stopped = true; win.clearTimeout(timer); effect.停止(); cancel?.(); popup.remove();
      if (answerStop === stop) { answerStop = undefined; activeAnswer = undefined; }
      (reveal ? 到着表示 : 即時表示)(row); scroll();
      if (reveal) nextAnswer();
    };
    const stop = () => finish(false);
    const land = () => {
      if (stopped) return;
      row.classList.remove('arrival-waiting'); row.classList.add('arrival-pending'); scroll();
      cancel = 枠飛行(popup, popup.getBoundingClientRect(), () => row.querySelector('.content') || row, () => finish(true));
    };
    const effect = 演出初期化(body, {
      カーソル色: color, isStream: false,
      表示更新: () => { body.scrollTop = body.scrollHeight; },
      完了: () => { if (!stopped) timer = win.setTimeout(land, 3000); },
    });
    answerStop = stop; effect.追加(text, true);
  }
  const hidden = () => { if (ownerDocument?.hidden) { inputStop?.(); stopAnswers(); } };
  function own(doc) {
    if (doc === ownerDocument) return;
    inputStop?.(); stopAnswers(); ownerDocument?.removeEventListener('visibilitychange', hidden);
    ownerDocument = doc; ownerDocument.addEventListener('visibilitychange', hidden);
  }
  return {
    reserve(element, text, count = 0) { own(element.ownerDocument); reservation = { origin: element.getBoundingClientRect(), doc: element.ownerDocument, text: text.trim(), count, until: Date.now() + 15000 }; },
    cancelReservation() { reservation = undefined; },
    show(row, role, text, type = '', index = 0) {
      if (!row || !row.isConnected) return;
      own(row.ownerDocument);
      if (row.ownerDocument.hidden) return;
      if (role === 'user' && reservation?.doc === row.ownerDocument && Date.now() <= reservation.until && index >= reservation.count && text.trim() === reservation.text && (!type || type === 'input_text')) {
        const saved = reservation; reservation = undefined; input(row, saved.origin, text);
      } else if (role === 'assistant') answer(row, text, type);
      scroll();
    },
    reset() { reservation = undefined; inputStop?.(); stopAnswers(); },
    dispose() { this.reset(); ownerDocument?.removeEventListener('visibilitychange', hidden); },
  };
}
