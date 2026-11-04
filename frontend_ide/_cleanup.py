# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""IDE群(Navigator / Console / Code / Live / IDE / Task / Team / Browser)を一括でクリーンアップする。"""
import importlib.util
import shutil
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent

def _load_cleanup(name):
    spec = importlib.util.spec_from_file_location('ide_cleanup_' + name, ROOT / name / '_cleanup.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def cleanup(choices=None):
    if choices is not None and choices.get('ide') is False:
        return True
    print('\n' + '=' * 60)
    print('IDE群(Navigator / Console / Code / Live / IDE / Task / Team / Browser) のクリーンアップ')
    print('=' * 60 + '\n')
    # 子側で停止・解除を確認できなければ共通依存を残す。
    navi_ok = _load_cleanup('aidiy_navi').cleanup(choices, report=False)
    term_ok = _load_cleanup('aidiy_console').cleanup(choices, report=False)
    host = _load_cleanup('host')
    results = [host.cleanup_app(module, report=False) for module in ('code', 'live')]
    results.append(_load_cleanup('viewer').cleanup(choices, report=False))
    results.extend(_load_cleanup('aidiy_' + kind).cleanup(choices, report=False) for kind in ('task', 'team', 'browser'))
    if not navi_ok or not term_ok or not all(results):
        print('IDE群の解除が完了していないため、共通UIの依存関係・生成物を残します。')
        return False
    if not host.cleanup_shared(report=False):
        print('共有通信基盤の解除が完了していないため、共通UIの依存関係・生成物を残します。')
        return False
    for name in ('node_modules', 'dist', '__pycache__'):
        target = ROOT / name
        resolved = target.resolve()
        if not resolved.is_relative_to(ROOT) or resolved == ROOT:
            raise ValueError('削除対象がfrontend_ideの外です。')
        if target.exists():
            shutil.rmtree(target)
            print(f'[OK] {name} (共通UI) を削除しました: {target}')
    print('[OK] IDE群(Navigator / Console / Code / Live / IDE / Task / Team / Browser) のクリーンアップ完了')
    return True

if __name__ == '__main__':
    answer = input('IDE群(Navigator / Console / Code / Live / IDE / Task / Team / Browser)を停止し、拡張・ランチャー・依存関係を解除しますか？ ([n]/y): ')
    if answer.strip().lower() == 'y':
        spec = importlib.util.spec_from_file_location('ide_root_cleanup', ROOT.parent / '_cleanup.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with module.cleanup_stop_request({}, services=['フロントエンド(navi)', 'フロントエンド(console)', 'フロントエンド(code)', 'フロントエンド(live)', 'フロントエンド(IDE)']):
            sys.exit(0 if cleanup() else 1)
