# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""プロジェクト内ランチャーの Windows PATH 登録と、Hermes の既存共有 bin 管理。"""
import base64
import json
import hashlib
import re
import tempfile
import ntpath
import os
import shlex
import sys
from pathlib import Path


def windows_launcher_command(command):
    """呼出元のコードページを変えず、UTF-8の配置先と引数を既存ランタイムへ渡す。"""
    # cmd.exe が読む実行文はASCIIだけにする。Nodeは全Electronアプリの既存の前提。
    # 日本語パスをUTF-8のままcmdへ埋めたり、chcpで共有コンソールを変更したりしない。
    payload = base64.b64encode(json.dumps(command, ensure_ascii=False).encode('utf-8')).decode('ascii')
    script = ("const{spawnSync}=require('node:child_process');"
              f"const[c,...a]=JSON.parse(Buffer.from('{payload}','base64').toString('utf8'));"
              "const r=spawnSync(c,[...a,...process.argv.slice(1)],{stdio:'inherit',windowsHide:true,shell:false});"
              "if(r.error)console.error(r.error.message);process.exitCode=r.status===null?1:r.status;")
    return f'node.exe -e "{script}" -- %*'


def launcher_owner_comment(script):
    """既存の解除処理が配置先を照合できるコメント。実行文には利用しない。"""
    return 'rem aidiy-launcher-owner: "' + str(script).replace('%', '%%') + '"'


def launcher_owned_by(content, script):
    """新形式は所有者コメントを完全一致、旧形式は従来の配置先で照合する。"""
    owners = [line for line in content.splitlines() if line.startswith('rem aidiy-launcher-owner: ')]
    return launcher_owner_comment(script) in owners if owners else str(script) in content



def launcher_directory(program, project=None):
    """アプリ別ランチャーの配置先。空のプロジェクトは AiDiy 本体。"""
    if not isinstance(program, str) or not program.startswith('aidiy_') or not program.replace('_', '').isalnum():
        raise ValueError('ランチャーのプログラム名が不正です。')
    root = Path(project).absolute() if project else Path(__file__).resolve().parents[1]
    directory = root
    for part in ('_AIDIY', program, 'bin'):
        directory = directory / part
        if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
            raise ValueError(f'ランチャー保存先が通常フォルダではありません: {directory}')
    return directory


def _normalized_launcher(content, scripts):
    """既知の生成テンプレートを比較する。埋込コマンドは解析だけで実行しない。"""
    text = content.replace('\r\n', '\n')
    # Windowsの日本語パス対応テンプレート。実行ファイルの版/位置だけは変わり得る。
    def payload(match):
        try:
            command = json.loads(base64.b64decode(match.group(1), validate=True))
        except (ValueError, TypeError):
            return match.group(0)
        if (not isinstance(command, list)
                or not all(isinstance(value, str) for value in command)
                or not (len(command) == 2 or (len(command) == 4 and command[1:3] == ['-X', 'utf8']))
                or command[-1] not in scripts):
            return match.group(0)
        return "Buffer.from('<owned-launcher>','base64')"
    text = re.sub(r"Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\)", payload, text)
    # POSIXのexec行も引数数と配置先を確認し、追記コマンドを受け入れない。
    lines = text.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if not line.startswith('exec '):
            continue
        try:
            args = shlex.split(line)
        except ValueError:
            continue
        if (line.rstrip('\n').endswith(' \"$@\"')
                and args and args[0] == 'exec' and args[-1] == '$@'
                and (len(args) == 4 or (len(args) == 6 and args[2:4] == ['-X', 'utf8']))
                and args[-2] in scripts):
            lines[index] = 'exec <owned-runtime> <owned-script> "$@"\n'
    text = ''.join(lines)
    for script in scripts:
        text = text.replace(hashlib.sha256(script.encode('utf-8')).hexdigest(), '<owned-hash>')
        text = text.replace(script.replace('%', '%%'), '<owned-script>')
        text = text.replace(script, '<owned-script>')
    return text


def sync_shared_launcher(launcher, script, *, legacy_scripts=()):
    """PATHで優先される旧 ~/.local/bin を、同一コピーの場合だけ最新化する。

    新規ホーム配置は作らず、共有PATH/他アプリ/他コピーには触れない。
    正規配置先の書込後に呼ぶ。テンプレート外の内容は変更せず失敗として通知する。
    """
    launcher, script = Path(launcher), Path(script)
    shared = Path.home() / '.local' / 'bin' / launcher.name
    if shared == launcher or not os.path.lexists(shared):
        return
    for path in (shared.parent.parent, shared.parent, shared):
        if path.is_symlink() or getattr(path, 'is_junction', lambda: False)():
            raise OSError(f'共有ランチャーはリンクのため変更しません: {shared}。直接起動: {launcher}')
    if not shared.is_file():
        raise OSError(f'共有ランチャーは通常ファイルではありません: {shared}')
    scripts = [str(script)]
    for old in legacy_scripts:
        old = Path(old)
        if not old.parent.is_symlink() and not getattr(old.parent, 'is_junction', lambda: False)():
            scripts.append(str(old))
    source = launcher.read_bytes()
    expected = source.decode('utf-8')
    previous = shared.read_bytes()
    try:
        owned = _normalized_launcher(previous.decode('utf-8'), scripts) == _normalized_launcher(expected, scripts)
    except UnicodeError:
        owned = False
    if not owned:
        raise OSError(f'共有ランチャーは別コピーまたは改変済みのため変更しません: {shared}。直接起動: {launcher}')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=shared.parent, prefix='.' + shared.name + '-', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(source)
        if sys.platform != 'win32':
            temporary.chmod(0o755)
        # 検査後のユーザー編集やリンクへの置換を上書きしない。
        if shared.is_symlink() or shared.read_bytes() != previous:
            raise OSError(f'共有ランチャーが変更されたため更新を中止しました: {shared}')
        temporary.replace(shared)
        temporary = None
        print(f'旧共有ランチャーを更新しました: {shared}')
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def ensure_launcher_path(directory):
    """Windows はユーザー PATH、POSIX のプロジェクト配置はプロセス限定。"""
    directory = Path(directory).absolute()
    if sys.platform == "win32":
        return _ensure_windows_path(directory)
    if directory.name == "bin" and directory.parent.name == ".local":
        return _ensure_posix_path(directory)
    current = os.environ.get('PATH', '')
    if str(directory) not in current.split(os.pathsep):
        os.environ['PATH'] = str(directory) + (os.pathsep + current if current else '')
    print(f'ランチャー配置先: {directory}（フルパスで起動できます）')
    print('このセットアップから呼出元の PATH は変更できません。コマンド名だけで起動する場合は、使うシェルで次を実行してください。')
    print(f'現在のシェルだけで使う場合: export PATH={shlex.quote(str(directory))}:"$PATH"')
    return True


def remove_launcher_path(directory=None):
    """Windows は自動登録分だけを解除。POSIX は既存の登録範囲を維持する。"""
    if directory is not None:
        directory = Path(directory).absolute()
        if sys.platform == "win32":
            return _remove_windows_path(directory)
        if directory.name == "bin" and directory.parent.name == ".local":
            return _remove_posix_path(directory)
        directory = str(directory)
        os.environ['PATH'] = os.pathsep.join(entry for entry in os.environ.get('PATH', '').split(os.pathsep) if entry != directory)
    return True


# 永続 PATH の登録記録は対象 bin の親に保存する。ホーム配置は Hermes のみ。
def _normalize(value):
    return ntpath.normcase(ntpath.normpath(ntpath.expandvars(value.strip().strip('"'))))


def _state_file(directory):
    return directory.parent / '.aidiy-launcher-path.json'


SHELL_PATH_BEGIN = '# >>> AiDiy launcher PATH >>>'
SHELL_PATH_END = '# <<< AiDiy launcher PATH <<<'


def shell_profile_paths():
    """ログイン・非ログインの zsh / bash を対象にし、既存の読込順を維持する。"""
    home = Path.home()
    paths = []
    if sys.platform == 'darwin' or Path(os.environ.get('SHELL', '')).name == 'zsh':
        zdotdir = Path(os.environ.get('ZDOTDIR') or home).expanduser().absolute()
        paths.extend([zdotdir / '.zprofile', zdotdir / '.zshrc'])
    # 新たな .bash_profile で既存の .profile 等が読まれなくなることを避ける。
    login = next((home / name for name in ('.bash_profile', '.bash_login', '.profile')
                  if (home / name).exists()), home / ('.bash_profile' if sys.platform == 'darwin' else '.profile'))
    paths.extend([login, home / '.bashrc'])
    return list(dict.fromkeys(paths))


def _shell_path_block(directory):
    quoted = shlex.quote(str(directory))
    return (f'{SHELL_PATH_BEGIN}\n'
            'case ":${PATH-}:" in\n'
            f'  *:{quoted}:*) ;;\n'
            f'  *) export PATH={quoted}${{PATH:+:"$PATH"}} ;;\n'
            f'esac\n{SHELL_PATH_END}\n')


def _read_profile(path):
    return path.read_bytes().decode('utf-8') if path.exists() else ''


def _save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)


def _posix_state(directory):
    path = _state_file(directory)
    if not path.exists():
        return {'platform': 'posix', 'directory': str(directory), 'profiles': []}
    state = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(state, dict) or state.get('platform') != 'posix' or state.get('directory') != str(directory):
        raise ValueError('PATH 登録記録の対象フォルダが一致しません。')
    profiles = state.get('profiles')
    if not isinstance(profiles, list):
        raise ValueError('シェル PATH 登録記録が不正です。')
    block = _shell_path_block(directory)
    for item in profiles:
        if (not isinstance(item, dict) or not isinstance(item.get('path'), str)
                or not Path(item['path']).is_absolute()
                or item.get('addition') not in (block, '\n' + block)
                or type(item.get('created')) is not bool):
            raise ValueError('シェル PATH 登録記録が不正です。')
    return state


def _ensure_posix_path(directory):
    try:
        state = _posix_state(directory)
        block = _shell_path_block(directory)
        for profile in shell_profile_paths():
            original = _read_profile(profile)
            entry = next((item for item in state['profiles'] if item['path'] == str(profile)), None)
            if block in original:
                continue
            if SHELL_PATH_BEGIN in original or SHELL_PATH_END in original:
                raise ValueError(f'自動登録部分が変更されています。内容を確認してください: {profile}')
            addition = ('\n' if original and not original.endswith('\n') else '') + block
            if entry is None:
                entry = {'path': str(profile), 'addition': addition, 'created': not profile.exists()}
                state['profiles'].append(entry)
            else:
                entry['addition'] = addition
            # 書込途中の失敗でも、追加した部分を cleanup で戻せるよう先に記録する。
            _save_state(_state_file(directory), state)
            profile.parent.mkdir(parents=True, exist_ok=True)
            profile.write_bytes((original + addition).encode('utf-8'))
            print(f'シェル PATH に登録しました: {profile}')
        process_path = os.environ.get('PATH', '')
        if str(directory) not in process_path.split(':'):
            os.environ['PATH'] = str(directory) + (':' + process_path if process_path else '')
        print('PATH 登録済み。新しいターミナルを開いて各 aidiy コマンドを実行してください。')
        print(f'今のターミナルで使う場合: export PATH={shlex.quote(str(directory))}:"$PATH"')
        return True
    except (OSError, ValueError) as exc:
        print(f'シェル PATH に登録できません: {exc}')
        return False


def _remove_posix_path(directory):
    try:
        if not _state_file(directory).exists():
            return True
        if directory.exists() and any(directory.iterdir()):
            print(f'ランチャーフォルダが使用中のため PATH 登録を保持します: {directory}')
            return True
        state = _posix_state(directory)
        for entry in state['profiles']:
            profile = Path(entry['path'])
            if not profile.exists():
                continue
            original = _read_profile(profile)
            addition = entry['addition']
            if addition not in original:
                if SHELL_PATH_BEGIN in original or SHELL_PATH_END in original:
                    raise ValueError(f'自動登録部分が変更されています。内容を確認してください: {profile}')
                continue
            updated = original.replace(addition, '', 1)
            if not updated and entry['created'] and not profile.is_symlink():
                profile.unlink()
            else:
                profile.write_bytes(updated.encode('utf-8'))
            print(f'自動追加したシェル PATH を解除しました: {profile}')
        _state_file(directory).unlink()
        os.environ['PATH'] = ':'.join(item for item in os.environ.get('PATH', '').split(':') if item != str(directory))
        return True
    except (OSError, ValueError) as exc:
        print(f'シェル PATH 登録の解除に失敗しました: {exc}')
        return False


def _notify_change():
    try:
        _notify_environment_change()
    except (OSError, AttributeError) as exc:
        print(f'環境変数の更新通知に失敗しました: {exc}。反映されない場合はサインインし直してください。')


def _notify_environment_change():
    """Explorer などへ環境変数の更新を通知する（受信先ごとの応答期限は1秒）。"""
    import ctypes
    from ctypes import wintypes

    send = ctypes.windll.user32.SendMessageTimeoutW
    send.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM,
                     wintypes.LPCWSTR, wintypes.UINT, wintypes.UINT,
                     ctypes.POINTER(ctypes.c_size_t)]
    send.restype = wintypes.LPARAM
    result = ctypes.c_size_t()
    if not send(0xFFFF, 0x001A, 0, 'Environment', 0x0002, 1000, ctypes.byref(result)):
        print('環境変数の更新通知が届きませんでした。反映されない場合はサインインし直してください。')


def _ensure_windows_path(directory):
    """既存のユーザー PATH を保持し、未登録の bin だけを永続登録する。"""
    directory = Path(directory).absolute()

    import winreg

    def contains(path):
        target = _normalize(str(directory))
        return any(_normalize(entry) == target for entry in path.split(';') if entry.strip())

    try:
        # プロセスの PATH にはシステム分も含まれるため、永続化には使わない。
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, 'Environment', 0,
                                winreg.KEY_QUERY_VALUE | winreg.KEY_SET_VALUE) as key:
            missing = False
            try:
                path, value_type = winreg.QueryValueEx(key, 'Path')
            except FileNotFoundError:
                path, value_type = '', winreg.REG_EXPAND_SZ
                missing = True
            if value_type not in (winreg.REG_SZ, winreg.REG_EXPAND_SZ):
                raise ValueError('ユーザー PATH が文字列型ではありません。')
            changed = not contains(path)
            if changed:
                separator = ';' if path and not path.endswith(';') else ''
                updated = path + separator + str(directory)
                # 自動追加した登録だけを cleanup で戻せるよう、対象 bin の親に記録する。
                # 記録できない場合は PATH も変更しない。
                state_file = _state_file(directory)
                state_file.parent.mkdir(parents=True, exist_ok=True)
                temporary = state_file.with_suffix('.tmp')
                temporary.write_text(json.dumps({'directory': str(directory), 'original_path': path,
                                                 'updated_path': updated, 'original_missing': missing},
                                                ensure_ascii=False), encoding='utf-8')
                temporary.replace(state_file)
                winreg.SetValueEx(key, 'Path', 0, value_type, updated)
    except (OSError, ValueError) as exc:
        print(f'ユーザー PATH に登録できません: {exc}')
        print(f'Windows の環境変数設定で {directory} をユーザー PATH に追加してください。')
        return False

    # このセットアップから起動する診断や子プロセスにも反映する。
    process_path = os.environ.get('PATH', '')
    if not contains(process_path):
        separator = ';' if process_path and not process_path.endswith(';') else ''
        os.environ['PATH'] = process_path + separator + str(directory)
    if changed:
        print(f'ユーザー PATH に登録しました: {directory}')
        _notify_change()
    print('PATH 登録済み。ターミナルや VS Code を開き直して各 aidiy コマンドを実行してください。')
    return True


def _remove_windows_path(directory):
    """bin が空になったときだけ、セットアップが追加した PATH を解除する。"""
    directory = Path(directory).absolute()
    state_file = _state_file(directory)
    if not state_file.is_file():
        return True

    import winreg

    try:
        # 残した AiDiy コマンド、別コピーのリンク、uv など他ツールがあれば共用を続ける。
        if directory.exists() and any(directory.iterdir()):
            print(f'ランチャーフォルダが使用中のため PATH 登録を保持します: {directory}')
            return True
        state = json.loads(state_file.read_text(encoding='utf-8'))
        if not isinstance(state, dict) or state.get('directory') != str(directory):
            raise ValueError('PATH 登録記録の対象フォルダが一致しません。')
        if not isinstance(state.get('original_path'), str) or not isinstance(state.get('updated_path'), str):
            raise ValueError('PATH 登録記録が不正です。')
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, 'Environment', 0,
                                winreg.KEY_QUERY_VALUE | winreg.KEY_SET_VALUE) as key:
            try:
                path, value_type = winreg.QueryValueEx(key, 'Path')
            except FileNotFoundError:
                path, value_type = '', winreg.REG_EXPAND_SZ
            if value_type not in (winreg.REG_SZ, winreg.REG_EXPAND_SZ):
                raise ValueError('ユーザー PATH が文字列型ではありません。')
            if path == state['updated_path']:
                updated = state['original_path']
                if state.get('original_missing') is True:
                    winreg.DeleteValue(key, 'Path')
                else:
                    winreg.SetValueEx(key, 'Path', 0, value_type, updated)
            else:
                # セットアップ後に追加された他の PATH 項目も保持する。
                entries = path.split(';')
                if str(directory) in entries:
                    index = len(entries) - 1 - entries[::-1].index(str(directory))
                    if state['updated_path'] == state['original_path'] + str(directory):
                        # 元の末尾区切りを再利用した登録は、その空要素を戻す。
                        # 複数アプリを登録順に解除しても既存の区切りを失わない。
                        entries[index] = ''
                    else:
                        entries.pop(index)
                updated = ';'.join(entries)
                if updated != path:
                    winreg.SetValueEx(key, 'Path', 0, value_type, updated)
        state_file.unlink()
        process_path = os.environ.get('PATH', '')
        os.environ['PATH'] = ';'.join(entry for entry in process_path.split(';')
                                     if not entry.strip() or _normalize(entry) != _normalize(str(directory)))
        if updated != path:
            _notify_change()
        print(f'自動追加した PATH 登録を解除しました: {directory}')
        return True
    except (OSError, ValueError) as exc:
        print(f'PATH 登録の解除に失敗しました: {exc}')
        return False
