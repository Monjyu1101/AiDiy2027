# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under AiDiy 公開利用ライセンス v1.1. See LICENSE.
"""compile 専用の開発ツール導入。既存ツールを置換せず、sudo を使用しない。"""
import hashlib
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile
import urllib.request

RUSTUP_VERSION = "1.29.3"
STATIC_ORIGIN = "https://static.rust-lang.org/"


def rust_host(system=None, machine=None):
    system = system or platform.system()
    machine = (machine or platform.machine()).lower()
    arch = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}.get(machine)
    suffix = {"Linux": "unknown-linux-gnu", "Darwin": "apple-darwin"}.get(system)
    if not arch or not suffix:
        raise RuntimeError("この OS / CPU の Rust 自動導入は未対応です。公式 rustup で導入してください。")
    if system == "Linux" and platform.libc_ver()[0] != "glibc":
        raise RuntimeError("glibc 以外の Linux は公式手順で Rust を導入してください。")
    return f"{arch}-{suffix}"


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith(STATIC_ORIGIN):
            raise RuntimeError("公式 Rust 配布先以外への転送を拒否しました。")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_verified(url, destination):
    """固定版の公式 HTTPS 配布物と SHA-256 を照合。未検証のプログラムは実行しない。"""
    if not url.startswith(STATIC_ORIGIN):
        raise RuntimeError("公式 Rust 配布 URL ではありません。")
    opener = urllib.request.build_opener(OfficialRedirect())
    with opener.open(url + ".sha256", timeout=60) as response:
        metadata = response.read(1025).decode("ascii").strip()
    digest = metadata.split()[0] if metadata else ""
    if not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
        raise RuntimeError("Rust 配布物の SHA-256 を確認できません。")
    hasher = hashlib.sha256()
    size = 0
    with opener.open(url, timeout=60) as response, destination.open("xb") as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > 100 * 1024 * 1024:
                raise RuntimeError("Rust インストーラーのサイズ上限を超えました。")
            hasher.update(chunk)
            output.write(chunk)
    if hasher.hexdigest().lower() != digest.lower():
        raise RuntimeError("Rust 配布物の SHA-256 が一致しません。実行しません。")


def tool_environment():
    # 資格情報やAPIキーをインストーラーへ渡さない。rustupの非公式mirror指定も継承しない。
    keys = {"PATH", "HOME", "USERPROFILE", "TMPDIR", "TEMP", "TMP", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY", "LANG", "LC_ALL"}
    return {**{k: v for k, v in os.environ.items() if k in keys}, "RUSTUP_INIT_SKIP_PATH_CHECK": "yes"}


def install_unix_rust():
    if os.environ.get("CARGO_HOME") or os.environ.get("RUSTUP_HOME"):
        raise RuntimeError("CARGO_HOME / RUSTUP_HOME 指定時は自動導入しません。既存の管理方法で Rust を導入してください。")
    home = Path.home()
    # 部分導入も保護し、勝手な上書き・修復はしない。
    for directory in (home / ".cargo", home / ".rustup"):
        if directory.is_symlink() or directory.exists():
            raise RuntimeError(f"{directory.name} が既にあります。自動上書きせず、Rust の状態を確認してください。")
    host = rust_host()
    url = f"{STATIC_ORIGIN}rustup/archive/{RUSTUP_VERSION}/{host}/rustup-init"
    print(f"[INFO] 公式 rustup {RUSTUP_VERSION} を導入します（管理者権限不要、既存 PATH は変更しません）。")
    with tempfile.TemporaryDirectory(prefix="aidiy-rustup-") as temporary:
        installer = Path(temporary) / "rustup-init"
        download_verified(url, installer)
        installer.chmod(0o700)
        subprocess.run([str(installer), "-y", "--no-modify-path", "--default-host", host,
                        "--default-toolchain", "none", "--profile", "minimal"],
                       cwd=temporary, env=tool_environment(), check=True, timeout=1800)
    if not (home / ".cargo/bin/cargo").is_file() or not (home / ".cargo/bin/rustup").is_file():
        raise RuntimeError("rustup 終了後に cargo / rustup を確認できません。")


def install_windows_tool(tool):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Windows 自動導入には Node.js が必要です。AiDiy の setup を先に実行してください。")
    # Node 側で個々の処理の期限・子プロセスツリー停止・排他解除を管理する。
    # 外側だけを timeout で kill すると rustup 等が孤児化するので、終了確認まで待つ。
    subprocess.run([node, str(Path(__file__).with_suffix(".mjs")), tool], check=True)
