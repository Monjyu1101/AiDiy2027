# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""CPUのランチャーを登録する。共有依存はIDE群のセットアップで導入する。"""
import importlib.util
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent

def setup(choices=None):
    if choices and choices.get("_defer_ide_launchers"):
        return True
    spec = importlib.util.spec_from_file_location('aidiy_cpu_launcher', ROOT.parent / 'viewer/launcher.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.install_launcher(ROOT, 'cpu')
    return True


def main():
    try:
        return 0 if setup() else 1
    except (OSError, ValueError) as exc:
        print(f'[NG] aidiy_cpu の起動コマンドを登録できません: {exc}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
