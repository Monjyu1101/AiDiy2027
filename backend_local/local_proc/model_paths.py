# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
ローカルモデル配置パスの解決ユーティリティ

モデルは HuggingFace の既定キャッシュ（~/.cache/huggingface）ではなく、
利用者のホームの ~/.aidiy/models/<safe_name> へモデルごとのフォルダで配置する。
git clone やフォルダコピーで作った別の AiDiy 環境とも共有し、プロジェクトの cleanup では削除されない。
設定 CHAT_LOCAL_MODELS_DIR を指定した場合はそちらを使う。

- safe_name: repo_id の "/" を "__" に置換した名前（例: google/gemma-4-E4B-it
  → google__gemma-4-E4B-it）。
- download_model.py がこのパスへ snapshot_download する。
- GemmaEngine はこのパスに config.json があればローカルからロードする。
"""

import os


def default_models_dir() -> str:
    """既定のモデル配置ディレクトリ（~/.aidiy/models）を返す。"""
    return os.path.join(os.path.expanduser("~"), ".aidiy", "models")


def safe_dir_name(model_id: str) -> str:
    """repo_id をフォルダ名に使える安全な名前へ変換する。"""
    return model_id.replace("/", "__").replace(":", "__").strip()


def local_dir_for(model_id: str, models_dir: str | None = None) -> str:
    """指定モデルのローカル配置先（絶対パス）を返す。"""
    base = models_dir or default_models_dir()
    return os.path.join(base, safe_dir_name(model_id))


def is_downloaded(model_id: str, models_dir: str | None = None) -> bool:
    """ローカル配置先にモデル本体（config.json）が存在するかを判定する。"""
    local_dir = local_dir_for(model_id, models_dir)
    return os.path.isfile(os.path.join(local_dir, "config.json"))
