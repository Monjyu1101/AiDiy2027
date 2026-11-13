# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""この作業コピーに属する診断ランチャーと依存関係を解除する。"""
from pathlib import Path
import hashlib
import secrets
import importlib.util
import shutil
import tempfile


def cleanup_dependencies(root: Path) -> bool:
    """配布済みstaticは保持し、再セットアップ可能な依存物だけを削除する。"""
    root = root.resolve(strict=True)
    for relative in ('node_modules', 'ui/node_modules'):
        target = root / relative
        if not target.exists():
            continue
        try:
            resolved = target.resolve(strict=True)
            if (target.is_symlink() or getattr(target, 'is_junction', lambda: False)()
                    or resolved != target or not resolved.is_relative_to(root)):
                raise ValueError(f'通常フォルダ以外は削除できません: {target}')
            shutil.rmtree(target)
            print(f'Diag依存関係を削除しました: {target}')
        except (OSError, ValueError) as exc:
            print(f'Diag依存関係の削除に失敗しました: {exc}')
            return False
    return True


_path_spec = importlib.util.spec_from_file_location('aidiy_diag_cleanup_path', Path(__file__).resolve().parent.parent / 'scripts' / '_setup_path.py')
_path_helper = importlib.util.module_from_spec(_path_spec)
_path_spec.loader.exec_module(_path_helper)
remove_launcher_path = _path_helper.remove_launcher_path

_stop_spec = importlib.util.spec_from_file_location(
    'aidiy_diag_stop', Path(__file__).resolve().parent / 'diag' / '起動' / 'プロセス停止.py')
_stop_helper = importlib.util.module_from_spec(_stop_spec)
_stop_spec.loader.exec_module(_stop_helper)


def stop_processes():
    """ランチャー解除の選択と独立して、本体・残留子プロセスの終了を確認する。"""
    return _stop_helper.stop(Path(__file__).resolve().parent)


def stop_memo_processes():
    """Diagの次に単体Memo・共用残留プロセスの終了を確認する。"""
    return _stop_helper.stop_memo(Path(__file__).resolve().parent)


def cleanup(choices=None):
    if choices is not None and choices.get('diag') is False:
        return True
    temporary = None
    try:
        stop_file = Path(__file__).resolve().with_name('.stop-request')
        # 固定名を開くと既存symlinkの参照先を上書きする。同じ配置先に排他的に作る。
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=stop_file.parent,
                                         prefix='.stop-request-', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(secrets.token_hex(16))
        temporary.replace(stop_file)
        temporary = None
        diag_stopped = stop_processes()
        memo_stopped = stop_memo_processes()
        if not (diag_stopped and memo_stopped):
            return False
        if not cleanup_dependencies(Path(__file__).resolve().parent):
            return False
        directories = set()
        for program, entry in (('aidiy_diag', 'diag_main.mjs'), ('aidiy_memo', 'memo_main.mjs')):
            script = str(Path(__file__).resolve().with_name(entry))
            marker = program + '-owner:' + hashlib.sha256(script.encode('utf-8')).hexdigest()
            launcher_dir = _path_helper.launcher_directory(program)
            directories.add(launcher_dir)
            for name in (program, program + '.cmd'):
                launcher = launcher_dir / name
                if not launcher.is_symlink() and launcher.is_file() and marker in launcher.read_text(encoding='utf-8'):
                    launcher.unlink()
                    print(f'ランチャーを解除しました: {launcher}')
        print('この作業コピーの Diag / Memo の終了を確認しました。')
        success = True
        for directory in directories:
            # 他checkoutのコマンドやリンクが残るPATHは解除しない。
            if any((directory / name).exists() or (directory / name).is_symlink()
                   for name in ('aidiy_diag', 'aidiy_diag.cmd', 'aidiy_memo', 'aidiy_memo.cmd')):
                continue
            success = remove_launcher_path(directory) and success
        return success
    except (OSError, ValueError) as exc:
        print(f'診断ランチャーの解除に失敗しました: {exc}')
        return False
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                print('Diag の停止通知用一時ファイルを整理できませんでした。')


if __name__ == '__main__':
    raise SystemExit(0 if cleanup() else 1)
