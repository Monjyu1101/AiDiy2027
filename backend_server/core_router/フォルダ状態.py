# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""読み取り専用のフォルダ状態。IDEと同じ除外規則を使い、内容は読み込まない。"""
import hashlib
import json
import os
import stat
import re
from pathlib import Path
import threading
import time
from collections import OrderedDict

規則 = json.loads(Path(__file__).with_name("フォルダ除外規則.json").read_text(encoding="utf-8"))
常時除外 = {name.lower() for name in 規則["ignored"]}
予約名 = {"con", "prn", "aux", "nul", "null", *[f"com{i}" for i in range(1, 10)], *[f"lpt{i}" for i in range(1, 10)]}
ロック = threading.Lock()
キャッシュ = OrderedDict()


def フォルダ許可(名前, 相対, フィルター):
    if 名前.rstrip(". ").lower() in 常時除外:
        return False
    if フィルター != "backup":
        return True
    return (名前 not in 規則["backupDirectories"] and not 名前.startswith(".")
            and not any("/" + p + "/" in "/" + 相対.strip("/") + "/" for p in 規則["backupPaths"]))


def ファイル許可(名前, フィルター):
    正規名 = 名前.split(":", 1)[0].rstrip(". ")
    if re.fullmatch(r"(?:internal_auth(?:_keys)?\.json|\.internal_auth(?:_keys)?\.json\..+\.tmp)", 正規名, re.IGNORECASE):
        return False
    return フィルター != "backup" or (名前 not in 規則["backupFiles"]
        and not 名前.startswith("~$") and not any(名前.endswith(e) for e in 規則["backupExtensions"])
        and 名前.rsplit(".", 1)[0].lower() not in 予約名)


def 対象解決(ルート, フォルダ, フィルター):
    root = Path(ルート).resolve(strict=True)
    if not root.is_dir() or len(フォルダ) > 4096 or "\\" in フォルダ or "\0" in フォルダ:
        raise ValueError("許可されたフォルダを指定してください")
    parts = フォルダ.split("/") if フォルダ else []
    current = root
    for part in parts:
        if part in ("", ".", "..") or ":" in part:
            raise ValueError("許可されたフォルダを指定してください")
        current /= part
        if not フォルダ許可(part, current.as_posix(), フィルター):
            raise ValueError("許可されたフォルダを指定してください")
        if current.is_symlink() or current.is_junction():
            raise ValueError("リンク先は参照できません")
        if not current.resolve(strict=True).is_relative_to(root) or not current.is_dir():
            raise ValueError("許可されたフォルダを指定してください")
    return root, current


def 状態走査(ルート, フォルダ="", フィルター="backup", *, max_files=100000, max_entries=200000, max_directories=10000, max_depth=128, time_ms=10000):
    root, target = 対象解決(ルート, フォルダ, フィルター)
    start = time.monotonic()
    records, file_list, files, directories, entries, latest = [], [], 0, 0, 0, None
    reason = None
    def walk(folder, depth):
        nonlocal files, directories, entries, latest, reason
        if reason: return
        if depth > max_depth: reason = "depth"; return
        if directories >= max_directories: reason = "directories"; return
        directories += 1
        records.append([folder.relative_to(root).as_posix(), "dir"])
        try:
            if folder.is_symlink() or folder.is_junction() or not folder.resolve(strict=True).is_relative_to(root):
                reason = "unreadable"; return
            with os.scandir(folder) as items:
                for item in items:
                    if reason: break
                    if (time.monotonic() - start) * 1000 >= time_ms: reason = "time"; break
                    if entries >= max_entries: reason = "entries"; break
                    entries += 1
                    path = Path(item.path)
                    if item.is_symlink() or path.is_junction(): continue
                    if item.is_dir(follow_symlinks=False):
                        if フォルダ許可(item.name, path.as_posix(), フィルター): walk(path, depth + 1)
                    elif item.is_file(follow_symlinks=False) and ファイル許可(item.name, フィルター):
                        if files >= max_files: reason = "files"; break
                        info = os.lstat(path)
                        if not stat.S_ISREG(info.st_mode):
                            reason = "unreadable"; break
                        files += 1
                        modified = round(info.st_mtime_ns / 1000000)
                        latest = modified if latest is None else max(latest, modified)
                        file_list.append({"パス": path.relative_to(root).as_posix(), "名前": item.name, "サイズ": info.st_size, "更新日時": round(info.st_mtime_ns / 1000000)})
                        records.append([path.relative_to(root).as_posix(), info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_ino])
        except OSError:
            reason = "unreadable"
    walk(target, 0)
    return {"フォルダ": フォルダ, "範囲": "再帰", "ファイル数": files, "フォルダ数": directories,
            "最終更新日時": latest, "ファイル一覧": sorted(file_list, key=lambda item: [int(p) if p.isdigit() else p.casefold() for p in re.split(r"(\d+)", item["パス"])]), "変更識別子": hashlib.sha256(json.dumps(sorted(records), ensure_ascii=False).encode()).hexdigest(),
            "不完全": reason is not None, "制限理由": reason, "走査時間ms": round((time.monotonic()-start)*1000)}


def フォルダ状態取得(ルート, フォルダ="", フィルター="backup"):
    # 認証後に呼ぶ。全利用者を通じ同時走査は1本、キャッシュは最大32フォルダ・2秒。
    root, _ = 対象解決(ルート, フォルダ, フィルター)
    key = (str(root), フォルダ, フィルター)
    if not ロック.acquire(blocking=False):
        raise BlockingIOError("フォルダを確認中です")
    try:
        cached = キャッシュ.get(key)
        if cached and time.monotonic()-cached[0] < 2: return cached[1]
        result = 状態走査(root, フォルダ, フィルター, max_files=100000 if フィルター == "backup" else 30000)
        キャッシュ[key] = (time.monotonic(), result)
        キャッシュ.move_to_end(key)
        while len(キャッシュ) > 32: キャッシュ.popitem(last=False)
        return result
    finally:
        ロック.release()
