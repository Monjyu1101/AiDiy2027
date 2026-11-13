# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""全体起動から呼ぶ診断の環境確認・起動。AIコアや npm は不要。"""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "scripts"))
from _runtime_requirements import check_node_runtime


def check_environment():
    node = shutil.which('node.exe' if sys.platform == 'win32' else 'node')
    if not node:
        return False, 'Node.js 18 以降が必要です: https://nodejs.org/'
    if not (ROOT / 'diag_main.mjs').is_file() or not (ROOT / 'diag' / '診断' / 'catalog.json').is_file():
        return False, '診断のソースファイルが見つかりません。'
    ok, detail = check_node_runtime('>=18', command=node, strict=True)
    if not ok:
        return False, detail
    return True, f'{detail} / Vue 3配布画面 / Electron またはブラウザ / AIコア不要'



def run_headless():
    """全体起動の必須前処理。完了を待ってモデル合成ファイルを生成する。"""
    node = shutil.which('node.exe' if sys.platform == 'win32' else 'node')
    if not node:
        raise RuntimeError('Node.js が見つかりません: https://nodejs.org/')
    result = subprocess.run([node, str(ROOT / 'diag_main.mjs'), '--headless'], cwd=ROOT,
                            stdin=subprocess.DEVNULL,
                            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
    if result.returncode:
        raise RuntimeError(f'aidiy_diag --headless に失敗しました（終了コード {result.returncode}）。')


def launch_gui():
    """全体起動の診断選択から呼ぶ。画面を切り離して起動し、表示準備の完了で戻る。
    --auto により、画面側で保存済みの起動設定による「一括起動」を自動実行する。"""
    node = shutil.which('node.exe' if sys.platform == 'win32' else 'node')
    if not node:
        raise RuntimeError('Node.js が見つかりません: https://nodejs.org/')
    result = subprocess.run([node, str(ROOT / 'diag_main.mjs'), '--auto'], cwd=ROOT, stdin=subprocess.DEVNULL,
                            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
    if result.returncode:
        raise RuntimeError(f'aidiy_diag の起動に失敗しました（終了コード {result.returncode}）。')


def start():
    node = shutil.which('node.exe' if sys.platform == 'win32' else 'node')
    if not node:
        raise RuntimeError('Node.js が見つかりません: https://nodejs.org/')
    # 認証 URL は直接ターミナルへ。集約出力のバッファ・ファイルへ保存しない。
    return subprocess.Popen([node, str(ROOT / 'diag_main.mjs'), '--foreground'], cwd=ROOT,
                            start_new_session=sys.platform != 'win32',
                            creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if sys.platform == 'win32' else 0)



def main(argv=None):
    """単独入口。aidiy_diag と同じ引数を渡し、明示されない --auto は付けない。"""
    args = sys.argv[1:] if argv is None else list(argv)
    try:
        ok, detail = check_environment()
        if not ok:
            print(f'Diag の環境が準備されていません: {detail}', file=sys.stderr)
            return 1
        node = shutil.which('node.exe' if sys.platform == 'win32' else 'node')
        if not node:
            raise FileNotFoundError('Node.js')
        result = subprocess.run([node, str(ROOT / 'diag_main.mjs'), *args], cwd=ROOT,
                                stdin=subprocess.DEVNULL,
                                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        # POSIXのsignal終了を、シェルと同じ128+signalの終了コードへ変換する。
        return result.returncode if result.returncode >= 0 else 128 - result.returncode
    except KeyboardInterrupt:
        print('Diag の起動を中断しました。', file=sys.stderr)
        return 130
    except (OSError, subprocess.SubprocessError):
        print('Diag を実行できません。Node.js と診断ファイルの配置・アクセス権を確認してください。', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
