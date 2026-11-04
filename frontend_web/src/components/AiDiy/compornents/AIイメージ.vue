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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { IWebSocketClient } from '@/api/websocket';

const プロパティ = defineProps<{
  autoShowSelection?: boolean;
  セッションID?: string;
  active?: boolean;
  wsConnected?: boolean;
  チャンネル?: string;
  wsClient?: IWebSocketClient | null;
}>();

const 通知 = defineEmits<{
  selectionCancel: [];
  selectionComplete: [];
  close: [];
}>();

const 画像プレビュー = ref<string | null>(null);
const ファイル入力 = ref<HTMLInputElement | null>(null);
const 選択ポップアップ表示 = ref(false);
const 接続状態 = ref<'disconnected' | 'connecting' | 'sending'>('disconnected');
const 動画要素 = ref<HTMLVideoElement | null>(null);
const 描画キャンバス = ref<HTMLCanvasElement | null>(null);
const 小型キャンバス = ref<HTMLCanvasElement | null>(null);
const メディアストリーム = ref<MediaStream | null>(null);
const キャプチャタイマー = ref<number | null>(null);
const 最終変化時刻 = ref<number>(0);
const 最終送信時刻 = ref<number>(0);
const 前回小画像 = ref<ImageData | null>(null);
const 送信中 = ref(false);
const 安定後送信済み = ref(false);
const フラッシュ中 = ref(false);
let フラッシュタイマーID: number | null = null;
const WebSocket接続中 = ref(false);
const ファイル選択中 = ref(false);
const ファイルダイアログ待機中 = ref(false);
const ファイルダイアログ変更済み = ref(false);
const ファイルダイアログ確認タイマー = ref<number | null>(null);
const ファイル画像タイマー = ref<number | null>(null);
const 選択画像 = ref<HTMLImageElement | null>(null);
const ファイル画像モード = ref(false);

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
const テキスト送信中 = ref(false);
const ドラッグ中 = ref(false);
const 入力欄最大到達 = ref(false);
const 入力欄最小高さ = 60;
const 入力欄最大高さ = ref(380);
const 入力欄固定中 = ref(false);
const 入力欄固定高さ = ref(入力欄最小高さ);

const CAPTURE_INTERVAL_MS = 550;
const 自動送信変化率パーセント = ref<number>(3);
const 自動送信待機秒 = ref<number>(2);
const 自動送信強制秒 = ref<number>(60);
const ライブ入力チャンネル = 'input';
const ライブ出力先チャンネル = '0';

// テキスト入力欄の状態管理
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
  const コンテナ = テキストエリア要素.closest('.image-container') as HTMLElement | null;
  if (!コンテナ) return;
  const 候補高さ = Math.floor(コンテナ.clientHeight * 0.30);
  入力欄最大高さ.value = Math.max(入力欄最小高さ, 候補高さ);
};

// テキストメッセージ送信（AIチャット.vueのliveモードと同じパケット形式）
const テキストメッセージ送信 = async (送信後クリア = false) => {
  if (!入力テキスト.value.trim() || テキスト送信中.value || !WebSocket接続中.value) return;

  const 送信内容 = 入力テキスト.value.trim();
  if (送信後クリア) {
    入力テキスト.value = '';
    入力欄状態リセット();
  }

  // inputソケット経由で送信し、LiveAIへルーティング
  if (プロパティ.wsClient && プロパティ.wsClient.isConnected()) {
    プロパティ.wsClient.send({
      セッションID: プロパティ.セッションID ?? '',
      チャンネル: ライブ入力チャンネル,
      メッセージ識別: 'input_text',
      メッセージ内容: 送信内容
    });
    console.log('[イメージ] テキスト送信完了 (liveモード):', 送信内容);
  }
};

const 送信ボタン処理 = async () => {
  await テキストメッセージ送信(true);
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
    if (ファイル.type.startsWith('image/')) {
      // 画像ファイルはファイル選択処理へ
      const 読込 = new FileReader();
      読込.onload = (e) => {
        const データURL = e.target?.result as string;
        const 画像 = new Image();
        画像.onload = () => {
          ファイル画像キャプチャ開始(画像);
          通知('selectionComplete');
        };
        画像.src = データURL;
      };
      読込.readAsDataURL(ファイル);
    }
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

// リソース選択を表示
const 選択表示 = () => {
  if (!WebSocket接続中.value) return;
  選択ポップアップ表示.value = true;
};

// リソース選択をキャンセル
const 選択取消 = () => {
  選択ポップアップ表示.value = false;
  キャプチャ停止();
  通知('selectionCancel');
};

// 選択オプションを処理
const 選択処理 = (option: string) => {
  if (!WebSocket接続中.value) return;
  選択ポップアップ表示.value = false;

  switch (option) {
    case 'file':
      ファイル選択();
      break;
    case 'camera':
      カメラキャプチャ();
      break;
    case 'desktop':
      画面共有キャプチャ();
      break;
  }
};

// ファイル選択
const ファイル選択 = () => {
  if (!WebSocket接続中.value) return;
  if (ファイル入力.value) {
    ファイル入力.value.value = '';
  }
  ファイル選択中.value = true;
  ファイルダイアログ待機中.value = true;
  ファイルダイアログ変更済み.value = false;
  const フォーカス処理 = () => {
    if (!ファイルダイアログ待機中.value) return;
    if (ファイルダイアログ確認タイマー.value) {
      window.clearInterval(ファイルダイアログ確認タイマー.value);
      ファイルダイアログ確認タイマー.value = null;
    }
    const 開始時刻 = Date.now();
    ファイルダイアログ確認タイマー.value = window.setInterval(() => {
      if (!ファイルダイアログ待機中.value) {
        if (ファイルダイアログ確認タイマー.value) {
          window.clearInterval(ファイルダイアログ確認タイマー.value);
          ファイルダイアログ確認タイマー.value = null;
        }
        return;
      }
      if (ファイルダイアログ変更済み.value) {
        ファイルダイアログ待機中.value = false;
        ファイル選択中.value = false;
        if (ファイルダイアログ確認タイマー.value) {
          window.clearInterval(ファイルダイアログ確認タイマー.value);
          ファイルダイアログ確認タイマー.value = null;
        }
        return;
      }
      const ファイル有無 = !!(ファイル入力.value && ファイル入力.value.files && ファイル入力.value.files.length > 0);
      if (ファイル有無) {
        ファイルダイアログ待機中.value = false;
        ファイル選択中.value = false;
        if (ファイルダイアログ確認タイマー.value) {
          window.clearInterval(ファイルダイアログ確認タイマー.value);
          ファイルダイアログ確認タイマー.value = null;
        }
        return;
      }
      if (Date.now() - 開始時刻 >= 2000) {
        ファイルダイアログ待機中.value = false;
        ファイル選択中.value = false;
        if (ファイルダイアログ確認タイマー.value) {
          window.clearInterval(ファイルダイアログ確認タイマー.value);
          ファイルダイアログ確認タイマー.value = null;
        }
        通知('selectionCancel');
      }
    }, 100);
  };
  window.addEventListener('focus', フォーカス処理, { once: true });
  ファイル入力.value?.click();
};

// ファイル選択時の処理
const ファイル変更処理 = (イベント: Event) => {
  ファイルダイアログ変更済み.value = true;
  ファイルダイアログ待機中.value = false;
  const 対象要素 = イベント.target as HTMLInputElement;
  const 選択ファイル = 対象要素.files?.[0];

  if (選択ファイル && 選択ファイル.type.startsWith('image/')) {
    console.log('[イメージ] ファイル画像選択完了 - ロード開始');

    const 読込 = new FileReader();
    読込.onload = (e) => {
      const データURL = e.target?.result as string;

      // Imageオブジェクトを作成
      const 画像 = new Image();
      画像.onload = () => {
        console.log('[イメージ] 画像ロード完了 - サイズ:', 画像.naturalWidth, 'x', 画像.naturalHeight);
        // キャプチャと同じロジックで定期送信開始
        ファイル画像キャプチャ開始(画像);
        通知('selectionComplete');
      };
      画像.onerror = () => {
        console.error('[イメージ] 画像ロードエラー');
        通知('selectionCancel');
      };
      画像.src = データURL;
    };
    読込.readAsDataURL(選択ファイル);
  } else {
    通知('selectionCancel');
  }
  ファイル選択中.value = false;
};

const キャプチャ開始 = async (映像ストリーム: MediaStream) => {
  キャプチャ停止();
  メディアストリーム.value = 映像ストリーム;
  接続状態.value = 'connecting';
  最終変化時刻.value = Date.now();
  最終送信時刻.value = Date.now();
  安定後送信済み.value = false;

  if (動画要素.value) {
    動画要素.value.srcObject = 映像ストリーム;
    try {
      await 動画要素.value.play();
    } catch (error) {
      console.error('[イメージ] video再生エラー:', error);
    }
  }

  キャプチャタイマー.value = window.setInterval(() => {
    フレーム取得();
  }, CAPTURE_INTERVAL_MS);
};

const ファイル画像タイマー停止 = () => {
  if (ファイル画像タイマー.value) {
    console.log('[イメージ] 定期送信タイマーを停止 - ID:', ファイル画像タイマー.value);
    window.clearInterval(ファイル画像タイマー.value);
    ファイル画像タイマー.value = null;
  }
};

const ファイル画像モード解除 = () => {
  ファイル画像タイマー停止();
  選択画像.value = null;
  ファイル画像モード.value = false;
};

// ファイル画像のキャプチャフレーム処理（キャプチャと同じロジック）
const ファイル画像フレーム取得 = () => {
  if (!選択画像.value || !描画キャンバス.value) {
    console.log('[イメージ] キャプチャスキップ - img:', !!選択画像.value, 'canvas:', !!描画キャンバス.value);
    return;
  }

  const 画像 = 選択画像.value;
  const 幅 = 画像.naturalWidth || 画像.width;
  const 高さ = 画像.naturalHeight || 画像.height;

  描画キャンバス.value.width = 幅;
  描画キャンバス.value.height = 高さ;
  const 描画コンテキスト = 描画キャンバス.value.getContext('2d');
  if (!描画コンテキスト) return;

  描画コンテキスト.drawImage(画像, 0, 0, 幅, 高さ);
  const データURL = 描画キャンバス.value.toDataURL('image/jpeg', 0.8);

  console.log('[イメージ] 静止画フレームキャプチャ完了 - サイズ:', 幅, 'x', 高さ);

  // プレビュー更新
  画像プレビュー.value = データURL;

  // 画像送信
  画像送信(データURL);
};

const ファイル画像強制送信タイマー再設定 = () => {
  ファイル画像タイマー停止();
  if (!ファイル画像モード.value || !選択画像.value) return;
  if (自動送信強制秒.value <= 0) {
    console.log('[イメージ] 強制送信タイマー無効 (z=0)');
    return;
  }
  const 間隔ms = 自動送信強制秒.value * 1000;
  ファイル画像タイマー.value = window.setInterval(() => {
    console.log('[イメージ] 定期送信タイマー発火 -', 自動送信強制秒.value, '秒経過');
    ファイル画像フレーム取得();
  }, 間隔ms);
  console.log('[イメージ] タイマー設定完了 - ID:', ファイル画像タイマー.value, '間隔:', 間隔ms, 'ms');
};

// ファイル画像の定期キャプチャ開始
const ファイル画像キャプチャ開始 = (画像: HTMLImageElement) => {
  キャプチャ停止(); // 既存のビデオキャプチャは停止

  選択画像.value = 画像;
  ファイル画像モード.value = true;
  接続状態.value = 'connecting';
  最終送信時刻.value = Date.now();

  console.log('[イメージ] 静止画キャプチャモード開始');

  // 最初の送信
  ファイル画像フレーム取得();

  // 強制送信タイマー（z秒, z=0は無効）
  ファイル画像強制送信タイマー再設定();
};

const キャプチャ停止 = (状態を切断へ戻す = true) => {
  if (キャプチャタイマー.value) {
    window.clearInterval(キャプチャタイマー.value);
    キャプチャタイマー.value = null;
  }
  if (メディアストリーム.value) {
    for (const トラック of メディアストリーム.value.getTracks()) {
      トラック.stop();
    }
    メディアストリーム.value = null;
  }
  if (動画要素.value) {
    動画要素.value.srcObject = null;
  }
  前回小画像.value = null;
  ファイル画像モード解除();
  接続状態.value = 状態を切断へ戻す ? 'disconnected' : (WebSocket接続中.value ? 'connecting' : 'disconnected');
};

// 自動選択ポップアップ表示
watch(() => プロパティ.autoShowSelection, (新値) => {
  if (新値 && WebSocket接続中.value) {
    選択ポップアップ表示.value = true;
  }
}, { immediate: true });

watch(
  () => プロパティ.active,
  (稼働中) => {
    if (稼働中 === false) {
      キャプチャ停止();
      画像プレビュー.value = null;
      if (ファイル入力.value) {
        ファイル入力.value.value = '';
      }
      選択ポップアップ表示.value = false;
    } else if (稼働中 && プロパティ.autoShowSelection && WebSocket接続中.value) {
      選択ポップアップ表示.value = true;
    }
  },
  { immediate: true }
);

watch(
  () => プロパティ.wsConnected,
  (接続フラグ) => {
    const 接続中 = !!接続フラグ;
    WebSocket接続中.value = 接続中;
    if (!接続中) {
      キャプチャ停止();
      選択ポップアップ表示.value = false;
      接続状態.value = 'disconnected';
    } else if (接続状態.value === 'disconnected') {
      接続状態.value = 'connecting';
      if (プロパティ.autoShowSelection) {
        選択ポップアップ表示.value = true;
      }
    }
  },
  { immediate: true }
);

watch(
  () => 自動送信強制秒.value,
  () => {
    if (ファイル画像モード.value && 選択画像.value) {
      ファイル画像強制送信タイマー再設定();
    }
  }
);

// カメラキャプチャ
const カメラキャプチャ = async () => {
  try {
    if (!WebSocket接続中.value) return;
    const 映像ストリーム = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    await キャプチャ開始(映像ストリーム);
    通知('selectionComplete');
  } catch (error) {
    console.error('[イメージ] カメラ取得エラー:', error);
    キャプチャ停止();
    通知('selectionCancel');
  }
};

// デスクトップキャプチャ
const 画面共有キャプチャ = async () => {
  try {
    if (!WebSocket接続中.value) return;
    const 映像ストリーム = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    await キャプチャ開始(映像ストリーム);
    通知('selectionComplete');
  } catch (error) {
    console.error('[イメージ] 画面共有取得エラー:', error);
    キャプチャ停止();
    通知('selectionCancel');
  }
};

const 差分計算 = (画像A: ImageData, 画像B: ImageData) => {
  const データ長 = 画像A.data.length;
  if (データ長 !== 画像B.data.length) return 100;
  let 二乗差分合計 = 0;
  for (let i = 0; i < データ長; i += 4) {
    const dr = 画像A.data[i] - 画像B.data[i];
    const dg = 画像A.data[i + 1] - 画像B.data[i + 1];
    const db = 画像A.data[i + 2] - 画像B.data[i + 2];
    const pixel差分 = (dr * dr + dg * dg + db * db) / 3;
    二乗差分合計 += pixel差分;
  }
  // 局所変化を拾いやすいようにRMSで100分率化
  const 平均二乗差分 = 二乗差分合計 / (データ長 / 4);
  const rms = Math.sqrt(平均二乗差分);
  return (rms / 255) * 100;
};

const フレーム取得 = () => {
  if (!動画要素.value || !描画キャンバス.value || !小型キャンバス.value) return;
  if (動画要素.value.readyState < 2) return;

  const 幅 = 動画要素.value.videoWidth || 640;
  const 高さ = 動画要素.value.videoHeight || 360;

  描画キャンバス.value.width = 幅;
  描画キャンバス.value.height = 高さ;
  const 描画コンテキスト = 描画キャンバス.value.getContext('2d');
  if (!描画コンテキスト) return;
  描画コンテキスト.drawImage(動画要素.value, 0, 0, 幅, 高さ);

  const 小幅 = 64;
  const 小高さ = 36;
  小型キャンバス.value.width = 小幅;
  小型キャンバス.value.height = 小高さ;
  const 小型コンテキスト = 小型キャンバス.value.getContext('2d');
  if (!小型コンテキスト) return;
  小型コンテキスト.drawImage(動画要素.value, 0, 0, 小幅, 小高さ);
  const 現在小画像 = 小型コンテキスト.getImageData(0, 0, 小幅, 小高さ);

  if (前回小画像.value) {
    const 差分 = 差分計算(現在小画像, 前回小画像.value);
    if (差分 > 自動送信変化率パーセント.value) {
      最終変化時刻.value = Date.now();
      安定後送信済み.value = false;
    }
  }
  前回小画像.value = 現在小画像;

  const 現在時刻 = Date.now();
  const 安定待機ms = 自動送信待機秒.value * 1000;
  const 強制送信待機ms = 自動送信強制秒.value * 1000;
  const 安定中 = 現在時刻 - 最終変化時刻.value >= 安定待機ms;
  const 強制送信 = 自動送信強制秒.value > 0
    && 最終送信時刻.value > 0
    && (現在時刻 - 最終送信時刻.value >= 強制送信待機ms);

  if ((安定中 && !安定後送信済み.value) || 強制送信) {
    const データURL = 描画キャンバス.value.toDataURL('image/jpeg', 0.8);
    画像送信(データURL);
    最終送信時刻.value = 現在時刻;
    if (安定中) {
      安定後送信済み.value = true;
    }
  } else {
    画像プレビュー.value = 描画キャンバス.value.toDataURL('image/jpeg', 0.6);
  }
};

const 画像送信 = async (データURL: string | null) => {
  if (!データURL) {
    console.log('[イメージ] 送信スキップ - dataUrlなし');
    return;
  }
  if (!WebSocket接続中.value) {
    console.log('[イメージ] 送信スキップ - WebSocket未接続');
    return;
  }
  if (送信中.value) {
    console.log('[イメージ] 送信スキップ - 送信中');
    return;
  }
  送信中.value = true;
  接続状態.value = 'sending';
  画像プレビュー.value = データURL;

  // フラッシュ演出
  if (フラッシュタイマーID !== null) {
    window.clearTimeout(フラッシュタイマーID);
    フラッシュタイマーID = null;
  }
  フラッシュ中.value = true;
  フラッシュタイマーID = window.setTimeout(() => {
    フラッシュ中.value = false;
    フラッシュタイマーID = null;
  }, 200);

  console.log('[イメージ] 画像送信開始 - データサイズ:', データURL.length, 'bytes');

  try {
    const Base64データ = データURL.includes('base64,')
      ? データURL.split('base64,', 2)[1]
      : データURL;
    if (!プロパティ.wsClient || !プロパティ.wsClient.isConnected()) {
      console.log('[イメージ] 送信スキップ - WebSocket未接続');
      return;
    }
    プロパティ.wsClient.send({
      セッションID: プロパティ.セッションID ?? '',
      チャンネル: ライブ入力チャンネル,
      出力先チャンネル: ライブ出力先チャンネル,
      メッセージ識別: 'input_image',
      メッセージ内容: 'image/jpeg',
      ファイル名: Base64データ,
      サムネイル画像: null
    });
    console.log('[イメージ] 画像送信完了');
    if (入力テキスト.value.trim()) {
      await テキストメッセージ送信();
      console.log('[イメージ] 画像送信にあわせて入力テキストを自動送信');
    }
  } catch (error) {
    console.error('[イメージ] 画像送信エラー:', error);
  } finally {
    送信中.value = false;
    if (接続状態.value === 'sending') {
      // 0.25秒待機してから緑（接続中）に戻す
      window.setTimeout(() => {
        if (接続状態.value === 'sending') {
          接続状態.value = 'connecting';
        }
      }, 250);
    }
  }
};

// ステータステキスト
const 状態表示テキスト = computed(() => {
  const 状態表示一覧: Record<string, string> = {
    disconnected: '切断',
    connecting: '接続中',
    sending: '送信中'
  };
  return 状態表示一覧[接続状態.value] ?? '切断';
});

onMounted(() => {
  接続状態.value = WebSocket接続中.value ? 'connecting' : 'disconnected';
  nextTick(() => {
    入力欄最大高さ更新();
    テキストエリア自動調整();
  });
  window.addEventListener('resize', テキストエリア自動調整);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', テキストエリア自動調整);
  if (ファイルダイアログ確認タイマー.value) {
    window.clearInterval(ファイルダイアログ確認タイマー.value);
    ファイルダイアログ確認タイマー.value = null;
  }
  キャプチャ停止();
});
</script>

<template>
  <div class="image-container show">
    <div class="image-header">
      <button class="close-btn" @click="通知('close')" title="閉じる">×</button>
      <h1>Live Capture</h1>
      <div class="image-status">
        <div :class="['image-status-dot', 接続状態]"></div>
        <span>{{ 状態表示テキスト }}</span>
      </div>
    </div>

    <div class="image-area" :class="{ flashing: フラッシュ中, monitoring: 接続状態 !== 'disconnected' }">
      <div class="image-preview" :class="{ disabled: !WebSocket接続中 }" @click="選択表示">
        <div v-if="!画像プレビュー" class="preview-placeholder">
          <span class="preview-icon">📷</span>
          <div>画像表示エリア</div>
          <small>クリックしてリソースを選択</small>
        </div>
        <img v-else :src="画像プレビュー" alt="プレビュー" class="preview-image" />
      </div>

      <video ref="動画要素" class="hidden-video" playsinline muted></video>
      <canvas ref="描画キャンバス" class="hidden-canvas"></canvas>
      <canvas ref="小型キャンバス" class="hidden-canvas"></canvas>

      <input
        ref="ファイル入力"
        type="file"
        accept="image/*"
        style="display: none"
        :disabled="!WebSocket接続中"
        @change="ファイル変更処理"
      />
    </div>

    <!-- テキスト入力エリア -->
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
            placeholder="画像についてのメッセージを入力..."
            maxlength="5000"
            title="Enter で改行、Tab で送信ボタンへ移動"
            :disabled="テキスト送信中 || !WebSocket接続中"
            @input="テキストエリア自動調整"
            @keydown="キー入力処理"
            ref="テキストエリア"
          ></textarea>
        </div>

        <button
          ref="送信ボタン"
          class="image-send-btn"
          :class="{
            'ws-disabled': !WebSocket接続中,
            'has-text': 入力テキスト.length > 0
          }"
          @click="送信ボタン処理"
          :disabled="!入力テキスト.trim() || テキスト送信中 || !WebSocket接続中"
          title="送信（フォーカス中に Enter）"
        >
          <img src="/icons/sending.png" alt="送信" />
          <span class="send-live-label">LIVE</span>
        </button>

        <div class="auto-send-settings">
          <div class="auto-send-line auto-send-line-top">
            <span class="auto-send-label">自動送信</span>
            <span class="auto-send-label auto-send-paren">(待機
              <select v-model.number="自動送信待機秒" class="auto-send-select">
                <option :value="1">1</option>
                <option :value="2">2</option>
                <option :value="3">3</option>
                <option :value="5">5</option>
              </select>秒)</span>
          </div>
          <div class="auto-send-line auto-send-line-bot">
            <span class="auto-send-label">変化</span>
            <select v-model.number="自動送信変化率パーセント" class="auto-send-select">
              <option :value="1">1</option>
              <option :value="2">2</option>
              <option :value="3">3</option>
              <option :value="5">5</option>
              <option :value="10">10</option>
              <option :value="20">20</option>
            </select>
            <span class="auto-send-unit">%</span>
            <span class="auto-send-or">or</span>
            <span class="auto-send-label">経過</span>
            <select v-model.number="自動送信強制秒" class="auto-send-select">
              <option :value="0">切</option>
              <option :value="60">60</option>
              <option :value="300">300</option>
              <option :value="600">600</option>
            </select>
            <span class="auto-send-unit">秒</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 選択ポップアップ（コンテナ内に移動） -->
    <div v-if="選択ポップアップ表示" class="selection-popup" @click.self="選択取消">
      <div class="selection-dialog">
        <div class="selection-title">リソース選択</div>
        <div class="selection-options">
          <div class="selection-option" @click="選択処理('file')">
            📁 画像ファイル選択
          </div>
          <div class="selection-option" @click="選択処理('camera')">
            <span class="option-icon">📷</span> カメラキャプチャ
          </div>
          <div class="selection-option" @click="選択処理('desktop')">
            🖥️ デスクトップキャプチャ
          </div>
        </div>
        <button class="selection-cancel" @click="選択取消">キャンセル</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-container {
  background: #101010;
  border-radius: 2px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: 100%;
  height: 100%;
  position: relative; /* 追加: selection-popupの基準にする */
}

.image-header {
  background: #c8c8c8;
  color: #333;
  padding: 5px 10%;
  text-align: center;
  position: relative;
}

.image-header h1 {
  font-size: 22px;
  font-weight: bold;
  margin: 0;
  height: 28px;
  line-height: 28px;
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

.image-status {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: bold;
}

.image-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.image-status-dot.disconnected { background: #888888; }
.image-status-dot.connecting { background: #44ff44; }
.image-status-dot.sending { background: #ff4444; }

.image-area {
  flex: 1;
  padding: 2px;
  overflow-y: auto;
  background: #101010;
  position: relative;
  box-sizing: border-box;
}

.image-area.monitoring {
  animation: pulse-border 2.5s infinite;
}

@keyframes pulse-border {
  0%, 100% { background: #ff4444; }
  50%       { background: rgba(255, 68, 68, 0.15); }
}

.image-area.flashing::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.55);
  animation: flash-once 0.2s ease-out forwards;
  pointer-events: none;
  z-index: 10;
  border-radius: 2px;
}

@keyframes flash-once {
  0%   { opacity: 1; }
  30%  { opacity: 0.8; }
  100% { opacity: 0; }
}

.image-preview {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 2px;
  background: #101010;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.image-preview:hover {
  background: #101010;
}
.image-preview.disabled {
  cursor: not-allowed;
  opacity: 0.6;
  background: #101010;
}
.image-preview.disabled:hover {
  background: #101010;
}

.preview-placeholder {
  text-align: center;
  color: #666;
}

.preview-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
  opacity: 0.6;
}

.preview-placeholder small {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: #999;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.hidden-video,
.hidden-canvas {
  display: none;
}

.selection-popup {
  position: absolute; /* fixedからabsoluteに変更 */
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  padding: 8px;
  box-sizing: border-box;
  /* 多数のパネルを並べた低いパネルでも、ダイアログをパネル内に収める */
  container-type: size;
}

.selection-dialog {
  background: white;
  border-radius: 2px;
  padding: 30px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  min-width: min(300px, 100%);
  max-width: 100%;
  max-height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  text-align: center;
}

.selection-title {
  font-size: 20px;
  font-weight: bold;
  margin-bottom: 20px;
  color: #333;
}

.selection-options {
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-bottom: 20px;
}

.selection-option {
  padding: 15px 20px;
  border: 2px solid #e0e0e0;
  border-radius: 2px;
  background: white;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 16px;
}

.selection-option:hover {
  border-color: #667eea;
  background: #f8f9ff;
}

.option-icon {
  margin-right: 8px;
}

.selection-cancel {
  padding: 10px 20px;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 2px;
  cursor: pointer;
  font-size: 14px;
  color: #666;
}

.selection-cancel:hover {
  background: #e0e0e0;
}

@container (max-height: 360px) {
  .selection-dialog {
    padding: 8px 12px;
  }

  .selection-title {
    font-size: 13px;
    margin-bottom: 6px;
  }

  .selection-options {
    gap: 4px;
    margin-bottom: 6px;
  }

  .selection-option {
    padding: 4px 10px;
    font-size: 13px;
  }

  .selection-cancel {
    padding: 2px 12px;
    font-size: 12px;
  }
}

/* テキスト入力エリア */
.control-area {
  padding: 10px 20px 0 20px;
  background: #101010;
  border-top: 1px solid #2c2c2c;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.text-input-area {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.auto-send-settings {
  min-width: 168px;
  margin-left: 2px;
  margin-bottom: 20px;
  padding: 2px 6px;
  border: 1px solid rgba(102, 126, 234, 0.45);
  background: rgba(20, 24, 38, 0.85);
  color: #d6def8;
  font-size: 10px;
  border-radius: 2px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0px;
  justify-content: center;
}

.auto-send-line {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  white-space: nowrap;
}

.auto-send-line-top {
  justify-content: space-between;
}

.auto-send-label {
  color: #d6def8;
  white-space: nowrap;
  line-height: 1;
}

.auto-send-paren {
  display: flex;
  align-items: center;
  gap: 2px;
}

.auto-send-unit {
  color: #97a8df;
  white-space: nowrap;
}

.auto-send-or {
  color: #97a8df;
  margin: 0 3px;
  white-space: nowrap;
}

.auto-send-select {
  width: 44px;
  height: 18px;
  border: 1px solid rgba(102, 126, 234, 0.65);
  background: rgba(6, 9, 16, 0.95);
  color: #ffffff;
  border-radius: 2px;
  font-size: 10px;
  padding: 0 2px;
  box-sizing: border-box;
  position: relative;
  top: 6px;
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
  border-color: #ffffff;
}

.input-field::placeholder {
  color: #888;
}

/* 送信ボタン */
.image-send-btn {
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
  margin-left: 10px;
}

.image-send-btn img {
  width: 34px;
  height: 34px;
  object-fit: contain;
  pointer-events: none;
  filter: brightness(0);
}

.send-live-label {
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

.image-send-btn:hover:not(:disabled) {
  background: rgba(240, 240, 240, 0.95);
  border-color: #5a6fd8;
}

.image-send-btn.has-text {
  background: #667eea;
  border-color: #667eea;
}

.image-send-btn.has-text img {
  filter: brightness(0) invert(1);
}

.image-send-btn.has-text .send-live-label {
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.image-send-btn.has-text:hover:not(:disabled) {
  background: #5a6fd8;
  border-color: #5a6fd8;
}

.image-send-btn:disabled:not(.ws-disabled) {
  background: rgba(255, 255, 255, 0.95);
  border-color: #667eea;
  cursor: not-allowed;
  opacity: 1;
}

.image-send-btn:disabled:not(.ws-disabled) img {
  filter: brightness(0);
}

.image-send-btn.ws-disabled {
  background: #808080 !important;
  border-color: #808080 !important;
  box-shadow: none;
  cursor: not-allowed;
  opacity: 1;
}

.image-send-btn.ws-disabled img {
  filter: brightness(0) invert(1) !important;
}

.image-send-btn.ws-disabled .send-live-label {
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

.image-send-btn.ws-disabled:hover {
  transform: none;
}
</style>


