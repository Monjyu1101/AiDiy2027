<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { LiveEnvironment } from '../ライブ/ライブ通信';
import { LiveConnection, 入力レート, 音声入力, 音声操作 } from '../../../host/aidiy_live/src/protocol';
import { LiveAudio } from '../../../host/aidiy_live/src/audio';
import { AudioCloud } from '../../../host/aidiy_live/src/visualizer';
import { ライブ選択エラー } from '../../../host/aidiy_live/src/model-catalog';
import { microphoneError } from '../../../host/aidiy_live/src/microphone-error';
import StatusBar from '../共通表示/状態バー.vue';
import TerminalWelcome from '../ターミナル/開始表示.vue';
import ModalDialog from '../../dialog/共通ダイアログ.vue';
import { chatArrival } from '../コード/会話到着演出';
import { createDraftReceiver } from '../下書き連携/下書き受け渡し.js';
import { fileAttachment, isDuplicateAttachment } from '../../../host/src/file-attachments';
import { readDroppedFiles } from '../添付ファイル/ファイル送信.js';
import ChatAttachment from '../添付ファイル/チャット添付.vue';
const props = defineProps({ base: String, config: { default: () => ({}) }, icon: String, linked: Boolean, desktop: Boolean, visible: { type: Boolean, default: true } });
const connected = ref(false), busy = ref(false), mic = ref(false), micBusy = ref(false), speaker = ref(true), error = ref(''), prompt = ref('');
const messages = ref([]), project = ref(null), settings = ref({}), preferred = ref({}), models = ref({}), voices = ref({});
const picker = ref(false), provider = ref(''), model = ref(''), voice = ref('');
const modelLoading = ref(true), modelSaving = ref(false);
const changing = ref(false), welcomeVisible = ref(true);
const draftGeneration = ref(0), draggingFiles = ref(false), uploadingFiles = ref(false), fileStatus = ref('');
const canvas = ref(), conversation = ref(), input = ref(), sendButton = ref();
const rows = new Map(), welcomeKey = ref(0);
const sendIcon = computed(() => new URL('sending.png', new URL(props.icon || '/development/AiDiy.png', location.href)).href);
const speakerIcon = computed(() => new URL('speaker.png', sendIcon.value).href);
const microphoneIcon = computed(() => new URL('microphone.png', sendIcon.value).href);
const arrivals = chatArrival(scroll);
let resizeObserver, scrollFrame;
function scroll() {
  if (disposed) return;
  if (conversation.value) conversation.value.scrollTop = conversation.value.scrollHeight;
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; if (!disposed && conversation.value) conversation.value.scrollTop = conversation.value.scrollHeight; });
}
const environment = new LiveEnvironment(props.config, new URL(props.base || './', location.href).href);
let cloud, audio, connection, heartbeat, generation = 0, micGeneration = 0, disposed = false, cancelFileBatch;
// 初期化済みソケットの切断はconnectのcatchより先に通知されるため、再接続中の保持方針を共有する。
let preserveOnConnectionLost = false;
const keys = (name = provider.value) => { const vendor = name === 'openai_live' ? 'OPENAI' : name === 'freeai_live' ? 'FREEAI' : 'GEMINI'; return { model: `LIVE_${vendor}_MODEL`, voice: `LIVE_${vendor}_VOICE` }; };
const modelLabel = computed(() => [settings.value.LIVE_AI_NAME, settings.value[keys(settings.value.LIVE_AI_NAME).model]].filter(Boolean).join(' - ') || 'AiDiy のライブ会話');
const folderMissing = computed(() => environment.host && !project.value?.パス);
const blocked = computed(() => folderMissing.value || busy.value || modelSaving.value);
const audible = computed(() => props.visible !== false && speaker.value);
const selectedModel = computed(() => ({ LIVE_AI_NAME: provider.value, [keys().model]: model.value, [keys().voice]: voice.value }));
const selectionError = computed(() => ライブ選択エラー(selectedModel.value, { models: models.value, voices: voices.value }));
const selectionChanged = computed(() => Object.entries(selectedModel.value).some(([key, value]) => value !== (settings.value[key] || '')));
function append(role, text, type = '') {
  if (!text.trim() || ['!', '\x02', '\x03', '\x18'].includes(text.trim())) return;
  welcomeVisible.value = false;
  const item = { role, text: text.slice(0, 20000), type, id: crypto.randomUUID() }, run = generation;
  messages.value.push(item);
  if (messages.value.length > 100) messages.value.shift();
  nextTick(() => { if (disposed || run !== generation) return; arrivals.show(rows.get(item.id), role, item.text, type); scroll(); });
}
function appendFile(packet) {
  if (!connection?.session || (packet.プロジェクトパス != null && packet.プロジェクトパス !== project.value?.パス)) return;
  const attachment = fileAttachment(packet, connection.session, '0');
  if (!attachment) {
    if (packet.メッセージ識別 === 'input_file' && packet.セッションID === connection.session && !packet.ファイル名) { cancelFileBatch?.(); fileStatus.value = ''; error.value = 'ファイルを保存できませんでした。もう一度送信してください。'; }
    return;
  }
  if (messages.value.some(item => isDuplicateAttachment(item.attachment, attachment))) return;
  welcomeVisible.value = false;
  messages.value.push({ role: attachment.kind === 'input_file' ? 'user' : 'assistant', text: '', type: attachment.kind, id: crypto.randomUUID(), attachment });
  if (messages.value.length > 100) messages.value.shift();
  if (attachment.kind === 'input_file') fileStatus.value = `受信済み: ${attachment.name}`;
  nextTick(scroll);
}
function dragFiles(event) {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  const available = connected.value && !blocked.value && !uploadingFiles.value && !!project.value?.パス;
  event.dataTransfer.dropEffect = available ? 'copy' : 'none'; draggingFiles.value = available;
}
function leaveFiles(event) { if (event.currentTarget === event.target || !event.currentTarget?.contains?.(event.relatedTarget)) draggingFiles.value = false; }
async function dropFiles(event) {
  const files = event.dataTransfer?.files;
  if (!files?.length && !Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault(); event.stopPropagation?.(); draggingFiles.value = false;
  if (uploadingFiles.value) return;
  if (!connected.value || blocked.value || !project.value?.パス) { error.value = 'ファイルはプロジェクトの会話へ接続してから送信してください。'; return; }
  const run = generation, session = connection.session, root = project.value.パス;
  let cancelled = false; cancelFileBatch = () => { cancelled = true; };
  const current = () => !cancelled && !disposed && run === generation && connected.value && !blocked.value && connection.session === session && project.value?.パス === root;
  uploadingFiles.value = true; error.value = ''; fileStatus.value = 'ファイルを読み込んでいます…';
  let sent = 0;
  try {
    await readDroppedFiles(files, { isCurrent: current, onFile: async ({ name, base64 }) => {
      if (!current()) return;
      if (!connection.send('input', { チャンネル: '0', 出力先チャンネル: '0', 送信モード: 'Live', プロジェクトパス: root,
        メッセージ識別: 'input_file', メッセージ内容: base64, ファイル名: name, サムネイル画像: null })) throw new Error('ファイルを送信できませんでした。接続または送信待ちを確認してください。');
      sent++;
    } });
    if (current()) fileStatus.value = sent ? `${sent}件を送信しました。Coreの受信表示を確認してください。` : '';
  } catch (e) { if (current()) { error.value = (sent ? `${sent}件送信後に停止: ` : '') + e.message; fileStatus.value = ''; } }
  finally { if (run === generation && !disposed) { uploadingFiles.value = false; cancelFileBatch = undefined; if (!current()) fileStatus.value = ''; } }
}
function receive(packet) {
  if (disposed) return;
  const type = packet.メッセージ識別, text = String(packet.メッセージ内容 || '');
  if (['input_file', 'output_file'].includes(type)) appendFile(packet);
  else if (type === 'output_audio') { if (props.visible !== false) audio.play(packet); }
  else if (type === 'cancel_audio') audio.cancel();
  else if (['input_text','output_text','output_request','output','recognition_input','recognition_output'].includes(type) && packet.チャンネル === '0') {
    if (type === 'output_text' && text.trim() === '!') { error.value = 'LiveAIに送信できませんでした。再接続してください。'; return; }
    append(['input_text','recognition_input'].includes(type) ? 'user' : 'assistant', text, type);
  } else if (type === 'welcome_text') append('system', text);
  else if (type === 'error') {
    if (['FILE_UPLOAD_FAILED', 'SOCKET_SEND_FAILED'].includes(packet.エラーコード)) {
      if (packet.セッションID && packet.セッションID !== connection?.session) return;
      cancelFileBatch?.(); fileStatus.value = '';
    }
    error.value = text || packet.error || '会話エラー';
  }
}
async function loadModels(session = '') {
  if (folderMissing.value) return;
  const run = generation;
  const data = await environment.api('core/AIコア/モデル情報/取得', { セッションID: session });
  if (disposed || run !== generation) return;
  if (data.status !== 'OK') throw new Error(data.message || 'モデル情報を取得できません。');
  models.value = data.data.available_models?.live_models || {}; voices.value = data.data.available_models?.live_voices || {};
  settings.value = { ...data.data.モデル設定, ...(!session ? preferred.value : {}) };
  if (!session) error.value = ライブ選択エラー(settings.value, { models: models.value, voices: voices.value });
}
function disconnect(clear = true) {
  preserveOnConnectionLost = false;
  arrivals.reset(); cancelFileBatch?.(); cancelFileBatch = undefined;
  generation++; draftGeneration.value++; draggingFiles.value = false; uploadingFiles.value = false; fileStatus.value = ''; micGeneration++; connected.value = false; busy.value = false; changing.value = false; mic.value = false; micBusy.value = false;
  clearInterval(heartbeat); heartbeat = undefined;
  connection?.send('input', 音声操作(false, false)); audio?.close(); connection?.disconnect();
  audio?.mute(true); speaker.value = true;
  modelLoading.value = false; modelSaving.value = false; picker.value = false;
  settings.value = { ...settings.value, ...preferred.value };
  error.value = '';
  if (clear) { messages.value = []; prompt.value = ''; welcomeKey.value++; welcomeVisible.value = true; }
}
async function connect(preserve = false, automatic = false) {
  if (folderMissing.value || busy.value || disposed) return;
  const run = ++generation; draftGeneration.value++; busy.value = true; error.value = '';
  preserveOnConnectionLost = preserve;
  try {
    if (!automatic) await audio.unlock();
    if (run !== generation || disposed) return;
    await loadModels();
    if (run !== generation || disposed) return;
    const invalid = ライブ選択エラー(settings.value, { models: models.value, voices: voices.value });
    if (invalid) throw new Error(invalid);
    const config = await environment.context();
    if (run !== generation || disposed) return;
    project.value = config.作業フォルダ;
    if (!preserve) { arrivals.reset(); messages.value = []; welcomeVisible.value = false; }
    await connection.connect({ codeBasePath: project.value?.パス || '', modelSettings: preferred.value });
    if (run !== generation || disposed) return;
    await loadModels(connection.session);
    if (run !== generation || disposed) return;
    connected.value = true; audio.mute(audible.value); connection.send('input', 音声操作(false, audible.value));
    if (!environment.host) heartbeat = setInterval(() => connection.send('input', { type: 'ping' }), 20000);
  } catch (e) { if (run === generation) { disconnect(!preserve); error.value = e.message; } }
  finally { if (run === generation) { preserveOnConnectionLost = false; busy.value = false; changing.value = false; } }
}
async function microphone() {
  if (!connected.value || micBusy.value || blocked.value || disposed || props.visible === false) return;
  if (mic.value) { error.value = ''; micGeneration++; audio.stop(); mic.value = false; connection.send('input', 音声操作(false, audible.value)); return; }
  const run = generation, own = ++micGeneration; micBusy.value = true; error.value = '';
  try {
    await audio.unlock();
    if (run !== generation || own !== micGeneration || disposed || props.visible === false) return;
    const active = await audio.start(入力レート(settings.value.LIVE_AI_NAME || ''));
    if (run !== generation || own !== micGeneration || disposed || props.visible === false) return;
    mic.value = active; connection.send('input', 音声操作(active, audible.value));
  } catch (e) { if (run === generation && own === micGeneration && !disposed) { mic.value = false; error.value = `マイクを開始できません: ${microphoneError(e)}`; } }
  finally { if (own === micGeneration) micBusy.value = false; }
}
async function sound() {
  if (!connected.value || blocked.value || props.visible === false) return;
  const run = generation, enabled = !speaker.value;
  try { if (enabled) await audio.unlock(); if (disposed || run !== generation || !connected.value || props.visible === false) return; speaker.value = enabled; audio.mute(audible.value); connection.send('input', 音声操作(mic.value, enabled)); }
  catch (e) { if (run === generation && !disposed) error.value = e.message; }
}
function submit() {
  if (!connected.value || blocked.value || uploadingFiles.value || !prompt.value.trim()) return;
  error.value = ''; const run = generation;
  void audio.unlock().catch(e => { if (run === generation && !disposed) error.value = e.message; });
  arrivals.reserve(input.value, prompt.value);
  if (connection.send('input', { チャンネル: '0', メッセージ識別: 'input_text', メッセージ内容: prompt.value.trim(), 送信モード: 'Live', 出力先チャンネル: '0' })) prompt.value = '';
  else { arrivals.cancelReservation(); error.value = '送信できませんでした。接続を確認してください。'; }
}
function choice(values = {}, selected) { return selected ? Object.hasOwn(values, selected) ? selected : '' : Object.keys(values)[0] || ''; }
function changeProvider() { model.value = choice(models.value[provider.value], settings.value[keys().model]); voice.value = choice(voices.value[provider.value], settings.value[keys().voice]); }
async function openModels() {
  if (blocked.value || modelLoading.value || picker.value) return;
  const run = generation;
  picker.value = true; modelLoading.value = true; error.value = '';
  // 再取得が失敗しても、前回キャンセルした選択や古い候補を適用させない。
  models.value = {}; voices.value = {}; provider.value = ''; model.value = ''; voice.value = '';
  try { await loadModels(connection.session); if (run !== generation || disposed) return; provider.value = choice(models.value, settings.value.LIVE_AI_NAME); changeProvider(); }
  catch (e) { if (run === generation && !disposed) error.value = e.message; }
  finally { if (run === generation && !disposed) modelLoading.value = false; }
}
async function applyModel() {
  if (blocked.value || modelLoading.value || selectionError.value || !selectionChanged.value) return;
  const selected = { ...selectedModel.value }, run = generation;
  modelSaving.value = true; error.value = '';
  try {
    await environment.saveModel(selected);
  } catch (e) { if (run === generation && !disposed) error.value = e.message; return; }
  finally { if (run === generation && !disposed) modelSaving.value = false; }
  if (disposed || run !== generation) return;
  preferred.value = selected; settings.value = { ...settings.value, ...selected };
  if (!connected.value) { picker.value = false; return; }
  const wasSpeaker = speaker.value;
  disconnect(false); speaker.value = wasSpeaker; audio.mute(audible.value);
  picker.value = true; changing.value = true;
  const connecting = connect(true), reconnectRun = generation;
  await connecting;
  if (reconnectRun === generation && connected.value && !disposed) {
    picker.value = false;
    append('system', '選択したモデルで接続しました。マイクを ON にして新しい会話を開始できます。');
  }
}
async function newChat() {
  if (blocked.value || modelLoading.value) return;
  const reconnect=connected.value, wasMic=mic.value, wasSpeaker=speaker.value;
  const selected = { ...preferred.value };
  for (const key of ['LIVE_AI_NAME', ...Object.values(keys(settings.value.LIVE_AI_NAME))]) if (settings.value[key]) selected[key] = settings.value[key];
  disconnect();
  if (reconnect) {
    preferred.value = selected; speaker.value=wasSpeaker; audio.mute(audible.value);
    const connecting = connect(true), run = generation;
    await connecting;
    if(run === generation && connected.value && wasMic && !disposed) await microphone();
  }
}
function copyInput(item) { if (item.attachment) return; if (item.role !== 'user' && !item.type.startsWith('recognition_')) return; prompt.value = item.text; nextTick(() => { input.value.focus(); input.value.setSelectionRange(item.text.length, item.text.length); scroll(); }); }
watch(prompt, () => nextTick(scroll));
// Webの別タブでも会話と下書きを保持する。非表示中は描画と音声入出力を止め、マイクは自動再開しない。
watch(() => props.visible, visible => {
  cloud?.setVisible(visible !== false);
  if (visible === false) { micGeneration++; audio?.stop(); mic.value = false; micBusy.value = false; }
  audio?.mute(audible.value);
  if (connected.value) connection?.send('input', 音声操作(false, audible.value));
}, { flush: 'sync' });
const draftReceiver = createDraftReceiver({
  kind: 'live', project: () => project.value?.パス, scope: () => String(draftGeneration.value),
  ready: () => !disposed && !blocked.value && !modelLoading.value,
  draft: () => prompt.value, setDraft: value => { prompt.value = value; }, label: () => 'Live',
  focus: () => nextTick(() => { if (!disposed) { input.value?.focus(); input.value?.setSelectionRange(prompt.value.length, prompt.value.length); scroll(); } }),
  // 単独起動もBrowserの連携先。IDE所属かどうかで受信IPCを無効にしない。
  api: props.desktop ? window.aidiyWindow : undefined,
});
defineExpose({ draftTarget: draftReceiver.target, insertDraft: draftReceiver.insert });
watch(() => [project.value?.パス, draftGeneration.value, blocked.value, modelLoading.value], () => draftReceiver.publish());
onMounted(async () => {
  draftReceiver.mount();
  const initialRun = generation;
  resizeObserver = new ResizeObserver(scroll); resizeObserver.observe(conversation.value);
  cloud = new AudioCloud(canvas.value, props.visible !== false);
  audio = new LiveAudio(base64 => connection.send('audio', 音声入力(base64)), (kind, value) => cloud.level(kind, value), (kind, values) => cloud.spectrum(kind, values), environment.captureUrl, environment.host ? environment.acquireMicrophone : undefined);
  audio.mute(audible.value);
  connection = new LiveConnection(environment.socketUrl, receive, () => { disconnect(!preserveOnConnectionLost); error.value = '接続が切れました。接続ボタンで開始してください。'; }, environment.socket);
  environment.onStop(message => { disconnect(); error.value = message || ''; });
  environment.onMicrophoneStop(() => { micGeneration++; audio.stop(); mic.value = false; micBusy.value = false; });
  environment.onFolder(folder => { if (project.value?.パス !== folder?.パス && (connected.value || busy.value || modelSaving.value || modelLoading.value)) { disconnect(); error.value = 'プロジェクトフォルダが変わりました。「接続」で新しいプロジェクトの会話を開始してください。'; } project.value = folder; });
  environment.ready();
  try { const config = await environment.context(); if (disposed || initialRun !== generation) return; project.value = config.作業フォルダ; const explicit=config.モデル設定||{}, saved=config.保存モデル設定;
    const remember=!explicit[keys(explicit.LIVE_AI_NAME).model]&&(!explicit.LIVE_AI_NAME||explicit.LIVE_AI_NAME===saved?.LIVE_AI_NAME);
    preferred.value={...(remember?saved:{}),...explicit,...preferred.value};
    await loadModels();
    if (disposed || initialRun !== generation) return;
    modelLoading.value = false;
    if (!environment.host && (config.自動接続 || explicit[keys(explicit.LIVE_AI_NAME).model])) await connect(false, true); }
  catch (e) { if (!disposed && initialRun === generation) { error.value = e.message; modelLoading.value = false; } }
});
onBeforeUnmount(() => { draftReceiver.dispose(); disposed = true; disconnect(); arrivals.dispose(); cancelAnimationFrame(scrollFrame); resizeObserver?.disconnect(); cloud?.dispose(); environment.dispose(); });
</script>
<template>
  <section class="ai-component live-component" :class="{ 'desktop-window': desktop, connected, 'file-drop-active': draggingFiles }" data-component="LivePanel" @dragover="dragFiles" @dragleave="leaveFiles" @drop="dropFiles">
    <StatusBar :title="linked ? 'AiDiy IDE / Live' : 'AiDiy Live'" :connected="connected" :busy="busy" :active="mic" :status="changing ? '再接続中' : connected && mic ? '会話中' : undefined" :desktop="desktop" :clock-pulse="visible !== false" />
    <div class="component-toolbar"><span :title="project?.パス">プロジェクト: {{ project?.名前 || '未選択' }}</span><nav><button :disabled="blocked || modelLoading" @click="newChat">新しい会話</button><button class="live-connect" :class="{ awaiting: !connected && !busy && !blocked && !modelLoading }" :disabled="blocked || modelLoading" @click="connected ? disconnect() : connect()">{{ busy ? '接続中…' : connected ? '切断' : '接続' }}</button></nav></div>
    <canvas ref="canvas" class="audio-cloud"></canvas>
    <div class="audio-actions"><button class="audio-button" :disabled="!connected || blocked" :aria-pressed="connected && speaker" :aria-label="`スピーカー ${connected && speaker ? 'ON' : 'OFF'}`" @click="sound"><span class="symbol speaker-symbol" :style="{ '--symbol-image': `url('${speakerIcon}')` }"></span><strong>{{ connected && speaker ? 'ON' : 'OFF' }}</strong></button><button class="audio-button microphone" :disabled="!connected || blocked || micBusy" :aria-pressed="mic" :aria-busy="micBusy" :aria-label="micBusy ? 'マイク準備中' : `マイク ${mic ? 'ON' : 'OFF'}`" @click="microphone"><span class="symbol" :style="{ '--symbol-image': `url('${microphoneIcon}')` }"></span><strong>{{ mic ? 'ON' : 'OFF' }}</strong></button></div>
    <main ref="conversation" class="conversation live-conversation" aria-label="会話の記録" role="log" aria-live="polite">
      <TerminalWelcome v-if="welcomeVisible" :key="welcomeKey" kind="live" :icon="icon" :started="!!prompt" />
      <article v-for="item in messages" :ref="el => el ? rows.set(item.id, el) : rows.delete(item.id)" :key="item.id" :class="['message',item.role,item.type, { recognition: item.type.startsWith('recognition_') }]" :title="!item.attachment && (item.role === 'user' || item.type.startsWith('recognition_')) ? 'クリックして入力欄へ戻す' : undefined" @click="copyInput(item)"><ChatAttachment v-if="item.attachment" :attachment="item.attachment" /><template v-else>{{ item.text }}</template></article>
    </main>
    <footer class="composer" :class="{ 'file-drop-active': draggingFiles }"><p v-if="draggingFiles" class="file-drop-hint">ここにドロップして送信（1件4MiB・10件まで）</p><p v-else-if="fileStatus" class="file-transfer-status" role="status">{{ fileStatus }}</p><p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="folderMissing" class="workspace-required" role="alert">先にプロジェクトフォルダを開いてください <button type="button" @click="environment.openFolder()">フォルダを開く</button></p>
      <form @submit.prevent="submit"><textarea :disabled="folderMissing" ref="input" v-model="prompt" rows="3" maxlength="20000" placeholder="AiDiyに話しかける…" aria-label="Liveへのメッセージ" @keydown.tab="event => { if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && event.keyCode !== 229 && connected && !blocked && !uploadingFiles && prompt.trim()) { event.preventDefault(); sendButton.focus(); } }"></textarea>
        <div class="composer-actions"><div class="keyboard-hint">Enter で改行 · Tab → Enter で送信</div><div class="composer-meta"><button type="button" :disabled="blocked || modelLoading" @click="openModels"><span class="model-caption">モデル</span> <span class="model-chevron">▾</span></button><span class="model-label">{{ modelLabel }}</span></div><button ref="sendButton" type="submit" class="send" :class="{ 'ws-disabled': !connected }" :disabled="!connected || blocked || uploadingFiles || !prompt.trim()" aria-label="送信"><img :src="sendIcon" alt=""></button></div>
      </form>
    </footer>
    <ModalDialog v-if="picker" class="live-model-dialog" label="音声モデル選択" :locked="blocked" @close="picker = false"><div class="settings-content"><div class="picker-header"><div><h2>ライブモデル・音声</h2><p class="muted">この会話で使用するモデルと音声を選択します。</p></div><button type="button" class="picker-close" :disabled="blocked" aria-label="閉じる" @click="picker = false"><span class="close-icon" aria-hidden="true"></span></button></div>
      <label>ライブ AI<select v-model="provider" :disabled="blocked || modelLoading" @change="changeProvider"><option v-if="!provider" value="" disabled>候補から選択してください</option><option v-for="(_, key) in models" :key="key" :value="key">{{ key }}</option></select></label>
      <label>モデル<select v-model="model" :disabled="blocked || modelLoading"><option v-if="!model" value="" disabled>候補から選択してください</option><option v-for="(label,key) in models[provider]" :key="key" :value="key">{{ label }}</option></select></label>
      <label>音声<select v-model="voice" :disabled="blocked || modelLoading"><option v-if="!voice" value="" disabled>候補から選択してください</option><option v-for="(label,key) in voices[provider]" :key="key" :value="key">{{ label }}</option></select></label>
      <p class="muted">{{ connected || busy ? 'モデルや音声を変更すると、音声AIへ自動で再接続します。マイクは OFF に戻ります。' : '選択したモデルと音声で、次の接続を開始します。' }}</p><p class="muted" v-if="connected || busy">画面の会話は保持し、音声AIの会話を新しく開始します。</p>
      <p v-if="modelLoading">読み込み中…</p><p v-else-if="selectionError" class="error">{{ selectionError }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p><div class="picker-actions"><button :disabled="blocked" @click="picker = false">キャンセル</button><button class="apply-model primary" :disabled="blocked || modelLoading || !!selectionError || !selectionChanged" @click="applyModel">{{ modelSaving ? '保存中…' : changing ? '再接続中…' : connected ? '変更して再接続' : '選択する' }}</button></div></div>
    </ModalDialog>
  </section>
</template>

<style scoped>
.workspace-required{color:#ff6666;margin:4px 0;font-weight:600;line-height:1.5}
.live-component:has(.workspace-required) .live-connect:disabled{opacity:.4;background:transparent;color:inherit;border-color:#444}
.composer.file-drop-active{outline:2px dashed #8ecbff;outline-offset:-2px;border-radius:6px;background:rgba(102,126,234,.18)}
.file-drop-hint,.file-transfer-status{margin:4px 0;font-size:12px;line-height:1.4;color:#a9b8cc;overflow-wrap:anywhere}
.file-drop-hint{color:#9edfff;font-weight:600}
</style>
