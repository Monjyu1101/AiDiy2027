# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

from __future__ import annotations
from pathlib import Path

BOM = b'\xef\xbb\xbf'
IGNORE_DIRS = {'.git', '.git_local', '.aidiy_backup', '.backup_local', '.aidiy_cache', 'node_modules', 'dist', 'build', '.venv', '__pycache__', '.mypy_cache', '.pytest_cache'}
MAX_BYTES = 10 * 1024 * 1024  # 10MB


def iter_files(root: Path):
    for path in root.rglob('*'):
        if path.is_dir():
            continue
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        yield path


def find_bom_offsets(data: bytes):
    offsets = []
    start = 0
    while True:
        idx = data.find(BOM, start)
        if idx == -1:
            break
        offsets.append(idx)
        start = idx + 1
    return offsets


def main():
    root = Path('.')
    anomalies = []
    for path in iter_files(root):
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size == 0 or size > MAX_BYTES:
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        offsets = find_bom_offsets(data)
        if not offsets:
            continue
        abnormal = [o for o in offsets if o != 0]
        if abnormal:
            rel = path.relative_to(root)
            anomalies.append((str(rel), offsets))

    print(f'TOTAL_ANOMALIES {len(anomalies)}')
    for rel, offsets in anomalies:
        off_str = ','.join(str(o) for o in offsets)
        print(f'{rel}\t{off_str}')


if __name__ == '__main__':
    main()
