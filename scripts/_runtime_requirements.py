# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""setup/startの実ランタイム確認。cleanupには版数の前提を追加しない。"""
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys


_VERSION = re.compile(r"^(?:v|Python\s+)?(\d+)\.(\d+)\.(\d+)$")
_COMPARATOR = re.compile(r"(>=|<=|>|<|=|\^|~)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?")


def version_satisfies(version, requirement):
    """実manifestの比較式（AND/OR/caret/tilde）を判定。未知の式は推測しない。"""
    if isinstance(version, str):
        match = _VERSION.fullmatch(version.strip())
        if not match:
            raise ValueError('安定版のバージョン表記を確認できません')
        version = tuple(map(int, match.groups()))
    matched = False
    for alternative in requirement.split('||'):
        alternative = alternative.strip()
        if alternative == '*':
            matched = True
            continue
        offset, results = 0, []
        for match in _COMPARATOR.finditer(alternative):
            if alternative[offset:match.start()].strip(' ,'):
                raise ValueError('対応していないバージョン範囲です')
            operator, major, minor, patch = match.groups()
            target = (int(major), int(minor or 0), int(patch or 0))
            operator = operator or '='
            if operator == '>=':
                valid = version >= target
            elif operator == '>':
                valid = version > target
            elif operator == '<=':
                valid = version <= target
            elif operator == '<':
                valid = version < target
            elif operator == '=':
                valid = version == target
            elif operator == '~':
                upper = (target[0] + 1, 0, 0) if minor is None else (target[0], target[1] + 1, 0)
                valid = target <= version < upper
            else:
                if target[0]:
                    upper = (target[0] + 1, 0, 0)
                elif target[1]:
                    upper = (0, target[1] + 1, 0)
                else:
                    upper = (0, 0, target[2] + 1)
                valid = target <= version < upper
            results.append(valid)
            offset = match.end()
        if not results or alternative[offset:].strip(' ,'):
            raise ValueError('対応していないバージョン範囲です')
        matched = matched or all(results)
    return matched


def python_requirement(project_dir):
    """Python管理ツール自身の版でなく、対象projectのrequires-pythonを読む。"""
    text = (Path(project_dir) / 'pyproject.toml').read_text(encoding='utf-8-sig')
    project = re.search(r'^\[project\]\s*$(.*?)(?=^\[|\Z)', text, re.M | re.S)
    requirement = re.search(r'^requires-python\s*=\s*[\"\']([^\"\']+)[\"\']', project[1], re.M) if project else None
    if not requirement:
        raise ValueError('pyproject.tomlのrequires-pythonを確認できません')
    return requirement[1]


def project_node_requirement(project_dir, dependency=None, fallback=None):
    """own engines、または指定依存の導入済み→lockfile enginesを読む。更新・導入なし。"""
    root = Path(project_dir)
    if dependency is None:
        package = json.loads((root / 'package.json').read_text(encoding='utf-8-sig'))
        requirement = package.get('engines', {}).get('node')
    else:
        # 呼出元が固定したパッケージ名だけを利用する（利用者入力のパスを渡さない）。
        name = Path(dependency)
        if name.is_absolute() or '..' in name.parts:
            raise ValueError('依存名が不正です')
        installed = root / 'node_modules' / name / 'package.json'
        if installed.is_file():
            package = json.loads(installed.read_text(encoding='utf-8-sig'))
            requirement = package.get('engines', {}).get('node')
        else:
            lock = root / 'package-lock.json'
            packages = json.loads(lock.read_text(encoding='utf-8-sig')).get('packages', {}) if lock.is_file() else {}
            requirement = packages.get('node_modules/' + dependency, {}).get('engines', {}).get('node')
    if requirement is not None and (not isinstance(requirement, str) or not requirement.strip()):
        raise ValueError('Node.js enginesが不正です')
    return requirement if requirement is not None else fallback


def _check_runtime(command, label, requirement, *, strict=False):
    if not command:
        return False, f'{label} が見つかりません（必要条件: {requirement}）。'
    try:
        result = subprocess.run([str(command), '--version'], stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, encoding='utf-8', errors='replace',
                                timeout=15, check=True,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) if sys.platform == 'win32' else 0)
        output = (result.stdout or result.stderr or '').strip().splitlines()
        value = output[0].strip() if output else ''
        if label == 'Python':
            value = value.removeprefix('Python ')
        if not version_satisfies(value, requirement):
            message = f'{label} {value}: 宣言された必要条件 {requirement} を満たしません。'
            return (False, message) if strict else (True, f'[WARN] {message} 版数だけでは停止せず、実行結果を確認します。')
        return True, f'{label} {value}（必要条件: {requirement}）'
    except subprocess.TimeoutExpired:
        return False, f'{label} のバージョン確認が15秒でタイムアウトしました。'
    except (ValueError, TypeError):
        message = f'{label} の版数範囲を判定できません（必要条件: {requirement}）。'
        return (False, message) if strict else (True, f'[WARN] {message} 実行結果を確認して続行します。')
    except (OSError, subprocess.SubprocessError):
        return False, f'{label} を実行できません（必要条件: {requirement}）。'


def check_python_runtime(command, requirement='>=3.13', *, strict=False):
    return _check_runtime(command, 'Python', requirement, strict=strict)


def check_node_runtime(requirement, command=None, *, strict=False):
    return _check_runtime(command or shutil.which('node'), 'Node.js', requirement, strict=strict)


def check_vscode_runtime(command, requirement='^1.106.0', *, strict=False):
    # 拡張の配置時専用。単独Electron/ブラウザ起動やcleanupには要求しない。
    return _check_runtime(command, 'VS Code', requirement, strict=strict)


def check_project_node_runtime(project_dir, dependency=None, fallback=None, command=None):
    try:
        requirement = project_node_requirement(project_dir, dependency, fallback)
        if not requirement:
            raise ValueError('Node.js requirement missing')
        return check_node_runtime(requirement, command)
    except (OSError, ValueError, TypeError, AttributeError):
        ok, detail = check_node_runtime('>=0', command)
        if not ok:
            return False, detail
        return True, '[WARN] Node.js のpackage metadataを確認できません。版数だけでは停止せず、実行結果を確認します。'
