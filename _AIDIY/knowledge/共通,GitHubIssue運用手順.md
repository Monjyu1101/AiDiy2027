# GitHub Issue 運用手順

> 文書: `共通,GitHubIssue運用手順.md` | 参照: GitHub Issue と対象機能の現行ソース

## このメモを使う場面

- GitHub issue の内容を確認し、ローカル実装と突き合わせる。
- 作者権限で issue にコメントして close する。
- `gh` コマンドが使えない環境で GitHub REST API を使う。

## issue の確認

1. issue 本文、期待動作、最新コメントを読む。
2. 関連キーワードを `rg` で検索する。
3. 該当ファイルは UTF-8 指定で読む。
4. 現行実装を正とするのか、issue 文面を厳密に満たすのかを明確にする。
5. close 前に、なぜ close するのかをコメントで残す。

例:

```powershell
rg -n "<関連キーワード>" .
Get-Content -Encoding UTF8 <file>
```

## REST API で close する判断

`gh` コマンドがない環境では PowerShell + GitHub REST API を使う。
token や credential の実値はドキュメントやソースに残さない。

前提:

- Windows Credential Manager に GitHub 認証情報が保存されている。
- 対象 credential の例: `GitHub - https://api.github.com/<GitHubユーザー名>`。
- `CredentialBlob` は UTF-8 で読む。Unicode 解釈では `401 Unauthorized` になる場合がある。

## close 手順

1. Windows Credential Manager から `CredReadW` で GitHub credential を取得する。
2. `CredentialBlob` を UTF-8 でデコードして token を得る。
3. コメント追加 API を呼ぶ。
   - `POST https://api.github.com/repos/monjyu1101/AiDiy2027/issues/<番号>/comments`
4. issue close API を呼ぶ。
   - `PATCH https://api.github.com/repos/monjyu1101/AiDiy2027/issues/<番号>`
5. `Authorization: Bearer <token>` を付与する。
6. `PATCH` body は `{"state":"closed"}` とする。

## 注意点

- issue close は実装確認後に行う。
- credential の取得コードや token 値をナレッジへ貼らない。
- API 応答が `401` の場合は token の読み取りエンコーディングと権限を確認する。
- close 済み issue の番号や一度限りの作業履歴は残さない。
