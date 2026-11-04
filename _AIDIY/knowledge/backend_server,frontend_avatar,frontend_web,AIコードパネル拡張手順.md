# AIコードパネル拡張手順

> 文書: `backend_server,frontend_avatar,frontend_web,AIコードパネル拡張手順.md` | 実装: `backend_server/AIコア/`, `frontend_avatar/src/components/AIコード.vue`

## このメモを使う場面
- Code AI パネル数を変更する
- `code1`〜`code6` / `CODE_AI1`〜`CODE_AI6` の対応を確認する
- 設定 UI、WebSocket チャンネル、Electron ウィンドウ定義の漏れを防ぐ

## 現行前提

現行は Code AI 6枠。

- パネルキー: `code1`〜`code6`
- 設定キー: `CODE_AI1_NAME`〜`CODE_AI6_NAME`、`CODE_AI1_MODEL`〜`CODE_AI6_MODEL`
- ソケット/チャンネル: `code1`〜`code6` または数値チャンネル `1`〜`6`

実装確認先:
- `backend_server/core_router/AIコア.py`
- `backend_server/AIコア/AIセッション管理.py`
- `frontend_avatar/src/AiDiy.vue`
- `frontend_web/src/components/AiDiy/AiDiy.vue`
- `frontend_avatar/electron/main.ts`
- `frontend_avatar/electron/preload.ts`

## 関連ファイル

### backend_server
- `_config/AiDiy_key.json`
- `backend_server/conf/conf_json.py`
- `backend_server/core_router/AIコア.py`
- `backend_server/AIコア/AIセッション管理.py`
- `backend_server/AIコア/AIストリーミング処理.py`
- `backend_server/AIコア/AI内部ツール.py`

### frontend_web
- `frontend_web/src/components/AiDiy/AiDiy.vue`
- `frontend_web/src/components/AiDiy/dialog/AI設定再起動.vue`
- `frontend_web/src/components/AiDiy/compornents/AIコア.vue`
- `frontend_web/src/components/AiDiy/compornents/AIチャット.vue`

### frontend_avatar
- `frontend_avatar/src/types.ts`
- `frontend_avatar/src/api/config.ts`
- `frontend_avatar/src/AiDiy.vue`
- `frontend_avatar/src/dialog/AI設定再起動.vue`
- `frontend_avatar/src/components/AIコア.vue`
- `frontend_avatar/src/components/AIチャット.vue`
- `frontend_avatar/electron/main.ts`
- `frontend_avatar/electron/preload.ts`

## 変更手順

1. `AiDiy_key.json` と `conf_json.py` の `DEFAULT_CONFIG` に `CODE_AI<N>_NAME` / `CODE_AI<N>_MODEL` を揃える
2. `conf_json.py` の auto 補完範囲を新しい最大枠まで広げる
3. `AIセッション管理.py` の初期モデル設定と正規化対象に追加する
4. `AIコア.py` の許可キー、コードチャンネル一覧、数値チャンネル一覧、processor 数チェックを更新する
5. `AIストリーミング処理.py` と `AI内部ツール.py` のチャンネル範囲を更新する
6. frontend_web の `PanelKey` / `チャットモード型` / `PANEL_KEYS` / テンプレート / 設定ダイアログを更新する
7. frontend_avatar の型、初期設定、タブ、Electron `WindowRole` / `PANEL_BOUNDS` / creation order を更新する
8. `AIチャット.vue` のラジオボタン、`AIコア.vue` のパネルボタン、設定ダイアログの選択肢を更新する

## 設定 UI の注意点

- Code AI 名と Code AI モデルは別物。`CODE_AI<N>_NAME` は CLI 種別、`CODE_AI<N>_MODEL` はそのスロットで使うモデル
- AI1 の設定を他枠へコピーする watch がある場合、対象範囲を最大枠まで更新する
- 選択肢は backend の `available_models.code_models` から作る。frontend に CLI 名を固定直書きしない
- レイアウト変更時は `code1`〜`code6` が見切れないことを Web / Electron の両方で確認する

## 注意点

- `frontend_avatar` の Web モードでは `webTabs` と右ペインタブも確認する
- Electron モードでは `electron/main.ts` と `electron/preload.ts` の `PanelKey` が漏れやすい
- `conf_json.py` の auto 補完範囲が狭いと、新規枠が `auto` のまま残る
- 現行6枠からさらに増やす場合は、CSS グリッド、画面幅、Electron ウィンドウ配置も合わせて見る

## 確認方法

```powershell
backend_server\.venv\Scripts\python.exe -m py_compile backend_server\core_router\AIコア.py
backend_server\.venv\Scripts\python.exe -m py_compile backend_server\AIコア\AIセッション管理.py
cd frontend_web
npm run type-check
cd ..\frontend_avatar
npm run type-check
```

画面では設定ダイアログに `CODE_AI1`〜`CODE_AI6` が出ること、各 `code1`〜`code6` パネルを開けること、送信先チャンネルがずれないことを確認する。
