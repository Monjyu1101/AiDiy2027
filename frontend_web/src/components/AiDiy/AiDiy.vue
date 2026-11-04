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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import apiClient from '@/api/client';
import AI設定再起動 from './dialog/AI設定再起動.vue';
import { AIWebSocket, createWebSocketUrl, type IWebSocketClient } from '@/api/websocket';
import AIコアコントロール from './compornents/AIコア.vue';
import AIコアチャット from './compornents/AIチャット.vue';
import AIコアイメージ from './compornents/AIイメージ.vue';
import AIコアコード from './compornents/AIコード.vue';
import AIコアファイル from './compornents/AIファイル.vue';

type PanelKey = 'chat' | 'file' | 'image' | 'code1' | 'code2' | 'code3' | 'code4' | 'code5' | 'code6';
type チャットモード型 = 'chat' | 'live' | 'code1' | 'code2' | 'code3' | 'code4' | 'code5' | 'code6';

const PANEL_KEYS: PanelKey[] = ['chat', 'file', 'image', 'code1', 'code2', 'code3', 'code4', 'code5', 'code6'];

function パネル状態生成(): Record<PanelKey, boolean> {
  return {
    chat: false,
    file: false,
    image: false,
    code1: false,
    code2: false,
    code3: false,
    code4: false,
    code5: false,
    code6: false,
  };
}

const セッションID = ref('');
const 入力ソケット = ref<IWebSocketClient | null>(null);
const コアソケット = ref<IWebSocketClient | null>(null);
const 入力接続済み = ref(false);
const コア処理中 = ref(false);
const コアエラー = ref('');

const モデル設定 = ref({
  CODE_BASE_PATH: '',
  CHAT_AI_NAME: '',
  LIVE_AI_NAME: '',
  CODE_AI1_NAME: '',
  CODE_AI2_NAME: '',
  CODE_AI3_NAME: '',
  CODE_AI4_NAME: '',
  CODE_AI5_NAME: '',
  CODE_AI6_NAME: '',
  CODE_PERMISSIONS: 'auto',
  TASK_AI_NAME: 'claude_cli',
  TASK_AI_MODEL_plan: 'auto',
  TASK_AI_MODEL_do: 'auto',
  TASK_AI_MODEL_check: 'auto',
  TEAM_AI_NAME: 'claude_cli',
  TEAM_AI_MODEL_plan: 'auto',
  TEAM_AI_MODEL_do: 'auto',
  TEAM_AI_MODEL_check: 'auto'
});

const チャットモード = ref<チャットモード型>('live');
const 入力ウェルカム情報 = ref('');
const 入力ウェルカム本文 = ref('');

const パネル表示中 = ref<Record<PanelKey, boolean>>(パネル状態生成());
const パネルレイアウト中 = ref<Record<PanelKey, boolean>>(パネル状態生成());
const パネルボタン状態 = ref<Record<PanelKey, boolean>>(パネル状態生成());

const 初期マイク有効 = ref(false);
const 初期スピーカー有効 = ref(true);
const 音声状態シード = ref(0);
const チャット数 = computed(() => 0);

const 自動選択表示 = ref(false);
const 設定再起動表示 = ref(false);
const パネル表示状態 = computed<Record<PanelKey, boolean>>(() => ({ ...パネルボタン状態.value }));

function 受信内容文字列(受信データ: any) {
  const 内容 = 受信データ?.メッセージ内容 ?? 受信データ?.text ?? '';
  if (!内容) return '';
  return typeof 内容 === 'string' ? 内容 : JSON.stringify(内容);
}

function パネル表示設定(panel: PanelKey, visible: boolean) {
  パネル表示中.value[panel] = visible;
}

function パネルレイアウト設定(panel: PanelKey, visible: boolean) {
  パネルレイアウト中.value[panel] = visible;
}

function パネルボタン設定(panel: PanelKey, visible: boolean) {
  パネルボタン状態.value[panel] = visible;
}

function パネルボタン取得(panel: PanelKey) {
  return パネルボタン状態.value[panel];
}

function コア状態リセット() {
  入力接続済み.value = false;
  コア処理中.value = false;
  コアエラー.value = '';
  入力ウェルカム情報.value = '';
  入力ウェルカム本文.value = '';
  初期マイク有効.value = false;
  初期スピーカー有効.value = true;
  音声状態シード.value = 0;
  チャットモード.value = 'live';
   モデル設定.value = {
     CODE_BASE_PATH: '',
     CHAT_AI_NAME: '',
     LIVE_AI_NAME: '',
     CODE_AI1_NAME: '',
     CODE_AI2_NAME: '',
     CODE_AI3_NAME: '',
     CODE_AI4_NAME: '',
     CODE_AI5_NAME: '',
     CODE_AI6_NAME: '',
     CODE_PERMISSIONS: 'auto',
     TASK_AI_NAME: 'claude_cli',
     TASK_AI_MODEL_plan: 'auto',
     TASK_AI_MODEL_do: 'auto',
     TASK_AI_MODEL_check: 'auto',
     TEAM_AI_NAME: 'claude_cli',
     TEAM_AI_MODEL_plan: 'auto',
     TEAM_AI_MODEL_do: 'auto',
     TEAM_AI_MODEL_check: 'auto'
   };
  パネルボタン状態.value = パネル状態生成();
  パネル表示中.value = パネル状態生成();
  パネルレイアウト中.value = パネル状態生成();
  自動選択表示.value = false;
}

function コア切断() {
  入力ソケット.value?.disconnect();
  コアソケット.value?.disconnect();
  入力ソケット.value = null;
  コアソケット.value = null;
  コア状態リセット();
}

function ソケット状態バインド(client: IWebSocketClient, target: typeof 入力接続済み) {
  // 接続情報（モデル・プロジェクトフォルダ）の反映後に各パネルを接続する。
  client.onStateChange((connected) => {
    if (!connected) target.value = false;
  });
  client.on('init', () => {
    target.value = client.isConnected();
  });
}

function ボタン状態取得() {
  return {
    ファイル: パネルボタン状態.value.file,
    チャット: パネルボタン状態.value.chat,
    エージェント1: パネルボタン状態.value.code1,
    イメージ: パネルボタン状態.value.image,
    エージェント2: パネルボタン状態.value.code2,
    エージェント3: パネルボタン状態.value.code3,
    エージェント4: パネルボタン状態.value.code4,
    エージェント5: パネルボタン状態.value.code5,
    エージェント6: パネルボタン状態.value.code6,
    チャットモード: チャットモード.value
  };
}

function パネル状態反映(ボタン?: Record<string, any>) {
  const states: Record<PanelKey, boolean> = {
    chat: Boolean(ボタン?.チャット ?? true),
    file: Boolean(ボタン?.ファイル),
    image: Boolean(ボタン?.イメージ),
    code1: Boolean(ボタン?.エージェント1),
    code2: Boolean(ボタン?.エージェント2),
    code3: Boolean(ボタン?.エージェント3),
    code4: Boolean(ボタン?.エージェント4),
    code5: Boolean(ボタン?.エージェント5),
    code6: Boolean(ボタン?.エージェント6)
  };

  PANEL_KEYS.forEach((panel) => {
    パネルボタン設定(panel, states[panel]);
    パネル表示設定(panel, states[panel]);
    パネルレイアウト設定(panel, states[panel]);
  });

  自動選択表示.value = false;
}

function 初期化処理(message: Record<string, any>) {
  const payload = message.メッセージ内容 ?? {};
  const buttons = payload.ボタン ?? {};
  const settings = payload.モデル設定 ?? {};

  モデル設定.value = {
    CODE_BASE_PATH: settings.CODE_BASE_PATH || '',
    CHAT_AI_NAME: settings.CHAT_AI_NAME || '',
    LIVE_AI_NAME: settings.LIVE_AI_NAME || '',
    CODE_AI1_NAME: settings.CODE_AI1_NAME || '',
    CODE_AI2_NAME: settings.CODE_AI2_NAME || '',
    CODE_AI3_NAME: settings.CODE_AI3_NAME || '',
    CODE_AI4_NAME: settings.CODE_AI4_NAME || '',
    CODE_AI5_NAME: settings.CODE_AI5_NAME || '',
    CODE_AI6_NAME: settings.CODE_AI6_NAME || '',
    CODE_PERMISSIONS: settings.CODE_PERMISSIONS || 'auto',
    TASK_AI_NAME: settings.TASK_AI_NAME || 'claude_cli',
    TASK_AI_MODEL_plan: settings.TASK_AI_MODEL_plan || 'auto',
    TASK_AI_MODEL_do: settings.TASK_AI_MODEL_do || 'auto',
    TASK_AI_MODEL_check: settings.TASK_AI_MODEL_check || 'auto',
    TEAM_AI_NAME: settings.TEAM_AI_NAME || 'claude_cli',
    TEAM_AI_MODEL_plan: settings.TEAM_AI_MODEL_plan || 'auto',
    TEAM_AI_MODEL_do: settings.TEAM_AI_MODEL_do || 'auto',
    TEAM_AI_MODEL_check: settings.TEAM_AI_MODEL_check || 'auto'
  };

  初期マイク有効.value = Boolean(buttons.マイク);
  初期スピーカー有効.value = buttons.スピーカー ?? true;
  チャットモード.value = (buttons.チャットモード || 'live') as チャットモード型;
  音声状態シード.value += 1;

  パネル状態反映(buttons);
}

function パネル有効化(panel: PanelKey) {
  パネルボタン設定(panel, true);
  パネルレイアウト設定(panel, true);
  パネル表示設定(panel, true);
}

function パネル閉じる(panel: PanelKey) {
  パネル表示設定(panel, false);
  パネルボタン設定(panel, false);

  if (panel === 'image') {
    自動選択表示.value = false;
  }
}

function パネル退場後(panel: PanelKey) {
  パネルレイアウト設定(panel, false);
}

function パネル切替(panel: PanelKey) {
  const current = パネルボタン取得(panel);

  if (panel === 'image' && !current) {
    自動選択表示.value = false;
    nextTick(() => {
      自動選択表示.value = true;
    });
  }

  パネルボタン設定(panel, !current);
  if (!current) {
    パネルレイアウト設定(panel, true);
    パネル表示設定(panel, true);
    return;
  }

  パネル表示設定(panel, false);
  if (panel === 'image') {
    自動選択表示.value = false;
  }
}

function 設定再起動を開く() {
  設定再起動表示.value = true;
}

function 設定再起動を閉じる() {
  設定再起動表示.value = false;
}

async function 設定再起動保存完了() {
  設定再起動表示.value = false;
  await 再接続();
}

function チャットモード更新(nextMode: チャットモード型) {
  チャットモード.value = nextMode;
}

async function 操作状態同期() {
  if (!セッションID.value || !入力ソケット.value?.isConnected()) {
    return;
  }

  const ボタン = ボタン状態取得();

  try {
    入力ソケット.value.updateState(ボタン);
    console.log('[AIコア] 状態更新 (WebSocket):', { ボタン });
  } catch (error) {
    console.error('[AIコア] 操作状態同期エラー:', error);
  }
}

async function コア初期化(preferredSessionId = ''): Promise<string> {
  コア切断();
  コア処理中.value = true;
  コアエラー.value = '';

  let resolvedSessionId = preferredSessionId;

  try {
    const initResponse = await apiClient.post('/core/AIコア/初期化', {
      セッションID: preferredSessionId || ''
    });
    if (initResponse.data.status === 'OK' && initResponse.data.data?.セッションID) {
      resolvedSessionId = initResponse.data.data.セッションID;
    }
  } catch {
    // REST失敗時はWebSocket側の初期化へ委譲
  }

  try {
    const wsUrl = createWebSocketUrl('/core/ws/AIコア');
    console.log('[AIコア] WebSocket接続開始:', wsUrl, 'セッションID:', resolvedSessionId);

    const nextCoreSocket = new AIWebSocket(wsUrl, resolvedSessionId, 'core');
    ソケット状態バインド(nextCoreSocket, 入力接続済み);
    nextCoreSocket.on('init', 初期化処理);
    nextCoreSocket.on('welcome_info', (message) => {
      const 内容 = 受信内容文字列(message);
      if (内容) {
        入力ウェルカム情報.value = 内容;
      }
    });
    nextCoreSocket.on('welcome_text', (message) => {
      const 内容 = 受信内容文字列(message);
      if (内容) {
        入力ウェルカム本文.value = 内容;
      }
    });
    nextCoreSocket.on('streaming_started', (message) => {
      console.log('[AIコア] ストリーミング開始:', message);
    });
    nextCoreSocket.on('heartbeat', (message) => {
      console.log('[AIコア] ハートビート:', message.count);
    });
    nextCoreSocket.on('channel_registered', (message) => {
      console.log('[AIコア] チャンネル登録確認:', message);
    });
    nextCoreSocket.on('channel_unregistered', (message) => {
      console.log('[AIコア] チャンネル解除確認:', message);
    });
    nextCoreSocket.on('error', (message) => {
      console.error('[AIコア] エラー:', message.error);
      コアエラー.value = String(message.メッセージ内容 || message.error || 'AIコア接続エラー');
    });

    const nextSessionId = await nextCoreSocket.connect();
    セッションID.value = nextSessionId;
    コアソケット.value = nextCoreSocket;

    const nextInputSocket = new AIWebSocket(wsUrl, nextSessionId, 'input', モデル設定.value.CODE_BASE_PATH);
    nextInputSocket.on('error', (message) => {
      コアエラー.value = String(message.メッセージ内容 || message.error || 'AIコア入力エラー');
    });
    nextInputSocket.onStateChange((connected) => {
      if (connected) void 操作状態同期();
    });
    nextInputSocket.connect().catch((error) => {
      console.error('[AIコア] inputチャンネル接続エラー:', error);
    });
    入力ソケット.value = nextInputSocket;

    return nextSessionId;
  } catch (error) {
    console.error('[AIコア] WebSocket接続エラー:', error);
    コアエラー.value = error instanceof Error ? error.message : 'AIコアへ接続できませんでした。';
    コア切断();
    throw error;
  } finally {
    コア処理中.value = false;
  }
}

async function 再接続() {
  const sessionId = セッションID.value || new URLSearchParams(window.location.search).get('セッションID') || '';
  const nextSessionId = await コア初期化(sessionId);
  if (!new URLSearchParams(window.location.search).get('セッションID')) {
    const nextUrl = `${window.location.pathname}?セッションID=${nextSessionId}`;
    window.history.replaceState(null, '', nextUrl);
  }
}

watch(
  () => ({
    ファイル: パネルボタン状態.value.file,
    チャット: パネルボタン状態.value.chat,
    エージェント1: パネルボタン状態.value.code1,
    イメージ: パネルボタン状態.value.image,
    エージェント2: パネルボタン状態.value.code2,
    エージェント3: パネルボタン状態.value.code3,
    エージェント4: パネルボタン状態.value.code4,
    エージェント5: パネルボタン状態.value.code5,
    エージェント6: パネルボタン状態.value.code6,
    チャットモード: チャットモード.value
  }),
  () => {
    void 操作状態同期();
  },
  { deep: true }
);

const 表示パネル数 = computed(() => {
  return Object.values(パネルレイアウト中.value).filter(Boolean).length;
});

const グリッドレイアウトクラス = computed(() => {
  const count = 表示パネル数.value;
  if (count === 0) return 'layout-empty';
  if (count === 1) return 'layout-single';
  if (count === 2) return 'layout-double';
  if (count === 3) return 'layout-triple';
  if (count === 4) return 'layout-quad';
  return 'layout-multi';
});

onMounted(async () => {
  const URLのセッションID = new URLSearchParams(window.location.search).get('セッションID') || '';
  console.log('[AIコア] ========================================');
  console.log('[AIコア] 初期化開始');
  console.log('[AIコア] URLからのセッションID:', URLのセッションID);
  console.log('[AIコア] ========================================');

  try {
    const nextSessionId = await コア初期化(URLのセッションID);
    if (!URLのセッションID) {
      const nextUrl = `${window.location.pathname}?セッションID=${nextSessionId}`;
      window.history.replaceState(null, '', nextUrl);
    }
    console.log('[AIコア] ========================================');
    console.log('[AIコア] ✅ 初期化完了');
    console.log('[AIコア] セッションID:', nextSessionId);
    console.log('[AIコア] 入力接続済み:', 入力接続済み.value);
    console.log('[AIコア] ========================================');
  } catch (error) {
    console.error('[AIコア] ========================================');
    console.error('[AIコア] ❌ 初期化エラー:', error);
    console.error('[AIコア] ========================================');
    コアエラー.value = `初期化失敗: ${error}`;
  }
});

onBeforeUnmount(() => {
  コア切断();
});
</script>

<template>
  <component
    :is="AIコアコントロール"
    :session-id="セッションID"
    :code-base-path="モデル設定.CODE_BASE_PATH"
    :live-model="モデル設定.LIVE_AI_NAME"
    :input-connected="入力接続済み"
    :input-socket="入力ソケット"
    :initial-mic-enabled="初期マイク有効"
    :initial-speaker-enabled="初期スピーカー有効"
    :audio-state-seed="音声状態シード"
    :panel-visibility="パネル表示状態"
    :chat-count="チャット数"
    :core-busy="コア処理中"
    :core-error="コアエラー"
    :welcome-info="入力ウェルカム情報"
    :welcome-body="入力ウェルカム本文"
    @toggle-panel="パネル切替"
    @reconnect="再接続"
    @open-setting-restart="設定再起動を開く"
  />

  <div class="ai-core-view">
    <!-- エラーメッセージ表示 -->
    <div v-if="コアエラー" class="error-message">
      <button class="error-close" @click="コアエラー = ''">×</button>
      <strong>エラー:</strong> {{ コアエラー }}
    </div>

    <!-- コンポーネントグリッド -->
    <div class="components-grid" :class="グリッドレイアウトクラス">
      <!-- ファイル -->
      <Transition name="panel-expand" @after-leave="パネル退場後('file')">
      <div v-show="パネル表示中.file" class="component-panel">
        <AIコアファイル
          :セッションID="セッションID"
          :active="パネル表示中.file"
          :入力接続済み="入力接続済み"
          :ws-client="入力ソケット ?? null"
          @close="パネル閉じる('file')"
        />
      </div>
      </Transition>

      <!-- チャット -->
      <Transition name="panel-expand" @after-leave="パネル退場後('chat')">
      <div v-show="パネル表示中.chat" class="component-panel">
        <AIコアチャット
          :セッションID="セッションID"
          チャンネル="0"
          :chat-ai="モデル設定.CHAT_AI_NAME"
          :live-ai="モデル設定.LIVE_AI_NAME"
          :chat-mode="チャットモード"
          :input-ws-client="入力ソケット"
          :input-connected="入力接続済み"
          @mode-change="チャットモード更新"
          @activate="パネル有効化('chat')"
          @close="パネル閉じる('chat')"
        />
      </div>
      </Transition>

      <!-- エージェント1 -->
      <Transition name="panel-expand" @after-leave="パネル退場後('code1')">
      <div v-show="パネル表示中.code1" class="component-panel">
        <AIコアコード
          key="code-1"
          :セッションID="セッションID"
          チャンネル="1"
          :code-ai="モデル設定.CODE_AI1_NAME"
          :input-ws-client="入力ソケット"
          :input-connected="入力接続済み"
          @activate="パネル有効化('code1')"
          @close="パネル閉じる('code1')"
        />
      </div>
      </Transition>

      <!-- イメージ -->
      <Transition name="panel-expand" @after-leave="パネル退場後('image')">
      <div v-show="パネル表示中.image" class="component-panel">
        <AIコアイメージ
          :auto-show-selection="自動選択表示"
          :セッションID="セッションID"
          :active="パネル表示中.image"
          :ws-connected="入力接続済み"
          :ws-client="入力ソケット ?? null"
          チャンネル="input"
          @selection-cancel="パネル閉じる('image')"
          @selection-complete="自動選択表示 = false"
          @close="パネル閉じる('image')"
        />
      </div>
      </Transition>

      <!-- エージェント2 -->
      <Transition name="panel-expand" @after-leave="パネル退場後('code2')">
      <div v-show="パネル表示中.code2" class="component-panel">
        <AIコアコード
          key="code-2"
          :セッションID="セッションID"
          チャンネル="2"
          :code-ai="モデル設定.CODE_AI2_NAME"
          :input-ws-client="入力ソケット"
          :input-connected="入力接続済み"
          @activate="パネル有効化('code2')"
          @close="パネル閉じる('code2')"
        />
      </div>
      </Transition>

      <!-- エージェント3 -->
      <Transition name="panel-expand" @after-leave="パネル退場後('code3')">
      <div v-show="パネル表示中.code3" class="component-panel">
        <AIコアコード
          key="code-3"
          :セッションID="セッションID"
          チャンネル="3"
          :code-ai="モデル設定.CODE_AI3_NAME"
          :input-ws-client="入力ソケット"
          :input-connected="入力接続済み"
          @activate="パネル有効化('code3')"
          @close="パネル閉じる('code3')"
        />
      </div>
      </Transition>

      <!-- エージェント4 -->
      <Transition name="panel-expand" @after-leave="パネル退場後('code4')">
      <div v-show="パネル表示中.code4" class="component-panel">
        <AIコアコード
          key="code-4"
          :セッションID="セッションID"
          チャンネル="4"
          :code-ai="モデル設定.CODE_AI4_NAME"
          :input-ws-client="入力ソケット"
          :input-connected="入力接続済み"
          @activate="パネル有効化('code4')"
          @close="パネル閉じる('code4')"
        />
      </div>
      </Transition>

      <!-- エージェント5 -->
      <Transition name="panel-expand" @after-leave="パネル退場後('code5')">
      <div v-show="パネル表示中.code5" class="component-panel">
        <AIコアコード
          key="code-5"
          :セッションID="セッションID"
          チャンネル="5"
          :code-ai="モデル設定.CODE_AI5_NAME"
          :input-ws-client="入力ソケット"
          :input-connected="入力接続済み"
          @activate="パネル有効化('code5')"
          @close="パネル閉じる('code5')"
        />
      </div>
      </Transition>

      <!-- エージェント6 -->
      <Transition name="panel-expand" @after-leave="パネル退場後('code6')">
      <div v-show="パネル表示中.code6" class="component-panel">
        <AIコアコード
          key="code-6"
          :セッションID="セッションID"
          チャンネル="6"
          :code-ai="モデル設定.CODE_AI6_NAME"
          :input-ws-client="入力ソケット"
          :input-connected="入力接続済み"
          @activate="パネル有効化('code6')"
          @close="パネル閉じる('code6')"
        />
      </div>
      </Transition>

    </div>
    <AI設定再起動
      :is-open="設定再起動表示"
      :session-id="セッションID"
      @close="設定再起動を閉じる"
      @saved="設定再起動保存完了"
    />
  </div>
</template>

<style scoped>
.ai-core-view {
  width: 100%;
  height: calc(100vh - 100px);
  position: relative;
  background: #1a1a1a;
  overflow-y: auto;
  overflow-x: hidden;
}

/* エラーメッセージ */
.error-message {
  position: absolute;
  top: 60px;
  left: 10px;
  right: 10px;
  background: rgba(255, 68, 68, 0.95);
  color: white;
  border: 2px solid #cc0000;
  border-radius: 4px;
  padding: 12px 40px 12px 12px;
  z-index: 998;
  font-size: 12px;
  font-family: 'Courier New', monospace;
  word-wrap: break-word;
  max-width: 600px;
}

.error-close {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(255, 255, 255, 0.3);
  color: white;
  border: none;
  border-radius: 2px;
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.error-close:hover {
  background: rgba(255, 255, 255, 0.5);
}

.core-guide-overlay {
  position: absolute;
  top: 12px;
  left: 16px;
  width: 30vw;
  max-width: 520px;
  min-width: 220px;
  height: calc(100% - 24px);
  overflow: auto;
  z-index: 1;
  pointer-events: none;
  user-select: none;
  direction: rtl; /* 縦スクロールバーを左側へ */
  font-family: 'Courier New', monospace;
  font-size: 10px;
  line-height: 1.35;
}

.core-guide-overlay::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(to left, rgba(26, 26, 26, 0.95) 0%, rgba(26, 26, 26, 0) 13%),
    linear-gradient(to top, rgba(26, 26, 26, 0.95) 0%, rgba(26, 26, 26, 0) 16%);
  z-index: 2;
}

.core-guide-overlay::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.core-guide-overlay::-webkit-scrollbar-track {
  background: rgba(26, 26, 26, 0.35);
}

.core-guide-overlay::-webkit-scrollbar-thumb {
  background: rgba(196, 210, 255, 0.35);
  border-radius: 3px;
}

.core-guide-info {
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
  color: #ffffff;
  text-shadow: none;
  white-space: pre-wrap;
  word-break: break-word;
  direction: ltr;
  text-align: left;
  position: relative;
  z-index: 1;
}

.core-guide-text {
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
}

.core-guide-overlay.is-hover .core-guide-text {
  color: #ffffff;
  filter: blur(0);
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.65);
}

/* コンポーネントグリッド - 基本設定 */
.components-grid {
  display: grid;
  gap: 18px;
  padding: 18px;
  width: 100%;
  height: 100%;
  min-height: 100%;
  box-sizing: border-box;
  transition: all 0.3s ease;
  position: relative;
  z-index: 2;
  justify-items: stretch;
  align-items: stretch;
  align-content: stretch;
  /* 7枚以上で増える行も、明示した行と同じ割合で高さを分け合う（中身の高さで他の行を潰さない） */
  grid-auto-rows: minmax(0, 1fr);
}

/* レイアウト: 0枚（空） */
.layout-empty {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
  place-items: center;
}

.layout-empty::after {
  content: 'コンポーネントが選択されていません';
  color: #666;
  font-size: 18px;
}

/* レイアウト: 1枚（全画面） */
.layout-single {
  grid-template-columns: 1fr;
  grid-template-rows: minmax(0, 1fr);
  padding-top: 40px;
  padding-bottom: 40px;
  padding-left: 20%;
  padding-right: 20%;
}

/* レイアウト: 2枚（左右分割） */
.layout-double {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  padding-top: 40px;
  padding-bottom: 40px;
  padding-left: 13%;
  padding-right: 13%;
  column-gap: 4%;
}

/* レイアウト: 3枚（横並び） */
.layout-triple {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  padding-bottom: 40px;
}

/* レイアウト: 4枚（2×2グリッド） */
.layout-quad {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
}

/* レイアウト: 5枚以上（3×2グリッド） */
.layout-multi {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
}

/* 3枚以上は右端まで並ぶため、右上の接続状態・音声メーター（上端から約72px）と
   右端のアイコン列（右端から約52px）に右端パネルの見出しが隠れないよう余白を取る */
.layout-triple,
.layout-quad,
.layout-multi {
  padding-top: 84px;
  padding-right: 72px;
}

.component-panel {
  background: #000;
  border: 1px solid #333;
  border-radius: 2px;
  overflow: hidden;
  position: relative;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  transition: all 0.3s ease;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.component-panel:hover {
  border-color: #81c784; /* 淡い緑 */
  box-shadow: 0 0 20px rgba(129, 199, 132, 0.8); /* 全方向均等な影 */
}

/* レスポンシブ対応 */
@media (max-width: 1400px) {
  .layout-multi {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(3, minmax(0, 1fr));
  }

  .layout-triple {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: minmax(0, 1fr);
  }
}

@media (max-width: 900px) {
  .layout-double,
  .layout-triple,
  .layout-quad,
  .layout-multi {
    grid-template-columns: 1fr;
    grid-template-rows: repeat(auto-fit, minmax(320px, 1fr));
    padding-right: 64px;
  }

  .component-panel {
    width: 100%;
    height: 100%;
    min-height: 320px;
  }
}

/* 縦長画面での調整 */
@media (max-aspect-ratio: 1/1) {
  .layout-single {
    padding-left: 16px;
    padding-right: 16px;
  }

  /* 2枚表示は上下配置 */
  .layout-double {
    grid-template-columns: 1fr;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    padding-left: 16px;
    padding-right: 16px;
    row-gap: 16px;
  }
}

/* コンポーネント内のスタイル調整 */
.component-panel :deep(.chat-container),
.component-panel :deep(.file-container),
.component-panel :deep(.image-container),
.component-panel :deep(.agent-container) {
  width: 100%;
  height: 100%;
  border-radius: 0;
  box-shadow: none;
}

/* パネル展開アニメーション（狭い→広がる） */
.panel-expand-enter-active {
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
  transform-origin: center center;
}
.panel-expand-leave-active {
  transition: opacity 0.3s ease;
  pointer-events: none;
}
.panel-expand-enter-from {
  transform: scaleX(0.5) scaleY(0.55);
  opacity: 0.2;
}
.panel-expand-enter-to {
  transform: scaleX(1) scaleY(1);
  opacity: 1;
}
.panel-expand-leave-from {
  opacity: 1;
}
.panel-expand-leave-to {
  opacity: 0;
}
</style>
