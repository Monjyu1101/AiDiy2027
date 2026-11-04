# Slash Command 一覧

> 文書: `command_hermes,Slash Command一覧.md` | 実装: `command_hermes/hermes_cli/commands.py`, `command_hermes/cli_main.py`

## このメモを使う場面

- 特定の slash command の存在やエイリアスを確認するとき
- 新しい slash command を追加するとき
- 既存 command のカテゴリや引数を変更するとき
- TUI 調整手順の補完として command 一覧を確認するとき

## アーキテクチャ

```text
cli_main.py の process_command()
  → hermes_cli/commands.py の resolve_command(name)
    → COMMAND_REGISTRY から CommandDef を検索（正規名 + alias）
  → 正規名で分岐処理
```

`COMMAND_REGISTRY` は `CommandDef` dataclass のリストです。

主なフィールドは `name`、`description`、`category`、`aliases`、`args_hint`、`subcommands`、`cli_only`、`gateway_only` です。現在は busy 処理、共有 executor、desktop 表示などの属性もあるため、dataclass 全体を本文へ複製せずソース定義を確認します。

## 一覧の確認

実際の利用環境では `/help` と `/` 補完を確認します。CLI・Gateway・desktop で利用条件が異なり、登録済みの全コマンドがすべての画面で使えるわけではありません。

代表例:

| 目的 | コマンド |
|------|----------|
| 会話を作り直す・履歴を確認する | `/new`、`/history` |
| モデル・設定を確認する | `/model`、`/config`、`/status` |
| やり直し・分岐 | `/retry`、`/undo`、`/branch` |
| ツール・スキル | `/tools`、`/toolsets`、`/skills` |
| ヘルプ・終了 | `/help`、`/quit`（`/exit`） |

登録全体は次の読み取り専用スクリプトで確認できます（リポジトリ直下、Python 標準ライブラリのみ）。実装を import しないため、設定読込や外部接続を起こしません。

```python
import ast
from pathlib import Path

source = Path("command_hermes/hermes_cli/commands.py")
tree = ast.parse(source.read_text(encoding="utf-8"))
registry = next(node.value for node in tree.body
                if isinstance(node, ast.AnnAssign)
                and isinstance(node.target, ast.Name)
                and node.target.id == "COMMAND_REGISTRY")
def display(node):
    try:
        return ast.literal_eval(node)
    except ValueError:
        return ast.unparse(node)  # 動的説明文は式のまま表示

for entry in registry.elts:
    name, description, category = [display(arg) for arg in entry.args[:3]]
    fields = {kw.arg: display(kw.value) for kw in entry.keywords}
    print(category, "/" + name, fields.get("aliases", ()), description)
```

一覧を文書へ追加する場合も固定の総数を合否条件にせず、同じコミットの `COMMAND_REGISTRY` と照合します。

## コマンド追加手順

1. `hermes_cli/commands.py` の `COMMAND_REGISTRY` に `CommandDef` を追加し、画面別の利用条件・実行中の busy 方針を指定
2. `cli_main.py` の `process_command()`、または該当する共有 executor / Gateway handler に実処理を追加
3. 必要に応じて `_COMMAND_LOOKUP` は import 時に自動構築されるため再起動のみで反映

## 注意点

- **CLI only / Gateway only**: `cli_only` と `gateway_only` フラグで利用可能な表面を制御。両方 false なら両方で使える
- **エイリアス衝突**: `_build_command_lookup()` で全エイリアスがユニークであることを確認すること。衝突時は後の定義で上書きされる
- **サブコマンド**: `subcommands` はタブ補完用のヒント。実際の処理は `process_command()` で引数パースして分岐
