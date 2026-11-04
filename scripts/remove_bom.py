# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

from __future__ import annotations
from pathlib import Path

# Remove UTF-8 BOM from text files in a root directory.
# Default root: current directory
# Default extensions: .py .vue .js .ts .json .md .txt .css .html .yml .yaml

DEFAULT_EXTS = {'.py', '.vue', '.js', '.ts', '.json', '.md', '.txt', '.css', '.html', '.yml', '.yaml'}
IGNORE_DIRS = {'.git', '.git_local', '.aidiy_backup', '.backup_local', '.aidiy_cache', 'node_modules', 'dist', 'build', '.venv', '__pycache__', '.mypy_cache', '.pytest_cache'}
BOM = b'\xef\xbb\xbf'


def iter_files(root: Path, exts: set[str]):
    for path in root.rglob('*'):
        if path.is_dir():
            continue
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        if path.suffix.lower() in exts:
            yield path


def remove_bom(path: Path) -> bool:
    data = path.read_bytes()
    if not data.startswith(BOM):
        return False
    path.write_bytes(data[len(BOM):])
    return True


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Remove UTF-8 BOM from text files.')
    parser.add_argument('root', nargs='?', default='.', help='Root directory (default: .)')
    parser.add_argument('--ext', action='append', help='File extension to include (e.g. --ext .py). Can be repeated.')
    args = parser.parse_args()

    exts = DEFAULT_EXTS
    if args.ext:
        exts = {e if e.startswith('.') else f'.{e}' for e in args.ext}

    root = Path(args.root).resolve()
    changed = []
    for path in iter_files(root, exts):
        if remove_bom(path):
            changed.append(path)

    print(f'CHANGED {len(changed)}')
    for path in changed:
        try:
            rel = path.relative_to(root)
        except ValueError:
            rel = path
        print(rel)


if __name__ == '__main__':
    main()
