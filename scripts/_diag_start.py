# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""各 _start.py の --diag-start 経路。既存の起動・停止APIを専用コンソールへ接続する。"""
import codecs
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [item for item in json.loads((ROOT / 'scripts/起動対象.json').read_text(encoding='utf-8'))
           if item.get('起動管理', True)]
# 実行ID・OSロックは永続診断結果と分け、リポジトリ直下の一時領域へ置く。
RUNTIME = ROOT / 'temp/aidiy_diag/起動'
# 管理監視は1秒単位。Event.wait により停止要求は周期を待たずに解除する。
MANAGEMENT_INTERVAL = 1.0


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class Console:
    encoding = 'utf-8'

    def __init__(self, output):
        self.output = output
        self.lock = threading.Lock()

    def event(self, kind, **data):
        with self.lock:
            self.output.write(json.dumps({'type': kind, **data}, ensure_ascii=False) + '\n')
            self.output.flush()

    def write(self, text):
        if text:
            self.event('log', data=text)
        return len(text)

    def flush(self):
        self.output.flush()

    def isatty(self):
        return False


@contextmanager
def service_lock(path, stopped):
    """古い Diag の監視終了を待つ。ロックはプロセス終了時にも OS が解放する。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as stream:
        if stream.tell() == 0:
            stream.write(b'0'); stream.flush()
        deadline = time.monotonic() + 35
        while True:
            stream.seek(0)
            try:
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if stopped.wait(MANAGEMENT_INTERVAL) or time.monotonic() >= deadline:
                    raise RuntimeError('前の起動処理を終了できませんでした。')
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_UN)


def pipe_output(process, console):
    decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
    # BufferedReader.read(size) は size 分たまるまで待つ。短い進捗・停止理由も
    # 子プロセスの終了を待たずに表示する。
    # OS のブロッキング読取なので無出力時は起床しない。表示監視用の定期タイマーは不要。
    read = getattr(process.stdout, 'read1', process.stdout.read)
    try:
        while True:
            chunk = read(4096)
            if not chunk:
                break
            console.write(decoder.decode(chunk))
        console.write(decoder.decode(b'', final=True))
    except (OSError, ValueError):
        pass


def watch_revision(revision, run_id, stopped):
    """実行IDの置換は最大1周期後に検知する。制御入力による停止は待機を即時解除。"""
    while not stopped.wait(MANAGEMENT_INTERVAL):
        try:
            if run_id and json.loads(revision.read_text(encoding='utf-8')).get('run') != run_id:
                stopped.set()
        except (OSError, ValueError, AttributeError):
            stopped.set()


def wait_for_exit(process, stopped):
    """出力読取とは独立した終了・自動再起動監視。停止イベントは即時に返す。"""
    while not stopped.is_set() and process.poll() is None:
        if stopped.wait(MANAGEMENT_INTERVAL):
            break


def terminate(process):
    if process is None or process.poll() is not None:
        return
    console = load_module('aidiy_diag_console', Path(__file__).with_name('_diag_console.py'))
    try:
        print('停止要求: Ctrl+C を送信します。')
        console.interrupt(process)
        process.wait(timeout=5)
        return
    except (OSError, subprocess.TimeoutExpired) as error:
        if process.poll() is not None:
            return
        print(f'通常停止を完了できないため、残ったプロセスを停止します: {error}')
    if os.name == 'nt':
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
    else:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name != 'nt':
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        process.wait(timeout=5)


def stop_previous(module, target):
    if target['id'] in ('core', 'apps'):
        module.kill_process_on_port(target['ポート'])
    else:
        module.kill_ports()
    if target.get('ポート'):
        try:
            with socket.create_connection(('127.0.0.1', target['ポート']), timeout=.2):
                raise RuntimeError('前のインスタンスがまだポートを使用しています。')
        except (ConnectionError, TimeoutError, OSError):
            pass


@contextmanager
def hidden_commands(module):
    original = getattr(module, 'subprocess', None)
    if os.name == 'nt' and original is not None:
        console = load_module('aidiy_diag_console', Path(__file__).with_name('_diag_console.py'))
        module.subprocess = console.HiddenSubprocess(original)
    try:
        yield
    finally:
        if original is not None:
            module.subprocess = original


def start_headless(node):
    api = subprocess
    if os.name == 'nt':
        console = load_module('aidiy_diag_console', Path(__file__).with_name('_diag_console.py'))
        api = console.ConsoleSubprocess(subprocess)
    return api.Popen([node, str(ROOT / 'backend_diag/diag_main.mjs'), '--headless'],
                     cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                     **({} if os.name == 'nt' else {'start_new_session': True}))


def launch(module, target, settings):
    kind = target['id']
    original = getattr(module, 'subprocess', None)
    if os.name == 'nt' and original is not None:
        console = load_module('aidiy_diag_console', Path(__file__).with_name('_diag_console.py'))
        module.subprocess = console.ConsoleSubprocess(original)
    try:
        if kind == 'core':
            return module.start_core()
        if kind == 'apps':
            return module.start_apps()
        return module.start()
    finally:
        if original is not None:
            module.subprocess = original


def wait_for_web(process, port, stopped, *, seconds=20, max_wait=90):
    """ポート開通だけでは開かず、HTTP の正常応答が継続するまで待つ。"""
    print(f'Web の HTTP 応答が {seconds} 秒間安定するまで待機します。')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + max_wait
    stable_since = None
    while not stopped.is_set():
        if process.poll() is not None:
            raise RuntimeError('Web の安定待機中にプロセスが終了しました。')
        try:
            with opener.open(f'http://127.0.0.1:{port}/', timeout=2) as response:
                healthy = response.status == 200
        except (OSError, ValueError):
            healthy = False
        now = time.monotonic()
        if healthy:
            if stable_since is None:
                stable_since = now
            if now - stable_since >= seconds:
                print('Web の安定を確認しました。')
                return not stopped.is_set() and process.poll() is None
        else:
            stable_since = None
        if now >= deadline:
            raise RuntimeError('Web の HTTP 応答が安定しないため、画面を開かず起動を中止しました。')
        stopped.wait(MANAGEMENT_INTERVAL)
    return False


def show_web(target, settings, process, stopped):
    if not settings.get('ブラウザ表示'):
        return not stopped.is_set()
    if not wait_for_web(process, target['ポート'], stopped):
        return False
    url = f'http://127.0.0.1:{target["ポート"]}/'
    try:
        tools = next(item for item in TARGETS if item['id'] == 'tools')
        request = urllib.request.Request(
            f'http://127.0.0.1:{tools["ポート"]}/aidiy_chrome_devtools/new_page',
            data=json.dumps({'url': url, 'show_automation_banner': False}).encode('utf-8'),
            headers={'Content-Type': 'application/json'}, method='POST')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(request, timeout=20) as response:
            result = json.loads(response.read(65536).decode('utf-8'))
        if not isinstance(result, dict) or not result.get('id'):
            raise RuntimeError(result.get('error', 'ページの作成を確認できませんでした。') if isinstance(result, dict) else '応答形式が不正です。')
        print(f'chrome_devtools で Web を開きました: {url}')
    except (OSError, ValueError, RuntimeError) as error:
        print(f'画面を開けませんでした（Web は稼働を続けます）: {error}')
        print('Tools / MCP の起動状態を確認し、Web を再起動してください。')
    return not stopped.is_set()


def run(module, kind, settings, *, run_id=None, console=None, stopped=None):
    target = next((item for item in TARGETS if item['id'] == kind), None)
    if target is None or (ROOT / target['フォルダ'] / '_start.py').resolve() != Path(module.__file__).resolve():
        raise ValueError('この起動スクリプトでは指定の機能を起動できません。')
    if not isinstance(settings, dict) or set(settings) != set(target['初期設定']) or any(type(value) is not bool for value in settings.values()):
        raise ValueError('起動設定が不正です。')
    console = console or Console(sys.stdout)
    stopped = stopped or threading.Event()
    run_id = run_id or os.environ.get('AIDIY_DIAG_RUN', '')
    revision = RUNTIME / (kind + '.json')

    def commands():
        try:
            for line in sys.stdin:
                if len(line) < 200 and json.loads(line).get('action') == 'stop':
                    stopped.set()
        except (OSError, ValueError, AttributeError):
            pass
        finally:
            stopped.set()  # Diag 終了・接続喪失でも起動したプロセスを回収する。

    threading.Thread(target=commands, daemon=True).start()
    if run_id:
        threading.Thread(target=watch_revision, args=(revision, run_id, stopped), daemon=True).start()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopped.set())
    os.environ['AIDIY_DIAG_CONSOLE'] = '1'
    sys.stdout = sys.stderr = console
    process = None
    output = None
    owns_service = False
    with service_lock(RUNTIME / (kind + '.lock'), stopped), hidden_commands(module):
        try:
            if stopped.is_set():
                return
            console.event('status', state='確認中')
            ok, detail = module.check_environment()
            if not ok:
                raise RuntimeError(detail)
            # 通常の _start.py の監視が、Diag で停止した旧インスタンスを再起動しないようにする。
            cleanup = load_module('aidiy_diag_cleanup_control', ROOT / '_cleanup.py')
            with cleanup.cleanup_stop_request({}, services=[target['監視名']]):
                if stopped.wait(1.3):
                    return
                console.event('status', state='再起動中')
                print('古いインスタンスを停止します。')
                stop_previous(module, target)
                owns_service = True
            while not stopped.is_set():
                if kind == 'tools':
                    print('起動前の headless 診断を実行します。')
                    import shutil
                    node = shutil.which('node')
                    if not node:
                        raise RuntimeError('Node.js が必要です。')
                    process = start_headless(node)
                    output = threading.Thread(target=pipe_output, args=(process, console), daemon=True)
                    output.start()
                    wait_for_exit(process, stopped)
                    if stopped.is_set():
                        return
                    output.join(timeout=2)
                    if process.returncode:
                        raise RuntimeError('事前診断に失敗したため Tools の起動を中止しました。')
                console.event('status', state='起動中')
                process = launch(module, target, settings)
                output = None
                if process.stdout is not None:
                    output = threading.Thread(target=pipe_output, args=(process, console), daemon=True)
                    output.start()
                # Tools は Windows 初回の COM キャッシュ生成と全 MCP 登録を含む。
                # 冷起動でも初期化途中に打ち切らない。停止要求は待機中も監視する。
                deadline = time.monotonic() + (180 if kind == 'tools' else 90)
                while not stopped.is_set() and process.poll() is None:
                    if not target.get('ポート'):
                        if stopped.wait(MANAGEMENT_INTERVAL):
                            break
                        if process.poll() is None:
                            break
                    else:
                        try:
                            with socket.create_connection(('127.0.0.1', target['ポート']), timeout=.2):
                                break
                        except OSError:
                            if time.monotonic() >= deadline:
                                raise RuntimeError('起動の待受確認がタイムアウトしました。')
                            stopped.wait(MANAGEMENT_INTERVAL)
                if stopped.is_set():
                    break
                if process.poll() is not None:
                    raise RuntimeError(f'起動プロセスが終了しました (終了コード: {process.returncode})。')
                if kind == 'web' and not show_web(target, settings, process, stopped):
                    break
                console.event('ready', state='稼働中')
                print('起動しました。停止ボタンから Ctrl+C を送信できます。ログの Ctrl+C はコピーです。')
                wait_for_exit(process, stopped)
                if stopped.is_set():
                    break
                if output:
                    output.join(timeout=2)
                if not settings['自動再起動']:
                    break
                console.event('status', state='再起動待ち')
                print('プロセスが終了しました。15秒後に再起動します。')
                if stopped.wait(15):
                    break
                stop_previous(module, target)
        finally:
            console.event('status', state='停止中')
            terminate(process)
            if output:
                output.join(timeout=1)
            # 専用窓・ブラウザ・孫プロセスを各フォルダが所有する停止処理で回収する。
            if owns_service:
                stop_previous(module, target)
            console.event('status', state='停止済み')


def dispatch(module):
    if len(sys.argv) != 3 or sys.argv[1] != '--diag-start':
        raise ValueError('--diag-start に機能IDを指定してください。')
    console = Console(sys.stdout)
    try:
        run(module, sys.argv[2], json.loads(os.environ.get('AIDIY_DIAG_SETTINGS', '{}')), console=console)
    except Exception as error:
        console.event('error', message=str(error))
        raise SystemExit(1)


if __name__ == '__main__':
    dispatch(START_MODULE)
