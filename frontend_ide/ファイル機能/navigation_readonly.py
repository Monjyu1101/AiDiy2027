# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -*- coding: utf-8 -*-
"""Navi専用アダプター。既存CLI読取専用境界を使い、通常実行へfallbackしない。"""
import asyncio
import contextlib
import json
import os
import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend_tools"))
sys.path.insert(0, str(ROOT / "backend_server"))


def load_saved_hermes_model():
    # CLI 全体やユーザー文脈は読み込まず、既存のモデル選択ファイルだけを読む。
    base = ROOT / "command_hermes"
    sys.path.insert(0, str(base / "base"))
    try:
        spec = importlib.util.spec_from_file_location(
            "navigation_hermes_preferences", base / "hermes_cli" / "aidiy_model_preferences.py")
        preferences = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(preferences)
        # AiDiy cli_main の起動規約に合わせる（upstream のWindows既定とは異なる）。
        # 環境変数の明示指定は尊重し、既存プロセスの環境は変更しない。
        from hermes_constants import set_hermes_home_override, reset_hermes_home_override
        home = os.environ.get("HERMES_HOME", "").strip() or str(Path.home() / ".hermes")
        token = set_hermes_home_override(home)
        try:
            return preferences.load_model_choice()
        finally:
            reset_hermes_home_override(token)
    finally:
        sys.path.remove(str(base / "base"))


def resolve_model(selection):
    model = selection["model"].strip()
    if selection["provider"] != "aidiy_hermes" or model != "same":
        return model
    choice = load_saved_hermes_model()
    # 読取専用CLIはユーザー設定を無視するため、sameを実モデルへ解決して渡す。
    # 対応が確認できないproviderをローカルモデル名として推測しない。
    if not choice or choice["provider"] not in {"openai_oauth", "openai-oauth", "openai-codex"}:
        raise ValueError("保存済みHermesモデルを解決できません。対応モデルを明示選択してください。")
    model = choice["model"].strip()
    if model.lower() in {"same", "auto", "unknown"} or "/" in model or ":" in model:
        raise ValueError("保存済みHermesモデルが明示モデルではありません。")
    return "openai_oauth/" + model


async def run(request, code=None):
    from AIコア.AI実行オプション import AI実行オプション, 読取専用CLI対応方式
    if code is None:
        from tools_proc.code_agents import CodeAgents
        code = CodeAgents(str(ROOT))
    project = Path(request["project"])
    if not project.is_absolute() or not project.is_dir():
        raise ValueError("対象プロジェクトを確認できません。")
    selection = request.get("selection", {"provider": "aidiy_hermes", "model": "same"})
    if selection.get("provider") not in 読取専用CLI対応方式 or not isinstance(selection.get("model"), str) or not selection["model"].strip() or len(selection["model"]) > 300 or any(ord(c) < 32 for c in selection["model"]):
        raise ValueError("読取専用対応AIとモデルを選択してください。")
    response = await code.run_async(
        prompt=request["prompt"], project_path=str(project),
        ai_name=selection["provider"], ai_model=resolve_model(selection), code_permissions="none",
        code_plan="off", code_verify="off", max_turns=12,
        resume=False, timeout_sec=280, self_check_loop=0,
        実行オプション=AI実行オプション.読取専用予測(),
    )
    if response.get("prediction_readonly_unavailable"):
        raise ValueError("設定済みAIの読取専用経路が利用できません。通常実行には切り替えません。")
    if response.get("status") != "OK" or not isinstance(response.get("result"), str):
        raise ValueError("読取専用AIの回答を確認できませんでした。")
    return {"content": response["result"], "provider": response.get("ai_name"), "model": response.get("selected_model")}


if __name__ == "__main__":
    try:
        payload = sys.stdin.buffer.read(1048577)
        if len(payload) > 1048576:
            raise ValueError("Navi request too large")
        request = json.loads(payload.decode("utf-8"))
        # 通常ログへ目標・回答を記録しない。stdoutはアダプターのJSONだけ。
        with contextlib.redirect_stdout(sys.stderr):
            from tools_proc.prediction_privacy import prediction_private_logs
            with prediction_private_logs():
                result = asyncio.run(run(request))
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        print(json.dumps({"error": "読取専用AIを実行できませんでした。設定・対応モデルを確認してください。"}, ensure_ascii=False))
        sys.exit(1)
