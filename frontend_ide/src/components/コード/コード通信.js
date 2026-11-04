// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export function codeTransport({ host = false, base = '', api } = {}, receive) {
  let events, disposed = false, draft = '';
  const uploads = new Map();
  const fileRequests = new Set();
  function cancelFiles(message = '接続または会話が変わったため送信確認を中断しました。Coreで受信済みのファイルは取り消されません。') {
    for (const upload of uploads.values()) { clearTimeout(upload.timer); upload.reject(new Error(message)); }
    uploads.clear();
    for (const controller of fileRequests) controller.abort(); fileRequests.clear();
  }
  const vscode = host ? api || window.acquireVsCodeApi() : null;
  const listener = event => {
    if (!event.data || disposed) return;
    const packet = event.data;
    if (packet.type === 'fileUploadResult') {
      const upload = uploads.get(packet.requestId);
      if (!upload) return;
      uploads.delete(packet.requestId); clearTimeout(upload.timer);
      if (packet.ok === true) upload.resolve();
      else upload.reject(new Error(packet.message || 'ファイルを送信できません。'));
      return;
    }
    receive(packet);
  };
  async function request(route, data, file = false) {
    const controller = file ? new AbortController() : undefined;
    let timer;
    if (controller) { fileRequests.add(controller); timer = setTimeout(() => controller.abort(), 30000); }
    try {
      const response = await fetch(new URL(route, new URL(base, location.href)), data === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), ...(controller ? { signal: controller.signal } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error || '接続できません。'), { status: response.status });
      return result;
    } catch (error) {
      if (controller?.signal.aborted) throw new Error('ファイルの送信確認がありません。会話欄を確認してから選び直してください。');
      throw error;
    } finally { if (controller) { clearTimeout(timer); fileRequests.delete(controller); } }
  }
  return {
    draft: () => vscode?.getState()?.下書き || draft,
    saveDraft(text) { draft = text; vscode?.setState({ 下書き: text }); },
    async start() {
      if (host) { window.addEventListener('message', listener); vscode.postMessage({ type: 'ready' }); }
      else {
        events = new EventSource(new URL('events', new URL(base, location.href)));
        events.onmessage = event => { if (!disposed) receive(JSON.parse(event.data)); };
        events.onerror = () => receive({ type: 'transportError', message: '画面との接続が切れました。再接続しています…' });
      }
    },
    async send(message) {
      if (disposed) return;
      if (host) {
        if (message.type !== 'sendFile') { vscode.postMessage(message); return; }
        const requestId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { uploads.delete(requestId); reject(new Error('ファイルの送信確認がありません。会話欄を確認してから選び直してください。')); }, 30000);
          uploads.set(requestId, { resolve, reject, timer });
          try { vscode.postMessage({ ...message, requestId }); }
          catch (error) { clearTimeout(timer); uploads.delete(requestId); reject(error); }
        });
      }
      if (message.type === 'chooseModel') {
        const result = await request(`catalog?provider=${encodeURIComponent(message.provider || '')}`);
        receive({ type: 'modelCatalog', provider: message.provider || '', items: message.provider ? result.models : result.providers });
      } else {
        await request('message', message.type === 'setModel' ? { ...message, type: 'model' } : message, message.type === 'sendFile');
      }
    },
    link(url) { if (!/^https?:\/\//i.test(url)) return; if (host) vscode.postMessage({ type: 'link', url }); else window.open(url, '_blank', 'noopener,noreferrer'); },
    cancelFiles,
    dispose() {
      disposed = true; events?.close(); window.removeEventListener('message', listener);
      cancelFiles('画面を閉じたため送信確認を中断しました。Coreで受信済みのファイルは取り消されません。');
    },
  };
}
