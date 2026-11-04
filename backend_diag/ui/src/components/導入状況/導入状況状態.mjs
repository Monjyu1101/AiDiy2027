// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { ref, computed } from 'vue';

export const 分類順 = ['ベース', 'CLI群', 'その他拡張'];
const 待機 = ms => new Promise(resolve => setTimeout(resolve, ms));

// 認証付き API と通知欄は App と共有し、キー試験には触れません。
export function 導入状況状態を作成({ api, 接続済み, 通知, 間隔 = 80, 進捗間隔 = 250, 操作中 = ref(false), 確認後 = async () => {} }) {
  const 確認中 = ref(false), 確認済み = ref(false), 書込中 = ref(false), 書込済み = ref(false), 表示中 = ref(null);
  const 前回実行日時 = ref(null), 個別確認IDs = ref(new Set());
  const 個別確認中 = computed(() => [...個別確認IDs.value][0] || '');
  const 項目 = ref([]), 結果 = ref([]), 調査 = ref({});
  function 一覧を反映(data) {
    項目.value = data.項目;
    結果.value = data.結果;
    前回実行日時.value = data.前回実行日時 || null;
    調査.value = data.調査 || {};
    確認済み.value = false; 書込済み.value = false;
  }
  // 画面の上から順（分類順・一覧順）。
  const 表示順 = () => 分類順.flatMap(group => 項目.value.filter(entry => (entry.menuGroup || 'その他拡張') === group));
  // 全項目を「確認中」で回し、終わった項目から結果を表示する。応答後は上から順に選択を追従させる。
  async function 状況確認() {
    if (操作中.value || 確認中.value || 個別確認中.value || 書込中.value || !接続済み.value) return false;
    確認中.value = true; 確認済み.value = false; 書込済み.value = false; 通知.value = '';
    const 前回 = 結果.value;
    結果.value = 項目.value.map(entry => ({ id: entry.id, 状態: '確認中' }));
    // 応答を待つ間も、確認が終わった項目から結果を表示する。
    let 待機中 = true;
    void (async () => {
      while (待機中) {
        if (進捗間隔) await 待機(進捗間隔);
        if (!待機中) break;
        try {
          const 途中 = new Map(((await api('api/診断/進捗')).結果 || []).map(result => [result.id, result]));
          if (待機中) 結果.value = 結果.value.map(result => result.状態 === '確認中' && 途中.has(result.id) ? 途中.get(result.id) : result);
        } catch { break; }
      }
    })();
    try {
      const data = await api('api/診断', 'POST'), 応答 = new Map(data.結果.map(result => [result.id, result]));
      待機中 = false;
      for (const entry of 表示順()) {
        if (!応答.has(entry.id)) continue;
        結果.value = 結果.value.map(result => result.id === entry.id ? 応答.get(entry.id) : result);
        表示中.value = entry.id;
        if (間隔) await 待機(間隔);
      }
      結果.value = data.結果;
      前回実行日時.value = data.前回実行日時 || new Date().toISOString();
      確認済み.value = true;
      await 確認後();
      return true;
    } catch (error) { 待機中 = false; 結果.value = 前回; 通知.value = error.message; return false; }
    finally { 待機中 = false; 確認中.value = false; }
  }
  // 対象の1行だけ更新し、一括確認の選択追従・先頭への移動は行わない。
  async function 個別確認(id) {
    if (操作中.value || 確認中.value || 個別確認IDs.value.has(id) || 書込中.value || !接続済み.value || !項目.value.some(entry => entry.id === id)) return false;
    const 前回 = 結果.value.find(item => item.id === id);
    const 反映 = result => {
      const byId = new Map(結果.value.map(item => [item.id, item]));byId.set(id, result);
      結果.value = 項目.value.flatMap(entry => byId.has(entry.id) ? [byId.get(entry.id)] : []);
    };
    個別確認IDs.value = new Set([...個別確認IDs.value, id]); 確認済み.value = false; 書込済み.value = false; 通知.value = '';
    反映({ id, 状態: '確認中', 説明: '最新の導入状況を確認しています。' });
    try {
      const data = await api(`api/診断/${encodeURIComponent(id)}`, 'POST');
      反映(data.結果);
      前回実行日時.value = data.前回実行日時 || new Date().toISOString();
      // 保存済みの表示を今回の確認結果として扱わず、サーバーの全項目確認を待つ。
      確認済み.value = data.確認済み === true;
      // 導入管理の能力再読込は確認ボタンの完了を遅らせない。
      void Promise.resolve().then(確認後).catch(() => {});
      return true;
    } catch (error) { if (前回) 反映(前回); else 結果.value = 結果.value.filter(item => item.id !== id); 通知.value = error.message; return false; }
    finally { const next = new Set(個別確認IDs.value); next.delete(id); 個別確認IDs.value = next; }
  }
  // 操作後も各行を個別確認と同じ結果で更新する。FFmpeg 一式以外の結果は受け取らない。
  function 操作結果を反映(data) {
    if (!項目.value.some(entry => entry.id === data.対象)) return;
    const allowed = ['ffmpeg', 'ffprobe', 'ffplay'].includes(data.対象) ? ['ffmpeg', 'ffprobe', 'ffplay'] : [data.対象];
    const incoming = Array.isArray(data.結果一覧) ? data.結果一覧 : data.結果 ? [data.結果] : [];
    const byId = new Map(結果.value.map(item => [item.id, item]));
    let changed = false;
    for (const result of incoming) {
      if (!result || !allowed.includes(result.id) || !項目.value.some(entry => entry.id === result.id)) continue;
      const previousTime = Date.parse(byId.get(result.id)?.確認日時), incomingTime = Date.parse(result.確認日時);
      // 再接続時の古い完了実行で、新しい個別確認結果へ巻き戻さない。
      if (Number.isFinite(previousTime) && (!Number.isFinite(incomingTime) || incomingTime <= previousTime)) continue;
      byId.set(result.id, result); changed = true;
    }
    if (!changed) return;
    結果.value = 項目.value.flatMap(entry => byId.has(entry.id) ? [byId.get(entry.id)] : []);
    const nextLastRun = data.前回実行日時 || data.結果?.確認日時;
    const previousLastTime = Date.parse(前回実行日時.value), nextLastTime = Date.parse(nextLastRun);
    if (nextLastRun && (!Number.isFinite(previousLastTime) || Number.isFinite(nextLastTime) && nextLastTime >= previousLastTime)) 前回実行日時.value = nextLastRun;
    確認済み.value = data.確認済み === true; 書込済み.value = false;
  }
  // 保存内容はサーバーが直前に確認した結果。画面の値は送らない。
  async function 書込() {
    if (操作中.value || !確認済み.value || 確認中.value || 個別確認中.value || 書込中.value || !接続済み.value) return false;
    書込中.value = true; 通知.value = '';
    try { await api('api/書込', 'POST'); 書込済み.value = true; return true; }
    catch (error) { 通知.value = error.message; return false; }
    finally { 書込中.value = false; }
  }
  // 全テスト: 確認してから書き込む。
  async function 全テスト() { return await 状況確認() && await 書込(); }
  return { 前回実行日時, 確認中, 個別確認中, 個別確認IDs, 確認済み, 書込中, 書込済み, 表示中, 項目, 結果, 調査, 一覧を反映, 状況確認, 個別確認, 操作結果を反映, 書込, 全テスト };
}
