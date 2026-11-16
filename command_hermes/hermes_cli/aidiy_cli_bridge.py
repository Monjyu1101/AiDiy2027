# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Hermes のモード・会話を Pi / Codex と共通の CLI アダプターへ渡す。"""
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time

PROVIDERS = {"claude-code": "claude_cli", "antigravity-cli": "antigravity_cli",
             "codex-cli": "codex_cli", "copilot-cli": "copilot_cli",
             "opencode": "opencode_cli", "grok-cli": "grok_cli"}


def run_cli(root, provider, model, prompt, project, mode, progress, *,
            cli_mode="passthrough", messages=None, tools=None, tool_choice=None, cancelled=None):
    root = Path(root)
    suffix = "Scripts/python.exe" if os.name == "nt" else "bin/python"
    python = next((root / name / ".venv" / suffix for name in ("backend_tools", "backend_server")
                   if (root / name / ".venv" / suffix).is_file()), None)
    if python is None:
        raise ValueError("外部 CLI 委譲に必要な Python 環境がありません。")
    request = {"provider": PROVIDERS[provider], "model": model or "same",
               "project": project, "prompt": prompt, "mode": mode, "cli_mode": cli_mode}
    if cli_mode == "chat":
        request.update(messages=messages or [], tools=tools or [])
        if tool_choice is not None:
            request["tool_choice"] = tool_choice
    payload = json.dumps(request, ensure_ascii=False).encode("utf-8")
    if len(payload) > 16 * 1024 * 1024:
        raise ValueError("外部 CLI に渡す会話が大きすぎます。")
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    command = [str(python), "-B", str(root / "backend_tools/tools_proc/process_lifetime.py"),
               "--parent-pid", str(os.getpid()), "--creationflags", str(flags), "--",
               str(python), "-B", str(root / "backend_tools/tools_proc/harness_cli.py")]
    process = subprocess.Popen(command, cwd=project, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, creationflags=flags,
                               env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"})
    events = queue.Queue(maxsize=64)
    stopped = threading.Event()

    def publish(event):
        while not stopped.is_set():
            try:
                events.put(event, timeout=0.1)
                return
            except queue.Full:
                pass

    def read():
        try:
            while not stopped.is_set():
                line = process.stdout.readline(16 * 1024 * 1024 + 1)
                if not line:
                    break
                if len(line) > 16 * 1024 * 1024:
                    raise ValueError("外部 CLI の応答が大きすぎます。")
                publish(json.loads(line))
        except Exception:
            publish({"type": "result", "ok": False, "text": "外部 CLI の応答形式が不正です。"})
        finally:
            publish(None)

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    answer = None
    last_event = time.monotonic()
    try:
        process.stdin.write(payload)
        process.stdin.close()
        while True:
            try:
                if cancelled and cancelled():
                    raise InterruptedError("外部 CLI を中断しました。")
                event = events.get(timeout=0.1 if cancelled else 900)
            except queue.Empty:
                if cancelled and time.monotonic() - last_event < 900:
                    continue
                raise ValueError("外部 CLI の出力が途絶えたため終了しました。") from None
            last_event = time.monotonic()
            if event is None:
                break
            if not isinstance(event, dict) or answer is not None:
                raise ValueError("外部 CLI の応答形式が不正です。")
            if event.get("type") == "progress" and isinstance(event.get("text"), str):
                progress(event["text"])
            elif event.get("type") == "result" and isinstance(event.get("ok"), bool):
                if not event["ok"]:
                    raise ValueError(event.get("text") or "外部 CLI が失敗しました。")
                answer = event.get("message") if cli_mode == "chat" else event.get("text")
            else:
                raise ValueError("外部 CLI の応答形式が不正です。")
        if process.wait(timeout=10) != 0 or (not isinstance(answer, dict) if cli_mode == "chat" else not isinstance(answer, str) or not answer.strip()):
            raise ValueError("外部 CLI の最終回答を取得できませんでした。")
        return answer
    finally:
        stopped.set()
        if process.poll() is None:
            process.terminate()  # Windows Job / POSIX SIGTERM で子孫も回収
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        reader.join(timeout=2)
        process.stdout.close()
        if not process.stdin.closed:
            process.stdin.close()


def uses_chat_engine(cli):
    return (getattr(cli, "_aidiy_cli_mode", "chat") == "chat"
            and getattr(cli, "_aidiy_provider_slug", "") in PROVIDERS)


def install_chat_engine(agent, cli, root):
    """Keep Hermes' native tool loop; replace only the model invocation."""
    from openai.types.chat import ChatCompletion
    import time

    def complete(api_kwargs, *, on_first_delta=None):
        if api_kwargs.get("response_format"):
            raise ValueError("CLI chat は response_format に未対応です。")
        if on_first_delta:
            on_first_delta()
        mode = "read-only" if os.environ.get("AIDIY_HERMES_READ_ONLY") == "1" else (
            "yolo" if cli._is_session_yolo_active() else "normal")
        message = run_cli(root, cli._aidiy_provider_slug, cli.model, "", os.getcwd(), mode,
                          lambda text: None, cli_mode="chat",
                          messages=api_kwargs.get("messages", []), tools=api_kwargs.get("tools", []),
                          tool_choice=api_kwargs.get("tool_choice"),
                          cancelled=lambda: bool(getattr(agent, "_interrupt_requested", False)))
        return ChatCompletion.model_validate({
            "id": "aidiy-cli", "object": "chat.completion", "created": int(time.time()),
            "model": cli.model, "choices": [{"index": 0, "message": message,
                "finish_reason": "tool_calls" if message.get("tool_calls") else "stop"}],
        })

    # Direct summary calls also use the bridge rather than an HTTP client.
    from types import SimpleNamespace
    facade = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: complete(kw))),
        close=lambda: None, is_closed=lambda: False,
        base_url="aidiy-cli://engine", api_key="aidiy-cli-no-api-key")
    old_client = getattr(agent, "client", None)
    if old_client is not None:
        old_client.close()
    agent.client = facade
    agent._ensure_primary_openai_client = lambda **kwargs: facade
    agent._create_request_openai_client = lambda **kwargs: facade
    agent._interruptible_api_call = complete
    agent._interruptible_streaming_api_call = complete
    agent._disable_streaming = True
    # A failed CLI engine must never silently switch to an API or passthrough.
    agent._fallback_chain = []
    agent._fallback_model = None

    def auxiliary(**kwargs):
        route = kwargs.get("route_info")
        if isinstance(route, dict):
            route.update(provider=cli._aidiy_provider_slug, model=cli.model)
        # Compression preserves its upstream prompt, but uses this same CLI
        # engine without tools. Never resolve a second API provider.
        return complete({"messages": kwargs.get("messages", []), "tools": [], "tool_choice": "none"})

    if getattr(agent, "context_compressor", None) is not None:
        agent.context_compressor._aidiy_chat_call = auxiliary
