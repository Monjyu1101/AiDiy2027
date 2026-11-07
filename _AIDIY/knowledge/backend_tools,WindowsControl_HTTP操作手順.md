# aidiy_windows_control の HTTP 操作手順

> 文書: `backend_tools,WindowsControl_HTTP操作手順.md` | 実装: `backend_tools/tools_proc/tools_windows_control.py`, `backend_tools/tools_proc/windows_control.py`, `backend_tools/tools_proc/desktop_capture.py`

## このメモを使う場面

- Computer Use（`mcp__computer-use__*`）を使えない、またはアプリ名を解決できない（Electron アプリなど）ときに、Windows のデスクトップ画面を操作する。
- MCP の SSE が未接続でも、Tools（8095）が起動していれば HTTP で同じ機能を使う。
- Diag など Electron 画面のボタンを、スクリーンショットと座標クリックで押す。

## 前提

- Windows 専用。Tools（`127.0.0.1:8095`）が起動していること。確認は `GET http://127.0.0.1:8095/aidiy_windows_control/ping` が `{"status":"ok",...}` を返すこと。
- MCP が `ECONNREFUSED` で未接続でも、原因が Tools 未起動ならこの HTTP と同じ状態である。Tools を起動すれば MCP と HTTP の両方が使える。
- 操作対象は実際のデスクトップ。マウス・キーボード操作は、いま前面にあるウィンドウへそのまま届く。

## HTTP の呼び出し

| 用途 | エンドポイント |
|------|----------------|
| 操作 | `POST /aidiy_windows_control/{method_name}`（JSON ボディ。引数は `WindowsControlRequest` のキー） |
| メソッド一覧・注意 | `GET /aidiy_windows_control/docs` |
| スクリーンショット | `POST /aidiy_desktop_capture/screenshot` |

主なメソッド: `list_windows` / `focus_window` / `mouse_click` / `mouse_move` / `mouse_drag` / `mouse_scroll` / `keyboard_type` / `keyboard_key` / `keyboard_shortcut` / `set_clipboard_text` / `get_clipboard_text` / `ui_snapshot` / `ui_click` / `ui_type` / `launch_app` / `kill_process` ほか。必須引数が欠けても 500 にはならず `{"error": "..."}` が返る。

### 日本語を含むボディは Python で送る

Git Bash の `curl -d '{"window_title":"AiDiy 診断"}'` は文字コードが崩れ、`{"detail":"There was an error parsing the body"}` になる（2026-11-06 に確認）。日本語のウィンドウ名や文字列は、UTF-8 のバイト列として送る。システム Python には `requests` が無い場合があるため、標準ライブラリの `urllib` を使う。

```python
import json, urllib.request

def post(path, **kw):
    req = urllib.request.Request(
        "http://127.0.0.1:8095/" + path,
        data=json.dumps(kw, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

post("aidiy_windows_control/focus_window", window_title="AiDiy 診断")
```

英数字だけの引数（`list_windows` など）なら `curl -X POST -H 'Content-Type: application/json' -d '{}'` でよい。

## 画面を操作する基本の流れ

1. `list_windows` で対象を探す。`hwnd` / `pid` / `title` が返る。`rect` は `None` のことがあるため、位置は次の手順で得る。
2. `focus_window`（`window_title` は部分一致、または `hwnd`）で最前面にする。
3. `ui_snapshot` を試す。標準的なアプリはボタン名と座標つきの要素一覧が返るので、`ui_click` / `ui_type` を使う。`element_id` は直前の `ui_snapshot` の直後だけ有効で、使う前に毎回取り直す。
4. 要素が取れなければ、スクリーンショットを撮って画像上の座標を決め、`mouse_click` で押す。
5. 押した後はスクリーンショットで結果を確認する。クリック直後は描画待ちのため、1 秒ほど待ってから撮る。

### Electron アプリは UI Automation に出ない

Diag など Electron 画面の中身（Web 部分）は、`ui_snapshot` でウィンドウ枠や `Chrome_RenderWidgetHostHWND` までしか取れず、ボタンや文字は出ない（Diag で 11 要素のみ）。この場合は手順 4 のスクリーンショット + 座標クリックを使う。

### スクリーンショットと座標

- `window_title` 指定のキャプチャは、そのウィンドウの矩形領域を画面から撮る。別ウィンドウが上に重なっていると、重なったものが写る（Diag の上の Chrome ログイン画面が写った）。必ず `focus_window` の後に撮る。
- 画像を読むには `save_path` に保存してから `Read` で開く。`save_path` を指定すると base64 は返らない。
- 画面座標 = ウィンドウ左上の座標 + 画像内の座標。ウィンドウ左上は、`ui_snapshot` の先頭要素（`WindowControl`）の `x` / `y` から得る。画像の幅と `width` が一致していれば 1:1 で、拡大率は考慮不要（2026-11-06 の環境で一致を確認）。一致しなければ拡大率で換算する。
- 座標はウィンドウの位置・大きさ・タブ内容で変わる。毎回、直前のスクリーンショットから決め、固定座標を別の機会へ持ち越さない。

## 練習例: Diag の「システム起動」タブを開く

```python
post("aidiy_windows_control/focus_window", window_title="AiDiy 診断")
post("aidiy_windows_control/mouse_click", x=944, y=178)   # ウィンドウ左上 (90,90) + 画像上 (854,88)
post("aidiy_desktop_capture/screenshot", window_title="AiDiy 診断",
     save_path=r"C:\...\temp\wc_practice\diag.png")
```

結果は画像で確認し、タブが切り替わっていることを見てから次の操作へ進む。

## Diag の一括起動

- Diag 画面の「システム起動」タブで、全機能が停止中のときに右上の「一括起動」を押す。稼働中の機能があるときは同じ位置が「強制停止」になる。
- 画面操作を使わない場合は `aidiy_diag --auto`（`node backend_diag/diag_main.mjs --auto`）で、保存済みの起動設定（`_config/AiDiy_diag_start.json` の「起動対象」）をもとに「設定起動」を自動実行する。
- Diag がすでに起動中だと、`--auto` を付けても既存ウィンドウを前面に出すだけで一括起動は実行されない。`--auto` で起動したい場合は、いったん Diag を終了して起動し直す。
- 起動後の確認は `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:{8090,8091,8093,8095,8098}/` が 200 を返すこと。`netstat` では IPv6 側の待ち受けが拾えず、起動済みでも一部のポートが出ないことがある（HTTP 応答を正とする）。

## 注意

- `kill_process` / `set_window_state`（`close`）は、実行中のアプリを実際に終了する。対象の `pid` / タイトルを `list_windows` で確認してから実行し、ユーザーの作業中のウィンドウを閉じない。
- パスワードなどの秘密情報を `keyboard_type` / `set_clipboard_text` に渡さない。操作の記録・スクリーンショットにも残る。
- 日本語の文字入力は、`keyboard_type` が IME でローマ字変換されることがあるため、`set_clipboard_text` + `keyboard_shortcut(["ctrl","v"])` を使う。
- 練習用のスクリーンショットは `temp/wc_practice/` に置く。成果物ではないためコミット対象にしない。

## 関連

- メディア生成など他の HTTP API は [HTTP API の save_path 挙動](./backend_tools,HTTP_API_save_path挙動.md)。
- MCP の使い分けと SSE 接続は [MCP活用手順](./backend_server,backend_tools,MCP活用手順.md)、[MCP_SSE接続](./command_hermes,backend_tools,MCP_SSE接続.md)。
- Diag 画面の操作と診断は [環境診断運用](./backend_diag,環境診断運用.md)。
