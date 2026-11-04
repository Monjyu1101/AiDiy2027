#!/usr/bin/env python3
"""``hermes`` サブコマンドの AiDiy 用エントリ。

対話 TUI は ``cli_main.py`` (``aidiy_hermes``) が入口ですが、upstream の
``hermes auth`` / ``hermes model`` / ``hermes doctor`` などの管理サブコマンドは
``hermes_cli.main`` にあります。このファイルはそこへの入口で、``cli_main.py``
と同じ layout shim を張ってから ``hermes_cli.main:main`` を呼びます。

使い方::

    .venv/Scripts/python.exe hermes_main.py auth add openai-codex
    .venv/Scripts/python.exe hermes_main.py --help
"""

# --- AiDiy layout shim -------------------------------------------------
# cli_main.py 冒頭と同じ読み替え。upstream はルート直下のモジュールと
# ``agent/`` パッケージを前提にしているが、この tree では ``base/`` と
# ``core/`` に置いている。
import sys as _sys
from pathlib import Path as _Path

_PROJECT_ROOT = _Path(__file__).resolve().parent
_BASE_DIR = _PROJECT_ROOT / "base"

for _module_dir in (_BASE_DIR, _PROJECT_ROOT):
    _module_dir_str = str(_module_dir)
    if _module_dir_str not in _sys.path:
        _sys.path.insert(0, _module_dir_str)

# HERMES_HOME は upstream 0.21 で Windows 既定が ~/.hermes から
# %LOCALAPPDATA%\hermes へ変わった。AiDiy はセッション / メモリ / skills を
# ~/.hermes に持っているので、そちらへ固定する。環境変数が明示されていれば
# それを尊重する（プロファイル切り替えを壊さない）。
import os as _os

if not _os.environ.get("HERMES_HOME", "").strip():
    _os.environ["HERMES_HOME"] = str(_Path.home() / ".hermes")

if "agent" not in _sys.modules:
    import core as _agent_package
    _sys.modules["agent"] = _agent_package
# --- end AiDiy layout shim ---------------------------------------------


def main() -> int:
    """Run ``hermes_cli.main`` with the AiDiy layout shim applied."""
    from hermes_cli.main import main as _hermes_main

    result = _hermes_main()
    return result if isinstance(result, int) else 0


if __name__ == "__main__":
    try:
        _sys.exit(main())
    except SystemExit:
        raise
    except KeyboardInterrupt:
        _sys.exit(130)
