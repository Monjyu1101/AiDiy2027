// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { ref } from 'vue';

const 操作名 = new Set(['導入', '再導入', '削除']);
const 動作中 = run => Boolean(run && (run.実行中 === true || ['実行中', '確認中'].includes(run.状態)));
const 関連 = run => [run?.対象, ...(run?.関連項目 || [])].filter(Boolean);

// コマンド・導入方式はサーバーだけが決める。画面の検出結果から操作権限を推測しない。
// 導入操作は項目ごとに独立して並行実行できる。押せなくするのは実行中・受付中の項目（関連項目を含む）だけ。
export function 導入操作状態を作成({ api, 接続済み, 操作中 = ref(false), 競合中 = () => false, 結果反映 = () => {}, 確認 = text => globalThis.confirm?.(text) === true, 間隔 = 750, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const 項目 = ref([]), 実行 = ref(null), 実行一覧 = ref([]), 読込中 = ref(false), 取消中 = ref(false), 取消要求済み = ref(false), エラー = ref(''), 受付 = ref(null), 受付一覧 = ref({}), 取消 = ref({});
  let enabled = false, disposed = false, version = 0, timer, pending, uncertain = false, sent = 0, applied = 0;
  const requests = new Set(), confirming = new Set(), merged = new Set(), startFailures = new Map(), cancelFailures = new Map();
  const 能力 = id => 項目.value.find(item => item.id === id);
  const 可能操作 = id => (能力(id)?.操作 || []).filter(action => 操作名.has(action));
  const 関連項目 = id => [id, ...(能力(id)?.関連項目 || [])];
  const 有効 = revision => !disposed && enabled && 接続済み.value && revision === version;
  // 同じ項目の最新の実行（関連項目を含む）。終了済みも直近の結果表示に使う。
  const 対象実行 = id => [...実行一覧.value].reverse().find(run => 関連(run).includes(id)) || null;
  const 項目操作中 = id => {
    const ids = 関連項目(id);
    return confirming.has(id) || Object.keys(受付一覧.value).some(key => 関連項目(key).some(value => ids.includes(value))) || 実行一覧.value.some(run => 動作中(run) && 関連(run).some(value => ids.includes(value)));
  };
  const 取消状態 = runId => 取消.value[runId] || null;
  const 実行中あり = () => 実行一覧.value.some(動作中);
  function 状態更新() {
    操作中.value = 実行中あり() || uncertain || Object.keys(受付一覧.value).length > 0;
    const latest = 実行.value?.実行ID;
    取消中.value = Object.values(取消.value).includes('要求中');
    取消要求済み.value = Boolean(latest && 取消.value[latest]);
  }
  function 解除() { version++; clearTimer(timer); timer = undefined; for (const controller of requests) controller.abort(); requests.clear(); pending = undefined; }
  function 予約() { clearTimer(timer); timer = undefined; if (enabled && !disposed && 接続済み.value && (操作中.value || uncertain)) timer = setTimer(() => { void 読込(); }, 間隔); }
  // 並行する GET / POST / DELETE の応答は、送信順で新しいものだけを反映する。
  function 反映(data, seq) {
    if (seq < applied) return;
    applied = seq;
    項目.value = Array.isArray(data.項目) ? data.項目 : [];
    const list = Array.isArray(data.実行一覧) ? data.実行一覧 : data.実行 ? [data.実行] : [];
    実行一覧.value = list; 実行.value = data.実行 || list.at(-1) || null; uncertain = false;
    // 終わった実行の中止表示は片付ける。
    const next = {};
    for (const [runId, value] of Object.entries(取消.value)) if (list.some(run => run.実行ID === runId && 動作中(run))) next[runId] = value;
    取消.value = next;
    // 同じ完了応答を繰り返し取得しても、後から行った個別確認を上書きしない。
    for (const run of list) if (!動作中(run) && (run.結果 || run.結果一覧?.length) && !merged.has(run.実行ID)) { 結果反映(run); merged.add(run.実行ID); }
    状態更新();
  }
  async function 送信(path, method) {
    const controller = new AbortController(), seq = ++sent; requests.add(controller);
    try { return { data: await api(path, method, controller.signal), seq }; }
    finally { requests.delete(controller); }
  }
  async function 読込() {
    if (!enabled || disposed || !接続済み.value) return false;
    if (pending) return pending;
    clearTimer(timer); timer = undefined;
    const revision = version; 読込中.value = true;
    pending = (async () => {
      try {
        const { data, seq } = await 送信('api/導入管理', 'GET'); if (!有効(revision)) return false;
        反映(data, seq); エラー.value = '';
        for (const [id, failure] of startFailures) {
          const run = 対象実行(id);
          if (!run || failure.previous.has(run.実行ID) || run.操作 !== failure.action) エラー.value = `${failure.message} 新しい実行の受付は確認できませんでした。`;
        }
        startFailures.clear();
        for (const [runId, message] of cancelFailures) {
          // 中止要求の応答が失われた場合、最新状態を照合した後だけ手動の再試行を許す。
          if (動作中(実行一覧.value.find(run => run.実行ID === runId))) { const next = { ...取消.value }; delete next[runId]; 取消.value = next; エラー.value = `${message} 中止を確認できません。必要なら再度「中止」を押してください。`; }
        }
        cancelFailures.clear(); 状態更新();
        return true;
      }
      catch (error) { if (有効(revision)) { エラー.value = `${error.message} 状況を再取得しています。`; uncertain = true; 状態更新(); } return false; }
      finally { if (revision === version) { pending = undefined; 読込中.value = false; 予約(); } }
    })();
    return pending;
  }
  async function 操作結果反映(data, seq, revision) {
    反映(data, seq);
    // 送信順はサーバーの処理順とは限らない。既存GETは操作受付前の状態かもしれないため、
    // その完了を待ってから新しいGETで照合し、実行一覧・中止操作・ポーリングを維持する。
    if (pending) await pending;
    if (有効(revision)) await 読込();
  }
  function 確認文(id, action, name) {
    const capability = 能力(id);
    const change = action === '削除' ? '対象パッケージを削除します。このプログラムは利用できなくなります。' : action === '再導入' ? (capability?.再導入説明 || '対象パッケージを削除してから、再度インストールします。再導入に失敗すると、このプログラムが利用できなくなる場合があります。') : '診断サーバーの環境へパッケージを導入します。';
    return `${name || id} を${action}しますか？\n対象パッケージ: ${capability?.パッケージ || id}\n\n${change}\n認証情報・利用者設定・会話履歴は削除しません。\n${[capability?.説明, capability?.確認説明].filter(Boolean).join('\n')}\n${capability?.関連項目?.length > 1 ? `一式の対象: ${capability.関連項目.join(' / ')}\n` : ''}${capability?.規約URL ? `提供元の案内・規約: ${capability.規約URL}\n` : ''}${action === '削除' ? 'パッケージ管理コマンドを実行します。' : 'ネットワークからパッケージを取得し、インストール処理を実行します。'}\n終了後に対象の各項目で「確認」ボタンと同じ処理を自動実行します。`;
  }
  async function 開始(id, action, name) {
    if (!enabled || disposed || !接続済み.value || uncertain || 競合中() || 項目操作中(id) || !可能操作(id).includes(action)) return false;
    confirming.add(id);
    const revision = version;
    let approved;
    try { approved = await 確認(確認文(id, action, name)); }
    catch (error) { confirming.delete(id); if (有効(revision)) エラー.value = error.message; return false; }
    confirming.delete(id);
    if (!有効(revision) || !approved) return false;
    // 確認中に能力や別処理が変わった場合、古い同意で開始しない。
    if (競合中() || 項目操作中(id) || !可能操作(id).includes(action)) return false;
    エラー.value = ''; 受付一覧.value = { ...受付一覧.value, [id]: { 対象: id, 操作: action } }; 受付.value = 受付一覧.value[id];
    startFailures.delete(id); 状態更新();
    const previous = new Set(実行一覧.value.filter(run => 関連(run).includes(id)).map(run => run.実行ID));
    try {
      const { data, seq } = await 送信(`api/導入管理/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, 'POST');
      if (!有効(revision)) return false;
      await 操作結果反映(data, seq, revision); return true;
    } catch (error) {
      if (有効(revision)) { エラー.value = `${error.message} 実行の有無を確認しています。`; startFailures.set(id, { action, previous, message: error.message }); uncertain = true; }
      // 受付結果が不明でも POST は再送せず、GET で既存実行を照合する。
      return false;
    } finally {
      if (有効(revision)) {
        const next = { ...受付一覧.value }; delete next[id]; 受付一覧.value = next;
        受付.value = Object.values(next).at(-1) || null; 状態更新(); 予約();
      }
    }
  }
  async function 中止(runId = 実行.value?.実行ID) {
    const run = 実行一覧.value.find(item => item.実行ID === runId);
    if (!enabled || disposed || !接続済み.value || !動作中(run) || 取消.value[runId]) return false;
    // 中止の応答を待つ間はポーリングを止め、応答後に再開する。
    clearTimer(timer); timer = undefined;
    const revision = version; 取消.value = { ...取消.value, [runId]: '要求中' }; エラー.value = ''; 状態更新();
    try { const { data, seq } = await 送信(`api/導入管理/${encodeURIComponent(runId)}`, 'DELETE'); if (!有効(revision)) return false; 取消.value = { ...取消.value, [runId]: '要求済み' }; await 操作結果反映(data, seq, revision); return true; }
    catch (error) { if (有効(revision)) { 取消.value = { ...取消.value, [runId]: '要求済み' }; エラー.value = `${error.message} 中止結果を確認しています。`; cancelFailures.set(runId, error.message); uncertain = true; } return false; }
    finally { if (有効(revision)) { 状態更新(); 予約(); } }
  }
  function 接続(value) {
    解除(); enabled = Boolean(value); 読込中.value = false; 受付.value = null; 受付一覧.value = {}; 取消.value = {}; confirming.clear();
    項目.value = []; 実行一覧.value = []; uncertain = enabled; startFailures.clear(); cancelFailures.clear(); applied = sent; 状態更新();
    if (enabled && !disposed) return 読込();
    return Promise.resolve(false);
  }
  function 終了() { disposed = true; enabled = false; 解除(); uncertain = false; 受付一覧.value = {}; 操作中.value = false; 読込中.value = false; 取消中.value = false; }
  return { 項目, 実行, 実行一覧, 読込中, 取消中, 取消要求済み, 操作中, エラー, 受付, 受付一覧, 能力, 可能操作, 対象実行, 項目操作中, 取消状態, 接続, 読込, 開始, 中止, 終了 };
}
