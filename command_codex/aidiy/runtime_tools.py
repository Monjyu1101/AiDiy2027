# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under AiDiy 公開利用ライセンス v1.1. See LICENSE.
"""Windows の Code Mode ホストを本体と同じ版の公式 npm 配布から配置する。"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import tempfile
import urllib.request

ORIGIN = "https://registry.npmjs.org/"
HOST = "codex-code-mode-host.exe"


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith(ORIGIN):
            raise RuntimeError("公式 npm レジストリ以外への転送を拒否しました。")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def install_windows_host(install_dir, cache_dir, version, target, source_root):
    """MSVC 開発環境は不要。ホストだけ公式バイナリを使い、本体は gnullvm でコンパイルする。"""
    arch = {"x86_64-pc-windows-gnullvm": "x64", "aarch64-pc-windows-gnullvm": "arm64"}.get(target)
    if not arch or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Code Mode ホストの版またはターゲットが不正です。")
    install_dir, cache_dir = Path(install_dir), Path(cache_dir)
    output = install_dir / HOST
    receipt = install_dir / "aidiy_codex_runtime.json"
    tag = f"{version}-win32-{arch}"
    licenses = [(Path(source_root) / name, install_dir / f"aidiy_codex_runtime_{name}") for name in ("LICENSE", "NOTICE")]
    try:
        saved = json.loads(receipt.read_text(encoding="utf-8"))
        if saved.get("package") == tag and output.is_file() and saved.get("sha256") == sha256(output) and all(dst.is_file() for _, dst in licenses):
            print(f"[INFO] Code Mode ホストは配置済みです: {output} ({version})")
            return output
    except (OSError, ValueError, AttributeError):
        pass

    opener = urllib.request.build_opener(OfficialRedirect())
    with opener.open(ORIGIN + "@openai%2fcodex/" + tag, timeout=60) as response:
        metadata = json.loads(response.read(1024 * 1024))
    url = ORIGIN + "@openai/codex/-/codex-" + tag + ".tgz"
    if metadata.get("name") != "@openai/codex" or metadata.get("version") != tag or metadata.get("dist", {}).get("tarball") != url:
        raise RuntimeError("Code Mode ホストの公式配布情報が一致しません。")
    integrity = metadata["dist"].get("integrity", "")
    if not re.fullmatch(r"sha512-[A-Za-z0-9+/]{86}==", integrity):
        raise RuntimeError("Code Mode ホストの SHA-512 を確認できません。")
    install_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / f"runtime-{tag}.tgz"

    def verified(path):
        if not path.is_file():
            return False
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha512").digest()
        return "sha512-" + base64.b64encode(digest).decode("ascii") == integrity

    with tempfile.TemporaryDirectory(prefix="runtime-", dir=cache_dir) as work:
        if not verified(archive):
            print(f"[INFO] 公式 Code Mode ホスト {version} ({arch}) をダウンロードします。")
            download = Path(work) / "package.tgz"
            with opener.open(url, timeout=60) as response, download.open("wb") as stream:
                shutil.copyfileobj(response, stream)
            if not verified(download):
                raise RuntimeError("Code Mode ホスト配布物の SHA-512 が一致しません。")
            os.replace(download, archive)
        triple = target.replace("gnullvm", "msvc")
        with tarfile.open(archive, "r:gz") as package:
            member = package.getmember(f"package/vendor/{triple}/bin/{HOST}")
            if not member.isfile():
                raise RuntimeError("Code Mode ホストが通常ファイルではありません。")
            # 固定メンバーだけを読み、アーカイブのパスで展開しない。
            with tempfile.NamedTemporaryFile(dir=install_dir, prefix=HOST + ".", suffix=".tmp", delete=False) as stream:
                staged = Path(stream.name)
                try:
                    with package.extractfile(member) as source:
                        shutil.copyfileobj(source, stream)
                except BaseException:
                    stream.close()
                    staged.unlink(missing_ok=True)
                    raise
        try:
            for src, dst in licenses:
                shutil.copy2(src, dst)
            os.replace(staged, output)
        finally:
            staged.unlink(missing_ok=True)
        record = {"package": tag, "source": url, "integrity": integrity, "sha256": sha256(output)}
        staged_receipt = Path(work) / "receipt.json"
        staged_receipt.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        # cache と bin は同じ ~/.aidiy 配下。
        os.replace(staged_receipt, receipt)
    print(f"[OK] Code Mode ホストを配置しました: {output} ({version})")
    return output
