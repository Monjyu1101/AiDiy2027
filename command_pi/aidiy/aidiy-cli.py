# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
"""Piから外部CLIへ委譲するJSONL入口。サーバー・DB・Hermesを起動しない。"""
import asyncio
import contextlib
import json
import logging
import os
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
CLI_PROVIDERS = frozenset({"claude_cli", "antigravity_cli", "codex_cli", "copilot_cli", "opencode_cli", "grok_cli"})
OUTPUT = sys.stdout


def emit(event):
    OUTPUT.write(json.dumps(event, ensure_ascii=False) + "\n")
    OUTPUT.flush()


class ProgressConnection:
    async def send_to_channel(self, channel, packet):
        if packet.get("メッセージ識別") == "output_stream":
            emit({"type": "progress", "text": str(packet.get("メッセージ内容", ""))})


async def run(request):
    if not isinstance(request, dict) or request.get("provider") not in CLI_PROVIDERS:
        raise ValueError("未対応の外部CLIです。")
    model, prompt, project = (request.get(key) for key in ("model", "prompt", "project"))
    if not all(isinstance(value, str) and value.strip() for value in (model, prompt, project)):
        raise ValueError("外部CLIへの入力が不正です。")
    if len(model) > 300 or any(ord(c) < 32 for c in model):
        raise ValueError("モデル名が不正です。")
    if not Path(project).is_absolute() or not Path(project).is_dir():
        raise ValueError("作業フォルダがありません。")
    sys.path.insert(0, str(ROOT / "backend_server"))
    from AIコア.AIコード_cli import CodeAI
    from AIコア.AI実行オプション import AI実行オプション
    from AIコア.AI応答 import エラー応答判定

    # Piが全会話文脈を渡す。別のCLI会話をresumeして混ぜない。
    code = CodeAI(
        親=SimpleNamespace(接続=ProgressConnection()), 絶対パス=project,
        AI_NAME=request["provider"], AI_MODEL=model, code_plan="off", code_verify="off", code_permissions="full",
        実行オプション=AI実行オプション(会話継続=False, 履歴保存=False, ストリーム送信=True, 出力ファイル保存=False),
    )
    result = await code.実行(prompt, resume=False, 絶対パス=project)
    emit({"type": "result", "ok": not エラー応答判定(result), "text": result})


if __name__ == "__main__":
    try:
        payload = sys.stdin.buffer.read(16 * 1024 * 1024 + 1)
        if len(payload) > 16 * 1024 * 1024:
            raise ValueError("外部CLIへの入力が大きすぎます。")
        request = json.loads(payload.decode("utf-8"))
        # 共通CodeAIの診断printをJSONLへ混ぜず、会話本文を通常ログへ保存しない。
        logging.disable(logging.CRITICAL)
        with open(os.devnull, "w", encoding="utf-8") as sink, contextlib.redirect_stdout(sink):
            asyncio.run(run(request))
    except Exception:
        emit({"type": "result", "ok": False, "text": "外部CLIを実行できません。導入・モデル・認証状態を確認してください。"})
        sys.exit(1)
