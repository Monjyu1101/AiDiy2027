# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""外部 CLI のセッション限定権限。利用者の設定ファイルを書き換えない。"""
import json


def antigravity読取専用設定() -> str:
    # --settings はセッション限定。deny は通常の許可・plan モードより優先される。
    return json.dumps({
        "agentMode": "plan", "toolPermission": "request-review",
        "permissions": {
            "allow": ["read_file(*)"], "ask": [],
            "deny": ["write_file(*)", "command(*)", "mcp(*)", "read_url(*)", "execute_url(*)"],
        },
    }, ensure_ascii=False)


def opencode読取専用設定() -> dict:
    # OpenCode V2: policy は agent 個別の許可と過去の承認より優先する。
    reads = ["read", "grep", "glob", "external_directory"]
    return {
        "permissions": [{"action": "*", "resource": "*", "effect": "deny"}]
        + [{"action": action, "resource": "*", "effect": "allow"} for action in reads],
        "policies": [{"action": "tool.use", "resource": "*", "effect": "deny"}]
        + [{"action": "tool.use", "resource": action + ":*", "effect": "allow"} for action in reads]
        + [{"action": action, "resource": "*", "effect": "deny"}
           for action in ["mcp.use", "plugin.use", "skill.use", "websearch.use"]],
        "subagent_depth": 0,
    }


def CLI実行環境(env: dict, provider: str, read_only: bool) -> dict:
    result = dict(env)
    if provider == "opencode_cli" and read_only:
        # 既存の provider 設定などは維持し、制約だけを最後に追加する。
        config = json.loads(result.get("OPENCODE_CONFIG_CONTENT") or "{}")
        if not isinstance(config, dict):
            raise ValueError("OPENCODE_CONFIG_CONTENT は JSON object が必要です。")
        readonly = opencode読取専用設定()
        for key in ("permissions", "policies"):
            existing = config.get(key, [])
            if not isinstance(existing, list):
                raise ValueError(f"OpenCode V2 の {key} は配列が必要です。")
            config[key] = existing + readonly[key]
        config["subagent_depth"] = 0
        result["OPENCODE_CONFIG_CONTENT"] = json.dumps(config, ensure_ascii=False)
        result["OPENCODE_DISABLE_AUTOUPDATE"] = "1"
        result["OPENCODE_DISABLE_PROJECT_CONFIG"] = "1"
    return result
