#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""次入力予測だけの Hermes 入口。通常の cli_main / upstream は変更しない。

モデルに許す操作は read_file / search_files だけ。schema の制限に加え、
逐次・並列共通の実行境界でも許可名を検査する。これは OS sandbox ではなく、
認証・診断ログ・キャッシュ等の通常のランタイム書込みまで禁止するものではない。
この入口は専用 subprocess からのみ使用し、対話・resume・外部 CLI は扱わない。
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
from pathlib import Path
import sys


READONLY_TOOLSET = "aidiy_prediction_readonly"
READONLY_TOOLS = frozenset({"read_file", "search_files"})
API_MODES = frozenset({
    "chat_completions", "codex_responses", "anthropic_messages", "bedrock_converse",
})
CLI_MODEL_ALIASES = frozenset({
    "claude_cli", "codex_cli", "copilot_cli", "antigravity_cli", "grok_cli", "opencode_cli",
})
UNSUPPORTED = "! Hermes の予測読取専用モードは外部 CLI / 未対応の実行方式を利用できません。"
UNAVAILABLE = "! Hermes の予測読取専用モードを安全に初期化できませんでした。"


class ReadonlyUnavailable(RuntimeError):
    """未確認の実行経路へフォールバックせずに停止する。"""


def _prepare_environment(workdir: str) -> None:
    path = Path(workdir)
    if not path.is_absolute() or not path.is_dir():
        raise ReadonlyUnavailable(UNAVAILABLE)
    path = path.resolve()
    os.chdir(path)
    # bundled 0.21 の MCP / plugin discovery と config loader が読む環境変数。
    # cli_main は import 時に設定を読むので、必ず import より先に設定する。
    os.environ.update({
        "HERMES_SAFE_MODE": "1",
        "HERMES_IGNORE_USER_CONFIG": "1",
        "HERMES_IGNORE_RULES": "1",
        "HERMES_YOLO_MODE": "0",
        "HERMES_DISABLE_LAZY_INSTALLS": "1",
        "TERMINAL_CWD": str(path),
        "TERMINAL_ENV": "local",
    })
    # target があると DISABLE_LAZY_INSTALLS=1 でも別ディレクトリへの install
    # は許されるため、予測プロセスでは escape hatch も除去する。
    os.environ.pop("HERMES_LAZY_INSTALL_TARGET", None)
    # 親プロセスが worker でも、予測を kanban worker / goal loop にしない。
    for name in tuple(os.environ):
        if name.startswith("HERMES_KANBAN_"):
            os.environ.pop(name, None)


def _reject_cli_provider(cli, provider: str | None, model: str | None = None) -> None:
    # 明示 provider だけでなく provider/model、provider:model も先に拒否。
    # 別途 factory で解決後 api_mode と ACP command を検査する。
    values = (provider or "", (model or "").split("/", 1)[0].split(":", 1)[0])
    if any(
        value.strip().lower() in CLI_MODEL_ALIASES
        or cli.provider_entry_is_cli(value.strip().lower())
        for value in values
    ):
        raise ReadonlyUnavailable(UNSUPPORTED)


def _readonly_dispatch(executor):
    original = executor._run_agent_tool_execution_middleware

    def dispatch(agent, *, function_name, function_args, **kwargs):
        if function_name not in READONLY_TOOLS or not _readonly_arguments(function_name, function_args):
            # allowlist は schema に存在しない名前にも適用する。execute_code、
            # delegate_task、tool_call 経由の動的展開も元の dispatcher に渡さない。
            # 並列 batch の後続を待たせないよう開始順 gate だけは進める。
            begin = kwargs.get("begin_execution")
            if begin is not None:
                begin()
            return executor._ManagedToolResult(
                result=json.dumps({"error": "Prediction read-only: tool or arguments not allowed."}),
                args=function_args,
                middleware_trace=list(kwargs.get("middleware_trace") or []),
                blocked=True,
                dispatched=False,
            )
        return original(
            agent, function_name=function_name, function_args=function_args, **kwargs,
        )

    return dispatch


def _readonly_arguments(name, args) -> bool:
    """shell の option と解釈されるモデル値を upstream に渡さない。"""
    if not isinstance(args, dict):
        return False
    path = args.get("path", "." if name == "search_files" else "")
    if not isinstance(path, str) or not path or path.lstrip().startswith("-"):
        return False
    for key in ("offset", "limit", "context"):
        if key in args and type(args[key]) is not int:
            return False
    if name == "search_files":
        # bundled rg の content search は pattern の前に '--' を置かない。
        # '--pre=sh' 等は quote 済みでも rg option になりプロセスを起動する。
        pattern = args.get("pattern")
        if not isinstance(pattern, str) or pattern.lstrip().startswith("-"):
            return False
        glob = args.get("file_glob")
        if glob is not None and (not isinstance(glob, str) or glob.lstrip().startswith("-")):
            return False
        for key, allowed in (
            ("target", {"content", "files"}),
            ("output_mode", {"content", "files_only", "count"}),
            ("order", {"discovery", "modified"}),
        ):
            if key in args and (not isinstance(args[key], str) or args[key] not in allowed):
                return False
    return True


def _install_readonly_policy(cli, toolsets, executor, extraction) -> None:
    toolsets.create_custom_toolset(
        READONLY_TOOLSET,
        "次入力予測専用。ファイルの読取りと検索のみ。",
        tools=sorted(READONLY_TOOLS),
        includes=[],
    )
    executor._run_agent_tool_execution_middleware = _readonly_dispatch(executor)
    # read_file はドキュメント拡張子から依存追加・外部 OCR を起動し得る。
    # 呼出しごとに import される判定を無効化し、通常の text/binary guard に
    # 進ませる。PDF / Office は読まない。ipynb は通常の JSON として読める。
    extraction.is_extractable_document = lambda path: False
    original_factory = cli.AIAgent

    def readonly_agent(*args, **kwargs):
        if args or kwargs.get("api_mode") not in API_MODES or kwargs.get("acp_command"):
            raise ReadonlyUnavailable(UNSUPPORTED)
        _reject_cli_provider(cli, kwargs.get("provider"), kwargs.get("model"))
        _reject_cli_provider(cli, kwargs.get("requested_provider"))
        kwargs.update(
            enabled_toolsets=[READONLY_TOOLSET], disabled_toolsets=None,
            skip_context_files=True, skip_memory=True, skip_background_review=True,
            save_trajectories=False, checkpoints_enabled=False, fallback_model=[],
            session_db=None,
        )
        agent = original_factory(**kwargs)
        # 解決結果も fail closed。未知の native/CLI transport は許可しない。
        if getattr(agent, "api_mode", None) not in API_MODES:
            raise ReadonlyUnavailable(UNSUPPORTED)
        agent.tools = [
            tool for tool in agent.tools
            if tool.get("type") == "function"
            and tool.get("function", {}).get("name") in READONLY_TOOLS
        ]
        agent.valid_tool_names = {tool["function"]["name"] for tool in agent.tools}
        agent.tools = [
            {**tool, "function": {
                **tool["function"],
                "description": "Read a local text file with line numbers and pagination. Document conversion and hosted OCR are disabled for prediction.",
            }} if tool["function"]["name"] == "read_file" else tool
            for tool in agent.tools
        ]
        agent._skip_mcp_refresh = True
        # upstream の persistence-isolated fork と同じ抑止フラグ。
        agent._persist_disabled = True
        agent._session_db = None
        agent._session_json_enabled = False
        # API 4xx 時の full-request debug dump は通常の履歴保存フラグとは別。
        # 予測本文を含む request snapshot もこの instance では保存しない。
        agent._dump_api_request_debug = lambda *args, **kwargs: None
        return agent

    def configure_provider(instance, provider, *, resumed=False, requested_model=None):
        _reject_cli_provider(cli, provider, requested_model)
        # CLI は constructor で store を用意するが、ここではまだ本文未投入。
        # _init_agent は store を再作成し得るが、factory は使わず、最終 flush
        # も agent._persist_disabled により短絡する。通常の起動時 DB 保守は別扱い。
        instance._session_db = None
        return False

    cli.AIAgent = readonly_agent
    cli._configure_aidiy_cli_provider = configure_provider


def _load_runtime():
    cli = importlib.import_module("cli_main")
    # CLIAgentSetupMixin は `from cli import AIAgent` を遅延 import する。
    # 別モジュールが同名で入っていれば保護対象がずれるため停止する。
    if sys.modules.get("cli") is not cli:
        raise ReadonlyUnavailable(UNAVAILABLE)
    toolsets = importlib.import_module("toolsets")
    executor = importlib.import_module("agent.tool_executor")
    extraction = importlib.import_module("tools.read_extract")
    # upstream の agent と AiDiy の core を二重ロードさせない。
    alternate = sys.modules.setdefault("core.tool_executor", executor)
    if alternate is not executor:
        raise ReadonlyUnavailable(UNAVAILABLE)
    return cli, toolsets, executor, extraction


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AiDiy Hermes 次入力予測（読取専用）")
    parser.add_argument("--model", required=True)
    parser.add_argument("--provider")
    parser.add_argument("--workdir", required=True)
    args = parser.parse_args(argv)
    try:
        _prepare_environment(args.workdir)
        cli, toolsets, executor, extraction = _load_runtime()
        _reject_cli_provider(cli, args.provider, args.model)
        _install_readonly_policy(cli, toolsets, executor, extraction)
        command = [
            "--model", args.model, "--toolsets", READONLY_TOOLSET,
            "--ignore-user-config", "--ignore-rules", "--oneshot-stdin", "-Q",
        ]
        if args.provider:
            command.extend(["--provider", args.provider])
        return cli.cli_entry(command)
    except ReadonlyUnavailable as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception:
        # provider/config の例外全文には URL、設定値、認証情報が混じり得る。
        print(UNAVAILABLE, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
