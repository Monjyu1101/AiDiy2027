# -*- coding: utf-8 -*-
"""Task/Team ワーカーの内部 HTTP。資格情報は要求ごとに読み、外部へ転送しない。"""
from __future__ import annotations

import json
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOKEN_FILE = PROJECT_ROOT / "_AIDIY/backend_taskteam/internal_auth.json"


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_HTTP = build_opener(ProxyHandler({}), _NoRedirect())


def _needs_token(url: str) -> bool:
    parts = urlsplit(url)
    path = unquote(parts.path)
    taskteam = path == "/task_check_okng" or path.startswith(("/task/", "/team/"))
    if not taskteam:
        return False
    # 配置された同一マシンのサービスだけ。環境変数で外部 URL を指定しても資格情報を渡さない。
    if (parts.scheme != "http" or parts.hostname not in ("127.0.0.1", "localhost", "::1")
            or parts.port != 8093
            or parts.username is not None or parts.password is not None
            or parts.query or parts.fragment or "\\" in path
            or any(segment in (".", "..") for segment in path.split("/"))):
        raise RuntimeError("内部認証の送信先が許可されていません")
    return True


def _read_token() -> str:
    try:
        if any(path.is_symlink() for path in (TOKEN_FILE, TOKEN_FILE.parent, TOKEN_FILE.parent.parent)):
            raise ValueError("symlink")
        payload = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
        token = payload.get("access_token")
        if (payload.get("token_type") != "bearer" or not isinstance(token, str)
                or not token or len(token) > 16384 or any(c.isspace() for c in token)):
            raise ValueError("format")
        return token
    except (OSError, ValueError, AttributeError):
        # JSON 断片・例外本文には資格情報が入る可能性がある。
        raise RuntimeError("TaskTeam 内部認証を取得できません。TaskTeam の起動を確認してください") from None


def post_json(url: str, payload: dict, timeout: int = 600) -> dict:
    protected = _needs_token(url)
    parts = urlsplit(url)
    # Task/Team の設定由来の相対プロジェクトは _config 基準。
    # Tools の絶対パス検証へ渡す前に解決し、呼出元の辞書やDBの値は変更しない。
    if (parts.scheme == "http" and parts.hostname in ("127.0.0.1", "localhost", "::1")
            and parts.port == 8095 and parts.path in
            ("/aidiy_code_agents/run", "/aidiy_task_agents/submit")
            and payload.get("project_path")):
        project = Path(str(payload["project_path"]))
        if not project.is_absolute():
            project = PROJECT_ROOT / "_config" / project
        payload = {**payload, "project_path": str(project.resolve())}
    encoded_url = urlunsplit((parts.scheme, "127.0.0.1:8093" if protected else parts.netloc,
                             quote(parts.path, safe="/%"), parts.query, parts.fragment))
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    for attempt in range(2 if protected else 1):
        headers = {"Content-Type": "application/json; charset=utf-8"}
        if protected:
            headers["Authorization"] = "Bearer " + _read_token()
        request = Request(encoded_url, data=data, headers=headers, method="POST")
        try:
            with _HTTP.open(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            status = exc.code
            exc.close()
            if protected and status == 401 and attempt == 0:
                continue  # 日付更新 / 再起動直後は原子的に置換されたファイルを再読込する。
            raise RuntimeError(f"内部 API HTTP {status}") from None
        except (URLError, OSError, ValueError):
            raise RuntimeError("内部 API に接続できないか、応答形式が不正です") from None
    raise RuntimeError("TaskTeam 内部認証に失敗しました")


def report_instruction() -> str:
    helper = Path(__file__).resolve()
    return (
        "\n【TaskTeam 内部認証】今回の要求で TaskTeam API を使う必要がある場合だけ、次の認証ヘルパーを使ってください。"
        "これは追加作業の依頼ではなく、元の作業範囲・読み取り専用等の制約は変わりません。\n"
        "資格情報を表示したり、プロンプト・ログ・コマンド引数へ埋め込んではいけません。\n"
        f"Python 実行環境で {str(helper)!r} を --post '/task/タスク要求/停止検査' のように起動し、"
        "指示された Body の JSON を標準入力へ渡してください。パスは目的の /task/... または /team/... に置き換えます。\n"
        "task_check_okng の報告は同じヘルパーの --check-report を使い、指定されたタスクID・SEQ・状態・メッセージの JSON を標準入力へ渡してください。\n"
        "ヘルパーが _AIDIY/backend_taskteam/internal_auth.json を要求ごとに読み、"
        "Authorization: Bearer を付けます。401 は一度だけ再読込します。"
        "資格情報ファイルの内容を応答へ含めず、API の処理結果だけ確認してください。\n"
    )


def main(argv=None, *, stdin=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    stdin = sys.stdin if stdin is None else stdin
    if argv == ["--check-report"]:
        path = "/task_check_okng"
    elif len(argv) == 2 and argv[0] == "--post":
        path = argv[1]
        parts = urlsplit(path)
        if (parts.scheme or parts.netloc or parts.query or parts.fragment
                or not path.startswith(("/task/", "/team/"))):
            raise ValueError("TaskTeam POST path required")
    else:
        raise ValueError("Usage: internal_client.py --post /task/... < request.json")
    payload = json.load(stdin)
    if not isinstance(payload, dict):
        raise ValueError("JSON object required")
    result = post_json("http://127.0.0.1:8093" + path, payload, timeout=60)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") == "OK" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError):
        raise SystemExit("TaskTeam 呼出しに失敗しました。内部認証・API パス・入力 JSON を確認してください") from None
