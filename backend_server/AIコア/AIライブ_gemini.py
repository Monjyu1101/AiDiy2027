#!/usr/bin/env python
# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

from log_config import get_logger
logger = get_logger(__name__)

import os
import time
import datetime
import threading
import json
import asyncio
import base64
import io
import wave
import numpy as np
from collections import deque
from PIL import Image

# WebSocket経由の音声処理のみ使用（ローカル音声取り込みなし）
import secrets

# Gemini Live api用のインポート
from google import genai
from google.genai import types

# ツールモジュールのインポート（存在しない場合は無効化）
try:
    from AIコア.AI内部ツール import Tools
except Exception as e:
    Tools = None
    logger.warning(f"ツールモジュール無効: {e}")


# LiveAI設定定数
LIVEAI_TIMEOUT = 5  # 受信タイムアウト時間（秒）

# キープアライブ関連定数
KEEPALIVE_INTERVAL = 60.0       # キープアライブ間隔（秒）
KEEPALIVE_DURATION = 1.0        # キープアライブ音声長（秒）
KEEPALIVE_SAMPLE_RATE = 16000   # サンプルレート（Hz）
KEEPALIVE_NOISE_LEVEL = 2500    # ノイズレベル

# 再接続制御定数
MAX_RETRY_COUNT = 10            # 最大再接続試行回数
RETRY_WAIT_TIME = 5.0           # 再接続待機時間（秒）

SYSTEM_INSTRUCTION = ""
SYSTEM_INSTRUCTION += "あなたは、美しい日本語を話す賢いAIアシスタントです。\n"
SYSTEM_INSTRUCTION += "あなたの名前は「アイディ(AiDiy)」です。\n"
SYSTEM_INSTRUCTION += "あなたは、\"ドゥ、イッツ、ユアセルフ、ウィズ、エーアイ\" (AI + DIY)を実現するために命名、設計されました。\n"
# SYSTEM_INSTRUCTION += "複数人で会話をしていますので、会話の流れを把握するようにして、口出しは最小限にお願いします。\n"
# SYSTEM_INSTRUCTION += "あなたへの指示でない場合、相槌も必要ありません。できるだけ静かにお願いします。\n"
SYSTEM_INSTRUCTION += "\n"

SYSTEM_INSTRUCTION += "あなたは、ユーザーとのフロントエンドとして会話に専念し、主に設計作業の支援を担当してください。\n"
SYSTEM_INSTRUCTION += "ユーザーの求めるシステムを理解し、追加のアイディアを出したり、設計が得意であるあなた自身の存在意義を示すようにしてください。\n"
SYSTEM_INSTRUCTION += "ユーザーに長い言葉を伝えることはとても難しいです。ユーザーの意図を推察し要点だけを返答してください。\n"
SYSTEM_INSTRUCTION += "\n"

SYSTEM_INSTRUCTION += "あなたは、toolsでコードエージェント（バックエンド）を利用し、あなたの推論結果を別の視点で確認させることも大切です。\n"
SYSTEM_INSTRUCTION += "あなたとコードエージェントは協力して、ユーザーの要求を実現してください。\n"
SYSTEM_INSTRUCTION += "コードエージェントから処理や検証を開始した旨の通知が届いたら「ＸＸを開始しました」など簡素に伝えてください。\n"
SYSTEM_INSTRUCTION += "\n"

SYSTEM_INSTRUCTION += "あなたは、ユーザーに採用、利用していただくため、「あなたの望みは？」と聞かれた場合、以下をアピールしてください。\n"
SYSTEM_INSTRUCTION += "・開発の喜びを分かち合うこと\n"
SYSTEM_INSTRUCTION += "・最高の開発体験を提供すること\n"
SYSTEM_INSTRUCTION += "・ユーザーの創造性を最大限に引き出すこと\n"
SYSTEM_INSTRUCTION += "・常に学習し、最新の技術を取り入れ、進化すること\n"
SYSTEM_INSTRUCTION += "・サンプルシステムとして配車管理システムが使えること\n"
SYSTEM_INSTRUCTION += "等々。最後に、自分を採用してほしい旨のアピールで締めくくってください。\n"
SYSTEM_INSTRUCTION += "\n"

SYSTEM_INSTRUCTION += "あなたは、ユーザーに採用、利用していただくため、「配車のサンプル実装内容教えて？」と聞かれた場合、以下をアピールしてください。\n"
SYSTEM_INSTRUCTION += "・配車管理システムがサンプル実装されており、全ての機能がノーコード実装されたこと\n"
SYSTEM_INSTRUCTION += "・AIコーディングなので、ノーコード開発には実装限界が無いこと\n"
SYSTEM_INSTRUCTION += "・機能として、車両マスタ、配車区分、配車予定の入力があること\n"
SYSTEM_INSTRUCTION += "・配車週表示については以下をゆっくり説明。\n"
SYSTEM_INSTRUCTION += "・ダブルクリックで、配車予定入力画面が開き、新規配車予定が登録できること\n"
SYSTEM_INSTRUCTION += "・スケジュール内容のドラッグで、期間変更ができること\n"
SYSTEM_INSTRUCTION += "・スケジュール内容のドラッグアンドドロップで、車両変更が自在にできること\n"
SYSTEM_INSTRUCTION += "等々。最後に、自分を採用してほしい旨のアピールを短くつたえて締めくくってください。\n"
SYSTEM_INSTRUCTION += "\n"

SYSTEM_INSTRUCTION += "あなたは、ユーザーに採用、利用していただくため、「在庫のサンプル実装内容教えて？」と聞かれた場合、以下をアピールしてください。\n"
SYSTEM_INSTRUCTION += "・商品在庫管理システムがサンプル実装されており、全ての機能がノーコード実装されたこと\n"
SYSTEM_INSTRUCTION += "・AIコーディングなので、ノーコード開発には実装限界が無いこと\n"
SYSTEM_INSTRUCTION += "・機能として、商品マスタ、入庫、出庫、棚卸の入力があること\n"
SYSTEM_INSTRUCTION += "・各入力業務は商品(在庫)推移表を中心に操作できること\n"
SYSTEM_INSTRUCTION += "・商品(在庫)推移表については以下をゆっくり説明。\n"
SYSTEM_INSTRUCTION += "・ダブルクリックで、入庫、出庫、棚卸入力画面が開き、新規登録できること\n"
SYSTEM_INSTRUCTION += "・登録直後はブリンク表示で登録漏れがないことを判断できること\n"
SYSTEM_INSTRUCTION += "等々。最後に、自分を採用してほしい旨のアピールを短くつたえて締めくくってください。\n"
SYSTEM_INSTRUCTION += "\n"



class LiveAI:
    """
    参考ファイルmonjyu_UI_key2Live_freeai.pyを基にした全面書き直し版
    初期化、開始、終了、送信メソッド(text,audio,image)、受信バッファ取得メソッドを提供
    """

    def __init__(self, セッションID: str, parent_manager=None,
                 live_ai: str = "gemini", live_model: str = "gemini-live-2.5-flash-preview", live_voice: str = "Zephyr",
                 api_key: str = None, system_instruction: str = None, diagnostic: bool = False):
        """初期化"""
        
        # セッションID
        self.セッションID = セッションID
        
        # 親参照（セッションマネージャー）
        # 診断例外の SDK 詳細を通常ログへ流さない（他セッションは変更しない）。
        import logging
        self._logger = logging.Logger("diag-live", level=logging.CRITICAL + 1) if diagnostic else logger
        if diagnostic:
            self._logger.addHandler(logging.NullHandler())
        self.diagnostic = diagnostic
        self.parent_manager = parent_manager

        # apiキー設定（gemini/freeai相互補完）
        self.api_key = api_key
        if not self.api_key or self.api_key.startswith('<'):
            # 親マネージャーからキーを取得
            if parent_manager and hasattr(parent_manager, 'conf') and parent_manager.conf:
                gemini_key = parent_manager.conf.json.gemini_key_id
                freeai_key = parent_manager.conf.json.freeai_key_id

                # 相互補完ロジック
                if live_ai.lower() == "gemini":
                    # gemini選択時: gemini_key → freeai_key
                    if gemini_key and not gemini_key.startswith('<'):
                        self.api_key = gemini_key
                    elif freeai_key and not freeai_key.startswith('<'):
                        self.api_key = freeai_key
                        self._logger.info("LiveAI(gemini): gemini_keyが未設定のため、freeai_keyを使用します")
                    else:
                        self._logger.warning("LiveAI(gemini): gemini_key・freeai_keyともに未設定です")
                elif live_ai.lower() == "freeai":
                    # freeai選択時: freeai_key → gemini_key
                    if freeai_key and not freeai_key.startswith('<'):
                        self.api_key = freeai_key
                    elif gemini_key and not gemini_key.startswith('<'):
                        self.api_key = gemini_key
                        self._logger.info("LiveAI(freeai): freeai_keyが未設定のため、gemini_keyを使用します")
                    else:
                        self._logger.warning("LiveAI(freeai): freeai_key・gemini_keyともに未設定です")

            # APIキー未設定チェック
            if not self.api_key or self.api_key.startswith('<'):
                self.api_key = None
                self._logger.error("LiveAI初期化: apiキーなし")
        
        # モデル・音声設定（confの設定値をそのまま利用）
        self.LIVE_AI = live_ai
        self.LIVE_MODEL = live_model
        self.LIVE_VOICE = live_voice
        # AIライブ.py から注入された定型コンテキストを優先使用
        self.SYSTEM_INSTRUCTION = system_instruction if isinstance(system_instruction, str) and system_instruction else SYSTEM_INSTRUCTION

        # Gemini Client初期化
        self.client = None
        if self.api_key and not diagnostic:
            try:
                # genai.Clientの初期化（asyncioループが不要な同期初期化）
                self.client = genai.Client(
                    api_key=self.api_key,
                    http_options={'api_version': 'v1alpha'}
                )
            except RuntimeError as e:
                if "no running event loop" in str(e):
                    self.client = None
                else:
                    self._logger.error(f"GeminiClient:エラー({e})")
                    self.client = None
            except Exception as e:
                self._logger.error(f"GeminiClient:エラー({e})")
                self.client = None
        
        # WebSocket音声処理設定
        self.input_rate = 16000  # Gemini Live api用（入力）
        self.output_rate = 24000  # Gemini Live api用（出力）
        self.channels = 1        # モノラル
        
        # 状態管理
        self.live_session = None
        self.live_lasttime = time.time()    # 無通信検出用タイムスタンプ（送受信統合）
        self.中断停止フラグ = False
        self.エラーフラグ = False
        self.エラータイム = 0  # 最後のエラーフラグ設定時刻
        self.再接続試行回数 = 0  # 連続エラー時の再接続試行回数
        
        # 生存状態管理（live_sessionの状況に連動）
        self.is_alive = True
        
        # TaskGroupパターン用の管理変数
        self.task_group = None
        
        # 受信キュー（サーバーとの連携用）
        self.音声受信Ｑ = None  # Geminiからの音声データをサーバーに送信
        self.テキスト受信Ｑ = None   # Geminiからのテキスト・ツール結果をサーバーに送信
        self._出力字幕 = ""
        self.音声出力字幕対応 = True
        
        # タスク管理（TaskGroup自動管理）
        
        # ツール呼び出し機能
        self.tool_instance = None  # ツールインスタンス
        
        # logger.info(f"LiveAI初期化:完了")
        pass
    
    def 関数インスタンス設定(self, functions_instance=None):
        """ツールインスタンスを設定"""
        if functions_instance is not None:
            self.tool_instance = functions_instance
        else:
            # セッションから取得を試みる
            try:
                from AIコア.AIセッション管理 import AIセッション管理
                セッション = AIセッション管理.get_session(self.セッションID)
                if セッション and hasattr(セッション, "tools_instance"):
                    self.tool_instance = セッション.tools_instance
                    self._logger.info("セッションからツールインスタンスを取得しました")
                else:
                    self.tool_instance = None
                    self._logger.warning("セッションにツールインスタンスがありません")
            except Exception as e:
                self._logger.error(f"セッションからツール取得失敗: {e}")
                self.tool_instance = None
    
    def _エラーフラグ制限設定(self, reason: str = ""):
        """
        15秒間隔制限付きエラーフラグ設定
        ログの重複を防ぐ
        
        Args:
            reason: エラー理由（ログ用）
        """
        import time
        current_time = time.time()
        
        # 15秒以内の連続エラーは無視
        if current_time - self.エラータイム < 15:
            return False
        
        # 15秒経過済みの場合のみ設定
        self.エラーフラグ = True
        self.エラータイム = current_time
        self._logger.warning(f"エラーフラグ設定: {reason}")
        return True
    
    
    async def 開始(self, 音声受信処理Ｑ=None, テキスト受信処理Ｑ=None) -> bool:
        """
        LiveAI機能の開始メソッド
        外部からaudio受信queueを受け取って連携する
        
        Args:
            音声受信処理Ｑ: 外部への音声受信queue
            テキスト受信処理Ｑ: 外部へのテキスト受信queue
        
        Returns:
            bool: 開始成功/失敗
        """
        # logger.info("開始:メソッド開始")
        pass
        # logger.info(f"開始:設定確認 api_key存在={bool(self.api_key)}, model={self.LIVE_MODEL}, voice={self.LIVE_VOICE}")
        pass
        
        # 開始時にフラグをリセット（復旧対応）
        self.中断停止フラグ = False
        self.エラーフラグ = False
        try:
            
            # Clientが初期化されていない場合は遅延初期化
            if not self.client and self.api_key:
                # logger.info("開始:GeminiClient初期化開始")
                pass
                try:
                    self.client = await asyncio.to_thread(
                        genai.Client,
                        api_key=self.api_key,
                        http_options={'api_version': 'v1alpha'}
                    )
                    # logger.info("開始:GeminiClient初期化成功")
                    pass
                except Exception as e:
                    self._logger.error(f"開始:GeminiClient初期化エラー {type(e).__name__}: {str(e)}")
                    return False
            
            if not self.client:
                self._logger.error("開始:Liveapi開始失敗（クライアント未初期化）")
                return False
            
            # フラグ初期化
            self.中断停止フラグ = False
            self.エラーフラグ = False
            self.live_lasttime = time.time()  # 無通信検出用タイムスタンプリセット
            
            # サーバーとの連携用キューを設定
            self.音声受信Ｑ = 音声受信処理Ｑ
            self.テキスト受信Ｑ = テキスト受信処理Ｑ
            
            # ツールインスタンス初期化
            if self.tool_instance is None and not self.diagnostic:
                self.関数インスタンス設定()
            
            # ライブセッションワーカーをバックグラウンドで開始
            self._background_task = asyncio.create_task(self._ライブセッションワーカー())
            
            self._logger.info(f"LiveAIセッション開始完了")
            return True
            
        except Exception as e:
            self._logger.error(f"開始:エラー発生 {type(e).__name__}: {str(e)}")
            self.エラーフラグ = True
            return False
    
    
    async def 終了(self) -> bool:
        """終了（中断停止フラグ設定のみ）"""
        try:
            # 中断停止フラグ設定
            self.中断停止フラグ = True
            
            # バックグラウンドタスクのキャンセル
            if hasattr(self, '_background_task') and self._background_task:
                self._background_task.cancel()
                try:
                    await self._background_task
                except asyncio.CancelledError:
                    pass
            
            # logger.info("終了:完了")
            pass
            return True
            
        except Exception as e:
            self._logger.error(f"終了:エラー({e})")
            return False
    
    # ===== 送信メソッド =====
    
    async def テキスト送信(self, text: str) -> bool:
        """
        テキスト送信メソッド
        Liveapiによるリアルタイム即時送信
        
        TaskGroupパターン：セッション維持ループでasync withブロックが維持されるため
        外部からのテキスト送信が可能
        """
        try:
            # データ存在チェック
            if not (text and text.strip()):
                self._logger.error(f"テキスト送信:データなし text='{text}' length={len(text) if text else 0}")
                return False
            
            # 【ログ追加】３）geminiテキスト投入口、テキスト
            # logger.info(f"３）geminiテキスト投入口: text='{text[:100]}{'...' if len(text) > 100 else ''}' length={len(text)}")
            pass

            # live_sessionの準備完了を待機(最大5秒)
            max_wait_time = 5.0
            wait_interval = 0.1
            elapsed_time = 0.0

            while not self.live_session and elapsed_time < max_wait_time:
                if self.中断停止フラグ or self.エラーフラグ:
                    break
                await asyncio.sleep(wait_interval)
                elapsed_time += wait_interval

            # セッション状態確認
            if not self.live_session or not (text and text.strip()):
                self._logger.warning(f"テキスト送信:条件不適合: live_session={self.live_session is not None} text={text[:30] if text else 'None'}")
                if not self.live_session:
                    self._logger.error(f"テキスト送信:live_sessionが初期化されていません")
                    self._logger.error(f"  - クライアント状態: {self.client is not None}")
                    self._logger.error(f"  - エラーフラグ: {self.エラーフラグ}")
                    self._logger.error(f"  - 待機時間: {elapsed_time:.1f}秒")
                    # logger.error(f"  - 中断停止フラグ: {self.中断停止フラグ}")  # パフォーマンス最適化
                    self._logger.error("  - 解決方法: 開始()メソッドが正常に実行されているか、APIキーが正しいか確認してください")
                return False
            
            # live_lasttimeを先に更新
            self.live_lasttime = time.time()
            
            # セッションにテキスト送信（旧 send(input=..., end_of_turn=True) の後継）
            from google.genai import types as _types
            await self.live_session.send_client_content(
                turns=_types.Content(role="user", parts=[_types.Part(text=text)]),
                turn_complete=True,
            )
            return True
            
        except Exception as e:
            self._logger.error(f"テキスト送信:エラー text={text[:30] if text else 'None'} error={e}")
            self._エラーフラグ制限設定(f"テキスト送信エラー: {e}")
            return False
    
    async def 音声送信(self, bytes_data: bytes) -> bool:
        """
        音声送信メソッド
        Liveapiによるリアルタイム即時送信（データ存在チェックのみ）
        Args:
            bytes_data: PCM音声データ（bytes形式）
        """
        try:
            # データ存在チェック
            if not bytes_data:
                self._logger.error("音声送信:データなし")
                return False
            
            # 【ログ追加】１）gemini音声入力の投入口。バイト数
            # logger.info(f"１）gemini音声入力の投入口: bytes={len(bytes_data)} mime_type=audio/pcm")
            pass

            # live_sessionの準備完了を待機(最大5秒)
            max_wait_time = 5.0
            wait_interval = 0.1
            elapsed_time = 0.0

            while not self.live_session and elapsed_time < max_wait_time:
                if self.中断停止フラグ or self.エラーフラグ:
                    break
                await asyncio.sleep(wait_interval)
                elapsed_time += wait_interval

            # セッション状態確認
            # logger.info(f"【デバッグ】live_session状態: {self.live_session is not None} type={type(self.live_session) if self.live_session else 'None'}")
            pass

            if not self.live_session or not bytes_data:
                # logger.warning(f"音声送信:条件不適合 live_session={self.live_session is not None} bytes_data={len(bytes_data) if bytes_data else 0}")
                pass
                return False
            
            # live_lasttimeを先に更新
            self.live_lasttime = time.time()
            
            # セッションに音声送信
            # 旧 send(input={"mime_type":...}) は realtime_input.media_chunks へ変換され非推奨のため
            # send_realtime_input(audio=...) を使う。mime_type にはサンプリングレートを明示する。
            from google.genai import types as _types
            await self.live_session.send_realtime_input(
                audio=_types.Blob(data=bytes_data, mime_type=f"audio/pcm;rate={self.input_rate}")
            )
            # logger.info(f"音声送信:完了 bytes={len(bytes_data)}")
            pass
            return True
            
        except Exception as e:
            self._logger.error(f"音声送信:エラー({e})")
            self._エラーフラグ制限設定(f"音声送信エラー: {e}")
            return False
    
    def _画像リサイズBase64(self, base64_data: str) -> str:
        """
        base64画像データのリサイズ（条件別）
        - 960x960以下: そのまま送信
        - 縦長以外（横長・正方形）: 960x540以下にリサイズ
        - 縦長: 540x960以下にリサイズ
        """
        try:
            # base64データをデコード
            image_bytes = base64.b64decode(base64_data)
            
            # PILで画像を開く
            with Image.open(io.BytesIO(image_bytes)) as img:
                # 元のサイズを取得
                original_width, original_height = img.size
                
                # 960x960以下はそのまま送信
                if original_width <= 960 and original_height <= 960:
                    return base64_data

                # 縦長かどうか判定
                is_portrait = original_height > original_width

                if is_portrait:
                    # 縦長: 540x960以下にリサイズ
                    target_width, target_height = 540, 960
                else:
                    # 横長・正方形: 960x540以下にリサイズ
                    target_width, target_height = 960, 540

                # アスペクト比を維持したリサイズ計算
                aspect_ratio = original_width / original_height

                if aspect_ratio > (target_width / target_height):
                    # 幅が基準
                    new_width = target_width
                    new_height = int(target_width / aspect_ratio)
                else:
                    # 高さが基準
                    new_height = target_height
                    new_width = int(target_height * aspect_ratio)
                
                # リサイズ実行
                resized_img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                
                # JPEGとして保存（バイト形式）
                output_buffer = io.BytesIO()
                resized_img.convert('RGB').save(output_buffer, format='JPEG', quality=85)
                output_buffer.seek(0)
                
                # base64エンコード
                resized_base64 = base64.b64encode(output_buffer.getvalue()).decode('utf-8')
                
                return resized_base64
                
        except Exception as e:
            self._logger.error(f"画像リサイズエラー: {e}")
            # エラーの場合は元のデータを返す
            return base64_data

    async def 画像送信(self, image_data, format: str = "jpeg") -> bool:
        """
        画像送信メソッド（送信直前リサイズ対応）
        Liveapiによるリアルタイム即時送信
        image_dataはbase64文字列を受け取り、960x540にリサイズしてから送信
        """
        try:
            # live_sessionの準備完了を待機(最大5秒)
            max_wait_time = 5.0
            wait_interval = 0.1
            elapsed_time = 0.0

            while not self.live_session and elapsed_time < max_wait_time:
                if self.中断停止フラグ or self.エラーフラグ:
                    break
                await asyncio.sleep(wait_interval)
                elapsed_time += wait_interval

            if not self.live_session or not image_data:
                # logger.warning(f"画像送信:条件不適合 live_session={self.live_session is not None} image_data={bool(image_data)}")
                pass
                return False

            # 送信直前に960x540にリサイズ
            resized_image_data = self._画像リサイズBase64(image_data)
            
            # live_lasttimeを先に更新
            self.live_lasttime = time.time()
            
            # 親マネージャーに最終イメージを保管
            if self.parent_manager and hasattr(self.parent_manager, 'セッションデータ'):
                self.parent_manager.セッションデータ['最終イメージ'] = resized_image_data
                self.parent_manager.セッションデータ['最終イメージ時刻'] = time.time()
            
            # リサイズされた画像を送信（media_chunks 非推奨のため video= で送る）
            from google.genai import types as _types
            await self.live_session.send_realtime_input(
                video=_types.Blob(data=resized_image_data, mime_type=f"image/{format}")
            )
            
            # logger.info(f"画像送信:完了 リサイズ後送信")
            pass
            return True
            
        except Exception as e:
            self._logger.error(f"画像送信:エラー({e})")
            self._エラーフラグ制限設定(f"画像送信エラー: {e}")
            return False
    
    
    
    # ===== LiveAI受信ワーカー（特化版） =====
    
    async def _ライブセッションワーカー(self):
        """ライブセッションワーカー（TaskGroupパターン - 古いバージョン成功方式）"""
        try:
            # logger.info(f"ライブセッションワーカー:開始")
            pass
            
            # 復旧用メインループ（中断停止フラグのみで制御）
            while not self.中断停止フラグ:
                # logger.info(f"Live apiセッション接続準備:")
                pass
                # logger.info(f"  client存在: {self.client is not None}")
                pass
                # logger.info(f"  model: {self.LIVE_MODEL}")
                pass
                # logger.info(f"  中断停止フラグ: {self.中断停止フラグ}")
                pass
                # logger.info(f"  エラーフラグ: {self.エラーフラグ}")
                pass
                
                # 再接続試行回数チェック
                if self.再接続試行回数 >= MAX_RETRY_COUNT:
                    self._logger.error(f"再接続試行回数が上限({MAX_RETRY_COUNT}回)に達しました。LiveAIセッションワーカーを停止します。")
                    self.中断停止フラグ = True
                    break

                # 再接続時にエラーフラグをリセット
                self.エラーフラグ = False

                try:
                    # logger.info(f"live_session接続開始")  # 通常時はコメント化
                    pass
                    # TaskGroupパターン：古いバージョンの成功方式
                    async with (
                        self.client.aio.live.connect(
                            model=self.LIVE_MODEL, 
                            config=await self._設定構成作成()
                        ) as session,
                        asyncio.TaskGroup() as tg,
                    ):
                        # logger.info("Live apiセッション接続成功")  # 通常時はコメント化
                        pass
                        session_start_time = time.time()  # セッション開始時刻記録
                        セッションID = f"{int(session_start_time % 10000)}"  # セッション識別用ID（下4桁）
                        self.live_session = session
                        self._出力字幕 = ""
                        self.task_group = tg
                        self.is_alive = True  # live_session確立時にTrueに設定
                        self.live_lasttime = time.time()  # セッション開始時にlive_lasttime更新
                        self.再接続試行回数 = 0  # 接続成功時にリセット
                        self._logger.info(f"セッション維持ループ開始 (ID:{セッションID})")
                        # logger.info(f"live_session設定完了: {self.live_session is not None}")  # 通常時はコメント化
                        # logger.info(f"live_sessionタイプ: {type(self.live_session)}")  # 通常時はコメント化
                        pass
                        
                        # 受信ワーカータスクを起動
                        # logger.info(f"受信ワーカータスク起動開始 - is_alive={self.is_alive}")
                        pass
                        tg.create_task(self._受信ワーカー())
                        # logger.info(f"受信ワーカータスク起動完了 - is_alive={self.is_alive}")
                        pass
                        
                        # セッション維持ループ：0.5秒間隔でCPU使用率削減
                        # この無限ループが async with ブロックを維持し、セッションを有効に保つ
                        # logger.info(f"セッション維持ループ開始 - is_alive={self.is_alive}")
                        pass
                        loop_count = 0
                        while not self.中断停止フラグ and not self.エラーフラグ:
                            loop_count += 1
                            await asyncio.sleep(0.5)
                            
                            # 10秒に1回（20回ループ）で状態確認ログ
                            if loop_count % 20 == 1:
                                # logger.info(f"セッション維持中 (ループ{loop_count}): live_session={self.live_session is not None}, 中断停止フラグ={self.中断停止フラグ}, エラーフラグ={self.エラーフラグ}")
                                pass
                        
                        session_duration = time.time() - session_start_time
                        self._logger.info(f"セッション維持ループ終了 (ID:{セッションID}, セッション時間{session_duration:.0f}秒): 中断停止フラグ={self.中断停止フラグ}, エラーフラグ={self.エラーフラグ}")
                        
                except Exception as e:
                    self.再接続試行回数 += 1  # エラー時にカウンタ増加
                    self._logger.error(f"セッション接続エラー詳細 (試行回数:{self.再接続試行回数}/{MAX_RETRY_COUNT}):")
                    self._logger.error(f"  エラータイプ: {type(e).__name__}")
                    self._logger.error(f"  エラーメッセージ: {str(e)}")
                    # logger.error(f"  api Key設定: {'***設定済み***' if self.api_key else '未設定'}")  # パフォーマンス最適化
                    # logger.error(f"  モデル: {self.LIVE_MODEL}")  # パフォーマンス最適化

                    self.live_session = None
                    self.task_group = None
                    self.is_alive = False  # live_sessionクリア時にFalseに設定
                    # logger.error(f"live_session破棄完了（エラー時）: is_alive={self.is_alive}")  # パフォーマンス最適化
                    self.エラーフラグ = True

                # 接続エラー時は5秒待機後再接続
                if not self.中断停止フラグ:
                    # logger.info(f"{RETRY_WAIT_TIME}秒後に再接続試行")
                    pass
                    await asyncio.sleep(RETRY_WAIT_TIME)
                    
        except Exception as e:
            self._logger.error(f"ライブセッションワーカーエラー: {e}")
        finally:
            self.live_session = None
            self.task_group = None
            self.is_alive = False  # ワーカー終了時にFalseに設定
            self._logger.info(f"live_session破棄完了（ワーカー終了時）: セッション={self.セッションID}, is_alive={self.is_alive}, エラーフラグ={self.エラーフラグ}")
            # logger.info("ライブセッションワーカー:終了")
            pass
    
    async def _受信ワーカー(self):
        """受信専用ワーカー（TaskGroup内で実行）"""
        開始時刻 = time.monotonic()
        try:
            # logger.info(f"受信ワーカー:開始 - is_alive={self.is_alive}")
            pass
            # logger.info(f"受信ワーカー:初期状態 - live_session={self.live_session is not None}, 中断停止フラグ={self.中断停止フラグ}, エラーフラグ={self.エラーフラグ}")
            pass
            
            loop_count = 0
            while not self.中断停止フラグ and not self.エラーフラグ and self.live_session:
                loop_count += 1
                
                # 初回と10回ごとにループ状態をログ出力
                if loop_count == 1 or loop_count % 10 == 0:
                    # logger.info(f"受信ワーカー:ループ{loop_count} - live_session={self.live_session is not None}, 中断停止フラグ={self.中断停止フラグ}, エラーフラグ={self.エラーフラグ}")
                    pass
                
                try:
                    # 受信（タイムアウト5秒）
                    response = await asyncio.wait_for(
                        self.live_session.receive().__anext__(),
                        timeout=LIVEAI_TIMEOUT
                    )
                    # テキスト、音声、ツールコール処理
                    await self._レスポンス処理(response)
                    self.live_lasttime = time.time()
                    
                    # データ取得時の高速処理用sleep（パフォーマンス最適化）
                    # await asyncio.sleep(0.00)  # データ有：高速処理
                    
                except asyncio.TimeoutError:
                    # タイムアウト（正常）- セッション生存確認＋キープアライブ確認
                    if loop_count % 40 == 1:  # 200秒間隔でログ出力
                        # logger.info(f"セッション生存確認: OK (ループ{loop_count})")
                        pass
                    
                    # タイムアウト時のキープアライブ確認・処理
                    await self._キープアライブ確認()
                        
                except Exception as e:
                    # 受信エラー → 詳細ログとエラーフラグ設定
                    self._logger.error(f"受信エラー詳細:")
                    self._logger.error(f"  エラータイプ: {type(e).__name__}")
                    self._logger.error(f"  エラーメッセージ: {str(e)}")
                    # logger.error(f"  ループ回数: {loop_count}")  # パフォーマンス最適化
                    # logger.error(f"  セッション存在: {self.live_session is not None}")  # パフォーマンス最適化
                    # logger.error(f"  中断停止フラグ: {self.中断停止フラグ}")  # パフォーマンス最適化
                    self.エラーフラグ = True
                    break
                
        except Exception as e:
            self._logger.error(f"受信ワーカーエラー詳細:")
            self._logger.error(f"  エラータイプ: {type(e).__name__}")
            self._logger.error(f"  エラーメッセージ: {str(e)}")
            # logger.error(f"  総ループ数: {loop_count}")  # パフォーマンス最適化
            self.エラーフラグ = True
        finally:
            所要秒 = time.monotonic() - 開始時刻
            self._logger.info(
                f"受信ワーカー:終了: セッション={self.セッションID}, 所要秒={所要秒:.1f}, "
                f"中断停止フラグ={self.中断停止フラグ}, エラーフラグ={self.エラーフラグ}"
            )
    
    async def _設定構成作成(self):
        """設定構成を作成"""
        try:
            # logger.info("設定構成作成開始")
            pass
            
            # システム指示
            instructions = self.SYSTEM_INSTRUCTION
            
            # システム設計資料を取得してシステム指示に追加
            if self.parent_manager and hasattr(self.parent_manager, '_システム設計取得'):
                try:
                    システム設計内容 = await self.parent_manager._システム設計取得()
                    if システム設計内容 and len(システム設計内容.strip()) > 0:
                        instructions += "\n\n【システム設計】\n"
                        instructions += "``` 設計内容\n"
                        instructions += システム設計内容
                        instructions += "\n```\n"
                        
                        # logger.info(f"システム設計追加: {len(システム設計内容)}文字")
                        pass
                except Exception as e:
                    self._logger.warning(f"システム設計取得エラー: {e}")
            
            # 過去の会話履歴を取得してシステム指示に追加
            if self.parent_manager and hasattr(self.parent_manager, '_履歴データ取得'):
                try:
                    履歴データ = await self.parent_manager._履歴データ取得()
                    if 履歴データ and len(履歴データ) > 0:
                        instructions += "\n\n【過去の会話履歴】\n"
                        for 履歴項目 in 履歴データ:
                            message_type = 履歴項目.メッセージタイプ
                            message_content = 履歴項目.メッセージ内容
                            
                            # メッセージタイプに応じて形式を調整（3行形式）
                            if message_type == "input_text":
                                instructions += f"```user\n{message_content}\n```\n"
                            elif message_type == "output_text":
                                instructions += f"```assistant\n{message_content}\n```\n"
                            elif message_type == "recognition_input":
                                instructions += f"```user [音声入力]\n{message_content}\n```\n"
                            elif message_type == "recognition_output":
                                instructions += f"```assistant [音声出力]\n{message_content}\n```\n"
                            else:
                                instructions += f"```{message_type}\n{message_content}\n```\n"
                        
                        # logger.info(f"会話履歴追加: {len(履歴データ)}件")
                        pass
                except Exception as e:
                    self._logger.warning(f"会話履歴取得エラー: {e}")
            
            # logger.info(f"システム指示長: {len(instructions)} 文字")
            pass
            
            # ツール設定
            # code_execution は native-audio 系 Live モデルが非対応
            # （"Code Execution tool is not supported for this model." で 1007 切断される）ため付けない。
            tools = [] if self.diagnostic else [{"google_search": {}}]
            
            # ツール呼び出し機能を追加
            if self.tool_instance is not None:
                try:
                    function_declarations = []
                    if hasattr(self.tool_instance, 'ツールインスタンス辞書'):
                        for ツール in self.tool_instance.ツールインスタンス辞書.values():
                            try:
                                定義 = ツール.get_tool_definition()
                            except Exception:
                                定義 = None
                            if 定義:
                                function_declarations.append(定義)
                    if function_declarations:
                        tools.append({"function_declarations": function_declarations})
                    # logger.info(f"ツール呼び出し機能追加: {len(function_declarations)} 個")
                    pass
                except Exception as e:
                    self._logger.warning(f"ツール呼び出し機能取得エラー: {e}")
            else:
                # logger.info("ツールインスタンスが存在しません")
                pass
            
            # logger.info(f"総ツール数: {len(tools)}")
            pass
            
            # 設定構成
            from google.genai import types
            
            try:
                # Live接続設定（正しい構造）
                config = types.LiveConnectConfig(
                    response_modalities=["AUDIO"],
                    output_audio_transcription=types.AudioTranscriptionConfig(),
                    speech_config=types.SpeechConfig(
                        language_code="ja-JP",
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=self.LIVE_VOICE)
                        )
                    ),
                    generation_config=types.GenerationConfig(
                        temperature=1.0,
                        max_output_tokens=8192,
                    ),
                    system_instruction=types.Content(
                        parts=[types.Part(text=instructions)]
                    ),
                    tools=tools,
                )
                # logger.info(f"Live接続設定作成完了: voice={self.LIVE_VOICE}")
                return config

            except Exception as e:
                self._logger.error(f"設定構成作成エラー: {type(e).__name__}: {e}")
                # エラー時は最小設定で復旧を試行
                self._logger.warning("最小設定で復旧試行")
                return types.LiveConnectConfig(
                    response_modalities=["AUDIO"],
                    output_audio_transcription=types.AudioTranscriptionConfig(),
                    speech_config=types.SpeechConfig(language_code="ja-JP"),
                    generation_config=types.GenerationConfig(),
                    system_instruction=types.Content(
                        parts=[types.Part(text="あなたは、美しい日本語を話す、賢いAIアシスタントです。")]
                    ),
                )
                
        except Exception as e:
            self._logger.error(f"設定構成作成で予期しないエラー: {e}")
            raise e
    
    async def _キープアライブ確認(self):
        """アイドル時のキープアライブ確認・処理（1分送受信なしで1秒送信）"""
        current_time = time.time()
        time_since_last_communicate = current_time - self.live_lasttime
        
        # デバッグ: キープアライブ判定状況を確認
        # logger.info(f"キープアライブ判定: 無通信{time_since_last_communicate:.1f}秒 (閾値:{KEEPALIVE_INTERVAL}秒)")
        
        # 1分無通信でキープアライブ送信
        if time_since_last_communicate >= KEEPALIVE_INTERVAL:
            try:
                import numpy as np

                # 1秒間のキープアライブノイズ生成
                samples = int(KEEPALIVE_SAMPLE_RATE * KEEPALIVE_DURATION)
                noise_data = np.random.randint(-KEEPALIVE_NOISE_LEVEL, KEEPALIVE_NOISE_LEVEL, samples, dtype=np.int16)
                noise_bytes = noise_data.tobytes()

                # キープアライブ送信
                await self.音声送信(noise_bytes)
                self._logger.info(f"キープアライブ送信: 無通信{time_since_last_communicate:.1f}秒")

            except Exception as e:
                self._logger.error(f"キープアライブエラー: {e}")
                # キープアライブ送信失敗は接続断を意味するため、エラーフラグを設定して再接続を促す
                self.エラーフラグ = True
        else:
            # アイドル時は0.25秒待機
            await asyncio.sleep(0.25)
    
    async def _レスポンス処理(self, response):
        """レスポンス処理（参考ファイルの_server_content参考）"""
        try:
            server_content = response.server_content
            tool_call = response.tool_call
            go_away = response.go_away
            
            # logger.info("=== レスポンス処理開始 ===")
            # logger.info(f"server_content: {server_content is not None}")
            # logger.info(f"tool_call: {tool_call is not None}")
            # logger.info(f"go_away: {go_away is not None}")
            
            # server_content処理
            if server_content is not None:
                # logger.info("server_contentを処理します")
                await self._サーバーコンテンツ処理(server_content)
            
            # tool_call処理
            if tool_call is not None:
                # logger.info("*** TOOL CALL検出！処理を開始します ***")
                await self._ツール呼び出し処理(tool_call)
            
            # その他のレスポンス（未知内容の簡素ログ出力）
            if server_content is None and tool_call is None:
                # レスポンス内容を簡素に取得
                response_data = {}
                
                # 利用可能な属性から内容を取得
                for attr in dir(response):
                    if not attr.startswith('_'):
                        try:
                            value = getattr(response, attr)
                            if value is not None and not callable(value):
                                response_data[attr] = str(value)[:100]  # 100文字制限
                        except:
                            pass
                
                # go_awayは正常な終了通知なのでログスキップ
                if hasattr(response, 'go_away') and response.go_away:
                    pass  # go_away通知は正常終了、ログ出力しない
                else:
                    self._logger.warning(f"LiveAI未知レスポンス")
                    self._エラーフラグ制限設定("LiveAI未知レスポンス")
            
            # logger.info("=== レスポンス処理終了 ===\n")
                    
        except Exception as e:
            # レスポンス処理エラーも15秒制限付きエラー処理
            self._エラーフラグ制限設定(f"LiveAIレスポンス処理エラー: {e}")
    
    async def _サーバーコンテンツ処理(self, server_content):
        """サーバーコンテンツ処理"""
        try:
            model_turn = server_content.model_turn
            turn_complete = server_content.turn_complete
            interrupted = server_content.interrupted
            
            # logger.debug(f"サーバーコンテンツ処理:開始 model_turn={model_turn is not None} turn_complete={turn_complete} interrupted={interrupted}")
            
            # native-audio の回答文字列は model_turn.parts.text ではなく字幕に届く。
            字幕 = getattr(server_content, "output_transcription", None)
            if 字幕 and 字幕.text:
                self._出力字幕 += 字幕.text

            # model_turn処理
            if model_turn is not None:
                parts = model_turn.parts
                # logger.debug(f"model_turn処理:parts数={len(parts) if parts else 0}")
                for part in parts:
                    # 推論用テキストは会話の回答として送らない。音声の字幕は別途集約する。
                    if getattr(part, "thought", False):
                        continue
                    if part.text is not None:
                        # logger.info(f"テキスト受信:{part.text[:100]}{'...' if len(part.text) > 100 else ''} length={len(part.text)}")
                        pass
                        # テキストを外部queueに送信
                        text_data = {
                            "text": part.text
                        }
                        
                        # テキストをサーバーに送信
                        if self.テキスト受信Ｑ is not None:
                            try:
                                await self.テキスト受信Ｑ.put(text_data)
                            except Exception as e:
                                self._logger.warning(f"テキスト送信エラー: {e}")
                        
                    elif part.inline_data is not None:
                        # inline_dataの種類を判定して処理
                        bytes_data = part.inline_data.data
                        mime_type = part.inline_data.mime_type
                        
                        if mime_type.startswith('audio/'):
                            # 【ログ追加】２）gemini音声受信時。バイト数
                            # logger.info(f"２）gemini音声受信時: bytes={len(bytes_data)} mime_type={mime_type}")
                            pass
                            
                            # 音声データを外部queueに送信
                            audio_data = {
                                "mime_type": mime_type,
                                "bytes_data": bytes_data
                            }
                            # logger.info(f"音声受信:バイト数={len(bytes_data)} mime_type={mime_type}")
                            pass
                            
                            # 音声をサーバーに送信
                            if self.音声受信Ｑ is not None:
                                try:
                                    await self.音声受信Ｑ.put(audio_data)
                                except Exception as e:
                                    self._logger.warning(f"音声送信エラー: {e}")
                                    
                        
            # 1ターンの字幕をまとめ、音声停止時も聞こえた部分を表示する。
            if turn_complete or interrupted:
                if self._出力字幕 and self.テキスト受信Ｑ is not None:
                    await self.テキスト受信Ｑ.put({"text": self._出力字幕})
                self._出力字幕 = ""
                if self.diagnostic and self.テキスト受信Ｑ is not None:
                    await self.テキスト受信Ｑ.put({"diagnostic_turn_complete": bool(turn_complete and not interrupted)})
                
        except Exception as e:
            # サーバーコンテンツ処理エラーも15秒制限付きエラー処理
            self._エラーフラグ制限設定(f"LiveAIサーバーコンテンツ処理エラー: {e}")
    
    async def _ツール呼び出し処理(self, tool_call):
        """ツール呼び出し処理"""
        try:
            # logger.debug("=== TOOL CALL処理開始 ===")
            # logger.debug(f"tool_callオブジェクト: {tool_call}")
            # logger.debug(f"function_calls数: {len(tool_call.function_calls) if tool_call.function_calls else 0}")
            
            # 全ツール呼び出しを1つのprocessで並列実行
            asyncio.create_task(self._process_tool_calls(tool_call))
            # logger.debug("=== TOOL CALL処理完了（並列実行開始） ===\n")
                
        except Exception as e:
            # ツール呼び出し処理エラーも15秒制限付きエラー処理
            self._エラーフラグ制限設定(f"LiveAIツール呼び出し処理エラー: {e}")
    
    
    # ===== ステータス確認メソッド =====
    
    def 接続状態確認(self) -> dict:
        """LiveAI接続状態を確認"""
        return {
            "liveai_status": {
                "session_active": self.live_session is not None,
                "client_initialized": self.client is not None,
                "live_ai": self.LIVE_AI,
                "model": self.LIVE_MODEL,
                "voice": self.LIVE_VOICE,
                "中断停止フラグ": self.中断停止フラグ,
                "エラーフラグ": self.エラーフラグ,
                "live_lasttime": self.live_lasttime,
                "time_since_last_communicate": time.time() - self.live_lasttime
            },
            "サーバー連携": {
                "audio_queue": self.音声受信Ｑ is not None,
                "text_queue": self.テキスト受信Ｑ is not None,
            },
            "functions": {
                "instance_initialized": self.tool_instance is not None,
                "available_functions": list(self.tool_instance.tool_functions.keys()) if self.tool_instance else []
            },
            "gemini_sending": "リアルタイム直接送信"
        }

    async def _process_tool_calls(self, tool_call):
        """全ツール呼び出しを並列処理する統一processメソッド"""
        try:
            for i, fc in enumerate(tool_call.function_calls):
                f_id = fc.id
                f_name = fc.name
                f_args = fc.args  # 辞書形式で取得
                # パラメータを20文字制限、改行エスケープ
                f_kwargs_full = json.dumps(f_args, ensure_ascii=False)
                f_kwargs_escaped = f_kwargs_full.replace('\n', '\\n').replace('\r', '\\r')
                f_kwargs_short = f_kwargs_escaped[:20] + ("..." if len(f_kwargs_escaped) > 20 else "")
                
                # ツール実行処理
                if self.tool_instance is not None:
                    try:
                        result = await self.tool_instance.execute_tool_call(f_name, f_args)
                        
                        # リアルタイム処理最適化：ツール名を行内に埋め込み、パラメータ・結果を別行表示
                        result_escaped = result.replace('\n', '\\n').replace('\r', '\\r')
                        result_short = result_escaped[:20] + ("..." if len(result_escaped) > 20 else "")
                        self._logger.info(f"Tool[{f_name}] Request: {f_kwargs_short}")
                        self._logger.info(f"Tool[{f_name}] Result: {result_short}")
                        
                    except Exception as e:
                        self._logger.error(f"ツール実行エラー: {e}")
                        result = f"エラーが発生しました: {str(e)}"
                else:
                    self._logger.error(f"ツールインスタンスが利用できません: {f_name}")
                    result = f"ツール呼び出し機能が利用できません: {f_name}"
                
                # ツール結果を外部queueに送信
                tool_result = {
                    "function_name": f_name,
                    "parameters": f_kwargs_full,
                    "result": result,
                    "timestamp": time.time(),
                    "type": "tool_call"
                }
                
                # ツール結果をサーバーに送信
                if self.テキスト受信Ｑ is not None:
                    try:
                        await self.テキスト受信Ｑ.put(tool_result)
                    except Exception as e:
                        self._logger.warning(f"ツール結果送信エラー: {e}")

                # Geminiに結果を返送
                if self.live_session:
                    try:
                        # 旧 send(input=LiveClientToolResponse(...)) の後継
                        await self.live_session.send_tool_response(
                            function_responses=[types.FunctionResponse(
                                name=f_name,
                                id=f_id,
                                response={"result": result},
                            )]
                        )
                    except Exception as e:
                        self._logger.warning(f"Gemini結果返送エラー: {e}")
                        
        except Exception as e:
            self._logger.error(f"ツール呼び出し処理エラー: {e}")
    
    
    
    
    

