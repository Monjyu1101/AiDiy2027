<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import MarkdownIt from 'markdown-it';
import { codeTransport } from '../コード/コード通信.js';
import { visibleStreamContent, streamControlOf } from '../../../host/src/stream-control';
import StatusBar from '../共通表示/状態バー.vue';
import TerminalWelcome from '../ターミナル/開始表示.vue';
import TerminalProgress from '../ターミナル/進捗表示.vue';
import ModalDialog from '../../dialog/共通ダイアログ.vue';
import { chatArrival } from '../コード/会話到着演出';
import { createDraftReceiver } from '../下書き連携/下書き受け渡し.js';
import ChatAttachment from '../添付ファイル/チャット添付.vue';
import { readDroppedFiles } from '../添付ファイル/ファイル送信.js';
const props = defineProps({ base: String, host: Boolean, icon: String, embedded: Boolean, hideStatusBar: Boolean, linked: Boolean, desktop: Boolean, pageNotifications: Boolean, projectNotice: String });
const windowTitle = ref('');
const state = reactive({ メッセージ: [], 履歴: [], 進捗: [], 信頼済み: false, 自動接続: true });
const prompt = ref(''), error = ref(''), pending = ref(false), history = ref(false), picker = ref(false), catalogBusy = ref(false);
const stopPending = ref(false);
const navigationRunning = ref(false), navigationCancelling = ref(false);
// 自動送信は入力欄にも表示する。人間の下書きとは分け、受付・停止後に元へ戻す。
const navigationPrompt = ref(null);
const displayedPrompt = computed({ get: () => navigationPrompt.value ?? prompt.value, set: value => { if (!navigationRunning.value && !navigationCancelling.value) prompt.value = value; } });
let navigationRun, navigationCancellationId, navigationBlocked = false;
const uploading = ref(false), fileNotice = ref(''), draggingFiles = ref(false);
let fileGeneration = 0;
// 下書きやホスト設定から復元しない。画面を開くたびに予測はOFFで開始する。
const autoSuggest = ref(false), predicting = ref(false), predictionNotice = ref('');
let prediction, predictionReply = false, predictionFailed = false;
const changingConversation = ref(false);
let conversationChange;
const autoPending = ref(false), deleteTarget = ref(null), deleting = ref(false), catalogReady = ref(false);
let catalogProvider = '';
const providers = ref([]), models = ref([]), provider = ref(''), model = ref(''), custom = ref(''), checks = ref(0);
const conversation = ref(), input = ref(), sendButton = ref(), progress = ref('');
const stream = ref();
const hasStreamContent = ref(false);
const sendIcon = computed(() => new URL('sending.png', new URL(props.icon || '/development/AiDiy.png', location.href)).href);
const stopIcon = computed(() => new URL('abort.png', sendIcon.value).href);
const rows = new Map();
// IDEブラウザー版のCodeタブだけ画面全体へ通知する。他のCodeは自分の領域内に収める。
const arrivals = chatArrival(scroll, row => props.pageNotifications ? row.ownerDocument.body : row.closest('.code-component'));
let revision = 0, resizeObserver, checksRestored = false;
function scroll() { if (conversation.value) conversation.value.scrollTop = conversation.value.scrollHeight; }
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content);
const offline = computed(() => state.実行モード === 'offline' || (state.オフライン対応 && !state.接続済み));
const busy = computed(() => !!state.実行中 || !!state.モデル変更中 || pending.value || changingConversation.value || uploading.value || navigationRunning.value || navigationCancelling.value);
// 一度本文が届いた依頼では、進捗100件の窓から本文が消えても待機演出へ戻さない。
// ストリーム枠が開いている間は、光をストリーム枠側（共通表示/会話表示.css）で流す。
const waitingForStream = computed(() => !!state.実行中 && !hasStreamContent.value && !stream.value?.visible);
const folderMissing = computed(() => props.host && !state.作業フォルダ);
const operable = computed(() => state.信頼済み && state.画面接続済み !== false && !folderMissing.value);
watch(folderMissing, missing => { if (missing) { picker.value = false; history.value = false; prompt.value = ''; error.value = ''; } });
const allowed = computed(() => state.信頼済み && state.画面接続済み !== false && !!state.作業フォルダ && (offline.value || state.接続済み));
const canSend = computed(() => allowed.value && !busy.value && !predicting.value && prompt.value.trim());
const canStop = computed(() => allowed.value && state.実行中 && !state.停止中 && !stopPending.value);
const modelLabel = computed(() => `${state.provider || '自動'} - ${state.model || (state.provider ? '既定モデル' : 'AIコアの設定')}`);
const sortedHistory = computed(() => [...state.履歴].sort((a, b) => b.更新日時 - a.更新日時));
const canApplyModel = computed(() => catalogReady.value && !catalogBusy.value && !busy.value && operable.value &&
  (model.value === '__custom__' ? !!custom.value.trim() : !offline.value || models.value.some(item => item.id === model.value)));
const transport = codeTransport(props, receive);
let disposed = false;
const predictionScope = () => JSON.stringify([state.作業フォルダ?.パス, state.接続プロジェクトパス, state.会話ID, state.セッションID || state.コアセッションID]);
const fileScope = () => JSON.stringify([predictionScope(), state.接続世代]);
function invalidateFiles() { fileGeneration++; fileNotice.value = ''; transport.cancelFiles?.(); }
const fileAllowed = () => allowed.value && !offline.value && !!state.接続プロジェクトパス && !!(state.セッションID || state.コアセッションID)
  && Number.isSafeInteger(state.接続世代) && !state.実行中 && !state.モデル変更中 && !pending.value && !changingConversation.value && !navigationRunning.value;
const canAttach = computed(() => fileAllowed() && !uploading.value);
// 添付はドロップだけで受け付ける。ドラッグ中は入力欄の外側の欄全体を受け口として表示する。
function dragFiles(event) {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = canAttach.value ? 'copy' : 'none'; draggingFiles.value = canAttach.value;
}
function leaveFiles(event) { if (event.currentTarget === event.target || !event.currentTarget?.contains?.(event.relatedTarget)) draggingFiles.value = false; }
function dropFiles(event) {
  draggingFiles.value = false;
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault(); event.stopPropagation();
  void attachFiles(event.dataTransfer.files);
}
async function attachFiles(files) {
  if (!files?.length || disposed || uploading.value) return;
  if (!canAttach.value) { error.value = 'ファイル添付はAIコア接続中・待機中に使用できます。'; return; }
  const generation = ++fileGeneration, scope = fileScope();
  const identity = { conversationId: state.会話ID, sessionId: state.セッションID || state.コアセッションID, projectPath: state.接続プロジェクトパス, connectionEpoch: state.接続世代 };
  const current = () => !disposed && generation === fileGeneration && scope === fileScope() && fileAllowed();
  uploading.value = true; error.value = ''; fileNotice.value = ''; cancelPrediction();
  try {
    const count = await readDroppedFiles(files, { isCurrent: current, onFile: async file => {
      if (!current()) throw new Error('会話または接続が変わりました。ファイルを選び直してください。');
      await transport.send({ type: 'sendFile', ...identity, ...file });
    } });
    if (current() && count) fileNotice.value = `${count}件を送信しました。受信結果を会話欄で確認し、1分以内に依頼を送信してください。`;
  } catch (failure) { if (!disposed && generation === fileGeneration) error.value = failure.message || 'ファイルを送信できません。'; }
  finally { if (!disposed) uploading.value = false; }
}
const predictionAllowed = () => autoSuggest.value && operable.value && state.自動接続 && state.接続済み
  && !!state.接続プロジェクトパス && !!(state.セッションID || state.コアセッションID) && !offline.value && !busy.value;
function cancelPrediction(notify = true) {
  predictionNotice.value = '';
  const request = prediction;
  prediction = undefined; predicting.value = false;
  if (!request) return;
  clearTimeout(request.timer);
  if (notify) void transport.send({ type: 'cancelPrediction', requestId: request.id }).catch(() => {});
}
function startPrediction() {
  // IME変換中はv-modelへ反映前の文字があり得るため、実際の入力欄も確認する。
  if (!predictionAllowed() || prompt.value.trim() || prediction || input.value?.composing
      || (typeof input.value?.value === 'string' && input.value.value.trim())) return;
  const request = { id: crypto.randomUUID(), scope: predictionScope(), draft: prompt.value };
  prediction = request; predicting.value = true;
  // ホスト応答・画面通信が失われても入力欄をロックしたままにしない。
  request.timer = setTimeout(() => { if (prediction === request) cancelPrediction(); }, 125000);
  void transport.send({ type: 'predictInput', requestId: request.id, projectPath: state.接続プロジェクトパス, conversationId: state.会話ID,
    sessionId: state.セッションID || state.コアセッションID || '' }).catch(() => { if (prediction === request) cancelPrediction(); });
}
function toggleSuggestion() {
  autoSuggest.value = !autoSuggest.value;
  if (!autoSuggest.value) cancelPrediction();
}
function acceptPrediction(packet) {
  const request = prediction;
  if (!request || packet.requestId !== request.id) return;
  const apply = !disposed && predictionAllowed() && predictionScope() === request.scope && prompt.value === request.draft
    && typeof packet.text === 'string' && !!packet.text.trim() && packet.text.length <= 200000;
  cancelPrediction(false);
  // 提案は編集できる下書きだけ。送信、会話追加、添付変更は行わない。
  if (apply) {
    const text = packet.text.trim();
    if (/^[!！]/.test(text)) predictionNotice.value = text.slice(1).trim();
    else prompt.value = text;
  }
}
function confirmsConversationChange(packet) {
  const change = conversationChange;
  if (!change || typeof packet.会話ID !== 'string' || !packet.会話ID) return false;
  if (props.host && (!change.result || change.result.会話ID !== packet.会話ID || change.result.projectPath !== packet.作業フォルダ?.パス)) return false;
  // VS Codeの新規だけは、固定中の会話とは別のアクティブな作業フォルダへ移れる。
  if (change.projectPath && change.projectPath !== packet.作業フォルダ?.パス && !(props.host && change.type === 'new')) return false;
  return change.type === 'selectHistory' ? packet.会話ID === change.id : packet.会話ID !== change.previousId;
}
// Navigator の自動送信は専用の相関IDで確認する。idle や本文だけを成功扱いしない。
const navigationScope = snapshot => JSON.stringify([snapshot.作業フォルダ?.パス, snapshot.接続プロジェクトパス, snapshot.会話ID,
  snapshot.セッションID || snapshot.コアセッションID, snapshot.接続世代, snapshot.実行モード, snapshot.自動接続 !== false, snapshot.provider, snapshot.model]);
function navigationReadiness(projectPath) {
  const path = state.作業フォルダ?.パス;
  // 自動接続ONの初回SSEは接続前のためoffline表示になる。これを明示オフラインと混同して送信しない。
  const online = state.自動接続 !== false;
  const connectionReady = !online || (state.実行モード === 'online' && state.接続済み && !state.接続中 && !state.モデル変更中
    && !!(state.セッションID || state.コアセッションID) && state.接続プロジェクトパス === path && Number.isSafeInteger(state.接続世代));
  const ready = !disposed && !props.host && state.navigationRunSupported === true && !navigationBlocked
    && connectionReady && allowed.value && !busy.value && !predicting.value && !picker.value && !deleting.value
    && !autoPending.value && !stopPending.value && !state.停止中 && !!state.会話ID
    && !state.添付 && (!projectPath || projectPath === path);
  const unsupported = !!state.会話ID && state.navigationRunSupported !== true;
  return { ready: !!ready, projectPath: path || '', running: navigationRunning.value, fatal: navigationBlocked || unsupported,
    reason: navigationBlocked ? '前の実行結果を確認できません。Codeを開き直して確認してください。'
      : unsupported ? 'Code実行サーバーが自動航行に未対応です。セットアップで更新し、Navigatorを開き直してください。'
      : !state.会話ID ? 'Codeの状態通知を待っています…'
      : !connectionReady ? state.接続エラー ? `Codeの接続待ち: ${state.接続エラー}` : 'Codeのオンライン接続・セッション確定を待っています…'
      : ready ? '' : 'Codeの接続・プロジェクト・実行状態を確認してください。' };
}
function finishNavigation(failure, cancel = false) {
  const run = navigationRun;
  if (!run) return;
  navigationRun = undefined; navigationRunning.value = false; navigationPrompt.value = null; pending.value = false; predictionReply = false;
  clearTimeout(run.timer); run.signal?.removeEventListener('abort', run.abort);
  if (failure) {
    arrivals.cancelReservation();
    // 結果不明時に同じ依頼を再送しない。停止もID付きで元の依頼だけへ送る。
    if (cancel) {
      navigationBlocked = true; navigationCancellationId = run.id; navigationCancelling.value = true;
      void transport.send({ type: 'cancel_run', navigationRequestId: run.id,
        メッセージ識別: 'cancel_run', メッセージ内容: '強制停止！' }).then(result => {
          // 元のIDの中止受付を確認してから手動操作を戻す。実行中なら通常のbusyガードを維持する。
          if (!disposed && navigationCancellationId === run.id && result?.navigationPending !== true) navigationCancelling.value = false;
        }).catch(() => {
          if (!disposed && navigationCancellationId === run.id) error.value = 'Codeの停止受付を確認できません。実行状態を確認してから画面を開き直してください。';
        });
    }
    error.value = failure.message;
    run.reject(failure);
  } else run.resolve({ requestId: run.id, status: 'succeeded' });
}
function runNavigationPrompt({ text, projectPath, signal } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('Navigatorの自動実行は停止しました。'));
  if (typeof text !== 'string' || !text.trim() || text.length > 200000)
    return Promise.reject(new Error('Codeへの依頼が空か長すぎます。'));
  if (typeof projectPath !== 'string' || !projectPath || !navigationReadiness(projectPath).ready)
    return Promise.reject(new Error(navigationReadiness(projectPath).reason || 'Codeのプロジェクトが一致しません。'));
  cancelPrediction(); history.value = false; error.value = ''; hasStreamContent.value = false;
  return new Promise((resolve, reject) => {
    const run = { id: crypto.randomUUID(), scope: navigationScope(state), accepted: false, signal, resolve, reject };
    navigationRun = run; navigationRunning.value = true; navigationPrompt.value = text;
    arrivals.reserve(input.value, text, state.メッセージ.length);
    run.abort = () => { if (navigationRun === run) finishNavigation(new Error('Navigatorの自動実行を停止しました。'), true); };
    signal?.addEventListener('abort', run.abort, { once: true });
    // 受付確認は30秒。受付後の自動航行の完了監視だけを1時間にし、Code側の実行制限は変更しない。
    run.timer = setTimeout(() => { if (navigationRun === run) finishNavigation(new Error('Codeの受付を確認できません。実行状態を確認してください。'), true); }, 30000);
    pending.value = true;
    const packet = { type: 'input_text', navigationRequestId: run.id, projectPath,
      conversationId: state.会話ID, sessionId: state.セッションID || state.コアセッションID || '', connectionEpoch: state.接続世代,
      メッセージ識別: 'input_text', メッセージ内容: text, self_check_loop: offline.value ? 0 : Number(checks.value) };
    // send() の手動操作ガードを迂回する唯一の入口。モデルや承認設定は上書きしない。
    void transport.send(packet).catch(failure => {
      if (navigationRun === run) finishNavigation(new Error(failure.message || 'Codeへの送信結果を確認できません。'), true);
    });
  });
}
function receiveNavigation(packet) {
  const run = navigationRun;
  if (!run) {
    // 同じ依頼の実終了が確認できた場合だけ、次の明示開始を許可する。切断による結果不明は解除しない。
    if (packet.type === 'navigationRunResult' && packet.requestId === navigationCancellationId && ['succeeded', 'failed', 'cancelled'].includes(packet.status)) {
      navigationCancelling.value = false;
      if (packet.settled === true) { navigationBlocked = false; navigationCancellationId = undefined; }
    }
    return;
  }
  if (packet.type === 'navigationRunResult') {
    if (packet.requestId !== run.id) return;
    if (packet.status === 'accepted' && !run.accepted) {
      run.accepted = true; navigationPrompt.value = null; pending.value = false;
      clearTimeout(run.timer);
      run.timer = setTimeout(() => { if (navigationRun === run) finishNavigation(new Error('Codeの完了監視が1時間を超えたため、自動航行を停止しました。'), true); }, 3600000);
    } else if (packet.status === 'succeeded') {
      if (run.accepted) finishNavigation();
      else finishNavigation(new Error('Codeの受付確認なしで完了通知を受け取りました。'), true);
    } else if (['failed', 'cancelled'].includes(packet.status)) {
      finishNavigation(new Error(packet.message || 'Codeの実行が失敗または停止しました。'), packet.settled !== true);
    }
  } else if (packet.type === 'state') {
    const scope = navigationScope(packet);
    if (scope !== run.scope || !packet.信頼済み || packet.画面接続済み === false || packet.停止中
        || packet.モデル変更中 || (!offline.value && !packet.接続済み))
      finishNavigation(new Error('Codeの接続・会話・プロジェクトまたは実行状態が変わりました。'), true);
  } else if (['transportError', 'error'].includes(packet.type) || ['error', 'cancel_run'].includes(packet.メッセージ識別)
      || (packet.メッセージ識別 === 'output_stream' && streamControlOf(String(packet.メッセージ内容 || '')) === 'cancel')
      || (['output_text', 'output'].includes(packet.メッセージ識別) && /^\s*!/.test(String(packet.メッセージ内容 || '')))) {
    finishNavigation(new Error(packet.message || packet.メッセージ内容 || 'Codeの接続または実行に失敗しました。'), true);
  }
}
function receive(packet) {
  if (disposed) return;
  receiveNavigation(packet);
  if (packet.エラーコード === 'FILE_UPLOAD_FAILED') invalidateFiles();
  if (packet.type === 'state') {
    const first = !state.会話ID;
    const changed = !!state.会話ID && state.会話ID !== packet.会話ID;
    const scopeChanged = !first && (state.作業フォルダ?.パス !== packet.作業フォルダ?.パス
      || state.接続プロジェクトパス !== packet.接続プロジェクトパス
      || (state.セッションID || state.コアセッションID) !== (packet.セッションID || packet.コアセッションID));
    const completedReply = !first && !changed && !scopeChanged && state.実行中 && !packet.実行中 && predictionReply && !predictionFailed && !state.停止中 && !packet.停止中;
    if (first || changed || scopeChanged || !packet.接続済み || packet.画面接続済み === false || packet.停止中) {
      predictionReply = false; cancelPrediction();
      invalidateFiles();
    }
    if (!packet.信頼済み || packet.実行中 || packet.モデル変更中 || state.接続世代 !== packet.接続世代) invalidateFiles();
    if (packet.実行中 && !state.実行中) { predictionReply = false; predictionFailed = false; cancelPrediction(); }
    const confirmed = confirmsConversationChange(packet);
    const previous = state.メッセージ.map(item => `${item.種別}:${item.本文}`);
    if (first || changed) { revision++; arrivals.reset(); }
    const own = revision;
    // ホストは新しい依頼の開始時に進捗を空へ戻す。watchではなく受信順に判定し、
    // 同じ描画周期に終了→次の開始が届いても前の依頼の判定を持ち越さない。
    if (first || changed || !state.実行中 || !packet.実行中 ||
        (state.進捗.length > 0 && (packet.進捗 || []).length === 0)) hasStreamContent.value = false;
    Object.assign(state, packet, { 接続プロジェクトパス: typeof packet.接続プロジェクトパス === 'string' ? packet.接続プロジェクトパス : '',
      自動接続: packet.自動接続 !== false, 画面接続済み: packet.画面接続済み !== false }); pending.value = false; autoPending.value = false;
    if (deleteTarget.value && (packet.実行中 || !state.履歴.some(item => item.id === deleteTarget.value.id))) deleteTarget.value = null;
    if (changed || !packet.実行中 || packet.停止中) stopPending.value = false;
    if (!checksRestored && [0, 1, 2, 3].includes(packet.検証回数)) { checks.value = packet.検証回数; checksRestored = true; }
    if (changed) { prompt.value = ''; progress.value = ''; }
    if (confirmed) finishConversationChange();
    error.value = conversationChange?.error || packet.接続エラー || '';
    progress.value = (packet.進捗 || []).map(line => visibleStreamContent(String(line))).filter(Boolean).join('\n');
    if (packet.実行中 && progress.value.trim()) hasStreamContent.value = true;
    const messages = packet.メッセージ || [];
    if ((prediction || predictionNotice.value) && (!predictionAllowed() || (prediction && prediction.scope !== predictionScope()))) cancelPrediction();
    if (completedReply) {
      predictionReply = false;
      if (messages.at(-1)?.種別 === 'assistant') startPrediction();
    }
    void nextTick(() => {
      if (disposed || own !== revision) return;
      stream.value?.sync(progress.value, first || changed);
      if (!first && !changed) {
        messages.forEach((item, i) => {
          if (!item.添付 && previous[i] !== `${item.種別}:${item.本文}` && ['user', 'assistant'].includes(item.種別)) arrivals.show(rows.get(i), item.種別, item.本文, '', i);
        });
      }
      scroll();
    });
  } else if (packet.type === 'predictionResult') { acceptPrediction(packet);
  } else if (packet.type === 'conversationChangeResult') {
    const change = conversationChange;
    if (!props.host || !change || packet.requestId !== change.requestId) return;
    if (packet.ok === true) {
      change.result = packet;
      if (confirmsConversationChange(state)) { finishConversationChange(); error.value = state.接続エラー || ''; }
    } else if (packet.ok === false) {
      error.value = packet.message || '会話を切り替えられませんでした。';
      if (!packet.uncertain) finishConversationChange();
      else { change.error = `${error.value} 下書きを控えてから画面を再読み込みしてください。`; error.value = change.error; }
    }
  } else if (packet.type === 'showConversation') { history.value = false; nextTick(scroll); }
  else if (packet.type === 'accepted') { cancelPrediction(); predictionReply = false; predictionFailed = false; if (!navigationRunning.value && !packet.navigationRequestId) prompt.value = ''; pending.value = false; }
  else if (packet.type === 'modelCatalog') {
    if (!picker.value || (packet.provider || '') !== catalogProvider) return;
    const items = (packet.items || []).filter(item => typeof item?.id === 'string' && typeof item.label === 'string');
    if (!packet.provider) {
      providers.value = items;
      provider.value = items.some(item => item.id === state.provider) ? state.provider : offline.value ? items[0]?.id || '' : '';
      void changeProvider();
    } else {
      models.value = items;
      model.value = provider.value === state.provider ? state.model || '' : offline.value ? 'same' : '';
      if (offline.value && !items.some(item => item.id === model.value)) model.value = items[0]?.id || '';
      custom.value = provider.value === state.provider ? state.model || '' : '';
      catalogBusy.value = false; catalogReady.value = true;
    }
  } else if (['modelCatalogError', 'transportError', 'error'].includes(packet.type)) {
    cancelPrediction(); predictionReply = false; predictionFailed = true;
    if (packet.type === 'modelCatalogError' && (!picker.value || (packet.provider || '') !== catalogProvider)) return;
    error.value = packet.message || packet.error || '処理に失敗しました。'; pending.value = false; catalogBusy.value = false;
    stopPending.value = false; autoPending.value = false;
    if (packet.type === 'modelCatalogError') catalogReady.value = false;
    arrivals.cancelReservation();
    if (packet.type === 'transportError') { revision++; invalidateFiles(); state.画面接続済み = false; arrivals.reset(); stream.value?.reset(); }
  } else if (packet.メッセージ識別 === 'output_stream') {
    const control = streamControlOf(String(packet.メッセージ内容 || ''));
    if (control === 'cancel') { predictionReply = false; predictionFailed = true; cancelPrediction(); }
    else if (control === 'start') cancelPrediction();
    stream.value?.packet(String(packet.メッセージ内容 || ''));
  } else if (['output_text', 'output'].includes(packet.メッセージ識別)) {
    cancelPrediction();
    // AIコア共通のエラー応答は output_text でも先頭が ! になる。中断後の本文でも再開しない。
    const text = typeof packet.メッセージ内容 === 'string' ? packet.メッセージ内容.trim() : '';
    if (text.startsWith('!')) { predictionReply = false; predictionFailed = true; }
    const progressOnly = /^【(?:検証|自己改善)(?:開始|完了)】/.test(text);
    if (state.実行中 && !state.停止中 && !predictionFailed && text && !progressOnly) predictionReply = true;
  } else if (['error', 'cancel_run'].includes(packet.メッセージ識別)
      || (packet.メッセージ識別 === 'output_end' && packet.メッセージ内容)) {
    predictionReply = false; predictionFailed = true; cancelPrediction();
  }
}
function finishConversationChange() {
  conversationChange = undefined; changingConversation.value = false;
  draftReceiver.publish();
}
async function send(type, data = {}) {
  if (disposed) return false;
  if ((navigationRunning.value || navigationCancelling.value) && type !== 'cancel_run') return false;
  const changesConversation = type === 'new' || type === 'selectHistory' || (type === 'deleteHistory' && data.id === state.会話ID) ||
    (!props.host && type === 'autoConnect' && data.enabled && state.実行モード === 'offline');
  if (changesConversation && changingConversation.value) return false;
  if (changesConversation || ['autoConnect', 'setModel', 'input_text', 'cancel_run'].includes(type)) { cancelPrediction(); predictionReply = false; }
  if (type === 'selectHistory' && data.id === state.会話ID) return true;
  let change;
  if (changesConversation) {
    invalidateFiles();
    change = { type, id: data.id, previousId: state.会話ID, projectPath: state.作業フォルダ?.パス, requestId: props.host ? crypto.randomUUID() : undefined };
    conversationChange = change; changingConversation.value = true;
    // Vueの次の描画やHTTP応答より前に、Webの公開APIとElectronの登録を失効させる。
    draftReceiver.publish();
  }
  error.value = '';
  try { await transport.send({ type, ...data, ...(change?.requestId ? { requestId: change.requestId } : {}) }); return true; }
  catch (e) {
    if (disposed || (change && conversationChange !== change)) return false;
    error.value = e.message; pending.value = false; catalogBusy.value = false;
    if (change) {
      // 実サーバーが変更前に返す拒否だけで復帰する。応答喪失や500は適用済みか不明。
      if ([400, 401, 403, 404, 409, 413].includes(e.status)) finishConversationChange();
      else { change.error = `${error.value} 会話の状態を確認できない場合は画面を再読み込みしてください。`; error.value = change.error; }
    }
    return false;
  }
}
async function submit() {
  if (!canSend.value) return;
  pending.value = true; hasStreamContent.value = false;
  arrivals.reserve(input.value, prompt.value, state.メッセージ.length);
  if (!await send('input_text', { メッセージ識別: 'input_text', メッセージ内容: prompt.value, self_check_loop: offline.value ? 0 : Number(checks.value) })) arrivals.cancelReservation();
}
async function stop() {
  if (navigationRunning.value) { finishNavigation(new Error('Codeの実行を停止しました。'), true); return; }
  if (!canStop.value) return;
  stopPending.value = true;
  if (navigationCancelling.value) {
    try {
      const result = await transport.send({ type: 'cancel_run', メッセージ識別: 'cancel_run', メッセージ内容: '強制停止！' });
      if (!disposed && result?.navigationPending !== true) navigationCancelling.value = false;
    } catch (failure) { if (!disposed) { error.value = failure.message; stopPending.value = false; } }
  } else if (!await send('cancel_run', { メッセージ識別: 'cancel_run', メッセージ内容: '強制停止！' })) stopPending.value = false;
}
async function openModels() {
  if (busy.value || !operable.value || picker.value) return;
  provider.value = ''; model.value = ''; custom.value = ''; providers.value = []; models.value = [];
  picker.value = true;
  await requestCatalog('');
}
async function requestCatalog(value) {
  catalogProvider = value; catalogBusy.value = true; catalogReady.value = false;
  await send('chooseModel', { provider: value });
}
async function changeProvider() {
  model.value = ''; custom.value = ''; models.value = [];
  if (provider.value) await requestCatalog(provider.value);
  else { catalogProvider = ''; catalogBusy.value = false; catalogReady.value = !offline.value; }
}
async function applyModel() {
  if (!canApplyModel.value) return;
  catalogBusy.value = true;
  if (await send('setModel', { provider: provider.value, model: model.value === '__custom__' ? custom.value.trim() : model.value })) picker.value = false;
  catalogBusy.value = false;
}
async function toggleAuto() { if (busy.value || autoPending.value || !operable.value) return; autoPending.value = true; if (!await send('autoConnect', { enabled: !state.自動接続 })) autoPending.value = false; }
async function deleteHistory() { if (!deleteTarget.value || busy.value || deleting.value || !operable.value) return; deleting.value = true; if (await send('deleteHistory', { id: deleteTarget.value.id })) deleteTarget.value = null; deleting.value = false; }
function historyDate(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const pad = n => String(n).padStart(2, '0'); return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; }
function link(event) { const a = event.target.closest('a'); if (a) { event.preventDefault(); transport.link(a.href); } }
function copyInput(text) { cancelPrediction(); prompt.value = text; nextTick(() => { input.value?.focus(); input.value?.setSelectionRange(text.length, text.length); scroll(); }); }
const draftReceiver = createDraftReceiver({
  kind: 'code', project: () => state.作業フォルダ?.パス, scope: () => state.会話ID,
  ready: () => !disposed && !navigationRunning.value && !navigationCancelling.value && !!state.信頼済み && state.画面接続済み !== false && !pending.value && !changingConversation.value,
  draft: () => prompt.value, setDraft: value => { cancelPrediction(); prompt.value = value; history.value = false; },
  label: () => state.履歴.find(item => item.id === state.会話ID)?.題名 || 'Code',
  focus: () => nextTick(() => { if (!disposed) { input.value?.focus(); input.value?.setSelectionRange(prompt.value.length, prompt.value.length); scroll(); } }),
  // 単独起動もBrowserの連携先。IDE所属かどうかで受信IPCを無効にしない。
  api: props.desktop ? window.aidiyWindow : undefined,
});
defineExpose({ draftTarget: draftReceiver.target, insertDraft: draftReceiver.insert, runNavigationPrompt, navigationReadiness });
watch(() => [state.作業フォルダ?.パス, state.会話ID, state.信頼済み, state.画面接続済み, pending.value, changingConversation.value, navigationRunning.value, navigationCancelling.value, state.履歴], () => draftReceiver.publish());
watch(prompt, text => { if (prediction && text !== prediction.draft) cancelPrediction(); transport.saveDraft(text); }, { flush: 'sync' });
watch(offline, () => { picker.value = false; });
onMounted(() => {
  if (props.desktop && props.linked) void window.aidiyWindow?.title?.().then(title => { if (!disposed && typeof title === 'string') windowTitle.value = title; }).catch(() => {});
  prompt.value = transport.draft(); draftReceiver.mount(); resizeObserver = new ResizeObserver(scroll); resizeObserver.observe(conversation.value); void transport.start(); });
onBeforeUnmount(() => { finishNavigation(new Error('Code画面を閉じたため自動実行を停止しました。'), true); cancelPrediction(); draftReceiver.dispose(); disposed = true; revision++; fileGeneration++; arrivals.dispose(); resizeObserver?.disconnect(); transport.dispose(); });
</script>
<template>
  <section class="ai-component code-component" :class="{ running: busy, 'desktop-window': desktop }" data-component="CodePanel" @dragover="dragFiles" @dragleave="leaveFiles" @drop="dropFiles">
    <StatusBar v-if="!hideStatusBar" :title="windowTitle || (linked ? 'AiDiy IDE / Code' : 'AiDiy Code')" :mode="state.自動接続 ? 'online' : 'offline'" :connected="state.接続済み" :busy="state.接続中" :active="state.実行中" :desktop="desktop" clock-pulse />
    <div class="component-toolbar"><span :title="state.作業フォルダ?.パス">プロジェクト: {{ state.作業フォルダ?.名前 }}</span><nav>
      <button v-if="!embedded" class="auto-connect" role="switch" :aria-checked="state.自動接続" :title="`自動接続 ${state.自動接続 ? 'ON' : 'OFF'}`" :disabled="busy || autoPending || !operable" @click="toggleAuto"><span>自動接続</span><span class="auto-connect-track" aria-hidden="true"><span class="auto-connect-thumb"></span></span></button>
      <button :disabled="busy || autoPending || !operable || (!offline && !state.接続済み) || (!state.作業フォルダ && !state.新規可能)" @click="send('new')">＋ 新規</button><button :disabled="!operable" :aria-expanded="history" @click="arrivals.reset(); history = !history">{{ history ? '戻る' : '一覧' }}</button>
    </nav></div>
    <p v-if="projectNotice" class="code-project-notice">{{ projectNotice }}</p>
    <p v-if="navigationCancelling" role="status" class="error">Codeの停止受付を確認しています。確認後、手動操作に戻ります。</p>
    <p v-if="changingConversation" role="status" class="error">会話の切り替えを確認しています。完了しない場合は、下書きを控えてから画面を再読み込みしてください。</p>
    <div v-if="history" class="history-list" role="list">
      <p v-if="!sortedHistory.length" class="history-empty">このフォルダに会話履歴はありません</p>
      <div v-for="item in sortedHistory" :key="item.id" class="history-row" :class="{ active: item.id === state.会話ID }" role="listitem">
        <button class="history-open" :disabled="busy || !operable" :title="item.題名" :aria-label="`会話を開く: ${item.題名}`" @click="send('selectHistory', { id: item.id }); history = false"><span class="history-date">{{ historyDate(item.更新日時) }}</span><span class="history-title">{{ item.題名 }}</span></button>
        <button class="history-delete" :disabled="busy || !operable" @click="deleteTarget = item" :aria-label="`会話を削除: ${item.題名}`">削除</button>
      </div>
    </div>
    <main v-show="!history" ref="conversation" class="conversation" @click="link">
      <TerminalWelcome v-if="!state.メッセージ.length" :key="state.会話ID" :icon="icon" :started="!!displayedPrompt" />
      <article v-for="(item, i) in state.メッセージ" :ref="el => el ? rows.set(i, el) : rows.delete(i)" :key="`${state.会話ID}:${i}`" :class="['message', item.種別]">
        <ChatAttachment v-if="item.添付" :attachment="item.添付" />
        <div v-else-if="item.種別 === 'user'" class="content user-text" title="クリックして入力欄へ戻す" @click="copyInput(item.本文)">{{ item.本文 }}</div>
        <div v-else-if="item.種別 === 'assistant'" class="content" v-html="markdown.render(item.本文 || '')"></div>
        <div v-else class="content">{{ item.本文 }}</div>
      </article>
    </main>
    <TerminalProgress :hidden="history" ref="stream" :running="!!state.実行中" @resize="scroll" />
    <footer v-show="!history" class="composer" :class="{ 'file-drop-active': draggingFiles }">
      <p v-if="draggingFiles" class="file-drop-hint">ここにドロップして送信（1件4MiB・10件まで）</p><p v-else-if="uploading || fileNotice" class="file-transfer-status" role="status">{{ uploading ? 'ファイル送信中…' : fileNotice }}</p>
      <div v-if="state.添付" class="attachment">{{ state.添付 }} <button :disabled="busy || !operable" aria-label="添付を外す" @click="send('removeAttachment')"><span class="close-icon" aria-hidden="true"></span></button></div>
      <p v-if="!state.信頼済み && host" class="error">VS Codeでワークスペースを信頼してください。</p><p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="folderMissing" class="workspace-required" role="alert">先にプロジェクトフォルダを開いてください <button type="button" @click="transport.send({ type: 'openFolder' })">フォルダを開く</button></p>
      <form :class="{ running: waitingForStream || predicting, predicting }" @submit.prevent="submit"><div class="prompt-frame"><textarea ref="input" :disabled="folderMissing" v-model="displayedPrompt" rows="3" maxlength="200000" :readonly="predicting || navigationRunning" :aria-busy="predicting || navigationRunning" :placeholder="predicting ? '予測中、、、' : 'AiDiyに依頼する…'" aria-label="Codeへの依頼" @keydown.tab="event => { if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && canSend) { event.preventDefault(); sendButton.focus(); } }"></textarea><span v-if="predicting && prompt" class="prediction-status" aria-hidden="true">予測中、、、</span></div>
        <div class="composer-actions"><div class="keyboard-hint">Enter で改行 · Tab → Enter で送信</div><div class="composer-meta"><button type="button" :disabled="busy || autoPending || !operable || (!offline && !state.作業フォルダ)" @click="openModels"><span class="model-caption">モデル</span> <span class="model-chevron">▾</span></button><span class="model-label" :title="modelLabel">{{ modelLabel }}</span></div>
          <div class="prediction-options"><label class="prediction-caption">予測</label><button type="button" class="auto-connect auto-suggest" :disabled="!operable" role="switch" :aria-checked="autoSuggest" aria-label="予測" :title="`予測 ${autoSuggest ? 'ON' : 'OFF'}`" @click="toggleSuggestion"><span class="auto-connect-track" aria-hidden="true"><span class="auto-connect-thumb"></span></span><span>{{ autoSuggest ? 'ON' : 'OFF' }}</span></button></div>
          <div class="verification-options"><label>検証</label><select :value="offline ? 0 : checks" :disabled="offline || !operable || navigationRunning || navigationCancelling" aria-label="検証回数" @change="checks = Number($event.target.value); checksRestored = true; send('setSelfCheckLoop', { count: checks })"><option v-for="n in [0,1,2,3]" :key="n" :value="n">{{ n }}回</option></select><span class="verification-hint">0回:バックアップ・検証無</span></div>
          <button v-if="state.実行中" type="button" class="stop" :disabled="!canStop" aria-label="実行を停止" title="実行を停止" @click="stop"><img class="stop-icon" :src="stopIcon" alt=""><span class="stop-label" aria-hidden="true">STOP</span></button>
          <button v-else ref="sendButton" type="submit" class="send" :class="{ 'ws-disabled': !allowed }" :disabled="!canSend" aria-label="送信"><img :src="sendIcon" alt=""></button>
        </div>
      </form>
    </footer>
    <ModalDialog v-if="predictionNotice" label="予測" @close="predictionNotice = ''"><h3>予測</h3><p class="prediction-notice">{{ predictionNotice }}</p><button @click="predictionNotice = ''">閉じる</button></ModalDialog>
    <ModalDialog v-if="picker" label="モデル選択" @close="picker = false"><h3>コードAIとモデル</h3>
      <p>{{ offline ? 'aidiy_hermes を直接実行します。オンラインとは別のモデルを保存します。' : 'AIコアのコードAIを選択します。' }}</p>
      <label>コードAI<select v-model="provider" :disabled="catalogBusy || offline" @change="changeProvider"><option v-if="!offline" value="">自動（AIコアの設定）</option><option v-for="p in providers" :key="p.id" :value="p.id">{{ p.label || p.id }}</option></select></label>
      <label>モデル<select v-model="model" :disabled="catalogBusy || !provider || !catalogReady"><option v-if="!offline" value="">{{ provider ? '既定モデル（プロバイダの設定）' : 'AIコアの設定を使用' }}</option><option v-for="m in models" :key="m.id" :value="m.id">{{ m.label || m.id }}</option><option v-if="!offline && provider === state.provider && state.model && !models.some(m => m.id === state.model)" :value="state.model">{{ state.model }}（現在のモデル）</option><option v-if="!offline && provider" value="__custom__">一覧にないモデル ID を入力…</option></select></label>
      <input v-if="model === '__custom__'" v-model="custom" maxlength="300" autocomplete="off" spellcheck="false" aria-label="モデル名"><p v-if="catalogBusy">読み込み中…</p><p v-if="error" class="error">{{ error }}</p>
      <button :disabled="!canApplyModel" @click="applyModel">選択する</button><button @click="picker = false">閉じる</button>
    </ModalDialog>
    <ModalDialog v-if="deleteTarget" label="会話の削除" :locked="deleting" @close="deleteTarget = null"><h3>この会話を削除しますか？</h3><p>{{ deleteTarget.題名 }}</p><p>削除した会話は元に戻せません。</p><p v-if="error" class="error">{{ error }}</p><button :disabled="busy || deleting || !operable" @click="deleteHistory">削除する</button><button :disabled="deleting" @click="deleteTarget = null">キャンセル</button></ModalDialog>
  </section>
</template>
<style scoped>
.workspace-required{color:#ff6666;margin:4px 0;font-weight:600;line-height:1.5}
.composer.file-drop-active{outline:2px dashed #8ecbff;outline-offset:-2px;border-radius:6px;background:rgba(102,126,234,.18)}
.file-drop-hint,.file-transfer-status{margin:4px 0;font-size:12px;line-height:1.4;color:#a9b8cc;overflow-wrap:anywhere}
.file-drop-hint{color:#9edfff;font-weight:600}
</style>
