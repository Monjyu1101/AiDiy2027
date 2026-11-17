# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""通常の Copilot CLI を stdin/stdout のチャットエンジンとして呼ぶ。SDK不使用。"""
from __future__ import annotations

import json
import os
import shutil
import tempfile


def command(model):
    executable = shutil.which("copilot")
    if not executable:
        raise ValueError("Copilot CLIがありません。通常のcopilotを導入してください。")
    if executable.lower().endswith((".cmd", ".bat")):
        # Windows npm shimをshell経由にせず、既存の直接起動解決を再利用する。
        from AIコア.AIコード_cli import CodeAI
        direct = CodeAI._npmシム直接実行に解決(None, executable)
        if not direct:
            raise ValueError("Copilot CLIの直接実行入口を解決できません。")
    else:
        direct = [executable]
    args = direct + [
        "--silent", "--stream=off", "--output-format=text",
        # 空のavailable-toolsや単独の*は全禁止にならない。公式CLIで実測。
        "--excluded-tools=builtin:*,mcp:*,custom:*",
        "--deny-tool=shell,read,write,url,memory",
        "--disable-builtin-mcps", "--disable-mcp-server=computer-use",
        "--no-custom-instructions", "--no-ask-user", "--no-auto-update",
        "--no-experimental", "--no-color", "--log-level=none",
        "--sync-session=off",
    ]
    if model.lower() not in {"same", "auto"}:
        args += ["--model", model]
    elif model.lower() == "auto":
        args += ["--model", "auto"]
    return args


async def chat(request):
    if __package__:
        from .harness_chat import INSTRUCTION, LIMIT, RESPONSE_SCHEMA, run_process
    else:
        from harness_chat import INSTRUCTION, LIMIT, RESPONSE_SCHEMA, run_process
    # 応答JSONは親のtool-callプロトコルでありSDKのresponse_schemaではない。
    # 会話はargvに置かずstdinだけに流す。新規CLI呼出し毎に全履歴を渡す。
    prompt = INSTRUCTION + "\nReturn one JSON object only, without Markdown fences.\nResponse shape: " + json.dumps(RESPONSE_SCHEMA) + "\nInput:\n" + json.dumps({
        "messages": request["messages"], "tools": request.get("tools", []),
        "tool_choice": request.get("tool_choice", "auto"),
    }, ensure_ascii=False)
    payload = prompt.encode("utf-8")
    if len(payload) > LIMIT:
        raise ValueError("CLI chatへの入力が大きすぎます。")
    environment = dict(os.environ)
    # ログイン情報は通常CLIが利用する。COPILOT_HOME/keychainを隠さない。
    # 親の自動承認・プロジェクト拡張opt-inはこの推論専用呼出しへ継承しない。
    for key in ("COPILOT_ALLOW_ALL", "COPILOT_ASSISTED_APPROVAL"):
        environment.pop(key, None)
    environment.update({"GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS": "false",
                        "GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS": "false",
                        "COPILOT_AUTO_UPDATE": "false"})
    with tempfile.TemporaryDirectory(prefix="aidiy-copilot-chat-") as scratch:
        output = await run_process(command(request.get("model", "same")), payload, scratch, env=environment)
    try:
        result = json.loads(output.decode("utf-8"))
    except (UnicodeError, ValueError):
        # 生stdoutには会話や秘密情報があり得る。JSONを自然文から拾わない。
        raise ValueError("Copilot CLI chatの応答がJSONではありません。応答形式の指定に従うモデルを選択してください。") from None
    if not isinstance(result, dict):
        raise ValueError("Copilot CLI chatの応答はJSON objectが必要です。")
    # 名前・引数schema・空回答は呼出元の共通normalize_responseで再検証する。
    return result
