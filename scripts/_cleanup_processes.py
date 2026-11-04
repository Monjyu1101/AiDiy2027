# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""クリーンアップ用のプロセス照合・強制終了・終了確認（標準ライブラリのみ）。"""

import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
import time


def process_arguments(command: str, windows: bool) -> list[str]:
    if windows:
        # 閉じていない引用符は POSIX の shlex と同じく解析不能として扱い、所属判定を安全側に倒す。
        if command.count('"') % 2:
            raise ValueError('引用符が閉じていないコマンドラインです')
        return [part.replace('"', '') for part in re.findall(r'(?:[^\s"]|"[^"]*")+', command)]
    return shlex.split(command)


def list_processes() -> list[dict]:
    if sys.platform == 'win32':
        script = (
            '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); '
            'Get-CimInstance Win32_Process | '
            'Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress'
        )
        result = subprocess.run(['powershell', '-NoProfile', '-Command', script],
                                check=True, capture_output=True, encoding='utf-8', timeout=15,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        records = json.loads(result.stdout or '[]')
        return records if isinstance(records, list) else [records]
    result = subprocess.run(['ps', '-axo', 'pid=,ppid=,comm=,args='], check=True,
                            capture_output=True, encoding='utf-8', timeout=15)
    records = []
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 3)
        if len(parts) == 4:
            pid, parent, name, command = parts
            records.append(dict(ProcessId=int(pid), ParentProcessId=int(parent),
                                Name=Path(name).name, CommandLine=command))
    return records


def stop_matching(matches, info, error, label: str) -> bool:
    windows = sys.platform == 'win32'
    try:
        processes = list_processes()
        by_pid = {p['ProcessId']: p for p in processes}
        # 仮想環境の Python から cleanup を実行した場合、自分と起動元を終了しない。
        protected = set()
        pid = os.getpid()
        while pid and pid not in protected:
            protected.add(pid)
            pid = by_pid.get(pid, {}).get('ParentProcessId', 0)
        if any(matches(p) for p in processes if p['ProcessId'] in protected):
            error(f'{label}: 削除対象の実行環境から cleanup が動いています。通常の Python から実行してください。')
            return False
        targets = {p['ProcessId']: p for p in processes if matches(p)}
        if not targets:
            info(f'{label}のプロセスはありません。')
            return True
        roots = [p for p in targets.values() if p['ParentProcessId'] not in targets]
        if not windows:
            while True:
                children = {p['ProcessId']: p for p in processes
                            if p['ParentProcessId'] in targets and p['ProcessId'] not in targets}
                if not children:
                    break
                targets.update(children)
            roots = list(reversed(list(targets.values())))
        for target in roots:
            # PID 再利用や、親の終了による消滅を再確認してから操作する。
            current = next((p for p in list_processes() if p['ProcessId'] == target['ProcessId']), None)
            if current != target:
                continue
            pid = target['ProcessId']
            info(f"{label}を強制終了します: {target['Name']} (PID={pid})")
            if windows:
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)],
                               capture_output=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
            else:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        deadline = time.monotonic() + 5
        while True:
            remaining = [p for p in list_processes() if matches(p)]
            if not remaining:
                info(f'{label}の終了を確認しました。')
                return True
            if time.monotonic() >= deadline:
                error(f'{label}が残っているため、生成物の削除を中止します。')
                return False
            time.sleep(0.2)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        error(f'{label}の終了を確認できません: {exc}')
        return False
