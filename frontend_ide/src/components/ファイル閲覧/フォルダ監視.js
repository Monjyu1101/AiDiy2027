// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 応答完了後に次を予約する。切替時の古い応答はabortと世代番号の両方で排除する。
export function createFolderMonitor({ fetch: request = globalThis.fetch, apply, report = () => {},
  schedule = setTimeout, cancel = clearTimeout, interval = 30000 } = {}) {
  let context, generation = 0, timer, controller, revision = '', closed = false, failures = 0;
  function stop() { generation++; cancel(timer); timer = undefined; controller?.abort(); controller = undefined; }
  async function poll(run) {
    if (closed || !context || run !== generation) return;
    const current = context, abort = new AbortController(); controller = abort;
    const deadline = schedule(() => abort.abort(), 15000);
    let delay = interval;
    try {
      const params = new URLSearchParams({ path: current.path, filter: current.filter, ...(revision ? { since: revision } : {}) });
      const response = await request('/api/folder-state?' + params, { cache: 'no-store', signal: abort.signal });
      if (!response.ok) throw Error('フォルダの変更を確認できません。');
      const result = await response.json();
      if (closed || run !== generation || abort.signal.aborted) return;
      failures = 0;
      delay = Math.min(30000, Math.max(interval, (result.elapsedMs || 0) * 4));
      if (result.missing) { report('フォルダが見つかりません。親へ移動するか一覧を更新してください。'); delay = 10000; }
      else if (result.truncated) { report('フォルダの確認が制限に達しました。前の一覧を保持しています。'); delay = 30000; }
      else {
        if (result.tree && apply(current, result) === false) return;
        revision = result.revision; report('');
      }
    } catch (error) {
      if (run === generation && !closed) { failures++; report('フォルダの確認を再試行します。'); delay = Math.min(30000, interval * 2 ** Math.min(failures, 4)); }
    } finally {
      cancel(deadline);
      if (controller === abort) controller = undefined;
      if (!closed && run === generation && context) timer = schedule(() => poll(run), delay);
    }
  }
  return {
    configure(next) {
      const normalized = next?.enabled ? { path: next.path || '', filter: next.filter || '', session: next.session } : null;
      if (JSON.stringify(context) === JSON.stringify(normalized)) return;
      stop(); context = normalized; revision = ''; failures = 0; report('');
      if (context && !closed) void poll(generation);
    },
    close() { closed = true; stop(); context = null; },
  };
}
