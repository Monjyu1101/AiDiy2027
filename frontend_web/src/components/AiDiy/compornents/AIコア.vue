<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AIWebSocket, createWebSocketUrl, type IWebSocketClient } from '@/api/websocket';
import { AudioController } from './AIコア_音声処理';

type PanelKey = 'chat' | 'file' | 'image' | 'code1' | 'code2' | 'code3' | 'code4' | 'code5' | 'code6';

const props = defineProps<{
  sessionId: string;
  liveModel: string;
  codeBasePath?: string;
  inputConnected: boolean;
  inputSocket: IWebSocketClient | null;
  initialMicEnabled: boolean;
  initialSpeakerEnabled: boolean;
  audioStateSeed: number;
  panelVisibility: Record<PanelKey, boolean>;
  chatCount: number;
  coreBusy: boolean;
  coreError: string;
  welcomeInfo?: string;
  welcomeBody?: string;
}>();

const emit = defineEmits<{
  togglePanel: [panel: PanelKey];
  reconnect: [];
  openSettingRestart: [];
  audioStateChange: [payload: { micEnabled: boolean; speakerEnabled: boolean; audioConnected: boolean }];
}>();

const 音声Socket = ref<IWebSocketClient | null>(null);
const 音声接続済み = ref(false);
const マイク有効 = ref(false);
const スピーカー有効 = ref(true);
const セッションID参照 = ref('');
const スピーカー有効参照 = ref(true);
const ウェルカムホバー中 = ref(false);

let 音声処理機: AudioController | null = null;
let 音声接続世代 = 0;

function 音声状態通知() {
  emit('audioStateChange', {
    micEnabled: マイク有効.value,
    speakerEnabled: スピーカー有効.value,
    audioConnected: 音声接続済み.value,
  });
}

async function 音声処理初期化() {
  if (音声処理機) {
    音声処理機.cleanup();
  }

  音声処理機 = new AudioController(音声Socket, セッションID参照, スピーカー有効参照);
  音声処理機.setupOutputAudio();

  await nextTick();
  const audioBarsElement = document.getElementById('audioBars');
  const overlayElement = document.getElementById('audioVisualizerOverlay');
  if (audioBarsElement && overlayElement) {
    音声処理機.setupAudioVisualizer(audioBarsElement, overlayElement);
  }
}

function 音声モデル同期() {
  const liveAi = props.liveModel || '';
  const provider = liveAi === 'openai_live' ? 'openai' : liveAi;
  音声処理機?.setSampleRate(provider);
}

function ビジュアライザー表示同期() {
  音声処理機?.updateVisualizerVisibility(マイク有効.value, スピーカー有効.value);
}

function パネル切替要求(panel: PanelKey) {
  emit('togglePanel', panel);
}

function 音声操作状態同期() {
  音声状態通知();

  if (!props.inputSocket?.isConnected()) return;

  props.inputSocket.send({
    セッションID: props.sessionId,
    チャンネル: 'input',
    メッセージ識別: 'operations',
    メッセージ内容: {
      ボタン: {
        マイク: マイク有効.value,
        スピーカー: スピーカー有効.value,
      },
    },
    ファイル名: null,
    サムネイル画像: null,
  });
}

function 音声切断(incrementGeneration = true) {
  if (incrementGeneration) {
    音声接続世代 += 1;
  }

  音声Socket.value?.disconnect();
  音声Socket.value = null;
  音声接続済み.value = false;
  音声処理機?.stopMicrophone();
  音声処理機?.cancelAudioOutput();
  ビジュアライザー表示同期();
  音声状態通知();
}

async function マイク開始反映() {
  if (!音声処理機) {
    return;
  }

  const result = await 音声処理機.startMicrophone();
  if (!result.success) {
    マイク有効.value = false;
    ビジュアライザー表示同期();
  }
}

async function 音声シード反映() {
  セッションID参照.value = props.sessionId;
  マイク有効.value = props.initialMicEnabled;
  スピーカー有効.value = props.initialSpeakerEnabled;
  スピーカー有効参照.value = スピーカー有効.value;
  音声モデル同期();
  ビジュアライザー表示同期();

  if (!音声処理機) {
    音声状態通知();
    return;
  }

  if (!マイク有効.value) {
    音声処理機.stopMicrophone();
  } else if (音声接続済み.value && !音声処理機.isRecording()) {
    await マイク開始反映();
  }

  if (!スピーカー有効.value) {
    音声処理機.clearAudioPlayback();
  }

  音声状態通知();
}

async function 音声接続開始() {
  if (!props.inputConnected || !props.sessionId) {
    音声切断();
    return;
  }

  const currentGeneration = ++音声接続世代;
  音声切断(false);
  セッションID参照.value = props.sessionId;

  const wsUrl = createWebSocketUrl('/core/ws/AIコア');
  const nextSocket = new AIWebSocket(wsUrl, props.sessionId, 'audio', props.codeBasePath || '');
  nextSocket.onStateChange((connected) => {
    if (currentGeneration !== 音声接続世代) return;
    音声接続済み.value = connected;
  });
  nextSocket.on('output_audio', (message) => {
    if (currentGeneration !== 音声接続世代) return;
    音声処理機?.handleAudioMessage(message);
  });
  nextSocket.on('cancel_audio', () => {
    if (currentGeneration !== 音声接続世代) return;
    音声処理機?.cancelAudioOutput();
  });

  // 接続待ちのソケットも保持し、切断・再接続時に確実に閉じる。
  音声Socket.value = nextSocket;
  try {
    await nextSocket.connect();
    if (currentGeneration !== 音声接続世代) {
      nextSocket.disconnect();
      return;
    }

    音声状態通知();

    if (マイク有効.value) {
      await マイク開始反映();
      音声状態通知();
    }
  } catch (error) {
    if (currentGeneration !== 音声接続世代) return;
    console.error('[AIコア] 音声WebSocket接続エラー:', error);
    音声切断(false);
  }
}

async function マイク切替() {
  if (!props.inputConnected || !音声接続済み.value || !音声処理機) {
    return;
  }

  if (!マイク有効.value) {
    マイク有効.value = true;
    await マイク開始反映();
    if (!マイク有効.value) {
      音声状態通知();
      return;
    }
  } else {
    音声処理機.stopMicrophone();
    マイク有効.value = false;
  }

  ビジュアライザー表示同期();
  音声操作状態同期();
}

function スピーカー切替() {
  if (!props.inputConnected || !音声接続済み.value || !音声処理機) {
    return;
  }

  スピーカー有効.value = !スピーカー有効.value;
  スピーカー有効参照.value = スピーカー有効.value;
  if (!スピーカー有効.value) {
    音声処理機.clearAudioPlayback();
  }
  ビジュアライザー表示同期();
  音声操作状態同期();
}

function 設定再起動要求() {
  emit('openSettingRestart');
}

function 再接続要求() {
  emit('reconnect');
}

watch(() => props.audioStateSeed, () => {
  void 音声シード反映();
}, { immediate: true });

watch(() => props.liveModel, () => {
  音声モデル同期();
});

watch(
  () => [props.sessionId, props.inputConnected, props.codeBasePath] as const,
  ([sessionId, inputConnected, codeBasePath], previous) => {
    const [prevSessionId, prevInputConnected, prevCodeBasePath] = previous ?? ['', false, undefined];
    セッションID参照.value = sessionId;

    if (!inputConnected || !sessionId) {
      音声切断();
      return;
    }

    if (!prevInputConnected || sessionId !== prevSessionId || codeBasePath !== prevCodeBasePath || !音声Socket.value?.isConnected()) {
      void 音声接続開始();
    }
  },
  { immediate: true },
);

onMounted(async () => {
  await 音声処理初期化();
  音声モデル同期();
  ビジュアライザー表示同期();
  音声状態通知();
});

onBeforeUnmount(() => {
  音声切断();
  音声処理機?.cleanup();
  音声処理機 = null;
});
</script>

<template>
  <div
    v-if="props.welcomeInfo || props.welcomeBody"
    :class="['welcome-info-overlay', { 'is-hover': ウェルカムホバー中 }]"
    @mouseenter="ウェルカムホバー中 = true"
    @mouseleave="ウェルカムホバー中 = false"
  >
    <div v-if="props.welcomeInfo" class="welcome-info-text">{{ props.welcomeInfo }}</div>
    <pre v-if="props.welcomeBody" class="welcome-body-text">{{ props.welcomeBody }}</pre>
  </div>

  <div class="ws-status" :class="{ connected: props.inputConnected }">
    <span class="ws-status-dot"></span>
    <span class="ws-status-text">
      {{ props.coreError ? '接続エラー' : props.coreBusy ? '接続中...' : props.inputConnected ? '接続中' : '切断中' }}
    </span>
    <button
      class="reconnect-button"
      :disabled="props.coreBusy"
      title="再接続"
      @click="再接続要求"
    >
      ↺
    </button>
  </div>

  <div id="audioVisualizerOverlay" class="audio-visualizer-overlay">
    <div id="audioBars" class="audio-bars"></div>
  </div>

  <div class="floating-controls">
    <button
      class="floating-icon microphone-icon"
      :class="{ active: マイク有効 }"
      :disabled="!props.inputConnected || !音声接続済み"
      title="マイク"
      @click="マイク切替"
    >
      <img src="/icons/microphone.png" alt="マイク" />
    </button>
    <button
      class="floating-icon speaker-icon"
      :class="{ inactive: !スピーカー有効, active: スピーカー有効 }"
      :disabled="!props.inputConnected || !音声接続済み"
      title="スピーカー"
      @click="スピーカー切替"
    >
      <img src="/icons/speaker.png" alt="スピーカー" />
    </button>
    <button
      class="floating-icon file-icon"
      :class="{ inactive: !props.panelVisibility.file, active: props.panelVisibility.file }"
      title="ファイル"
      @click="パネル切替要求('file')"
    >
      <img src="/icons/folder.png" alt="ファイル" />
    </button>
    <button
      class="floating-icon chat-icon"
      :class="{ inactive: !props.panelVisibility.chat, active: props.panelVisibility.chat }"
      :disabled="!props.inputConnected"
      title="チャット"
      @click="パネル切替要求('chat')"
    >
      {{ props.chatCount }}
    </button>
    <button
      class="floating-icon agent-icon"
      :class="{ inactive: !props.panelVisibility.code1, active: props.panelVisibility.code1 }"
      :disabled="!props.inputConnected"
      title="コード1"
      @click="パネル切替要求('code1')"
    >
      1
    </button>
    <button
      class="floating-icon camera-icon"
      :class="{ active: props.panelVisibility.image }"
      :disabled="!props.inputConnected"
      title="イメージ"
      @click="パネル切替要求('image')"
    >
      <img src="/icons/camera.png" alt="イメージ" />
    </button>
    <button
      class="floating-icon agent-icon"
      :class="{ inactive: !props.panelVisibility.code2, active: props.panelVisibility.code2 }"
      :disabled="!props.inputConnected"
      title="コード2"
      @click="パネル切替要求('code2')"
    >
      2
    </button>
    <button
      class="floating-icon agent-icon"
      :class="{ inactive: !props.panelVisibility.code3, active: props.panelVisibility.code3 }"
      :disabled="!props.inputConnected"
      title="コード3"
      @click="パネル切替要求('code3')"
    >
      3
    </button>
    <button
      class="floating-icon agent-icon"
      :class="{ inactive: !props.panelVisibility.code4, active: props.panelVisibility.code4 }"
      :disabled="!props.inputConnected"
      title="コード4"
      @click="パネル切替要求('code4')"
    >
      4
    </button>
    <button
      class="floating-icon agent-icon"
      :class="{ inactive: !props.panelVisibility.code5, active: props.panelVisibility.code5 }"
      :disabled="!props.inputConnected"
      title="コード5"
      @click="パネル切替要求('code5')"
    >
      5
    </button>
    <button
      class="floating-icon agent-icon"
      :class="{ inactive: !props.panelVisibility.code6, active: props.panelVisibility.code6 }"
      :disabled="!props.inputConnected"
      title="コード6"
      @click="パネル切替要求('code6')"
    >
      6
    </button>
    <button
      class="floating-icon config-icon"
      :disabled="!props.inputConnected"
      title="モデル設定"
      @click="設定再起動要求"
    >
      <img src="/icons/setting.png" alt="設定" class="icon-image" />
    </button>
  </div>
</template>

<style scoped>
.welcome-info-overlay {
  position: fixed;
  top: 112px;
  left: 16px;
  z-index: 1;
  width: 30vw;
  max-width: 520px;
  min-width: 220px;
  height: calc(100vh - 130px);
  overflow: auto;
  pointer-events: none;
  user-select: none;
  direction: rtl; /* 縦スクロールバーを左側へ */
  font-family: 'Courier New', monospace;
  font-size: 10px;
  line-height: 1.35;
}

.welcome-info-overlay::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(to left, rgba(26, 26, 26, 0.95) 0%, rgba(26, 26, 26, 0) 13%),
    linear-gradient(to top, rgba(26, 26, 26, 0.95) 0%, rgba(26, 26, 26, 0) 16%);
  z-index: 2;
}

.welcome-info-overlay::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.welcome-info-overlay::-webkit-scrollbar-track {
  background: rgba(26, 26, 26, 0.35);
}

.welcome-info-overlay::-webkit-scrollbar-thumb {
  background: rgba(196, 210, 255, 0.35);
  border-radius: 3px;
}

.welcome-info-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
  color: #ffffff;
  white-space: pre-wrap;
  word-break: break-word;
  direction: ltr;
  text-align: left;
  position: relative;
  z-index: 1;
}

.welcome-body-text {
  margin: 21px 0 0;
  color: rgba(216, 225, 255, 0.22);
  white-space: pre-wrap;
  word-break: break-word;
  opacity: 1;
  filter: blur(0.6px);
  text-shadow: 0 0 2px rgba(216, 225, 255, 0.25);
  transition: color 0.45s ease, filter 0.45s ease, text-shadow 0.45s ease;
  direction: ltr;
  text-align: left;
  position: relative;
  z-index: 1;
  font-family: 'Courier New', monospace;
}

@media (max-width: 900px) {
  .welcome-info-overlay {
    top: 116px;
    left: 8px;
    width: 80vw;
    max-width: 340px;
    min-width: 160px;
  }
}

.welcome-info-overlay.is-hover .welcome-body-text {
  color: #ffffff;
  filter: blur(0);
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.65);
}

.ws-status,
.audio-visualizer-overlay,
.floating-controls {
  --ws-top: 112px;
  --ws-right: 20px;
  --ws-height: 27px;
  --status-block-gap: 6px;
  --visualizer-height: 27px;
}

.ws-status {
  position: fixed;
  top: var(--ws-top);
  right: var(--ws-right);
  background: rgba(50, 50, 50, 0.9);
  border: 2px solid #ff4444;
  border-radius: 4px;
  padding: 0 12px;
  height: var(--ws-height);
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 1000;
  font-size: 11px;
  color: #ff4444;
  transition: all 0.3s ease;
}

.ws-status.connected {
  border-color: #44ff44;
  color: #44ff44;
}

.ws-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff4444;
  animation: pulse-red 1.5s infinite;
}

.ws-status.connected .ws-status-dot {
  background: #44ff44;
  animation: pulse-green 1.5s infinite;
}

.ws-status-text {
  font-weight: bold;
  font-family: 'Courier New', monospace;
}

.reconnect-button {
  min-width: 24px;
  height: 20px;
  padding: 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}

.reconnect-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes pulse-red {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.7);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(255, 68, 68, 0);
  }
}

@keyframes pulse-green {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(68, 255, 68, 0.7);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(68, 255, 68, 0);
  }
}

.floating-controls {
  position: fixed;
  top: calc(var(--ws-top) + var(--ws-height) + var(--visualizer-height) + (var(--status-block-gap) * 2));
  right: var(--ws-right);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 1000;
}

.floating-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid transparent;
  background: rgba(255, 255, 255, 0.95);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(128, 128, 128, 0.3);
}

.floating-icon img {
  width: 21px;
  height: 21px;
  object-fit: contain;
  pointer-events: none;
  filter: brightness(0);
}

.floating-icon:hover {
  transform: scale(1.05);
}

.floating-icon.microphone-icon {
  border-color: #ff4444;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 2px 8px rgba(255, 68, 68, 0.3);
}

.floating-icon.microphone-icon.active {
  background: #ff4444;
  border-color: #ff4444;
  animation: pulse 2.5s infinite;
  box-shadow: 0 2px 8px rgba(255, 68, 68, 0.5);
}

.floating-icon.microphone-icon.active img {
  filter: brightness(0) invert(1);
}

.floating-icon.speaker-icon.inactive {
  border-color: #00bfff;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 2px 8px rgba(68, 255, 68, 0.3);
}

.floating-icon.speaker-icon {
  background: #00bfff;
  border-color: #00bfff;
  box-shadow: 0 2px 8px rgba(68, 255, 68, 0.3);
}

.floating-icon.speaker-icon.active {
  animation: pulse 2.5s infinite;
}

.floating-icon.camera-icon {
  border-color: #2e7d32;
  background: #888888;
  box-shadow: 0 2px 8px rgba(68, 255, 68, 0.3);
  border-radius: 0;
  width: 28px;
  height: 28px;

}

.floating-icon.camera-icon.active {
  background: #000000;
  border-color: #44ff44;
  animation: pulse 2.5s infinite;
  box-shadow: 0 2px 8px rgba(68, 255, 68, 0.5);
}

.floating-icon.camera-icon.active img {
  filter: brightness(0) invert(1);
}

.floating-icon.chat-icon:disabled,
.floating-icon.agent-icon:disabled {
  background: #cccccc;
  border-color: #cccccc;
  color: #000000;
  cursor: not-allowed;
  opacity: 0.6;
  border-radius: 0;
  width: 28px;
  height: 28px;

  font-size: 17px;
}

.floating-icon.chat-icon.inactive,
.floating-icon.agent-icon.inactive {
  border-color: #2e7d32;
  background: #888888;
  color: #000000;
  font-weight: 900;
  font-size: 17px;
  border-radius: 0;
  width: 28px;
  height: 28px;

}

.floating-icon.chat-icon.active,
.floating-icon.agent-icon.active {
  background: #000000;
  border-color: #44ff44;
  color: #00ff00;
  font-weight: 900;
  font-size: 17px;
  animation: pulse 2.5s infinite;
  box-shadow: 0 2px 8px rgba(0, 255, 0, 0.5);
  border-radius: 0;
  width: 28px;
  height: 28px;

}

.floating-icon.file-icon {
  border-radius: 2px;
  width: 28px;
  height: 28px;

}

.floating-icon.file-icon.inactive {
  border-color: #2e7d32;
  background: #888888;
  box-shadow: 0 2px 8px rgba(68, 255, 68, 0.3);
}

.floating-icon.file-icon.inactive img {
  mix-blend-mode: multiply;
}

.floating-icon.file-icon.active {
  background: #000000;
  border-color: #44ff44;
  animation: pulse 2.5s infinite;
  box-shadow: 0 2px 8px rgba(68, 255, 68, 0.5);
}

.floating-icon.file-icon.active img {
  filter: invert(1);
}

.floating-icon.config-icon {
  background: #ffffff;
  border: 2px solid #ffffff;
  color: #000000;
  box-shadow: 0 2px 8px rgba(255, 255, 255, 0.3);
  padding: 3px;
}

.floating-icon.config-icon .icon-image {
  width: 29px;
  height: 29px;
  display: block;
  filter: brightness(0);
}

.floating-icon.config-icon:disabled {
  background: #888888;
  border-color: #888888;
  box-shadow: none;
}

.floating-icon.config-icon:disabled .icon-image {
  filter: brightness(0.6);
}

.floating-icon:disabled {
  background: #808080 !important;
  border-color: #808080 !important;
  cursor: not-allowed !important;
  box-shadow: 0 2px 8px rgba(128, 128, 128, 0.3) !important;
  animation: none !important;
}

.floating-icon:disabled img {
  filter: brightness(0) invert(1) !important;
}

.floating-icon:disabled:hover {
  transform: none !important;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.audio-visualizer-overlay {
  position: fixed;
  top: calc(var(--ws-top) + var(--ws-height) + var(--status-block-gap));
  right: var(--ws-right);
  width: 170px;
  height: var(--visualizer-height);
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  overflow: visible;
  z-index: 999;
  display: none;
  align-items: flex-end;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  pointer-events: none;
  padding: 0 2px;
}

.audio-bars {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  height: 100%;
  width: 100%;
  gap: 1px;
}

.audio-bar-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-end;
  height: 100%;
  gap: 0;
  min-width: 1px;
}

.audio-bar {
  width: 100%;
  min-height: 2px;
  height: 10%;
  transition: height 0.05s ease-out;
  border-radius: 0;
}

.audio-bar.input-audio {
  background: #ff4444;
  order: 2;
}

.audio-bar.output-audio {
  background: #44ff44;
  order: 1;
}

@media (max-width: 900px) {
  .ws-status,
  .audio-visualizer-overlay,
  .floating-controls {
    --ws-height: 24px;
    --status-block-gap: 4px;
  }

  .audio-visualizer-overlay {
    width: 120px;
  }

  .ws-status {
    font-size: 9px;
    padding: 0 8px;
  }

  .floating-controls {
    gap: 6px;
  }

  .floating-icon {
    width: 28px;
    height: 28px;
  }

  .floating-icon img {
    width: 18px;
    height: 18px;
  }
}

@media (max-aspect-ratio: 1/1) {
  .ws-status,
  .floating-controls {
    display: flex !important;
  }
}
</style>
