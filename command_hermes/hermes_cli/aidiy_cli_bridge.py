# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Pi / Codex と共通の CLI アダプターへ Hermes の依頼を直接委譲する。"""
import json
import os
from pathlib import Path
import queue
import subprocess
import threading

PROVIDERS = {"claude-code": "claude_cli", "antigravity-cli": "antigravity_cli", "agy_cli": "agy_cli",
             "codex-cli": "codex_cli", "copilot-cli": "copilot_cli",
             "opencode": "opencode_cli", "grok-cli": "grok_cli"}


def run_cli(root, provider, model, prompt, project, mode, progress):
    root = Path(root)
    suffix = "Scripts/python.exe" if os.name == "nt" else "bin/python"
    python = next((root / name / ".venv" / suffix for name in ("backend_tools", "backend_server")
                   if (root / name / ".venv" / suffix).is_file()), None)
    if python is None:
        raise ValueError("外部 CLI 委譲に必要な Python 環境がありません。")
    request = {"provider": PROVIDERS[provider], "model": model or "same",
               "project": project, "prompt": prompt, "mode": mode}
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
    try:
        process.stdin.write(payload)
        process.stdin.close()
        while True:
            try:
                event = events.get(timeout=900)
            except queue.Empty:
                raise ValueError("外部 CLI の出力が途絶えたため終了しました。") from None
            if event is None:
                break
            if not isinstance(event, dict) or answer is not None:
                raise ValueError("外部 CLI の応答形式が不正です。")
            if event.get("type") == "progress" and isinstance(event.get("text"), str):
                progress(event["text"])
            elif event.get("type") == "result" and isinstance(event.get("ok"), bool):
                if not event["ok"]:
                    raise ValueError(event.get("text") or "外部 CLI が失敗しました。")
                answer = event.get("text")
            else:
                raise ValueError("外部 CLI の応答形式が不正です。")
        if process.wait(timeout=10) != 0 or (not isinstance(answer, str) or not answer.strip()):
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
