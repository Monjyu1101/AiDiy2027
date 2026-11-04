# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
Gemma モデル事前ダウンロードスクリプト

HuggingFace から指定モデルを backend_local/temp/models/<safe_name> へ
モデルごとのフォルダで取得する。ダウンロード後は local_main.py がそのフォルダから
オフラインでロードできる。

使い方:
    # 既定モデル（LOCAL_MODEL or google/gemma-4-E4B-it）を取得
    uv run python download_model.py

    # モデルを指定
    uv run python download_model.py google/gemma-4-E2B-it

    # 配置先を指定
    uv run python download_model.py google/gemma-4-E4B-it --models-dir D:/models

Gemma はゲートモデルのため、HuggingFace でライセンス同意のうえ AiDiy_key.json の
huggingface_key_read にアクセストークンを設定すること（--token でも上書き可）。
"""

import argparse
import os
import sys

# UTF-8出力を強制（Windows文字化け対策）
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from local_proc.model_paths import default_models_dir, local_dir_for, safe_dir_name
from local_proc.aidiy_config import AiDiyConfig, load_local_models

# 設定は AiDiy_key.json から読み込む（環境変数は使わない）
_cfg = AiDiyConfig()
DEFAULT_MODEL = _cfg.get_str("CHAT_LOCAL_MODEL", "google/gemma-4-E2B-it")
DEFAULT_MODELS_DIR = _cfg.get_str("CHAT_LOCAL_MODELS_DIR", None) or default_models_dir()
# ダウンロードはゲートアクセスのため read トークンを使用
DEFAULT_TOKEN = _cfg.get_str("huggingface_key_read", None)

# --all でchat合成JSONが無い場合のフォールバック候補。
# 通常はchat合成JSONの local_chat.models を取得対象にする。
LOCAL_MODEL_CANDIDATES = [
    "google/gemma-4-E2B-it",
    "google/gemma-4-E4B-it",
    "google/gemma-4-E2B-it-qat-mobile-transformers",
    "google/gemma-4-E4B-it-qat-mobile-transformers",
]


def _all_models() -> list[str]:
    """--all の取得対象一覧を返す。

    chat合成JSONがあればそこに書かれたローカルモデルを使う。
    無ければフォールバック候補 + 設定中モデルを使う。
    """
    json_models = load_local_models()
    if json_models:
        return json_models
    merged: list[str] = []
    for m in [*LOCAL_MODEL_CANDIDATES, DEFAULT_MODEL]:
        if m and m not in merged:
            merged.append(m)
    return merged


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Gemma モデルを temp/models へ事前ダウンロードする")
    parser.add_argument(
        "model",
        nargs="?",
        default=DEFAULT_MODEL,
        help=f"HuggingFace モデル ID（既定: {DEFAULT_MODEL}）",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="候補モデル（LOCAL_MODEL_CANDIDATES + 設定中モデル）を一括ダウンロードする",
    )
    parser.add_argument(
        "--models-dir",
        default=DEFAULT_MODELS_DIR,
        help="配置先ベースディレクトリ（既定: backend_local/temp/models）",
    )
    parser.add_argument(
        "--token",
        default=DEFAULT_TOKEN,
        help="HuggingFace アクセストークン（既定: AiDiy_key.json の huggingface_key_read）",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="既にダウンロード済みでも再取得する",
    )
    return parser.parse_args()


def _download_one(model: str, models_dir: str, token: str | None, force: bool) -> int:
    """1モデルを temp/models/<safe_name> へダウンロードする。0=成功(またはスキップ)。"""
    from huggingface_hub import snapshot_download
    from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

    target_dir = local_dir_for(model, models_dir)
    already = os.path.isfile(os.path.join(target_dir, "config.json"))

    print(f"モデル        : {model}")
    print(f"配置先        : {target_dir}")
    print(f"トークン      : {'設定済み' if token else '未設定（ゲートモデルは 401/403 になる可能性）'}")

    if already and not force:
        print("既にダウンロード済みです（再取得するには --force）。")
        return 0

    os.makedirs(target_dir, exist_ok=True)
    print("ダウンロードを開始します...（モデルサイズにより時間がかかります）")

    try:
        path = snapshot_download(
            repo_id=model,
            local_dir=target_dir,
            token=token,
            # 重み・設定・トークナイザ・プロセッサのみ。GGUF 等の別形式は除外。
            ignore_patterns=["*.gguf", "*.bin.index.json.bak", "original/*"],
        )
    except GatedRepoError:
        print(
            "[エラー] ゲートモデルへのアクセスが許可されていません。\n"
            f"  HuggingFace で {model} のライセンスに同意し、"
            "AiDiy_key.json の huggingface_key_read を設定してください。",
            file=sys.stderr,
        )
        return 2
    except RepositoryNotFoundError:
        print(f"[エラー] モデルが見つかりません: {model}", file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001
        print(f"[エラー] ダウンロードに失敗しました: {e}", file=sys.stderr)
        return 1

    print(f"完了: {path}")
    print(f"safe_name     : {safe_dir_name(model)}")
    return 0


def main() -> int:
    args = parse_args()

    if args.all:
        # chat合成JSONがあればそのモデル、無ければフォールバック候補
        models = _all_models()
        src = "chat_models_info.json" if load_local_models() else "フォールバック候補"
        print(f"=== 一括ダウンロード: {len(models)} モデル（{src}）===")
        rc = 0
        for i, m in enumerate(models, 1):
            print(f"\n--- [{i}/{len(models)}] {m} ---")
            r = _download_one(m, args.models_dir, args.token, args.force)
            if r != 0:
                rc = r  # 失敗は記録しつつ続行
        print("\n=== 一括ダウンロード完了 ===")
        return rc

    rc = _download_one(args.model, args.models_dir, args.token, args.force)
    if rc == 0:
        print("起動時はこのフォルダから自動的にロードされます。")
        print("  例: uv run uvicorn local_main:app --reload --host 127.0.0.1 --port 8096 --ws-max-size 20971520")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
