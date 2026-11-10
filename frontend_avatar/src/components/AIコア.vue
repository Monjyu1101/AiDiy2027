<!--
  -*- coding: utf-8 -*-

  -------------------------------------------------------------------------
  COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
  Licensed under "AiDiy 公開利用ライセンス v1.1".
  Commercial use requires prior written consent from all copyright holders.
  See LICENSE for full terms. Thank you for keeping the rules.
  https://github.com/monjyu1101/AiDiy2027
  -------------------------------------------------------------------------
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import アバター from '@/components/AIコア_アバター.vue'
import xneko from '@/components/AIコア_xneko.vue'
import xeyes from '@/components/AIコア_xeyes.vue'
import アナログ時計 from '@/components/AIコア_アナログ時計.vue'
import デジタル時計 from '@/components/AIコア_デジタル時計.vue'
import カレンダー from '@/components/AIコア_カレンダー.vue'
import WindowShell from '@/components/_WindowShell.vue'
import 再読込ボタン from '@/components/再読込ボタン.vue'
import { AudioController } from '@/components/AIコア_音声処理'
import { AI_WS_ENDPOINT } from '@/api/config'
import { AIWebSocket } from '@/api/websocket'

type PanelKey = 'chat' | 'file' | 'image' | 'code1' | 'code2' | 'code3' | 'code4' | 'code5' | 'code6'

const props = defineProps<{
  sessionId: string;
  userLabel: string;
  liveModel: string;
  codeBasePath?: string;
  welcomeInfo: string;
  welcomeBody?: string;
  inputConnected: boolean;
  inputSocket: AIWebSocket | null;
  initialMicEnabled: boolean;
  initialSpeakerEnabled: boolean;
  audioStateSeed: number;
  panelVisibility: Record<PanelKey, boolean>;
  chatCount?: number;
  coreBusy: boolean;
  coreError: string;
  showUserLabel?: boolean;
  standalone?: boolean;
  titleStatusSource?: 'core' | 'input';
}>()

// --- 字幕キュー（最小5秒・最大30秒表示） ---

const 字幕表示 = ref('')
const 字幕キュー: string[] = []
let 字幕最小表示タイマー: ReturnType<typeof setTimeout> | null = null
let 字幕最大表示タイマー: ReturnType<typeof setTimeout> | null = null

function 字幕タイマー停止() {
  if (字幕最小表示タイマー) { clearTimeout(字幕最小表示タイマー); 字幕最小表示タイマー = null }
  if (字幕最大表示タイマー) { clearTimeout(字幕最大表示タイマー); 字幕最大表示タイマー = null }
}

function 字幕送り() {
  字幕タイマー停止()
  if (字幕キュー.length > 0) {
    字幕表示.value = 字幕キュー.shift()!
    字幕最小表示タイマー = setTimeout(() => {
      字幕最小表示タイマー = null
      if (字幕キュー.length > 0) {
        字幕送り()
      } else {
        字幕最大表示タイマー = setTimeout(() => {
          字幕表示.value = ''
          字幕最大表示タイマー = null
        }, 25000)
      }
    }, 5000)
  } else {
    字幕表示.value = ''
  }
}

function 字幕追加(text: string) {
  if (!text.trim()) return
  字幕キュー.push(text)
  if (!字幕表示.value) {
    字幕送り()
    return
  }
  if (!字幕最小表示タイマー && 字幕最大表示タイマー) {
    字幕送り()
  }
}

const emit = defineEmits<{
  togglePanel: [panel: PanelKey];
  reconnect: [];
  openSettingRestart: [];
  audioStateChange: [payload: { micEnabled: boolean; speakerEnabled: boolean; audioConnected: boolean }];
  logout: [];
}>()

const UI自動非表示秒数 = 15000
const ビジュアライザーバー数 = 32
const UI表示中 = ref(true)
const 音声接続済み = ref(false)
const マイク有効 = ref(false)
const スピーカー有効 = ref(true)
const マイクレベル = ref(0)
const スピーカーレベル = ref(0)
const 音声エラー = ref('')
const ウェルカムホバー中 = ref(false)
type 表示選択型 = 'アバター' | 'カレンダーα' | 'xneko' | 'xeyes' | 'アナログ時計' | 'デジタル時計' | 'デジアナ時計' | 'カレンダー' | '無し'

const 表示選択 = ref<表示選択型>('アバター')
const 入力スペクトラム = ref<number[]>(初期スペクトラム())
const 出力スペクトラム = ref<number[]>(初期スペクトラム())
const 音声Socket = shallowRef<AIWebSocket | null>(null)
const アバターRef = ref<{ 表示更新: () => void } | null>(null)

let UI非表示タイマー: ReturnType<typeof setTimeout> | null = null
let ポインター確認タイマー: ReturnType<typeof setInterval> | null = null
let ポインター確認中 = false
let 音声接続世代 = 0
const ポインター確認間隔 = 500

const 音声処理機 = shallowRef(new AudioController({
  onInputLevel: (value) => {
    マイクレベル.value = value
  },
  onOutputLevel: (value) => {
    スピーカーレベル.value = value
  },
  onInputSpectrum: (values) => {
    入力スペクトラム.value = values
  },
  onOutputSpectrum: (values) => {
    出力スペクトラム.value = values
  },
  getSocket: () => 音声Socket.value,
  getSessionId: () => props.sessionId,
}))

const 接続状態表示 = computed(() => {
  if (props.inputConnected && 音声接続済み.value) return '接続中'
  if (props.coreBusy) return '接続中...'
  if (props.inputConnected || 音声接続済み.value) return '部分接続'
  return '切断'
})

const タイトル接続状態表示 = computed(() => {
  if (props.titleStatusSource === 'input') {
    return props.inputConnected ? '接続中' : '切断'
  }
  return 接続状態表示.value
})

const 接続状態ドットクラス = computed(() => {
  if (props.titleStatusSource === 'input') {
    return {
      on: props.inputConnected,
      partial: false,
    }
  }
  return {
    on: 接続状態表示.value === '接続中',
    partial: 接続状態表示.value === '部分接続' || 接続状態表示.value === '接続中...',
  }
})

const ビジュアライザー表示中 = computed(() => {
  return UI表示中.value && (マイク有効.value || スピーカー有効.value || マイクレベル.value > 0.03 || スピーカーレベル.value > 0.03)
})

const アバター表示中 = computed(() => 表示選択.value === 'アバター')
const xneko表示中 = computed(() => 表示選択.value === 'xneko')
const xeyes表示中 = computed(() => 表示選択.value === 'xeyes')
const アナログ時計表示中 = computed(() => 表示選択.value === 'アナログ時計')
const デジタル時計表示中 = computed(() => 表示選択.value === 'デジタル時計')
const デジアナ時計表示中 = computed(() => 表示選択.value === 'デジアナ時計')
const カレンダー表示中 = computed(() => 表示選択.value === 'カレンダー')
const カレンダーα表示中 = computed(() => 表示選択.value === 'カレンダーα')

const 案内表示テキスト = computed(() => {
  if (props.coreError) return props.coreError
  if (音声エラー.value) return 音声エラー.value
  if (props.coreBusy) return 'AIコアへ接続しています...'
  return ''
})

const 案内表示エラー = computed(() => Boolean(props.coreError || 音声エラー.value))

function 初期スペクトラム() {
  return Array.from({ length: ビジュアライザーバー数 }, () => 0.05)
}

function 音声状態通知() {
  emit('audioStateChange', {
    micEnabled: マイク有効.value,
    speakerEnabled: スピーカー有効.value,
    audioConnected: 音声接続済み.value,
  })
}

function 音声モデル同期() {
  音声処理機.value.setLiveModelName(props.liveModel)
}

function ビジュアライザー初期化() {
  入力スペクトラム.value = 初期スペクトラム()
  出力スペクトラム.value = 初期スペクトラム()
}

function UI自動非表示停止() {
  if (!UI非表示タイマー) return
  clearTimeout(UI非表示タイマー)
  UI非表示タイマー = null
}

function UI自動非表示予約() {
  UI自動非表示停止()
  UI非表示タイマー = setTimeout(() => {
    UI表示中.value = false
  }, UI自動非表示秒数)
}

function UI表示開始() {
  UI自動非表示停止()
  UI表示中.value = true
}

function UI表示終了() {
  UI自動非表示予約()
}

// Windows では、起動直後の自動ログインなどで非アクティブのまま表示された透明ウィンドウに、
// 一度クリックされるまで mouseleave が届かないことがある（UI が隠れず透明化しない）。
// Electron では実際のカーソル位置も確認し、DOM のイベントが欠けても表示状態を合わせる。
async function ポインター位置確認() {
  if (ポインター確認中 || !window.desktopApi?.getWindowPointerSnapshot) return
  ポインター確認中 = true
  try {
    const snapshot = await window.desktopApi.getWindowPointerSnapshot()
    const ホバー中 = UI表示中.value && !UI非表示タイマー
    if (snapshot.insideWindow && !ホバー中) UI表示開始()
    else if (!snapshot.insideWindow && ホバー中) UI表示終了()
  } catch {
    // 取得できない場合は DOM のイベントだけで判定する。
  } finally {
    ポインター確認中 = false
  }
}

function ポインター確認開始() {
  if (ポインター確認タイマー || !window.desktopApi?.getWindowPointerSnapshot) return
  ポインター確認タイマー = setInterval(() => { void ポインター位置確認() }, ポインター確認間隔)
}

function ポインター確認停止() {
  if (!ポインター確認タイマー) return
  clearInterval(ポインター確認タイマー)
  ポインター確認タイマー = null
}

function パネル切替要求(panel: PanelKey) {
  emit('togglePanel', panel)
}

function 再表示要求() {
  UI表示中.value = true
  UI自動非表示予約()
  アバターRef.value?.表示更新()
}

function 再接続要求() {
  emit('reconnect')
}

function 設定再起動要求() {
  emit('openSettingRestart')
}

function 音声操作状態同期() {
  音声状態通知()
  if (!props.inputSocket?.isConnected()) return

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
  })
}

function 音声切断(incrementGeneration = true) {
  if (incrementGeneration) {
    音声接続世代 += 1
  }

  音声Socket.value?.disconnect()
  音声Socket.value = null
  音声接続済み.value = false
  音声処理機.value.setAudioSocket(null)
  音声処理機.value.cleanup()
  マイクレベル.value = 0
  スピーカーレベル.value = 0
  ビジュアライザー初期化()
  音声状態通知()
}

async function マイク開始反映() {
  const result = await 音声処理機.value.startMicrophone()
  if (!result.success) {
    マイク有効.value = false
    音声エラー.value = result.error || 'マイクを開始できませんでした。'
  }
}

function 音声シード反映() {
  マイク有効.value = props.initialMicEnabled
  スピーカー有効.value = props.initialSpeakerEnabled
  音声処理機.value.setSessionId(props.sessionId)
  音声モデル同期()
  音声処理機.value.setSpeakerEnabled(スピーカー有効.value)
  if (!マイク有効.value) {
    音声処理機.value.stopMicrophone()
  } else if (音声接続済み.value) {
    void マイク開始反映()
  }
  音声状態通知()
}

async function 音声接続開始() {
  if (!props.inputConnected || !props.sessionId) {
    音声切断()
    return
  }

  const currentGeneration = ++音声接続世代
  音声切断(false)
  音声エラー.value = ''

  const nextSocket = new AIWebSocket(AI_WS_ENDPOINT, props.sessionId, 'audio', props.codeBasePath || '')
  nextSocket.onStateChange((connected) => {
    if (currentGeneration !== 音声接続世代) return
    音声接続済み.value = connected
  })
  nextSocket.on('output_audio', (message) => {
    if (currentGeneration !== 音声接続世代) return
    音声処理機.value.handleAudioMessage(message)
  })
  nextSocket.on('cancel_audio', () => {
    if (currentGeneration !== 音声接続世代) return
    音声処理機.value.cancelOutput({ resetLevel: false })
  })

  // 接続待ちのソケットも保持し、切断・再接続時に確実に閉じる。
  音声Socket.value = nextSocket
  try {
    const connectedSessionId = await nextSocket.connect()
    if (currentGeneration !== 音声接続世代) {
      nextSocket.disconnect()
      return
    }

    音声処理機.value.setAudioSocket(nextSocket)
    音声処理機.value.setSessionId(connectedSessionId)
    音声モデル同期()
    音声処理機.value.setSpeakerEnabled(スピーカー有効.value)
    音声エラー.value = ''
    音声状態通知()

    if (マイク有効.value) {
      await マイク開始反映()
      音声状態通知()
    }
  } catch (error) {
    if (currentGeneration !== 音声接続世代) return
    音声エラー.value = error instanceof Error ? error.message : '音声チャンネルへ接続できませんでした。'
    音声切断(false)
  }
}

async function マイク切替() {
  if (!props.inputConnected || !音声接続済み.value) {
    音声エラー.value = '音声チャンネル接続後にマイクを操作してください。'
    return
  }

  音声エラー.value = ''
  await 音声処理機.value.unlockAudio()

  if (!マイク有効.value) {
    マイク有効.value = true
    await マイク開始反映()
    if (!マイク有効.value) {
      音声状態通知()
      return
    }
  } else {
    音声処理機.value.stopMicrophone()
    マイク有効.value = false
  }

  音声操作状態同期()
}

async function スピーカー切替() {
  if (!props.inputConnected || !音声接続済み.value) {
    音声エラー.value = '音声チャンネル接続後にスピーカーを操作してください。'
    return
  }

  音声エラー.value = ''
  await 音声処理機.value.unlockAudio()
  スピーカー有効.value = !スピーカー有効.value
  音声処理機.value.setSpeakerEnabled(スピーカー有効.value)
  音声操作状態同期()
}

watch(() => props.audioStateSeed, () => {
  音声シード反映()
}, { immediate: true })

watch(() => props.liveModel, (model) => {
  音声モデル同期()
})

watch(
  () => [props.sessionId, props.inputConnected, props.codeBasePath] as const,
  ([sessionId, inputConnected, codeBasePath], previous) => {
    const [prevSessionId, prevInputConnected, prevCodeBasePath] = previous ?? ['', false, undefined]
    if (!inputConnected || !sessionId) {
      音声切断()
      return
    }

    if (!prevInputConnected || sessionId !== prevSessionId || codeBasePath !== prevCodeBasePath || !音声Socket.value?.isConnected()) {
      void 音声接続開始()
    }
  },
  { immediate: true },
)

onMounted(() => {
  UI自動非表示予約()
  ポインター確認開始()
})

onBeforeUnmount(() => {
  UI自動非表示停止()
  ポインター確認停止()
  字幕タイマー停止()
  音声切断()
})

defineExpose({ 字幕追加 })
</script>

<template>
  <component
    :is="WindowShell"
    :title="props.liveModel ? `AiDiy Avatar (${props.liveModel})` : 'AiDiy Avatar'"
    theme="purple"
    close-mode="event"
    :chrome-visible="UI表示中"
    @mouseenter="UI表示開始"
    @mouseleave="UI表示終了"
    @close="emit('logout')"
  >
    <template v-if="UI表示中" #title-right>
      <span class="core-status-dot" :class="接続状態ドットクラス"></span>
      <span class="core-status-text">{{ タイトル接続状態表示 }}</span>
      <component :is="再読込ボタン" title="再表示" @click="再表示要求" />
      <span v-if="props.showUserLabel !== false" class="core-user-label" :title="props.userLabel">{{ props.userLabel }}</span>
    </template>

    <div class="core-panel-body">
      <div v-show="ビジュアライザー表示中" class="audio-visualizer-overlay">
        <div class="audio-bars">
          <div v-for="(_, index) in 入力スペクトラム" :key="index" class="audio-bar-container">
            <i class="audio-bar output-audio" :style="{ height: `${Math.round((出力スペクトラム[index] || 0.05) * 100)}%` }"></i>
            <i class="audio-bar input-audio" :style="{ height: `${Math.round((入力スペクトラム[index] || 0.05) * 100)}%` }"></i>
          </div>
        </div>
      </div>

      <div
        v-if="UI表示中 && (props.welcomeInfo || props.welcomeBody)"
        :class="['welcome-info-overlay', { 'is-hover': ウェルカムホバー中 }]"
        @mouseenter="ウェルカムホバー中 = true"
        @mouseleave="ウェルカムホバー中 = false"
      >
        <div v-if="props.welcomeInfo" class="welcome-info-text">{{ props.welcomeInfo }}</div>
        <pre v-if="props.welcomeBody" class="welcome-body-text">{{ props.welcomeBody }}</pre>
      </div>

      <component
        v-show="アバター表示中"
        :is="アバター"
        ref="アバターRef"
        class="avatar-layer"
        :session-id="sessionId"
        :user-name="userLabel"
        :live-model="liveModel"
        :input-connected="inputConnected"
        :audio-connected="音声接続済み"
        :mic-enabled="マイク有効"
        :speaker-enabled="スピーカー有効"
        :mic-level="マイクレベル"
        :speaker-level="スピーカーレベル"
        :ui-visible="UI表示中"
        :controls-visible="UI表示中"
        :transparent-mode="!UI表示中"
        :subtitle-text="字幕表示"
      />

      <component
        v-if="xneko表示中"
        :is="xneko"
        :controls-visible="UI表示中"
      />

      <component
        v-if="xeyes表示中"
        :is="xeyes"
        :controls-visible="UI表示中"
      />

      <component
        v-if="アナログ時計表示中"
        :is="アナログ時計"
        class="display-option-layer"
        :controls-visible="UI表示中"
      />

      <component
        v-if="デジタル時計表示中"
        :is="デジタル時計"
        class="display-option-layer"
        :controls-visible="UI表示中"
      />

      <!-- デジ+アナ時計: アナログ時計＋金色デジタル時計＋xneko の順に重ね合わせ -->
      <template v-if="デジアナ時計表示中">
        <component
          :is="アナログ時計"
          class="display-option-layer"
          :controls-visible="UI表示中"
        />
        <component
          :is="デジタル時計"
          class="display-option-layer カレンダーα時計"
          :controls-visible="UI表示中"
          :前景色="'#FFB400'"
        />
        <component
          :is="xneko"
          class="display-option-layer"
          :controls-visible="UI表示中"
        />
      </template>

      <component
        v-if="カレンダー表示中"
        :is="カレンダー"
        class="display-option-layer"
        :controls-visible="UI表示中"
      />

      <!-- カレンダー+α: 金色デジタル時計＋カレンダー＋xneko の重ね合わせ -->
      <template v-if="カレンダーα表示中">
        <component
          :is="デジタル時計"
          class="display-option-layer カレンダーα時計"
          :controls-visible="UI表示中"
          :前景色="'#FFB400'"
        />
        <component
          :is="カレンダー"
          class="display-option-layer"
          :controls-visible="UI表示中"
        />
        <component
          :is="xneko"
          class="display-option-layer"
          :controls-visible="UI表示中"
        />
      </template>

      <div v-show="UI表示中" class="left-bottom-settings">
        <label class="setting-select">
          <span>表示選択</span>
          <select v-model="表示選択">
            <option value="アバター">アバター</option>
            <option value="カレンダーα">カレンダー+α</option>
            <option value="xneko">xneko(猫)</option>
            <option value="xeyes">xeyes(目)</option>
            <option value="アナログ時計">アナログ時計</option>
            <option value="デジタル時計">デジタル時計</option>
            <option value="デジアナ時計">デジ+アナ時計</option>
            <option value="カレンダー">カレンダー</option>
            <option value="無し">無し</option>
          </select>
        </label>
      </div>

      <aside v-show="UI表示中" class="floating-controls">
        <button
          class="floating-icon microphone-icon"
          :class="{ active: マイク有効 }"
          :disabled="!inputConnected || !音声接続済み"
          type="button"
          title="マイク"
          @click="マイク切替"
        >
          <img src="/icons/microphone.png" alt="マイク" />
        </button>
        <button
          class="floating-icon speaker-icon"
          :class="{ inactive: !スピーカー有効, active: スピーカー有効 }"
          :disabled="!inputConnected || !音声接続済み"
          type="button"
          title="スピーカー"
          @click="スピーカー切替"
        >
          <img src="/icons/speaker.png" alt="スピーカー" />
        </button>
        <template>
        <button
          class="floating-icon file-icon"
          :class="{ inactive: !panelVisibility.file, active: panelVisibility.file }"
          type="button"
          title="ファイル"
          @click="パネル切替要求('file')"
        >
          <img src="/icons/folder.png" alt="ファイル" />
        </button>
        <button
          class="floating-icon chat-icon"
          :class="{ inactive: !panelVisibility.chat, active: panelVisibility.chat }"
          :disabled="!inputConnected"
          type="button"
          title="チャット"
          @click="パネル切替要求('chat')"
        >
          {{ props.chatCount ?? 0 }}
        </button>
        <button
          class="floating-icon agent-icon"
          :class="{ inactive: !panelVisibility.code1, active: panelVisibility.code1 }"
          :disabled="!inputConnected"
          type="button"
          title="コード1"
          @click="パネル切替要求('code1')"
        >
          1
        </button>
        <button
          class="floating-icon camera-icon"
          :class="{ active: panelVisibility.image }"
          :disabled="!inputConnected"
          type="button"
          title="イメージ"
          @click="パネル切替要求('image')"
        >
          <img src="/icons/camera.png" alt="イメージ" />
        </button>
        <button
          class="floating-icon agent-icon"
          :class="{ inactive: !panelVisibility.code2, active: panelVisibility.code2 }"
          :disabled="!inputConnected"
          type="button"
          title="コード2"
          @click="パネル切替要求('code2')"
        >
          2
        </button>
        <button
          class="floating-icon agent-icon"
          :class="{ inactive: !panelVisibility.code3, active: panelVisibility.code3 }"
          :disabled="!inputConnected"
          type="button"
          title="コード3"
          @click="パネル切替要求('code3')"
        >
          3
        </button>
        <button
          class="floating-icon agent-icon"
          :class="{ inactive: !panelVisibility.code4, active: panelVisibility.code4 }"
          :disabled="!inputConnected"
          type="button"
          title="コード4"
          @click="パネル切替要求('code4')"
        >
          4
        </button>
        <button
          class="floating-icon agent-icon"
          :class="{ inactive: !panelVisibility.code5, active: panelVisibility.code5 }"
          :disabled="!inputConnected"
          type="button"
          title="コード5"
          @click="パネル切替要求('code5')"
        >
          5
        </button>
        <button
          class="floating-icon agent-icon"
          :class="{ inactive: !panelVisibility.code6, active: panelVisibility.code6 }"
          :disabled="!inputConnected"
          type="button"
          title="コード6"
          @click="パネル切替要求('code6')"
        >
          6
        </button>
        </template>
        <button
          class="floating-icon config-icon"
          :disabled="!inputConnected"
          type="button"
          title="モデル設定"
          @click="設定再起動要求"
        >
          <img src="/icons/setting.png" alt="設定" class="icon-image" />
        </button>
      </aside>
    </div>
  </component>
</template>

<style scoped>
.core-panel-body {
  position: relative;
  width: 100%;
  height: 100%;
}

.core-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
}

.core-status-dot.on {
  background: #44ff44;
}

.core-status-dot.partial {
  background: #facc15;
}

.core-status-text {
  font-size: 10px;
  font-weight: bold;
}

.core-user-label {
  max-width: 180px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.title-action-button {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid #16a34a;
  background: #22c55e;
  color: #ffffff;
  border-radius: 2px;
  cursor: pointer;
  font-size: 14px;
  line-height: 18px;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.title-action-button:hover {
  background: #34d399;
  border-color: #22c55e;
  transform: translateY(-1px);
}





.audio-visualizer-overlay {
  position: absolute;
  top: 20px;
  right: 54px; /* floating-controls right(14px) + mic button width(32px) + gap(8px) */
  width: min(180px, 28vw);
  height: 32px;
  background: rgba(3, 5, 10, 0.26);
  border: 1px solid rgba(153, 141, 214, 0.32);
  border-radius: 0;
  overflow: hidden;
  z-index: 8;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  pointer-events: none;
  padding: 4px 6px;
  backdrop-filter: blur(12px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
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
  transition: height 0.05s ease-out;
}

.audio-bar.input-audio {
  background: #ff4444;
  order: 2;
}

.audio-bar.output-audio {
  background: #44ff44;
  order: 1;
}

.welcome-info-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: auto;
  pointer-events: none;
  user-select: none;
  direction: rtl;
  font-family: 'Courier New', monospace;
  font-size: 10px;
  line-height: 1.35;
  padding: 12px 56px 12px 12px;
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
  color: #ffffff;
  white-space: pre-wrap;
  word-break: break-word;
  opacity: 1;
  filter: blur(0);
  text-shadow: 0 0 2px rgba(216, 225, 255, 0.25);
  transition: color 0.45s ease, filter 0.45s ease, text-shadow 0.45s ease;
  direction: ltr;
  text-align: left;
  position: relative;
  z-index: 1;
  font-family: 'Courier New', monospace;
}

.welcome-info-overlay.is-hover .welcome-body-text {
  color: #ffffff;
  filter: blur(0);
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.65);
}

.avatar-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
}

.display-option-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
}

.カレンダーα時計 {
  align-items: flex-end;
  padding-bottom: 24px;
}

.left-bottom-settings {
  position: absolute;
  left: 16px;
  bottom: 12px;
  min-height: 34px;
  z-index: 7;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 0;
}

.setting-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #f4f4ff;
  font-size: 10px;
  line-height: 1.2;
  user-select: none;
}

.setting-select select {
  width: 112px;
  height: 20px;
  border: 1px solid rgba(244, 244, 255, 0.82);
  border-radius: 2px;
  background: rgba(20, 20, 28, 0.72);
  color: #f4f4ff;
  font-size: 10px;
  line-height: 1;
  outline: none;
  cursor: pointer;
}

.floating-controls {
  position: absolute;
  top: 20px;
  right: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 9;
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
  width: 22px;
  height: 22px;
  min-width: 22px;
  min-height: 22px;
  max-width: 22px;
  max-height: 22px;
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

.floating-icon.chat-icon,
.floating-icon.agent-icon {
  padding-top: 3px;
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

@media (max-width: 900px) {
  .welcome-info-overlay {
    inset: 0;
    padding: 10px 46px 10px 10px;
  }

  .left-bottom-settings {
    left: 12px;
    bottom: 12px;
    padding: 0;
  }

}
</style>
