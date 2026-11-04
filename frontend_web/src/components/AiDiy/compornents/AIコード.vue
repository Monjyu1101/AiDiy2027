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
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue';
import { AIWebSocket, createWebSocketUrl, type IWebSocketClient } from '@/api/websocket';
import UpdateFilesDialog from '../dialog/更新ファイル一覧.vue';
import FileContentDialog from '../dialog/ファイル内容表示.vue';
import apiClient from '@/api/client';
import { AIストリーム制御判定, AIストリーム表示内容 } from '@/utils/AIストリーム制御';

const プロパティ = defineProps<{
  セッションID?: string;
  チャンネル?: string;
  codeAi?: string;
  inputWsClient?: IWebSocketClient | null;
  inputConnected?: boolean;
}>();

const 通知 = defineEmits<{
  close: [];
  activate: [];
}>();

const 出力WebSocket = ref<IWebSocketClient | null>(null);
const 出力接続済み = ref(false);
const WebSocket接続中 = computed(() => (プロパティ.inputConnected ?? false) && 出力接続済み.value);
const セッションID = computed(() => プロパティ.セッションID ?? '');

// メッセージ構造体
interface メッセージ {
  id: string;
  role: 'input_text' | 'input_request' | 'output_text' | 'welcome_text' | 'input_file' | 'output_file' | 'cancel_run';
  content: string;
  render: 'effect' | 'static';
  kind: 'text' | 'file';
  fileName?: string | null;
  thumbnail?: string | null;
  isStream?: boolean;
  isCollapsed?: boolean;
}

let メッセージID連番 = 0;
const メッセージ一覧 = ref<メッセージ[]>([]);
const コンテンツ領域 = ref<HTMLElement | null>(null);

const 接続状態 = computed<'disconnected' | 'connected'>(() => (
  WebSocket接続中.value ? 'connected' : 'disconnected'
));

// テキスト入力関連
const 入力テキスト = ref('');
const テキストエリア = ref<HTMLTextAreaElement | null>(null);
const 送信ボタン = ref<HTMLButtonElement | null>(null);

// Enter は通常の改行。Tab で送信ボタンへ移動し、そこで Enter を押すと送信する。
function キー入力処理(event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey
      || event.isComposing || event.keyCode === 229) return;
  if (!送信ボタン.value || 送信ボタン.value.disabled) return;
  event.preventDefault();
  送信ボタン.value.focus();
}
const 送信中 = ref(false);
const 検証ループ回数 = ref(1);
const ドラッグ中 = ref(false);
const ストリーム受信中 = ref(false);
const 入力欄最大到達 = ref(false);
const 入力欄最小高さ = 60;
const 入力欄最大高さ = ref(380);
const 入力欄固定中 = ref(false);
const 入力欄固定高さ = ref(入力欄最小高さ);

const 入力欄状態リセット = () => {
  入力欄最大到達.value = false;
  入力欄固定中.value = false;
  入力欄固定高さ.value = 入力欄最小高さ;
  if (テキストエリア.value) {
    テキストエリア.value.style.height = `${入力欄最小高さ}px`;
  }
};

const 入力欄クリア = () => {
  入力テキスト.value = '';
  入力欄状態リセット();
  nextTick(() => {
    if (!テキストエリア.value) return;
    テキストエリア.value.focus();
    テキストエリア自動調整();
  });
};

const 入力欄最大高さ更新 = () => {
  const テキストエリア要素 = テキストエリア.value;
  if (!テキストエリア要素) return;
  const コンテナ = テキストエリア要素.closest('.agent-container') as HTMLElement | null;
  if (!コンテナ) return;
  const 候補高さ = Math.floor(コンテナ.clientHeight * 0.78);
  入力欄最大高さ.value = Math.max(入力欄最小高さ, 候補高さ);
};

// メッセージ送信（input_textとして送信）
const メッセージ送信 = async () => {
  if (!入力テキスト.value.trim() || 送信中.value || !WebSocket接続中.value) return;

  const 送信内容 = 入力テキスト.value.trim();
  入力テキスト.value = '';

  // テキストエリアの高さをリセット
  入力欄状態リセット();

  // ローカル表示はせず、サーバーからのエコーバックで表示

  // input_textとして送信
  if (プロパティ.inputWsClient && プロパティ.inputWsClient.isConnected()) {
    const チャンネル = プロパティ.チャンネル ?? '0';
    プロパティ.inputWsClient.send({
      セッションID: セッションID.value,
      チャンネル: チャンネル,
      メッセージ識別: 'input_text',
      メッセージ内容: 送信内容,
      self_check_loop: 検証ループ回数.value
    });
  }
};

// 画像ファイル送信（input_fileとして送信）
const 入力ファイル送信 = async (入力ファイル: File) => {
  if (!プロパティ.inputWsClient || !WebSocket接続中.value) return;

  try {
    const 読込 = new FileReader();
    読込.onload = async (e) => {
      const Base64データ = e.target?.result as string;
      const チャンネル = プロパティ.チャンネル ?? '0';
      プロパティ.inputWsClient?.send({
        セッションID: セッションID.value,
        チャンネル: チャンネル,
        メッセージ識別: 'input_file',
        メッセージ内容: Base64データ,
        ファイル名: 入力ファイル.name,
        サムネイル画像: null
      });
    };
    読込.readAsDataURL(入力ファイル);
  } catch (error) {
    console.error('[AIコード] ファイル送信エラー:', error);
    行追加('[エラー] ファイル送信に失敗しました。');
  }
};

// キャンセル送信（cancel_run）
const キャンセル送信 = () => {
  if (!ストリーム受信中.value || !WebSocket接続中.value) return;
  if (プロパティ.inputWsClient && プロパティ.inputWsClient.isConnected()) {
    const チャンネル = プロパティ.チャンネル ?? '0';
    プロパティ.inputWsClient.send({
      セッションID: セッションID.value,
      チャンネル: チャンネル,
      メッセージ識別: 'cancel_run',
      メッセージ内容: '強制停止！'
    });
  }
};

// ドラッグ&ドロップ
const ドラッグオーバー処理 = (イベント: DragEvent) => {
  イベント.preventDefault();
  if (!WebSocket接続中.value) return;
  ドラッグ中.value = true;
};

const ドラッグ離脱処理 = (イベント: DragEvent) => {
  イベント.preventDefault();
  if (イベント.currentTarget === イベント.target) {
    ドラッグ中.value = false;
  }
};

const ドロップ処理 = async (イベント: DragEvent) => {
  イベント.preventDefault();
  ドラッグ中.value = false;
  if (!WebSocket接続中.value) return;
  const ファイル一覧 = イベント.dataTransfer?.files;
  if (!ファイル一覧 || ファイル一覧.length === 0) return;
  for (const ファイル of Array.from(ファイル一覧)) {
    await 入力ファイル送信(ファイル);
  }
};

// テキストエリアの自動リサイズ
const テキストエリア自動調整 = () => {
  if (!テキストエリア.value) return;
  入力欄最大高さ更新();
  if (入力テキスト.value.length === 0) {
    入力欄状態リセット();
    return;
  }
  if (入力欄固定中.value) {
    入力欄最大到達.value = true;
    テキストエリア.value.style.height = `${入力欄固定高さ.value}px`;
    return;
  }
  テキストエリア.value.style.height = `${入力欄最小高さ}px`;
  const スクロール高 = テキストエリア.value.scrollHeight;
  const 次の高さ = Math.max(スクロール高, 入力欄最小高さ);
  const 上限到達 = 次の高さ >= 入力欄最大高さ.value;
  入力欄最大到達.value = 上限到達;
  if (上限到達) {
    入力欄固定中.value = true;
    入力欄固定高さ.value = 入力欄最大高さ.value;
    テキストエリア.value.style.height = `${入力欄固定高さ.value}px`;
    return;
  }
  テキストエリア.value.style.height = `${次の高さ}px`;
};

// 自動スクロール
const 最下部スクロール = () => {
  nextTick(() => {
    if (コンテンツ領域.value) {
      コンテンツ領域.value.scrollTop = コンテンツ領域.value.scrollHeight;
    }
  });
};

const 新規メッセージID = () => {
  const ソケット = セッションID.value || 'nosocket';
  const チャンネル = プロパティ.チャンネル ?? '0';
  return `code-${ソケット}-${チャンネル}-${メッセージID連番++}`;
};

const ファイルメッセージ追加 = (role: メッセージ['role'], fileName?: string | null, thumbnail?: string | null) => {
  メッセージ一覧.value.push({
    id: 新規メッセージID(),
    role,
    content: '',
    render: 'static',
    kind: 'file',
    fileName: fileName ?? null,
    thumbnail: thumbnail ?? null
  });
  最下部スクロール();
};

type 演出状態 = {
  container: HTMLElement;
  textSpan: HTMLElement;
  cursorSpan: HTMLElement;
  queue: string[];
  running: boolean;
  ready: boolean;
  finalizeOnEmpty: boolean;
  isStream: boolean;
  blinkInterval: ReturnType<typeof setInterval>;
};

const 演出状態Map = new Map<string, 演出状態>();

const 速度設定 = (文字数: number, isStream: boolean) => {
  if (isStream) {
    // output_streamは高速表示
    const batch = Math.max(8, Math.floor(文字数 / 12) + 2);
    return { interval: 2, batch };
  }
  // 通常メッセージは従来速度
  const batch = Math.floor(文字数 / 50) + 1;
  return { interval: 10, batch };
};

const 演出初期化 = (
  メッセージID: string,
  表示領域: HTMLElement,
  カーソル色: string = '#00ff00',
  isStream: boolean = false
) => {
  表示領域.innerHTML = '';
  
  // テキスト要素
  const textSpan = document.createElement('span');
  textSpan.className = 'terminal-text';
  表示領域.appendChild(textSpan);
  
  // カーソル要素（テキストの後ろに兄弟要素として配置）
  const cursorSpan = document.createElement('span');
  cursorSpan.className = 'terminal-cursor';
  cursorSpan.textContent = '\u0020';  // Unicode半角スペース
  cursorSpan.style.display = 'inline-block';
  cursorSpan.style.width = '8px';
  cursorSpan.style.backgroundColor = カーソル色;
  cursorSpan.style.color = '#000000';
  表示領域.appendChild(cursorSpan);

  // JavaScript で明滅制御（0.3秒周期）
  let blinkVisible = true;
  const blinkInterval = setInterval(() => {
    if (blinkVisible) {
      cursorSpan.style.backgroundColor = 'transparent';
    } else {
      cursorSpan.style.backgroundColor = カーソル色;
    }
    blinkVisible = !blinkVisible;
  }, 300);

  const state: 演出状態 = {
    container: 表示領域,
    textSpan,
    cursorSpan,
    queue: [],
    running: false,
    ready: false,
    finalizeOnEmpty: false,
    isStream,
    blinkInterval
  };
  演出状態Map.set(メッセージID, state);

  最下部スクロール();

  const 開始待機ms = isStream ? 30 : 500;
  console.log(`[コード演出] ${メッセージID}: ${開始待機ms}ms待機開始（カーソル明滅中）カーソル色=${カーソル色}`);
  window.setTimeout(() => {
    state.ready = true;
    console.log(`[コード演出] ${メッセージID}: ${開始待機ms}ms待機完了、テキスト表示開始`);
    演出実行(メッセージID);
  }, 開始待機ms);
  
  // 演出完了時にクリアできるように保存（型安全）
  state.blinkInterval = blinkInterval;
};

const 演出キュー追加 = (メッセージID: string, 文字列: string, finalize: boolean) => {
  const state = 演出状態Map.get(メッセージID);
  if (!state) return;
  if (文字列) {
    state.queue.push(文字列);
  }
  if (finalize) {
    state.finalizeOnEmpty = true;
  }
  演出実行(メッセージID);
};

const 演出実行 = (メッセージID: string) => {
  const state = 演出状態Map.get(メッセージID);
  if (!state || state.running || !state.ready) return;
  if (state.queue.length === 0) {
    if (state.finalizeOnEmpty) {
      // カーソルを削除
      if (state.cursorSpan && state.cursorSpan.parentNode) {
        state.cursorSpan.remove();
      }
      // 明滅タイマーをクリア
      if (state.blinkInterval) {
        clearInterval(state.blinkInterval);
      }
      console.log(`[コード演出] ${メッセージID}: 完了（カーソル削除）`);
      演出状態Map.delete(メッセージID);
      最下部スクロール();
    }
    return;
  }
  state.running = true;
  const chunk = state.queue.shift() ?? '';
  const { interval, batch } = 速度設定(chunk.length, state.isStream);
  let index = 0;

  const tick = () => {
    if (演出状態Map.get(メッセージID) !== state) return;
    const end = Math.min(index + batch, chunk.length);
    if (end > index) {
      state.textSpan.textContent += chunk.slice(index, end);
      index = end;
      nextTick(() => 最下部スクロール());
    }
    if (index >= chunk.length) {
      state.running = false;
      nextTick(() => 最下部スクロール());
      演出実行(メッセージID);
      return;
    }
    window.setTimeout(tick, interval);
  };

  tick();
};

const カーソル色取得 = (role: メッセージ['role']): string => {
  switch (role) {
    case 'input_text': return '#ffffff'
    case 'input_request': return '#00ffff'
    case 'cancel_run': return '#ff4444'
    default: return '#00ff00'
  }
};

const ターミナルメッセージ追加 = (role: メッセージ['role'], 内容: string, 追加オプション?: Partial<メッセージ>, finalize = true) => {
  const メッセージID = 新規メッセージID();
  メッセージ一覧.value.push({
    id: メッセージID,
    role,
    content: 内容,
    render: 'effect',
    kind: 'text',
    ...(追加オプション || {})
  });

  const カーソル色 = カーソル色取得(role);

  nextTick(() => {
    const メッセージ要素 = document.getElementById(メッセージID);
    if (!メッセージ要素) return;
    const bubbleElement = メッセージ要素.querySelector('.content-area') as HTMLElement | null;
    if (!bubbleElement) return;
    演出初期化(メッセージID, bubbleElement, カーソル色, false);
    演出キュー追加(メッセージID, 内容, finalize);
  });
};

// ターミナル風の出力を追加
const 行追加 = (text: string) => {
  ターミナルメッセージ追加('output_text', text);
};

const cancel_run受信処理 = (受信データ: any) => {
  表示時アクティブ化();
  const 内容 = 受信内容文字列(受信データ);
  if (!内容) return;
  ターミナルメッセージ追加('cancel_run', `> ${内容}`);
};

// WebSocketイベントハンドラ
const ウェルカム表示有無 = ref(false);
const ウェルカム内容 = ref<string>('');
const ウェルカムテキスト受信済み = ref(false);
const 更新ファイル一覧 = ref<string[]>([]);
const 更新ファイルダイアログ表示 = ref(false);
const ファイル内容ダイアログ表示 = ref(false);
const 表示ファイル名 = ref('');
const 表示base64_data = ref('');

const 表示時アクティブ化 = () => {
  if (!ウェルカムテキスト受信済み.value) return;
  通知('activate');
};

const 受信内容文字列 = (受信データ: any) => {
  const 内容 = 受信データ.メッセージ内容 ?? 受信データ.text ?? '';
  if (!内容) return '';
  return typeof 内容 === 'string' ? 内容 : JSON.stringify(内容);
};

const ウェルカム処理 = (受信データ: any) => {
  const 内容 = 受信内容文字列(受信データ);
  if (!内容) return;
  // 再接続で送られる履歴は置換し、復元だけではパネルを切り替えない。
  for (const state of 演出状態Map.values()) clearInterval(state.blinkInterval);
  演出状態Map.clear();
  メッセージ一覧.value = [];
  ストリームメッセージID = null;
  ウェルカムテキスト受信済み.value = false;
  ウェルカム内容.value = 内容;
  ウェルカム表示有無.value = true;
};
const 入力テキスト受信処理 = (受信データ: any) => {
  表示時アクティブ化();

  const 内容 = 受信内容文字列(受信データ);
  if (!内容) return;
  ターミナルメッセージ追加('input_text', `> ${内容}`);
};

const 入力リクエスト受信処理 = (受信データ: any) => {
  表示時アクティブ化();

  const 内容 = 受信内容文字列(受信データ);
  if (!内容) return;
  ターミナルメッセージ追加('input_request', 内容);
};

const 入力ファイル受信処理 = (受信データ: any) => {
  表示時アクティブ化();

  const fileName = 受信データ.ファイル名 ?? null;
  const thumbnail = 受信データ.サムネイル画像 ?? null;
  ファイルメッセージ追加('input_file', fileName, thumbnail);
};

const 出力テキスト受信処理 = (受信データ: any) => {
  表示時アクティブ化();

  const 内容 = 受信内容文字列(受信データ);
  if (!内容) return;
  ターミナルメッセージ追加('output_text', 内容);
};

const ウェルカムテキスト受信処理 = (受信データ: any) => {
  if (ウェルカムテキスト受信済み.value) {
    表示時アクティブ化();
  }
  ウェルカムテキスト受信済み.value = true;

  const 内容 = 受信内容文字列(受信データ);
  if (!内容) return;
  ターミナルメッセージ追加('welcome_text', 内容);
};

const 出力ファイル受信処理 = (受信データ: any) => {
  表示時アクティブ化();

  const fileName = 受信データ.ファイル名 ?? null;
  const thumbnail = 受信データ.サムネイル画像 ?? null;
  ファイルメッセージ追加('output_file', fileName, thumbnail);
};

const update_info受信処理 = (受信データ: any) => {
  const メッセージ内容 = 受信データ.メッセージ内容;
  let updateFiles: string[] = [];

  if (メッセージ内容 && typeof メッセージ内容 === 'object' && Array.isArray(メッセージ内容.update_files)) {
    updateFiles = メッセージ内容.update_files;
  }

  if (updateFiles.length === 0) {
    return;
  }
  表示時アクティブ化();

  // 更新ファイル一覧をダイアログ表示
  更新ファイル一覧.value = updateFiles;
  更新ファイルダイアログ表示.value = true;
};

// ストリーム表示用の一時メッセージID
let ストリームメッセージID: string | null = null;

const 出力ストリーム受信処理 = (受信データ: any) => {
  表示時アクティブ化();
  const 内容 = 受信内容文字列(受信データ);
  if (!内容) return;
  const 制御種別 = AIストリーム制御判定(内容);

  // 処理開始
  if (制御種別 === '開始') {
    const メッセージID = 新規メッセージID();
    ストリームメッセージID = メッセージID;
    ストリーム受信中.value = true;

    メッセージ一覧.value.push({
      role: 'output_text',
      content: '',
      id: メッセージID,
      kind: 'text',
      render: 'effect',
      isStream: true
    });

    nextTick(() => {
      const メッセージ要素 = document.getElementById(メッセージID);
      if (!メッセージ要素) return;
      const bubbleElement = メッセージ要素.querySelector('.content-area') as HTMLElement | null;
      if (!bubbleElement) return;
      演出初期化(メッセージID, bubbleElement, '#00ffff', true);
    });
    return;
  }

  // 処理終了・処理中断（制御コード自体は表示しない）
  if (制御種別 === '終了' || 制御種別 === '中断') {
    if (ストリームメッセージID) {
      演出キュー追加(ストリームメッセージID, '', true);
      const 対象メッセージ = メッセージ一覧.value.find(m => m.id === ストリームメッセージID);
      if (対象メッセージ) {
        対象メッセージ.isCollapsed = true;
      }
    }
    ストリームメッセージID = null;
    ストリーム受信中.value = false;
    return;
  }

  const 表示内容 = AIストリーム表示内容(内容);
  if (!表示内容) return;

  // ストリーム内容を追加
  if (ストリームメッセージID) {
    演出キュー追加(ストリームメッセージID, `${表示内容}\n`, false);
  } else {
    // ストリームメッセージIDが存在しない場合、新規にストリーム表示を開始
    const メッセージID = 新規メッセージID();
    ストリームメッセージID = メッセージID;

    メッセージ一覧.value.push({
      role: 'output_text',
      content: '',
      id: メッセージID,
      kind: 'text',
      render: 'effect',
      isStream: true
    });

    nextTick(() => {
      const メッセージ要素 = document.getElementById(メッセージID);
      if (!メッセージ要素) return;
      const bubbleElement = メッセージ要素.querySelector('.content-area') as HTMLElement | null;
      if (!bubbleElement) return;
      演出初期化(メッセージID, bubbleElement, '#00ffff', true);
      演出キュー追加(メッセージID, `${表示内容}\n`, false);
    });
  }
};

// 折りたたみ/展開切り替え
const 折りたたみ切替 = (メッセージID: string) => {
  const 対象メッセージ = メッセージ一覧.value.find(m => m.id === メッセージID);
  if (対象メッセージ && 対象メッセージ.isStream) {
    対象メッセージ.isCollapsed = !対象メッセージ.isCollapsed;
  }
};

const 貼り付け対象ロール: メッセージ['role'][] = [
  'input_text',
  'input_request',
  'input_file',
  'output_file',
  'output_text'
];

const 右トリム = (text: string) => text.replace(/\s+$/u, '');

const 貼り付け用文字列取得 = (メッセージ項目: メッセージ) => {
  if (メッセージ項目.kind === 'file') {
    const ファイル名 = メッセージ項目.fileName ?? '';
    return ファイル名 ? `"${ファイル名}"` : '';
  }

  let 内容 = メッセージ項目.content ?? '';

  // input_text は表示用に "> " を先頭へ付与しているため、貼り付け時は外す
  if (メッセージ項目.role === 'input_text') {
    内容 = 内容.replace(/^>\s*/, '');
  }

  return 内容;
};

const メッセージ貼り付け可能 = (メッセージ項目: メッセージ) => {
  if (メッセージ項目.isStream) return false;
  return 貼り付け対象ロール.includes(メッセージ項目.role);
};

const 画像拡張子セット = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const テキスト拡張子セット = new Set([
  'py', 'vue', 'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt',
  'html', 'css', 'scss', 'sass', 'less', 'yml', 'yaml', 'toml',
  'ini', 'env', 'sql', 'csv', 'log', 'xml', 'sh', 'ps1', 'bat'
]);

const 拡張子取得 = (ファイル名: string): string => {
  const クエリ除去 = ファイル名.split(/[?#]/u, 1)[0] || '';
  const 最後のスラッシュ位置 = Math.max(クエリ除去.lastIndexOf('/'), クエリ除去.lastIndexOf('\\'));
  const ベース名 = 最後のスラッシュ位置 >= 0 ? クエリ除去.slice(最後のスラッシュ位置 + 1) : クエリ除去;
  const ドット位置 = ベース名.lastIndexOf('.');
  if (ドット位置 < 0) return '';
  return ベース名.slice(ドット位置 + 1).toLowerCase();
};

const ファイル内容表示対象 = (ファイル名: string): boolean => {
  const 拡張子 = 拡張子取得(ファイル名);
  return 画像拡張子セット.has(拡張子) || テキスト拡張子セット.has(拡張子);
};

const ファイル内容ダイアログ閉じる = () => {
  ファイル内容ダイアログ表示.value = false;
  表示ファイル名.value = '';
  表示base64_data.value = '';
};

const ファイル内容表示を開く = async (ファイル名: string) => {
  if (!ファイル内容表示対象(ファイル名)) return;

  try {
    const response = await apiClient.post('/core/files/内容取得', { ファイル名 });
    if (response?.data?.status !== 'OK') return;
    const base64_data = response?.data?.data?.base64_data;
    if (typeof base64_data !== 'string' || !base64_data) return;

    表示ファイル名.value = ファイル名;
    表示base64_data.value = base64_data;
    ファイル内容ダイアログ表示.value = true;
  } catch (error) {
    console.error('[AIコード] ファイル内容取得エラー:', error);
  }
};

const メッセージ行クリック処理 = async (メッセージ項目: メッセージ) => {
  if (メッセージ項目.isStream) {
    if (メッセージ項目.isCollapsed) {
      折りたたみ切替(メッセージ項目.id);
    }
    return;
  }

  if (!メッセージ貼り付け可能(メッセージ項目)) return;

  const 貼り付け文字列 = 右トリム(貼り付け用文字列取得(メッセージ項目));
  if (!貼り付け文字列) return;

  const ファイル系メッセージ =
    メッセージ項目.role === 'input_file' || メッセージ項目.role === 'output_file';

  if (ファイル系メッセージ) {
    const 区切り = 入力テキスト.value && !入力テキスト.value.endsWith('\n') ? '\n' : '';
    入力テキスト.value = `${入力テキスト.value}${区切り}${貼り付け文字列}\n`;
  } else {
    入力テキスト.value = `${貼り付け文字列}\n`;
  }

  nextTick(() => {
    if (!テキストエリア.value) return;
    テキストエリア.value.focus();
    テキストエリア自動調整();
    const 末尾 = テキストエリア.value.value.length;
    テキストエリア.value.setSelectionRange(末尾, 末尾);
  });

  if (ファイル系メッセージ && メッセージ項目.fileName) {
    await ファイル内容表示を開く(メッセージ項目.fileName);
  }
};

const メッセージ行カーソル = (メッセージ項目: メッセージ) => {
  if (メッセージ項目.isStream && メッセージ項目.isCollapsed) return 'pointer';
  return メッセージ貼り付け可能(メッセージ項目) ? 'pointer' : 'default';
};

const WSハンドラ登録 = (client?: IWebSocketClient | null) => {
  if (!client) return;
  const ch = プロパティ.チャンネル ?? '0';

  client.on('welcome_info', ウェルカム処理);
  client.on('input_text', 入力テキスト受信処理);
  client.on('input_request', 入力リクエスト受信処理);
  client.on('input_file', 入力ファイル受信処理);
  client.on('output_text', 出力テキスト受信処理);
  client.on('welcome_text', ウェルカムテキスト受信処理);
  client.on('output_stream', 出力ストリーム受信処理);
  client.on('output_file', 出力ファイル受信処理);
  client.on('update_info', update_info受信処理);
  client.on('cancel_run', cancel_run受信処理);

  console.log(`[AIコード${ch}] ハンドラ登録完了`);
};

const WSハンドラ解除 = (client?: IWebSocketClient | null) => {
  if (!client) return;
  const ch = プロパティ.チャンネル ?? '0';

  client.off('welcome_info', ウェルカム処理);
  client.off('input_text', 入力テキスト受信処理);
  client.off('input_request', 入力リクエスト受信処理);
  client.off('input_file', 入力ファイル受信処理);
  client.off('output_text', 出力テキスト受信処理);
  client.off('welcome_text', ウェルカムテキスト受信処理);
  client.off('output_stream', 出力ストリーム受信処理);
  client.off('output_file', 出力ファイル受信処理);
  client.off('update_info', update_info受信処理);
  client.off('cancel_run', cancel_run受信処理);

  console.log(`[AIコード${ch}] ハンドラ削除完了`);
};

const 出力ソケット接続 = async () => {
  const チャンネル = プロパティ.チャンネル ?? '0';
  if (!セッションID.value) {
    console.warn(`[AIコード${チャンネル}] セッションID未確定のため出力ソケットを保留`);
    return;
  }

  const wsUrl = createWebSocketUrl('/core/ws/AIコア');
  出力WebSocket.value = new AIWebSocket(wsUrl, セッションID.value, チャンネル);
  WSハンドラ登録(出力WebSocket.value);

  try {
    await 出力WebSocket.value.connect();
    出力接続済み.value = true;
    console.log(`[AIコード${チャンネル}] 出力ソケット接続完了`);
  } catch (error) {
    出力接続済み.value = false;
    console.error(`[AIコード${チャンネル}] 出力ソケット接続エラー:`, error);
  }
};

// ダイアログイベントハンドラ
const 更新ファイルダイアログ閉じる = () => {
  更新ファイルダイアログ表示.value = false;
  更新ファイル一覧.value = [];
};

onMounted(() => {
  const チャンネル = プロパティ.チャンネル ?? '0';
  console.log(`[AIコード${チャンネル}] ========== onMounted開始 ==========`);
  console.log(`[AIコード${チャンネル}] チャンネル=${チャンネル}`);
  console.log(`[AIコード${チャンネル}] セッションID=${セッションID.value}`);
  console.log(`[AIコード${チャンネル}] inputWsClient=${!!プロパティ.inputWsClient}`);
  console.log(`[AIコード${チャンネル}] inputConnected=${プロパティ.inputConnected}`);
  出力ソケット接続();
  nextTick(() => {
    入力欄最大高さ更新();
    テキストエリア自動調整();
  });
  window.addEventListener('resize', テキストエリア自動調整);
  console.log(`[AIコード${チャンネル}] ========== onMounted完了 ==========`);
});

watch(() => プロパティ.セッションID, (newId, oldId) => {
  if (!newId || newId === oldId) return;
  ウェルカムテキスト受信済み.value = false;
  if (出力WebSocket.value) {
    WSハンドラ解除(出力WebSocket.value);
    出力WebSocket.value.disconnect();
    出力WebSocket.value = null;
    出力接続済み.value = false;
  }
  出力ソケット接続();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', テキストエリア自動調整);
  if (出力WebSocket.value) {
    WSハンドラ解除(出力WebSocket.value);
    出力WebSocket.value.disconnect();
    出力WebSocket.value = null;
  }
  出力接続済み.value = false;
});

// ステータステキスト
const 状態表示テキスト = () => {
  const 状態表示一覧 = {
    disconnected: '切断',
    connected: '接続中'
  };
  return 状態表示一覧[接続状態.value];
};
</script>

<template>
  <div class="agent-container show">
    <div class="agent-header">
      <button class="close-btn" @click="通知('close')" title="閉じる">×</button>
      <h1>Code Agent {{ チャンネル }} <span v-if="codeAi" class="model-info">({{ codeAi }})</span></h1>
      <div class="agent-status">
        <div :class="['agent-status-dot', 接続状態]"></div>
        <span>{{ 状態表示テキスト() }}</span>
      </div>
    </div>

    <div ref="コンテンツ領域" class="agent-content">
      <div class="welcome-message" v-if="ウェルカム内容">
        {{ ウェルカム内容 }}
      </div>

      <div
        v-for="メッセージ項目 in メッセージ一覧"
        :key="メッセージ項目.id"
        :id="メッセージ項目.id"
        :class="['terminal-line', メッセージ項目.role, メッセージ項目.isStream ? 'stream-output' : '', メッセージ項目.isCollapsed ? 'collapsed' : '']"
      >
        <div
          class="line-content"
          @click="メッセージ行クリック処理(メッセージ項目)"
          :style="{ cursor: メッセージ行カーソル(メッセージ項目) }"
        >
          <div v-if="メッセージ項目.isStream && メッセージ項目.isCollapsed" class="collapsed-wrapper">
            <span class="collapsed-indicator">...</span>
            <span class="collapsed-arrow">◀</span>
          </div>
          <div v-show="!(メッセージ項目.isStream && メッセージ項目.isCollapsed)" class="content-area">
            <template v-if="メッセージ項目.kind === 'file'">
              <div class="file-message">
                <div class="file-name">
                  <span v-if="メッセージ項目.role === 'input_file'">ファイル入力: </span>
                  <span v-if="メッセージ項目.role === 'output_file'">ファイル出力: </span>
                  {{ メッセージ項目.fileName || 'ファイル受信' }}
                </div>
                <img
                  v-if="メッセージ項目.thumbnail"
                  class="file-thumbnail"
                  :src="`data:image/png;base64,${メッセージ項目.thumbnail}`"
                  alt="thumbnail"
                />
              </div>
            </template>
            <template v-else-if="メッセージ項目.render === 'static'">
              {{ メッセージ項目.content }}
            </template>
            <template v-else-if="メッセージ項目.render === 'effect'">
              <!-- ターミナルエフェクトがここに直接DOMを書き込む -->
            </template>
          </div>
          <span
            v-if="メッセージ項目.isStream && !メッセージ項目.isCollapsed"
            class="expand-indicator"
            @click.stop="折りたたみ切替(メッセージ項目.id)"
            title="折りたたむ"
          >▼</span>
        </div>
      </div>
    </div>

    <div class="control-area">
      <div
        class="text-input-area"
        :class="{ 'drag-over': ドラッグ中 }"
        @dragover="ドラッグオーバー処理"
        @dragleave="ドラッグ離脱処理"
        @drop="ドロップ処理"
      >
        <div class="input-container">
          <span class="prompt-symbol" @click="入力欄クリア">&gt;</span>
          <textarea
            v-model="入力テキスト"
            :class="['input-field', { 'at-limit': 入力欄最大到達 }]"
            :style="{ maxHeight: `${入力欄最大高さ}px` }"
            placeholder="メッセージを入力..."
            maxlength="5000"
            title="Enter で改行、Tab で送信ボタンへ移動"
            :disabled="送信中 || !WebSocket接続中"
            @input="テキストエリア自動調整"
            @keydown="キー入力処理"
            ref="テキストエリア"
          ></textarea>
        </div>

        <div class="verification-options">
          <label class="verification-row">
            <span class="verification-label">検証</span>
            <select v-model.number="検証ループ回数" class="verification-select" title="0回はバックアップ・検証なし">
              <option :value="0">0回</option>
              <option :value="1">1回</option>
              <option :value="2">2回</option>
              <option :value="3">3回</option>
            </select>
          </label>
          <span class="verification-hint">0回:バックアップ・検証無</span>
        </div>

        <button
          ref="送信ボタン"
          class="agent-send-btn"
          :class="{
            'ws-disabled': !WebSocket接続中,
            'has-text': 入力テキスト.length > 0
          }"
          @click="メッセージ送信"
          :disabled="!入力テキスト.trim() || 送信中 || !WebSocket接続中"
          title="送信（フォーカス中に Enter）"
        >
          <img src="/icons/sending.png" alt="送信" />
          <span class="send-code-label">CODE</span>
        </button>

        <button
          class="agent-cancel-btn"
          :class="{ 'is-active': ストリーム受信中 }"
          @click="キャンセル送信"
          :disabled="!ストリーム受信中 || !WebSocket接続中"
          title="キャンセル"
        >
          <img src="/icons/abort.png" alt="キャンセル" />
        </button>
      </div>
    </div>

    <!-- 更新ファイル一覧ダイアログ -->
    <UpdateFilesDialog
      :show="更新ファイルダイアログ表示"
      :files="更新ファイル一覧"
      @close="更新ファイルダイアログ閉じる"
      @select-file="ファイル内容表示を開く"
    />

    <FileContentDialog
      :show="ファイル内容ダイアログ表示"
      :ファイル名="表示ファイル名"
      :base64_data="表示base64_data"
      @close="ファイル内容ダイアログ閉じる"
    />
  </div>
</template>

<style scoped>
.verification-options {
  display: grid;
  flex: 0 0 auto;
  height: 48px;
  margin-bottom: 20px;
  align-content: center;
  gap: 1px;
  white-space: nowrap;
}

.verification-row {
  display: grid;
  grid-template-columns: 1fr 52px;
  align-items: center;
  gap: 6px;
}

.verification-label {
  display: flex;
  align-items: center;
  justify-self: start;
  box-sizing: border-box;
  height: 22px;
  padding: 0 8px;
  line-height: normal;
  background: #fff;
  color: #000;
  font-size: 12px;
}

.verification-select {
  box-sizing: border-box;
  width: 52px;
  height: 22px;
  margin: 0;
  padding: 0 2px;
  border: 1px solid #666;
  border-radius: 0;
  background: #333;
  color: #ccc;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.verification-hint {
  color: #999;
  font-size: 9px;
  line-height: 11px;
}

.agent-container {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 2px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: 100%;
  height: 100%;
}

.agent-header {
  background: #c8c8c8;
  color: #333;
  padding: 5px 20px;
  text-align: center;
  position: relative;
}

.agent-header h1 {
  font-size: 22px;
  font-weight: bold;
  margin: 0;
  height: 28px;
  line-height: 28px;
}

.agent-header h1 .model-info {
  font-size: 14px;
  font-weight: normal;
  color: #666;
  margin-left: 8px;
}

.close-btn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  font-size: 24px;
  color: #333;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  line-height: 24px;
  text-align: center;
  transition: all 0.2s ease;
}

.close-btn:hover {
  color: #ff4444;
  transform: translateY(-50%) scale(1.2);
}

.agent-status {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: bold;
}

.agent-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.agent-status-dot.disconnected { background: #888888; }
.agent-status-dot.connected { background: #44ff44; }
.agent-status-dot.sending { background: #ff4444; }

.agent-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  overflow-x: auto;
  background: #000000;
  color: #00ff00;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
  box-sizing: border-box;
}

.welcome-message {
  background: rgba(102, 126, 234, 0.08);
  color: #b8c5f2;
  padding: 12px 16px;
  border-radius: 2px;
  margin: 8px auto;
  border: 1px solid rgba(102, 126, 234, 0.3);
  border-left: 4px solid rgba(102, 126, 234, 0.6);
  text-align: center;
  max-width: 85%;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  white-space: pre-line;
  /* 親 .agent-content の line-height: 1.5 / white-space: pre 継承をリセットしてAIチャットに揃える */
  line-height: normal;
}

.terminal-line {
  margin: 0;
  padding: 0;
}

.line-content {
  display: inline;
  position: relative;
}

.terminal-text {
  display: inline;
  white-space: pre-wrap;
  font-family: 'Courier New', monospace;
  line-height: 1.1;
}

.terminal-text {
  display: inline;
  white-space: pre-wrap;
  font-family: 'Courier New', monospace;
  line-height: 1.1;
}

.terminal-text.typing::after {
  content: '█';
  color: #ffffff;
  font-weight: bold;
  margin-left: 0px;
}

@keyframes cursor-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.terminal-line.input_text .line-content {
  color: #ffffff;
}

.terminal-line.input_request .line-content {
  color: #00ffff;
}

.terminal-line.input_request .line-content::before {
  content: "REQ > ";
  font-weight: bold;
  color: #00ffff;
}

.terminal-line.input_request .content-area {
  display: inline;
}

.terminal-line.output_text .line-content {
  color: #00ff00;
}

.terminal-line.welcome_text .line-content {
  color: #00ff00;
}

.terminal-line.cancel_run .line-content {
  color: #ff4444;
  font-weight: bold;
}

.terminal-line.stream-output .line-content {
  color: #00ffff;
  background: rgba(0, 255, 255, 0.12);
  border: 1px solid rgba(0, 255, 255, 0.5);
  border-radius: 4px;
  padding: 0;
  display: block;
  position: relative;
}

.terminal-line.stream-output.collapsed .line-content {
  padding: 8px 8px;
}

.collapsed-wrapper {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  cursor: pointer;
}

.collapsed-indicator {
  color: #ffffff;
  font-weight: bold;
  font-size: 14px;
  line-height: 1;
}

.collapsed-arrow {
  color: #ffffff;
  font-size: 14px;
  line-height: 1;
}

.expand-indicator {
  position: absolute;
  top: 4px;
  right: 8px;
  color: #ffffff;
  font-size: 18px;
  cursor: pointer;
  user-select: none;
}

.expand-indicator:hover {
  color: #cccccc;
}

.terminal-line.input_file .line-content,
.terminal-line.output_file .line-content {
  display: block;
}

.file-message {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

/* input_file: 白いボーダー */
.terminal-line.input_file .file-message {
  border-left: 4px solid rgba(255, 255, 255, 0.7);
}

/* output_file: 緑のボーダー */
.terminal-line.output_file .file-message {
  border-left: 4px solid rgba(0, 255, 0, 0.7);
}

/* input_fileのサムネイルは非表示 */
.terminal-line.input_file .file-thumbnail {
  display: none;
}

/* output_fileのサムネイルも非表示 */
.terminal-line.output_file .file-thumbnail {
  display: none;
}

.file-name {
  font-size: 11px;
  font-family: 'Courier New', monospace;
  color: #ffffff;
}

/* output_fileのファイル名は緑 */
.terminal-line.output_file .file-name {
  color: #00ff00;
}

.file-thumbnail {
  max-width: 320px;
  max-height: 240px;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-thumbnail:hover {
  opacity: 0.8;
  transform: scale(1.02);
}

.terminal-cursor {
  display: inline !important;
  color: #000000 !important;
  padding: 0 2px !important;
  margin-left: 0 !important;
  font-family: 'Courier New', monospace !important;
  font-weight: bold !important;
}

.terminal-cursor-typing {
  display: inline;
  color: #ffffff !important;
  font-family: 'Courier New', monospace;
  font-size: inherit;
  font-weight: bold;
  opacity: 1 !important;
  animation: none !important;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

@keyframes cursor-rapid-blink {
  0%, 49% { 
    background-color: #00ff00;
    color: #000000;
  }
  50%, 100% { 
    background-color: transparent;
    color: #00ff00;
  }
}

/* スクロールバーのスタイル（細く） */
.agent-content::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.agent-content::-webkit-scrollbar-track {
  background: #1a1a1a;
}

.agent-content::-webkit-scrollbar-thumb {
  background: #666666;
  border-radius: 2px;
}

.agent-content::-webkit-scrollbar-thumb:hover {
  background: #888888;
}

/* テキスト入力エリア */
.control-area {
  padding: 10px 20px 0 20px; /* チャットと同じpadding */
  background: #101010;
  border-top: 1px solid #2c2c2c;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 15px; /* チャットと同じgap */
}

.text-input-area {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.text-input-area.drag-over {
  background: rgba(102, 126, 234, 0.2);
  border: 2px dashed #667eea;
  border-radius: 4px;
  padding: 8px;
}

.input-container {
  position: relative;
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.prompt-symbol {
  position: absolute;
  left: 8px;
  top: 16px;
  color: #ffffff;
  font-family: 'Courier New', monospace;
  font-weight: bold;
  font-size: 16px;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
  z-index: 1;
}

.input-field {
  width: 100%;
  padding: 10px 16px 6px 30px;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-radius: 0;
  outline: none;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.35);
  color: #e0e0e0;
  box-sizing: border-box;
  resize: none;
  min-height: 60px;
  max-height: 380px;
  overflow-y: auto;
  font-family: inherit;
  line-height: 1.4;
  height: 60px;
}

.input-field.at-limit {
  font-size: 8px;
  line-height: 1.1;
}

.input-field:disabled {
  border-color: #808080;
  color: #666;
  background: rgba(128, 128, 128, 0.1);
}

.input-field:focus {
  border-color: #ffffff; /* 鮮やかな白 */
}

.input-field::placeholder {
  color: #888;
}

/* 送信ボタン */
.agent-send-btn {
  border: 2px solid #667eea;
  border-radius: 2px;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  box-shadow: none;
  padding: 0;
  width: 56px;
  height: 48px;
  margin-bottom: 20px;
  background: rgba(255, 255, 255, 0.95);
  color: white;
}

.agent-send-btn img {
  width: 34px;
  height: 34px;
  object-fit: contain;
  pointer-events: none;
  filter: brightness(0);
}

.send-code-label {
  position: absolute;
  left: 50%;
  bottom: 3px;
  transform: translateX(-50%);
  pointer-events: none;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.7px;
  color: #334155;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.6);
}

.agent-send-btn:hover:not(:disabled) {
  background: rgba(240, 240, 240, 0.95);
  border-color: #5a6fd8;
}

.agent-send-btn.has-text {
  background: #667eea;
  border-color: #667eea;
}

.agent-send-btn.has-text img {
  filter: brightness(0) invert(1);
}

.agent-send-btn.has-text .send-code-label {
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.agent-send-btn.has-text:hover:not(:disabled) {
  background: #5a6fd8;
  border-color: #5a6fd8;
}

.agent-send-btn:disabled:not(.ws-disabled) {
  background: rgba(255, 255, 255, 0.95);
  border-color: #667eea;
  cursor: not-allowed;
  opacity: 1;
}

.agent-send-btn:disabled:not(.ws-disabled) img {
  filter: brightness(0);
}

.agent-send-btn.ws-disabled {
  background: #808080 !important;
  border-color: #808080 !important;
  box-shadow: none;
  cursor: not-allowed;
  opacity: 1;
}

.agent-send-btn.ws-disabled img {
  filter: brightness(0) invert(1) !important;
}

.agent-send-btn.ws-disabled .send-code-label {
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

.agent-send-btn.ws-disabled:hover {
  transform: none;
}

/* キャンセルボタン */
.agent-cancel-btn {
  border: 2px solid #808080;
  border-radius: 2px;
  cursor: not-allowed;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 56px;
  height: 48px;
  margin-bottom: 20px;
  margin-left: 4px;
  background: rgba(128, 128, 128, 0.3);
  transition: all 0.2s ease;
}

.agent-cancel-btn img {
  width: 44px;
  height: 44px;
  object-fit: contain;
  pointer-events: none;
  filter: brightness(0) invert(1) opacity(0.6);
}

.agent-cancel-btn.is-active {
  background: #ff4444;
  border-color: #ff4444;
  cursor: pointer;
}

.agent-cancel-btn.is-active img {
  filter: brightness(0) invert(1);
}

.agent-cancel-btn.is-active:hover {
  background: #cc0000;
  border-color: #cc0000;
}

.agent-cancel-btn:disabled {
  opacity: 0.6;
}

.agent-cancel-btn.is-active:disabled {
  opacity: 1;
}
</style>





