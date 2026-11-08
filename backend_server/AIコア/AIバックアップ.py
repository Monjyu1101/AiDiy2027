# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

import os
import shutil
import ctypes
import time
from fnmatch import fnmatchcase
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Optional, Tuple, List, TypedDict

from log_config import get_logger

logger = get_logger("バックアップ")

_バックアップ除外フォルダ = (
    "__pycache__",
    ".git",
    ".git_local",
    ".venv",
    "venv",
    "_data",
    "temp",
    "log",
    "logs",
    ".aidiy_backup",
    ".backup_local",
    ".aidiy_cache",
    "node_modules",
    "dist",
    "build",
    ".output",
    ".nuxt",
    ".next",
    ".vite",
    ".turbo",
    ".cache",
    ".npm",
    ".pnpm-store",
    ".yarn",
)

# .gitignore の **/_AIDIY/aidiy_*/ と同じ条件。未知のアプリも除外し、外側の同名ソースは残す。
_バックアップ除外フォルダ組 = {
    ("_AIDIY", "aidiy_*"),
}


def _バックアップ除外フォルダ判定(parent: str, child: str) -> bool:
    return any(fnmatchcase(parent, parent_pattern) and fnmatchcase(child, child_pattern)
               for parent_pattern, child_pattern in _バックアップ除外フォルダ組)


_バックアップ除外ファイル = (
    ".DS_Store",
    "Thumbs.db",
    "internal_auth.json",
    "internal_auth_keys.json",
    ".internal_auth_keys.lock",
    "package-lock.json",
    "package.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "npm-shrinkwrap.json",
)

_バックアップ除外拡張子 = (
    ".pyc",
    ".pyo",
    ".pyd",
    ".log",
    ".tmp",
    ".swp",
)

# Windows予約デバイス名（削除不可能）
_WINDOWS予約デバイス名 = (
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
)

# ファイルコピーは軽量な並列数で実行（呼び出し元APIは同期で待機）
_バックアップコピー並列数 = 4

# 除外後の対象がこの件数以上なら、コピー開始前にキャンセルする
_バックアップキャンセル件数 = 100_000


class ファイル情報(TypedDict):
    パス: str
    更新日時: str


class _内部ファイル情報(TypedDict):
    パス: str
    更新日時: str
    更新時刻: float


def _コードベース絶対パス取得(アプリ設定=None, backend_dir: Optional[str] = None, セッション設定: Optional[dict] = None) -> str:
    """
    CODE_BASE_PATHの絶対パスを取得
    優先順位: 1. セッション設定, 2. アプリ設定, 3. デフォルト("../")
    """
    raw_path = "../"

    # 1. セッション設定から取得（最優先）
    if セッション設定 and "CODE_BASE_PATH" in セッション設定:
        raw_path = セッション設定["CODE_BASE_PATH"]
    # 2. アプリ設定から取得
    elif アプリ設定 and hasattr(アプリ設定, "json"):
        raw_path = アプリ設定.json.get("CODE_BASE_PATH", "../")

    normalized = raw_path.replace("\\", "/").strip()
    # backend_server/ を基準にする（__file__ の1階層上）
    base_dir = backend_dir or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if os.path.isabs(normalized):
        return os.path.abspath(normalized)
    return os.path.abspath(os.path.join(base_dir, normalized))


def コードベース絶対パス取得(アプリ設定=None, backend_dir: Optional[str] = None, セッション設定: Optional[dict] = None) -> str:
    """CODE_BASE_PATH の絶対パスを返す公開ヘルパー"""
    return _コードベース絶対パス取得(アプリ設定=アプリ設定, backend_dir=backend_dir, セッション設定=セッション設定)


def バックアップ実行_共通ログ(
    呼出しロガー=None,
    アプリ設定=None,
    backend_dir: Optional[str] = None,
    セッション設定: Optional[dict] = None,
) -> Optional[Tuple[str, List[ファイル情報], List[str], bool, str]]:
    """
    呼び出し元ロガーに開始と終了または中止を出す共通ラッパー
    - 開始は呼び出し直後に出力
    - 結果があれば終了、なければ中止を出力（差分なしは件数0）
    """
    base_path = _コードベース絶対パス取得(
        アプリ設定=アプリ設定,
        backend_dir=backend_dir,
        セッション設定=セッション設定,
    )
    log = 呼出しロガー or logger
    log.info(f"バックアップ開始({base_path})")
    result = バックアップ実行(
        アプリ設定=アプリ設定,
        backend_dir=backend_dir,
        セッション設定=セッション設定,
        ログ出力=False,
    )
    if result is None:
        log.info(f"バックアップ中止({base_path})")
    else:
        log.info(f"バックアップ終了(件数={len(result[2])}, 全件={len(result[1])})")
    return result


def _全ファイルスキャン(ベースパス: str, 最大件数: Optional[int] = None) -> List[_内部ファイル情報]:
    files: List[_内部ファイル情報] = []
    workspace_root = os.path.abspath(ベースパス)
    # 高速ルックアップ用セット
    _除外フォルダセット = set(_バックアップ除外フォルダ)
    def 走査エラー(error):
        # 読取不能を正常な対象0件へ読み替えない。
        raise error

    for root, dirs, file_names in os.walk(workspace_root, onerror=走査エラー):
        # 除外は選択したプロジェクトの内側だけに適用する。
        # 親が temp/log 等でも、明示された作業フォルダを丸ごと除外しない。
        root_parts = os.path.relpath(root, workspace_root).split(os.sep)
        if any(_バックアップ除外フォルダ判定(*pair) for pair in zip(root_parts, root_parts[1:])):
            dirs[:] = []
            continue
        # ディレクトリ名の完全一致で除外（サブストリング一致は "dialog" → "log" のような誤除外を招く）
        dirs[:] = [
            d for d in dirs
            if d not in _除外フォルダセット and not d.startswith(".")
            and not _バックアップ除外フォルダ判定(root_parts[-1], d)
        ]
        for file_name in file_names:
            # Office の一時ロックファイルは、件数判定・差分判定・コピーのすべてから除外する。
            if (file_name.startswith("~$")
                    or (file_name.startswith((".internal_auth.json.", ".internal_auth_keys.json.")) and file_name.endswith(".tmp"))):
                continue
            file_path = os.path.join(root, file_name)

            # Windows予約デバイス名 + null チェック（削除不可能/問題ファイルのため警告のみ）
            base_name = os.path.splitext(file_name)[0].lower()
            if base_name in _WINDOWS予約デバイス名 or base_name == "null":
                if os.name == "nt" and base_name in ("nul", "null"):
                    _nul_nullファイル削除試行(file_path)
                logger.warning(f"問題のあるファイル名を検出（バックアップ対象外）: {file_path}")
                continue

            # パス構成要素の完全一致チェック（サブストリング一致は使わない）
            # 例: "log" in "qAlertDialog.vue" は True になるが、これは誤除外
            path_parts = os.path.relpath(file_path, workspace_root).split(os.sep)
            if any(part in _除外フォルダセット for part in path_parts):
                continue
            if file_name in _バックアップ除外ファイル or file_name.endswith(_バックアップ除外拡張子):
                continue
            try:
                mtime = os.path.getmtime(file_path)
            except OSError:
                # 取得失敗を対象なしとして成功させない。
                raise
            rel_path = os.path.relpath(file_path, workspace_root).replace("\\", "/")
            更新日時 = datetime.fromtimestamp(mtime).strftime("%Y/%m/%d %H:%M:%S")
            files.append({"パス": rel_path, "更新日時": 更新日時, "更新時刻": mtime})
            if 最大件数 is not None and len(files) >= 最大件数:
                raise RuntimeError(
                    f"バックアップキャンセル: 対象ファイル数が{最大件数:,}件以上です"
                    f"（検出件数={len(files):,}, 対象={workspace_root}）"
                )
    return files


def _ローカルGit記録(base_path: str, files: List[str]) -> None:
    """batch に関係なく Git は別 worker へ渡し、コピーと返却を待たせない。"""
    try:
        import importlib.util
        import sys
        from pathlib import Path
        # Tools はネイティブ実装を複数回ロードするため、helper のキューを共有する。
        module_name = "aidiy_local_git_backup"
        module = sys.modules.get(module_name)
        if module is None:
            helper = Path(__file__).resolve().parents[2] / "scripts" / "local_git_backup.py"
            spec = importlib.util.spec_from_file_location(module_name, helper)
            candidate = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(candidate)
            module = sys.modules.setdefault(module_name, candidate)
        module.queue_local_backup(
            base_path, files, logger=logger, excluded_dirs=_バックアップ除外フォルダ,
            excluded_files=_バックアップ除外ファイル,
            excluded_suffixes=_バックアップ除外拡張子,
            excluded_pairs=_バックアップ除外フォルダ組,
        )
    except Exception:
        logger.warning("ローカル Git 記録を実行できませんでした。通常バックアップを継続します。")


def _nul_nullファイル削除試行(file_path: str) -> bool:
    """Windows環境で nul/null ファイル削除を試行（失敗しても継続）"""
    if os.name != "nt":
        return False

    try:
        abs_path = os.path.abspath(file_path)
        if abs_path.startswith("\\\\"):
            unc_path = "\\\\?\\UNC\\" + abs_path[2:]
        else:
            unc_path = "\\\\?\\" + abs_path

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        delete_file_w = kernel32.DeleteFileW
        delete_file_w.argtypes = [ctypes.c_wchar_p]
        delete_file_w.restype = ctypes.c_int

        result = delete_file_w(unc_path)
        if result:
            logger.info(f"問題ファイルを削除しました: {file_path}")
            return True

        error_code = ctypes.get_last_error()
        error_message = ctypes.FormatError(error_code).strip()
        logger.error(
            f"問題ファイルの削除に失敗しました: {file_path}, "
            f"error_code={error_code}, error={error_message}"
        )
        return False
    except Exception as e:
        logger.error(f"問題ファイルの削除中に例外が発生しました: {file_path}, error={e}")
        return False


def バックアップ実行(
    アプリ設定=None,
    backend_dir: Optional[str] = None,
    セッション設定: Optional[dict] = None,
    ログ出力: bool = True,
    コピー実行=None,
) -> Optional[Tuple[str, List[ファイル情報], List[str], bool, str]]:
    """
    シンプル差分バックアップ実行
    - 初回（*.allフォルダなし）→ 全件バックアップ
    - 2回目以降 → 最終バックアップ時刻+1秒以降の差分のみ
    - 除外後の全対象ファイルが100,000件以上 → ERRORログを残してキャンセル

    セッション設定: セッション固有のCODE_BASE_PATHを含む辞書（オプション）
    戻り値: (最終更新時刻, 全ファイル一覧[パス/更新日時], バックアップファイル一覧, 全件フラグ, バックアップフォルダ絶対パス) または None（エラー時のみ）
    """
    try:
        base_path = _コードベース絶対パス取得(アプリ設定, backend_dir=backend_dir, セッション設定=セッション設定)
        if not os.path.isdir(base_path):
            return None

        backup_root = os.path.join(base_path, ".aidiy_backup")

        # 通常は従来コピー。Tools の batch だけ受付用の内部関数を渡す。
        copy_files = コピー実行 or _ファイルコピー実行

        # 最終バックアップ時刻を取得
        最終バックアップ結果 = _バックアップ全体の最終日時取得(backup_root)

        # 全ファイル一覧を走査（パス/更新日時/更新時刻）
        all_scan = _全ファイルスキャン(base_path, 最大件数=_バックアップキャンセル件数)
        _ローカルGit記録(base_path, [f["パス"] for f in all_scan])
        if not all_scan:
            # 正常な空の対象。失敗のNoneと分け、コピー先も作らない。
            return ("", [], [], False, "")
        max_mtime = max(f["更新時刻"] for f in all_scan)
        all_files: List[ファイル情報] = [{"パス": f["パス"], "更新日時": f["更新日時"]} for f in all_scan]

        # バックアップフォルダ名を作成
        timestamp = datetime.fromtimestamp(max_mtime)
        date_dir = timestamp.strftime("%Y%m%d")
        time_dir = timestamp.strftime("%H%M%S")
        最終時刻 = timestamp.strftime("%Y-%m-%d %H:%M:%S")

        # 初回（全件バックアップ）
        if not 最終バックアップ結果:
            target_dir = os.path.abspath(os.path.join(backup_root, date_dir, f"{time_dir}.all"))
            if ログ出力:
                logger.info(f"バックアップ開始({base_path})")
            全ファイルパス一覧 = [f["パス"] for f in all_files]
            if copy_files(base_path, 全ファイルパス一覧, target_dir):
                if ログ出力:
                    logger.info(f"バックアップ終了(件数={len(all_files)})")
                return (最終時刻, all_files, 全ファイルパス一覧, True, target_dir)
            return None

        # 差分バックアップ: 最終バックアップ時刻+1秒以降
        最終タイムスタンプ, _ = 最終バックアップ結果
        最終時刻 = datetime.fromtimestamp(最終タイムスタンプ).strftime("%Y-%m-%d %H:%M:%S")
        threshold_ts = 最終タイムスタンプ + 1.0

        # 差分ファイル抽出（走査済みの更新時刻を使用）
        changed_files = [f["パス"] for f in all_scan if f["更新時刻"] >= threshold_ts]

        # 差分なし → 全ファイル一覧だけ返す
        if not changed_files:
            return (最終時刻, all_files, [], False, "")

        # 差分バックアップ作成
        target_dir = os.path.abspath(os.path.join(backup_root, date_dir, time_dir))
        if os.path.isdir(target_dir):
            return (最終時刻, all_files, [], False, target_dir)

        if ログ出力:
            logger.info(f"バックアップ開始({base_path})")
        if copy_files(base_path, changed_files, target_dir):
            if ログ出力:
                logger.info(f"バックアップ終了(件数={len(changed_files)})")
            return (最終時刻, all_files, changed_files, False, target_dir)
        return None

    except Exception as e:
        logger.error(f"バックアップ実行エラー: {e}")
        return None


def _ファイルコピー実行(base_path: str, file_list: List[str], target_dir: str) -> bool:
    """ファイルリストをtarget_dirにコピー"""
    try:
        os.makedirs(target_dir, exist_ok=True)
        targets: List[Tuple[str, str]] = []
        for rel_path in file_list:
            src_path = os.path.join(base_path, rel_path.replace("/", os.sep))
            if not os.path.exists(src_path):
                continue
            dest_path = os.path.join(target_dir, rel_path.replace("/", os.sep))
            targets.append((src_path, dest_path))

        if not targets:
            return True

        max_workers = min(_バックアップコピー並列数, len(targets))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(_単一ファイルコピー, src_path, dest_path) for src_path, dest_path in targets]
            for future in as_completed(futures):
                if not future.result():
                    return False
        return True
    except Exception as e:
        logger.error(f"ファイルコピーエラー: {e}")
        return False


def _単一ファイルコピー(src_path: str, dest_path: str) -> bool:
    try:
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        shutil.copy2(src_path, dest_path)
        return True
    except Exception as e:
        logger.error(f"ファイルコピー失敗: {src_path} -> {dest_path}, エラー: {e}")
        return False





def _最終バックアップ時刻取得(date_folder: str) -> Optional[float]:
    """
    date_folder内の全フォルダ（*.all含む）の最大時刻をタイムスタンプで返す
    """
    max_ts = 0.0
    try:
        for item in os.listdir(date_folder):
            item_path = os.path.join(date_folder, item)
            if not os.path.isdir(item_path):
                continue
            # フォルダ名から時刻を抽出（"HHMMSS", "HHMMSS.all", "HHMMSS.コメント" 等）
            time_str = item.split(".")[0]
            # 数字6桁で始まる時刻フォルダのみ処理
            if len(time_str) != 6 or not time_str.isdigit():
                continue
            # HHMMSS をタイムスタンプに変換
            hour = int(time_str[0:2])
            minute = int(time_str[2:4])
            second = int(time_str[4:6])
            # date_folderの日付を取得（最初の8桁のみ使用）
            date_str = os.path.basename(date_folder)
            if len(date_str) < 8 or not date_str[:8].isdigit():
                continue
            year = int(date_str[0:4])
            month = int(date_str[4:6])
            day = int(date_str[6:8])
            dt = datetime(year, month, day, hour, minute, second)
            # Windowsのdatetime.timestamp()は1970年初日のローカル時刻で
            # 失敗する場合があるため、ローカル時刻変換を直接使う。
            ts = time.mktime(dt.timetuple())
            if ts > max_ts:
                max_ts = ts
        return max_ts if max_ts > 0 else None
    except Exception as e:
        logger.error(f"最終バックアップ時刻取得エラー: {e}")
        return None


def _バックアップ全体の最終日時取得(backup_root: str) -> Optional[Tuple[float, str]]:
    """
    バックアップフォルダ全体から最も新しいバックアップ日時を取得
    戻り値: (タイムスタンプ, "YYYY-MM-DD HH:MM:SS") または None
    """
    max_ts = 0.0
    try:
        if not os.path.isdir(backup_root):
            return None

        for date_dir in os.listdir(backup_root):
            date_folder = os.path.join(backup_root, date_dir)
            if not os.path.isdir(date_folder):
                continue
            # 数字8桁で始まる日付フォルダのみ処理
            if len(date_dir) < 8:
                continue
            if not date_dir[:8].isdigit():
                continue

            # この日付フォルダ内の最終時刻を取得
            folder_max_ts = _最終バックアップ時刻取得(date_folder)
            if folder_max_ts and folder_max_ts > max_ts:
                max_ts = folder_max_ts

        if max_ts == 0.0:
            return None

        timestamp = datetime.fromtimestamp(max_ts)
        last_time = timestamp.strftime("%Y-%m-%d %H:%M:%S")
        return (max_ts, last_time)

    except Exception as e:
        logger.error(f"バックアップ全体の最終日時取得エラー: {e}")
        return None


def 差分ファイル取得(
    アプリ設定=None,
    backend_dir: Optional[str] = None,
    セッション設定: Optional[dict] = None,
) -> Optional[Tuple[str, List[str]]]:
    """
    バックアップフォルダから最終日時を取得し、その+1秒以降に更新されたファイル一覧を返す

    戻り値: (最終バックアップ日時, 差分ファイル一覧) または None
    """
    try:
        base_path = _コードベース絶対パス取得(アプリ設定, backend_dir=backend_dir, セッション設定=セッション設定)
        if not os.path.isdir(base_path):
            return None

        backup_root = os.path.join(base_path, ".aidiy_backup")

        # バックアップフォルダ全体から最終日時を取得
        result = _バックアップ全体の最終日時取得(backup_root)
        if not result:
            return None

        最終タイムスタンプ, 最終日時文字列 = result
        threshold_ts = 最終タイムスタンプ + 1.0

        # 全ファイルを共通走査して差分を抽出
        all_scan = _全ファイルスキャン(base_path)
        差分ファイル一覧: List[str] = [f["パス"] for f in all_scan if f["更新時刻"] >= threshold_ts]

        return (最終日時文字列, 差分ファイル一覧)

    except Exception as e:
        logger.warning(f"差分ファイル取得失敗: {e}")
        return None
