# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027


# -------------------------------------------------------------------------
# See LICENSE for full terms.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
無限解説ビデオ生成.py

既存の `ビデオページ生成_解説.py` は変更せず、外側から
aidiy_backup と aidiy_code_agents を使って解説ビデオ生成を継続制御する。

流れ:
  1. backend_tools MCP を必要なら起動し、初回バックアップを作る。
  2. ループごとに差分バックアップを保存する。差分があれば 5 分待つ。
  3. `_ビデオページ生成_解説_状況.json` が complete_steps=99 なら、
     AI 関連の新しい題材と設定 JSON 更新を aidiy_code_agents に依頼する。
  4. 設定更新を確認して状況 JSON を空に戻し、解説スクリプトの継続実行を
     aidiy_code_agents に依頼する。
  5. 生成中に 5 分間ファイル更新がなければタスクをキャンセルし、次ループで再開する。
     30 分相当の停滞が複数回続く場合は異常として停止する。

使い方:
  cd backend_tools
  .venv\\Scripts\\python.exe aidiy_automations\\ビデオページ生成\\無限解説ビデオ生成.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = Path(__file__).resolve().parent
MCP_DIR = SCRIPT_DIR.parents[1]
REPO_DIR = MCP_DIR.parent
VIDEO_BASE_DIR = REPO_DIR / "frontend_web" / "public" / "Xビデオ"
SETTING_JSON_PATH = SCRIPT_DIR / "_ビデオページ生成_解説_設定.json"
STEPS_JSON_PATH = SCRIPT_DIR / "_ビデオページ生成_解説_状況.json"
VIDEO_SCRIPT_PATH = SCRIPT_DIR / "ビデオページ生成_解説.py"

BACKUP_API_URL = "http://127.0.0.1:8095/aidiy_backup/save"
CODE_AGENTS_API_URL = "http://127.0.0.1:8095/aidiy_code_agents"
BACKUP_PING_URL = "http://127.0.0.1:8095/aidiy_backup/ping"
_LOCAL_HTTP_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

LOOP_WAIT_SEC = 300
TOPIC_WAIT_SEC = 600
NO_UPDATE_CANCEL_SEC = 300
LONG_STALL_SEC = 1800
MAX_LONG_STALLS = 6
RUNTIME_DIR = MCP_DIR / "temp" / "infinite_video"
TASK_LOG_DIR = RUNTIME_DIR / "tasks"
STATE_JSON_PATH = RUNTIME_DIR / "state.json"
TASK_LOG_RETENTION_DAYS = 14
API_RETRY_WAIT_SEC = 30


class FatalStop(Exception):
    """常駐ループを継続せず停止すべき異常。"""


def now_text() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def ts_name() -> str:
    return time.strftime("%Y%m%d.%H%M%S")


def log(message: str) -> None:
    print(f"[{now_text()}] {message}", flush=True)


def read_json(path: Path, default: Any) -> Any:
    try:
        with path.open("r", encoding="utf-8-sig") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except Exception as e:
        log(f"JSON 読み込み失敗: {path} ({e})")
        return default


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp_path.replace(path)


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def post_json(url: str, payload: dict[str, Any] | None = None, timeout_sec: int = 30) -> dict[str, Any]:
    data = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with _LOCAL_HTTP_OPENER.open(req, timeout=timeout_sec) as res:
        raw = res.read().decode("utf-8", errors="replace")
    result = json.loads(raw)
    if isinstance(result, dict) and result.get("error"):
        raise RuntimeError(str(result["error"]))
    return result


def get_url(url: str, timeout_sec: int = 5) -> str:
    with _LOCAL_HTTP_OPENER.open(url, timeout=timeout_sec) as res:
        return res.read().decode("utf-8", errors="replace")


def python_exe_for_backend_tools() -> str:
    venv_python = MCP_DIR / ".venv" / "Scripts" / "python.exe"
    if venv_python.is_file():
        return str(venv_python)
    return sys.executable


def ensure_backend_tools_running(current_proc: subprocess.Popen | None = None) -> subprocess.Popen | None:
    try:
        get_url(BACKUP_PING_URL, timeout_sec=3)
        return current_proc
    except Exception:
        pass

    if current_proc is not None and current_proc.poll() is None:
        log("backend_tools MCP の ping が失敗したため、このスクリプトが起動したプロセスを終了します")
        terminate_process(current_proc)

    python_exe = python_exe_for_backend_tools()
    log("backend_tools MCP を起動します")
    proc = subprocess.Popen(
        [python_exe, "-m", "uvicorn", "tools_main:app", "--host", "127.0.0.1", "--port", "8095", "--ws-max-size", os.environ.get("UVICORN_WS_MAX_SIZE", "20971520")],
        cwd=str(MCP_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            get_url(BACKUP_PING_URL, timeout_sec=3)
            log("backend_tools MCP の起動を確認しました")
            return proc
        except Exception:
            time.sleep(2)
    raise RuntimeError("backend_tools MCP を 60 秒以内に起動確認できませんでした")


def cleanup_task_logs(retention_days: int = TASK_LOG_RETENTION_DAYS) -> None:
    if retention_days <= 0 or not TASK_LOG_DIR.is_dir():
        return
    cutoff = time.time() - retention_days * 24 * 60 * 60
    removed = 0
    for path in TASK_LOG_DIR.glob("*"):
        if not path.is_file():
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError:
            pass
    if removed:
        log(f"古い task ログを削除しました: {removed} 件")


def save_state(**kwargs: Any) -> None:
    state = {
        "updated_at": now_text(),
        "pid": os.getpid(),
        **kwargs,
    }
    write_json(STATE_JSON_PATH, state)


def backup_run(tool_proc: subprocess.Popen | None = None) -> tuple[dict[str, Any], subprocess.Popen | None]:
    tool_proc = ensure_backend_tools_running(tool_proc)
    result = post_json(f"{BACKUP_API_URL}/run", {}, timeout_sec=180)
    count = int(result.get("バックアップ件数", result.get("count", 0)) or 0)
    no_diff = bool(result.get("差分なし"))
    log(f"バックアップ作成: count={count} 差分なし={no_diff} 先={result.get('バックアップ先', '')}")
    return result, tool_proc


def backup_has_diff(result: dict[str, Any]) -> bool:
    count = int(result.get("バックアップ件数", result.get("count", 0)) or 0)
    return count > 0 or bool(result.get("全件フラグ"))


def complete_step_value() -> str:
    data = read_json(STEPS_JSON_PATH, {})
    return str(data.get("complete_steps", "") or "")


def reset_steps_json() -> None:
    write_json(STEPS_JSON_PATH, {"complete_steps": ""})
    log(f"状況JSONを未実行へ戻しました: {STEPS_JSON_PATH}")


def watched_latest_mtime() -> float:
    paths = [SETTING_JSON_PATH, STEPS_JSON_PATH]
    setting = read_json(SETTING_JSON_PATH, {})
    folder_name = str(setting.get("folder_name", "") or "").strip()
    if folder_name:
        output_dir = VIDEO_BASE_DIR / folder_name
        if output_dir.exists():
            for path in output_dir.rglob("*"):
                if path.is_file():
                    paths.append(path)
    latest = 0.0
    for path in paths:
        try:
            latest = max(latest, path.stat().st_mtime)
        except FileNotFoundError:
            pass
    return latest


@dataclass
class AgentTask:
    name: str
    proc: subprocess.Popen
    started_at: float
    last_update_at: float
    last_mtime: float
    log_path: Path

    def running(self) -> bool:
        return self.proc.poll() is None


def terminate_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    if sys.platform == "win32" and proc.pid:
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )


def spawn_agent_task(name: str, prompt: str, timeout_sec: int, *, resume: bool) -> AgentTask:
    TASK_LOG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "prompt": prompt,
        "project_path": str(REPO_DIR),
        "ai_name": "auto",
        "ai_model": "auto",
        "max_turns": 999,
        "code_plan": "off",
        "code_verify": "off",
        "code_permissions": "full",
        "resume": resume,
        "timeout_sec": timeout_sec,
    }
    payload_path = TASK_LOG_DIR / f"{ts_name()}.{name}.payload.json"
    log_path = TASK_LOG_DIR / f"{ts_name()}.{name}.log"
    write_json(payload_path, payload)

    helper = (
        "import json,sys,urllib.request\n"
        "payload_path,url,log_path=sys.argv[1],sys.argv[2],sys.argv[3]\n"
        "payload=json.load(open(payload_path,encoding='utf-8'))\n"
        "data=json.dumps(payload,ensure_ascii=False).encode('utf-8')\n"
        "req=urllib.request.Request(url,data=data,headers={'Content-Type':'application/json'},method='POST')\n"
        "opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))\n"
        "try:\n"
        "    with opener.open(req,timeout=payload.get('timeout_sec',1200)+120) as res:\n"
        "        raw=res.read().decode('utf-8',errors='replace')\n"
        "except Exception as e:\n"
        "    raw=json.dumps({'status':'NG','error':str(e)},ensure_ascii=False)\n"
        "open(log_path,'w',encoding='utf-8',newline='\\n').write(raw+'\\n')\n"
    )
    proc = subprocess.Popen(
        [sys.executable, "-c", helper, str(payload_path), f"{CODE_AGENTS_API_URL}/run", str(log_path)],
        cwd=str(REPO_DIR),
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )
    latest = watched_latest_mtime()
    log(f"task={name} を投入しました pid={proc.pid} log={log_path}")
    return AgentTask(name=name, proc=proc, started_at=time.monotonic(), last_update_at=time.monotonic(), last_mtime=latest, log_path=log_path)


def monitor_task(task: AgentTask) -> tuple[bool, bool]:
    """戻り値: (まだ実行中, 停滞キャンセルしたか)"""
    latest = watched_latest_mtime()
    if latest > task.last_mtime:
        task.last_mtime = latest
        task.last_update_at = time.monotonic()

    if not task.running():
        log(f"task={task.name} は終了しました exit={task.proc.returncode} log={task.log_path}")
        return False, False

    idle = time.monotonic() - task.last_update_at
    if idle >= NO_UPDATE_CANCEL_SEC:
        log(f"task={task.name} は {idle:.0f} 秒更新なしのためキャンセルします")
        terminate_process(task.proc)
        return False, True
    return True, False


def existing_video_folders_text(limit: int = 80) -> str:
    folders: list[str] = []
    if VIDEO_BASE_DIR.is_dir():
        for path in sorted(VIDEO_BASE_DIR.iterdir(), key=lambda p: p.name):
            if path.is_dir():
                folders.append(path.name)
    if len(folders) > limit:
        folders = folders[-limit:]
    return "\n".join(f"  - {name}" for name in folders)


def topic_prompt() -> str:
    current_setting = read_json(SETTING_JSON_PATH, {})
    current_hash = file_sha256(SETTING_JSON_PATH) if SETTING_JSON_PATH.is_file() else ""
    return f"""
AiDiy の無限解説ビデオ生成ループからの依頼です。

目的:
  次に生成する「二人掛け合い解説ビデオ」の題材を決め、
  次の設定ファイルだけを更新してください。

対象設定ファイル:
  "{SETTING_JSON_PATH}"

制約:
  - 既存の "{VIDEO_SCRIPT_PATH}" は修正しないでください。
  - 設定ファイルの JSON 構造、shared セクション、template_dir、language は維持してください。
  - topic と folder_name を新しい題材に更新してください。
  - folder_name は "{VIDEO_BASE_DIR}" 配下で未使用のフォルダ名にしてください。
  - folder_name は Windows パスで安全な文字だけにし、例: "解説_OpenAIエージェントSDK_AiDiy_ja" のようにしてください。
  - 題材は anthropic / openai / google のいずれか、またはそれらの比較・実装動向から AI に関する解説題材を選んでください。
  - topic には根拠資料 URL またはローカル参照先、要点、シーン構成、scene_999 の締め要素を含めてください。
  - シーン数は 7 シーン程度に収め、二人掛け合いで説明しやすい構成にしてください。
  - この動画が AiDiy の video_generation 機能で自動生成された旨を冒頭と締めで明言する指定を入れてください。
  - 更新後、JSON として読み込めることを確認してください。

現在の設定ファイル SHA256:
  {current_hash}

現在の設定概要:
  folder_name={current_setting.get("folder_name", "")}

既存の Xビデオ フォルダ:
{existing_video_folders_text()}

最後に、更新した folder_name と題材を短く報告してください。
""".strip()


def video_generation_prompt() -> str:
    return f"""
AiDiy の無限解説ビデオ生成ループからの依頼です。

目的:
  次の既存スクリプトを使って、二人掛け合い解説ビデオを続きから生成してください。

実行対象:
  "{VIDEO_SCRIPT_PATH}"

重要:
  - "{VIDEO_SCRIPT_PATH}" は修正しないでください。
  - 設定ファイルは "{SETTING_JSON_PATH}" です。
  - 状況ファイルは "{STEPS_JSON_PATH}" です。
  - 状況ファイルの complete_steps を見て、未完了の次ステップから進めてください。
  - Python 実行と検証を行い、失敗時は原因を確認して同じステップを再実行してください。
  - 必要に応じて `python "{VIDEO_SCRIPT_PATH}"` またはステップ番号付き実行を使ってください。
  - 生成途中の成果物は削除しないでください。途中再開性を優先してください。
  - 最終的に complete_steps=99 になるまで進めることを目標にしてください。

外側 Python は 5 分間ファイル更新がない場合にこの task をキャンセルし、次ループで再投入します。
短い単位で成果物と状況 JSON を更新しながら進めてください。
""".strip()


def wait_for_topic_task(task: AgentTask, before_hash: str) -> bool:
    deadline = time.monotonic() + TOPIC_WAIT_SEC
    while time.monotonic() < deadline:
        if setting_updated_since(before_hash):
            if task.running():
                terminate_process(task.proc)
            log("題材決定 task による設定JSON更新を確認しました")
            return True
        if not task.running():
            log(f"題材決定 task は終了しました exit={task.proc.returncode} log={task.log_path}")
            return True
        time.sleep(10)
    log("題材決定 task が 10 分以内に終了しないためキャンセルします")
    terminate_process(task.proc)
    return False


def setting_updated_since(before_hash: str) -> bool:
    if not SETTING_JSON_PATH.is_file():
        return False
    after_hash = file_sha256(SETTING_JSON_PATH)
    if after_hash == before_hash:
        return False
    data = read_json(SETTING_JSON_PATH, {})
    folder_name = str(data.get("folder_name", "") or "").strip()
    topic = data.get("topic")
    return bool(folder_name) and bool(topic)


def run_loop(args: argparse.Namespace) -> None:
    tool_proc = ensure_backend_tools_running()
    active_task: AgentTask | None = None
    long_stall_count = 0
    task: str | None = None

    log("初回バックアップを作成します task=null")
    task = None
    save_state(task=task, step=complete_step_value(), long_stall_count=long_stall_count)
    _, tool_proc = backup_run(tool_proc)

    try:
        while True:
            try:
                tool_proc = ensure_backend_tools_running(tool_proc)
                cleanup_task_logs()

                if active_task is not None:
                    running, cancelled = monitor_task(active_task)
                    if cancelled:
                        long_stall_count += 1
                        active_task = None
                        task = None
                        save_state(task=task, step=complete_step_value(), long_stall_count=long_stall_count, last_event="task_cancelled")
                        if long_stall_count >= MAX_LONG_STALLS:
                            total_stall_min = (NO_UPDATE_CANCEL_SEC * MAX_LONG_STALLS) // 60
                            raise FatalStop(
                                f"更新停止キャンセルが {MAX_LONG_STALLS} 回、約 {total_stall_min} 分相当続いたため停止します"
                            )
                    elif running:
                        save_state(
                            task=active_task.name,
                            step=complete_step_value(),
                            long_stall_count=long_stall_count,
                            last_event="task_running",
                            task_pid=active_task.proc.pid,
                            task_log=str(active_task.log_path),
                        )
                        log(f"task={active_task.name} 実行中。次の監視まで待機します")
                        time.sleep(args.loop_wait_sec)
                        continue
                    else:
                        active_task = None
                        task = None
                        long_stall_count = 0
                        save_state(task=task, step=complete_step_value(), long_stall_count=long_stall_count, last_event="task_finished")

                backup_result, tool_proc = backup_run(tool_proc)
                if backup_has_diff(backup_result):
                    save_state(task=task, step=complete_step_value(), long_stall_count=long_stall_count, last_event="backup_saved")
                    log(f"差分バックアップを保存したため {args.loop_wait_sec} 秒待機して次ループへ進みます")
                    time.sleep(args.loop_wait_sec)
                    continue

                step = complete_step_value()
                save_state(task=task, step=step, long_stall_count=long_stall_count, last_event="idle")
                log(f"現在の complete_steps={step or '未実行'} task={task}")

                if step == "99":
                    before_hash = file_sha256(SETTING_JSON_PATH) if SETTING_JSON_PATH.is_file() else ""
                    task = "aidiy_code_agents:topic"
                    save_state(task=task, step=step, long_stall_count=long_stall_count, last_event="topic_start")
                    topic_task = spawn_agent_task("topic", topic_prompt(), timeout_sec=TOPIC_WAIT_SEC, resume=False)
                    if not wait_for_topic_task(topic_task, before_hash):
                        task = None
                        save_state(task=task, step=complete_step_value(), long_stall_count=long_stall_count, last_event="topic_timeout")
                        time.sleep(args.loop_wait_sec)
                        continue
                    if not setting_updated_since(before_hash):
                        log("設定JSONの更新を確認できませんでした。次ループで再試行します")
                        task = None
                        save_state(task=task, step=complete_step_value(), long_stall_count=long_stall_count, last_event="topic_no_update")
                        time.sleep(args.loop_wait_sec)
                        continue

                    reset_steps_json()
                    task = "aidiy_code_agents:video"
                    active_task = spawn_agent_task("video", video_generation_prompt(), timeout_sec=LONG_STALL_SEC, resume=True)
                    save_state(
                        task=active_task.name,
                        step=complete_step_value(),
                        long_stall_count=long_stall_count,
                        last_event="video_start",
                        task_pid=active_task.proc.pid,
                        task_log=str(active_task.log_path),
                    )
                    log(f"ビデオ生成 task 投入後、{args.loop_wait_sec} 秒待機して次ループへ進みます")
                    time.sleep(args.loop_wait_sec)
                    continue

                task = "aidiy_code_agents:video"
                active_task = spawn_agent_task("video", video_generation_prompt(), timeout_sec=LONG_STALL_SEC, resume=True)
                save_state(
                    task=active_task.name,
                    step=complete_step_value(),
                    long_stall_count=long_stall_count,
                    last_event="video_resume",
                    task_pid=active_task.proc.pid,
                    task_log=str(active_task.log_path),
                )
                log(f"未完了ステップの継続 task を投入しました。{args.loop_wait_sec} 秒待機します")
                time.sleep(args.loop_wait_sec)
            except KeyboardInterrupt:
                raise
            except FatalStop:
                raise
            except Exception as e:
                save_state(task=task, step=complete_step_value(), long_stall_count=long_stall_count, last_event="loop_error", error=str(e))
                log(f"ループ例外を検出しました。{API_RETRY_WAIT_SEC} 秒後に継続します: {e}")
                time.sleep(API_RETRY_WAIT_SEC)

    finally:
        if active_task is not None and active_task.running():
            terminate_process(active_task.proc)
        if tool_proc is not None and tool_proc.poll() is None:
            log("このスクリプトが起動した backend_tools MCP は起動したまま残します")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AiDiy 解説ビデオを外側から継続生成する常駐ループ")
    parser.add_argument("--loop-wait-sec", type=int, default=LOOP_WAIT_SEC, help="通常ループ待機秒数。既定 300")
    return parser.parse_args()


if __name__ == "__main__":
    run_loop(parse_args())
