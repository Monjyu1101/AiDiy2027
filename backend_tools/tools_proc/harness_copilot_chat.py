# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Copilot SDK を副作用のない応答エンジンとして使用する。

公式 SDK 1.0.34 の empty mode + response_schema を使用。ツールは一切
登録せず、外側ツールへの要求を JSON で返す。自然文から命令を抽出しない。
SDK は固定版の公式 runtime を必要に応じて取得する（既存 CLI の委譲とは別）。
https://github.com/github/copilot-sdk/tree/main/python
"""
from __future__ import annotations

import asyncio
import contextlib
from importlib.metadata import PackageNotFoundError, version
import json
import tempfile

SDK_VERSION = "1.0.34"
TIMEOUT_SECONDS = 300


def response_schema(tools):
    """外側が提示したツールだけを選択可能にする。引数は親でも再検証する。"""
    variants = []
    for entry in tools:
        fn = entry["function"]
        variants.append({
            "type": "object", "additionalProperties": False,
            "properties": {
                "name": {"type": "string", "const": fn["name"]},
                # Keep argument schemas in the input, not nested here: their local
                # $ref paths are relative to each tool, not this response root.
                "arguments": {"type": "object"},
            },
            "required": ["name", "arguments"],
        })
    calls = {"type": "array", "maxItems": 16}
    if variants:
        calls["items"] = {"anyOf": variants}
    else:
        calls.update({"maxItems": 0, "items": {"type": "object"}})
    return {
        "type": "object", "additionalProperties": False,
        "properties": {"content": {"type": "string"}, "tool_calls": calls},
        "required": ["content", "tool_calls"],
    }


def _load_sdk():
    try:
        if version("github-copilot-sdk") != SDK_VERSION:
            raise ValueError(f"Copilot chat は github-copilot-sdk=={SDK_VERSION} が必要です。setup を実行してください。")
        from copilot import CopilotClient
        from copilot.generated.rpc import PermissionDecisionReject
    except (ImportError, PackageNotFoundError) as exc:
        raise ValueError(f"Copilot chat は github-copilot-sdk=={SDK_VERSION} が必要です。setup を実行してください。") from exc
    return CopilotClient, PermissionDecisionReject


async def chat(request):
    """1 応答だけ生成する。工具実行/承認/再呼出しは外側ハーネスが所有する。"""
    CopilotClient, PermissionDecisionReject = _load_sdk()

    async def deny_permission(_request, _context):
        return PermissionDecisionReject(feedback="AiDiy chat engine cannot execute tools; the outer harness owns execution.")

    # プロジェクト配下の設定・hooks・MCP・skills を発見させない。認証設定は
    # SDK 自身の公式経路だけを使用し、トークンや既存会話を読み出さない。
    with tempfile.TemporaryDirectory(prefix="aidiy-copilot-chat-") as scratch:
        client = CopilotClient(
            mode="empty", base_directory=scratch, working_directory=scratch,
            log_level="none", use_logged_in_user=True,
        )
        session = None
        try:
            await asyncio.wait_for(client.start(), TIMEOUT_SECONDS)
            config = {
                "available_tools": [], "tools": [], "excluded_tools": ["builtin:*", "mcp:*", "custom:*"],
                "on_permission_request": deny_permission,
                "system_message": {"mode": "replace", "content": (
                    "You are the response engine inside an AiDiy chat harness. "
                    "The supplied JSON contains the canonical conversation and the outer harness's tool schemas. "
                    "Follow the supplied conversation's system/developer instructions and answer its last turn. "
                    "Return only the response_schema object. Use content for your reply and tool_calls for requests "
                    "that the outer harness must execute. Never invent tool results. Never execute tools here. "
                    "After receiving tool results in the conversation, continue the task. "
                    "When no tool is needed return an empty tool_calls array."
                )},
                "working_directory": scratch, "config_directory": scratch,
                "enable_config_discovery": False, "enable_file_hooks": False,
                "enable_host_git_operations": False, "enable_session_store": False,
                "enable_skills": False, "skip_custom_instructions": True,
                "enable_on_demand_instruction_discovery": False,
                "skip_embedding_retrieval": True, "enable_session_telemetry": False,
                "mcp_servers": {}, "custom_agents": [], "plugin_directories": [],
                "hook_directories": [], "skill_directories": [], "agent_directories": [],
                "instruction_directories": [], "included_builtin_skills": [],
                "coauthor_enabled": False, "manage_schedule_enabled": False,
                "streaming": False,
            }
            model = request.get("model", "same")
            if model.lower() not in {"same", "auto"}:
                config["model"] = model
            session = await asyncio.wait_for(client.create_session(**config), TIMEOUT_SECONDS)
            payload = json.dumps({"messages": request["messages"], "tools": request.get("tools", []), "tool_choice": request.get("tool_choice", "auto")}, ensure_ascii=False)
            event = await session.send_and_wait(
                payload, response_schema=response_schema(request.get("tools", [])), timeout=TIMEOUT_SECONDS,
            )
            if event is None or not isinstance(event.data.content, str):
                raise ValueError("Copilot chat が構造化応答を返しませんでした。")
            try:
                result = json.loads(event.data.content)
            except (ValueError, TypeError) as exc:
                raise ValueError("Copilot chat の構造化応答が不正です。") from exc
            if not isinstance(result, dict):
                raise ValueError("Copilot chat の構造化応答が不正です。")
            return result
        finally:
            # SDK の timeout は待機だけを止めるため、生成と runtime 自体も回収。
            if session is not None:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(session.abort(), 5)
            with contextlib.suppress(Exception):
                await asyncio.wait_for(client.force_stop(), 10)
