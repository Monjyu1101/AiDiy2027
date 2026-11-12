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
import json
import tempfile
from typing import Any, Dict

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CONFIG_FILE = '../_config/AiDiy_key.json'

class conf_json:
    """設定JSON管理クラス（シンプル実装・プロパティアクセス対応）"""

    # デフォルト設定値
    DEFAULT_CONFIG = {
        # WebUI設定
        'PORT_WEB': '8090',
        'PORT_CORE': '8091',
        'PORT_AVATAR': '8092',
        'PORT_TASKTEAM': '8093',
        'PORT_TOOLS': '8095',
        'PORT_LOCAL': '8096',
        'PORT_APPS': '8098',
        'WEBUI_FIRST_PAGE': 'メニュー',

        # APIキー
        'gemini_key_id': '< your gemini api key >',
        'freeai_key_id': '< your freeai api key >',
        'claude_key_id': '< your claude api key >',

        # OpenAI/Azureの基本設定
        'openai_api_type': 'openai',
        'openai_organization': '< your openai organization id >',
        'openai_key_id': '< your openai api key >',
        'azure_endpoint': '< your azure openai endpoint >',
        'azure_version': 'yyyy-mm-dd-preview',
        'azure_key_id': '< your azure openai api key >',

        # Copilot/OpenRouterの基本設定
        'copilot_key_id': '< your copilot api key >',
        'openrt_key_id': '< your openrouter api key >',

        # Ollamaの基本設定（ローカルLLM）
        'ollama_key_id': '< your ollama api key >',
        'ollama_host': 'http://127.0.0.1:11434',

        # HuggingFaceの基本設定（ローカルLLM / モデルダウンロード）
        'huggingface_key_read': '< your huggingface read key >',
        'huggingface_key_write': '< your huggingface write key >',

        # Discord接続（未設定では起動しない。IDは文字列で指定）
        'discord_bot_token': '< your discord bot token >',
        'discord_guild_id': '< your discord server id >',
        'discord_allowed_user_id': '< your discord user id >',
        'discord_text_channel_id': '< your discord text channel id >',
        'discord_voice_channel_id': '< your discord voice channel id >',

        # Slack接続（IDは文字列で指定）
        'slack_bot_token': '< your slack bot token >',
        'slack_app_token': '< your slack app-level token >',
        'slack_team_id': '< your slack workspace id >',
        'slack_allowed_user_id': '< your slack user id >',
        'slack_text_channel_id': '< your slack text channel id >',

        # ChatAI設定
        'CHAT_AI_NAME': 'freeai_chat',
        'CHAT_GEMINI_MODEL': 'gemini-3.1-flash-image',
        'CHAT_FREEAI_MODEL': 'gemini-4-carbon',
        'CHAT_OPENRT_MODEL': 'google/gemini-3.1-flash-image',
        'CHAT_OPENRT_FREE_MODEL': 'auto',
        'CHAT_OPENAI_MODEL': 'gpt-6.1-sol',
        'CHAT_OLLAMA_MODEL': 'deepseek-v4-flash:cloud',
        'CHAT_LOCAL_MODEL': 'google/gemma-4-E2B-it',
        'CHAT_LOCAL_DTYPE': 'bfloat16',

        # LiveAI設定
        'LIVE_AI_NAME': 'freeai_live',
        'LIVE_GEMINI_MODEL': 'gemini-2.5-flash-native-audio-preview-12-2025',
        'LIVE_GEMINI_VOICE': 'Zephyr',
        'LIVE_FREEAI_MODEL': 'gemini-2.5-flash-native-audio-preview-09-2025',
        'LIVE_FREEAI_VOICE': 'Zephyr',
        'LIVE_OPENAI_MODEL': 'gpt-realtime-2.1-mini',
        'LIVE_OPENAI_VOICE': 'marin',

        # PredictionAI設定（次のユーザー入力予測用。方式別モデル）
        'PREDICTION_AI_NAME': 'auto',
        'PREDICTION_OPENAI_MODEL': 'auto',
        'PREDICTION_OAUTH_MODEL': 'auto',
        'PREDICTION_GEMINI_MODEL': 'auto',
        'PREDICTION_FREEAI_MODEL': 'auto',
        'PREDICTION_CODEX_CLI_MODEL': 'gpt-6-luna',
        'PREDICTION_COPILOT_CLI_MODEL': 'gpt-6-luna',
        'PREDICTION_AIDIY_HERMES_MODEL': 'openai_oauth/gpt-6-luna',

        # DecisionAI設定（方式別モデル。autoは各方式の既定値）
        'DECISION_AI_NAME': 'auto',
        'DECISION_OPENAI_MODEL': 'auto',
        'DECISION_OAUTH_MODEL': 'auto',
        'DECISION_GEMINI_MODEL': 'auto',
        'DECISION_FREEAI_MODEL': 'auto',

        # CodeAI設定
        'CODE_BASE_PATH': '../',
        'CODE_PERMISSIONS': 'auto',
        'CODE_AI1_NAME': 'aidiy_hermes',
        'CODE_AI1_MODEL': 'auto',
        'CODE_AI2_NAME': 'copilot_cli',
        'CODE_AI2_MODEL': 'auto',
        'CODE_AI3_NAME': 'claude_cli',
        'CODE_AI3_MODEL': 'auto',
        'CODE_AI4_NAME': 'antigravity_cli',
        'CODE_AI4_MODEL': 'same',
        'CODE_AI5_NAME': 'opencode_cli',
        'CODE_AI5_MODEL': 'auto',
        'CODE_AI6_NAME': 'aidiy_hermes',
        'CODE_AI6_MODEL': 'auto',
        'CODE_CLAUDE_SDK_MODEL': 'auto',
        'CODE_CLAUDE_CLI_MODEL': 'auto',
        'CODE_CLAUDE_OLLAMA_MODEL': 'auto',
        'CODE_COPILOT_CLI_MODEL': 'auto',
        'CODE_ANTIGRAVITY_CLI_MODEL': 'auto',
        'CODE_CODEX_CLI_MODEL': 'auto',
        'CODE_CODEX_OLLAMA_MODEL': 'auto',
        'CODE_GROK_CLI_MODEL': 'same',
        'CODE_AIDIY_HERMES_MODEL': 'auto',
        'CODE_OPENCODE_CLI_MODEL': 'auto',
        'CODE_MAX_TURNS': 999,
        'CODE_PLAN': 'auto',
        'CODE_VERIFY': 'auto',
        'CODE_SELF_CHECK_LOOP': 1,

        # TaskAI設定
        'TASK_AI_NAME': 'codex_cli',
        'TASK_AI_MODEL_plan': 'auto',
        'TASK_AI_MODEL_do': 'auto',
        'TASK_AI_MODEL_check': 'auto',

        # TeamAI設定
        'TEAM_AI_NAME': 'codex_cli',
        'TEAM_AI_MODEL_plan': 'auto',
        'TEAM_AI_MODEL_do': 'auto',
        'TEAM_AI_MODEL_check': 'auto',
    }

    # ポート番号として検証・正規化するキー
    PORT_KEYS = ('PORT_WEB', 'PORT_CORE', 'PORT_AVATAR', 'PORT_TASKTEAM', 'PORT_TOOLS', 'PORT_LOCAL', 'PORT_APPS')

    def __init__(self, json: str = None):
        """
        初期化

        Args:
            json: 設定ファイルパス（省略時はデフォルト）
        """
        if json is None:
            json = os.path.normpath(os.path.join(BACKEND_DIR, DEFAULT_CONFIG_FILE))

        object.__setattr__(self, '_config_file', json)
        object.__setattr__(self, '_config_data', {})

        # 設定ファイルを読み込み（無い場合は作成）
        self._load_or_create()

    def _load_or_create(self) -> None:
        """設定ファイルの読み込み、または初期値で作成"""
        config_file = object.__getattribute__(self, '_config_file')
        保存要否 = False

        if os.path.exists(config_file):
            try:
                with open(config_file, 'r', encoding='utf-8-sig') as f:
                    config_data = json.load(f)
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                logger.error(f'設定ファイル読み込みエラー: {e}')
                raise ValueError(
                    f'設定ファイルの形式が不正です（元ファイルは変更しません）: {config_file}'
                ) from e
            except OSError as e:
                logger.error(f'設定ファイル読み込みエラー: {e}')
                raise

            if not isinstance(config_data, dict):
                logger.error('設定JSONのルートはオブジェクト(dict)である必要があります')
                raise ValueError(
                    f'設定JSONのルートがオブジェクトではありません（元ファイルは変更しません）: {config_file}'
                )
            object.__setattr__(self, '_config_data', config_data)
            logger.info(f'設定ファイル読み込み完了: {config_file}')
        else:
            logger.warning(f'設定ファイルが存在しません: {config_file}')
            object.__setattr__(self, '_config_data', self.DEFAULT_CONFIG.copy())
            保存要否 = True

        # 既存設定に不足しているデフォルト項目を補完
        if self._apply_default_keys():
            保存要否 = True

        # ポートは1～65535の文字列へ正規化する
        if self._validate_and_normalize_port_values():
            保存要否 = True

        # CODE_AI2_NAME～6_NAMEが"auto"の場合、CODE_AI1_NAMEの値をコピー
        if self._apply_code_ai_auto():
            保存要否 = True

        if 保存要否 and not self._save():
            raise OSError(f'設定ファイルを保存できません: {config_file}')

    @staticmethod
    def _normalize_port_value(key: str, value: Any) -> str:
        """ポート値を検証し、JSONで使用する10進文字列へ統一する。"""
        if isinstance(value, bool):
            raise ValueError(f'{key} は1～65535のポート番号で指定してください: {value!r}')

        text = str(value).strip()
        if not text.isdecimal():
            raise ValueError(f'{key} は1～65535のポート番号で指定してください: {value!r}')

        port = int(text, 10)
        if not 1 <= port <= 65535:
            raise ValueError(f'{key} は1～65535のポート番号で指定してください: {value!r}')
        return str(port)

    def _validate_and_normalize_port_values(self) -> bool:
        """現行ポートキーを検証し、値を文字列へ正規化する。"""
        config_data = object.__getattribute__(self, '_config_data')
        変更あり = False
        for key in self.PORT_KEYS:
            if key not in config_data:
                continue
            normalized_value = self._normalize_port_value(key, config_data[key])
            if normalized_value != config_data[key]:
                config_data[key] = normalized_value
                変更あり = True
        return 変更あり

    def _ordered_config_data(self, config_data: Dict[str, Any]) -> Dict[str, Any]:
        """既定キーを先頭へ並べ、未知キーの現在順を末尾に維持する。"""
        ordered = {}
        for key in self.DEFAULT_CONFIG:
            if key in config_data:
                ordered[key] = config_data[key]
        for key, value in config_data.items():
            if key not in ordered:
                ordered[key] = value
        return ordered

    def _apply_default_keys(self) -> bool:
        """不足しているデフォルト設定キーを補完"""
        config_data = object.__getattribute__(self, '_config_data')
        変更あり = False
        for key, value in self.DEFAULT_CONFIG.items():
            if key not in config_data:
                config_data[key] = value
                変更あり = True
        # 並び順をDEFAULT_CONFIG準拠に統一（未知キーは末尾維持）
        ordered = self._ordered_config_data(config_data)
        if list(ordered.keys()) != list(config_data.keys()):
            変更あり = True
        object.__setattr__(self, '_config_data', ordered)
        return 変更あり

    def _normalize_ollama_cloud_model_value(self, key: str, value: Any) -> Any:
        """ローカル ollama daemon が :cloud ルーティングを処理するため除去不要"""
        return value


    def _apply_code_ai_auto(self) -> bool:
        """CODE_AI2_NAME～6_NAMEが'auto'の場合、CODE_AI1_NAMEの値をコピー"""
        config_data = object.__getattribute__(self, '_config_data')
        変更あり = False
        
        code_ai1 = config_data.get('CODE_AI1_NAME', 'auto')
        code_ai1_model = config_data.get('CODE_AI1_MODEL', 'auto')
        
        # CODE_AI2_NAME～6_NAMEをチェック
        for i in range(2, 7):
            code_ai_key = f'CODE_AI{i}_NAME'
            code_model_key = f'CODE_AI{i}_MODEL'
            
            # CODE_AIn_NAMEが"auto"の場合、CODE_AI1_NAMEの値をコピー
            if config_data.get(code_ai_key, 'auto') == 'auto':
                config_data[code_ai_key] = code_ai1
                config_data[code_model_key] = code_ai1_model
                変更あり = True
                logger.debug(f'{code_ai_key}が"auto"のため、CODE_AI1_NAMEの値({code_ai1})をコピーしました')
        return 変更あり

    def _save(self, config_data: Dict[str, Any] = None) -> bool:
        """設定ファイルを同一フォルダの一時ファイル経由で安全に保存する。"""
        temp_path = None
        try:
            config_file = object.__getattribute__(self, '_config_file')
            if config_data is None:
                config_data = object.__getattribute__(self, '_config_data')

            config_dir = os.path.dirname(os.path.abspath(config_file))
            os.makedirs(config_dir, exist_ok=True)

            with tempfile.NamedTemporaryFile(
                mode='w',
                encoding='utf-8',
                newline='\n',
                prefix=f'.{os.path.basename(config_file)}.',
                suffix='.tmp',
                dir=config_dir,
                delete=False,
            ) as f:
                temp_path = f.name
                json.dump(config_data, f, indent=4, ensure_ascii=False)
                f.write('\n')
                f.flush()
                os.fsync(f.fileno())

            os.replace(temp_path, config_file)
            temp_path = None
            logger.info(f'設定ファイル保存完了: {config_file}')
            return True
        except Exception as e:
            logger.error(f'設定ファイル保存エラー: {e}')
            return False
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    def __getattr__(self, key: str) -> Any:
        """プロパティアクセスで設定値を取得"""
        config_data = object.__getattribute__(self, '_config_data')
        if key in config_data:
            return self._normalize_ollama_cloud_model_value(key, config_data[key])
        raise AttributeError(f"'{type(self).__name__}' object has no attribute '{key}'")

    def __setattr__(self, key: str, value: Any) -> None:
        """プロパティアクセスで設定値を設定し、ファイルに保存"""
        if key.startswith('_'):
            object.__setattr__(self, key, value)
        else:
            if not self.set(key, value):
                raise OSError(f'設定値を保存できません: {key}')

    def get(self, key: str, default: Any = None) -> Any:
        """設定値を取得（辞書形式）"""
        config_data = object.__getattribute__(self, '_config_data')
        return self._normalize_ollama_cloud_model_value(key, config_data.get(key, default))

    def set(self, key: str, value: Any) -> bool:
        """設定値を設定し、ファイルに保存（辞書形式）"""
        return self.update({key: value})

    def update(self, data: Dict[str, Any]) -> bool:
        """複数の設定値を一括更新し、ファイルに保存"""
        if not isinstance(data, dict):
            raise TypeError('更新データはdictで指定してください')

        config_data = object.__getattribute__(self, '_config_data')
        updated = dict(config_data)
        updated.update(data)

        # 現行ポート値を検証する
        for key in self.PORT_KEYS:
            if key in updated:
                updated[key] = self._normalize_port_value(key, updated[key])

        updated = self._ordered_config_data(updated)
        if not self._save(updated):
            return False

        object.__setattr__(self, '_config_data', updated)
        return True


ConfigJsonManager = conf_json

__all__ = [
    "DEFAULT_CONFIG_FILE",
    "conf_json",
    "ConfigJsonManager",
]
