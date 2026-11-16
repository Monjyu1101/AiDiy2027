# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Use AiDiy's explicit inference-only Codex entry, never an arbitrary codex binary."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile


# Strict Responses schemas cannot express arbitrary argument objects. Encode only
# that leaf as JSON text; decode and validate against parent tool schemas later.
RESPONSE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["content", "tool_calls"],
    "properties": {"content": {"type": "string"}, "tool_calls": {
        "type": "array", "items": {"type": "object", "additionalProperties": False,
            "required": ["name", "arguments"], "properties": {
                "name": {"type": "string"}, "arguments": {"type": "string"}}}}},
}


def command(model, schema, result):
    binary = Path.home() / ".aidiy" / "bin" / ("aidiy_codex.exe" if os.name == "nt" else "aidiy_codex")
    if not binary.is_file():
        raise ValueError("Codex chatには推論専用経路を含むaidiy_codexの再コンパイルが必要です。python command_codex/_compile.py を実行してください。")
    # Do not recurse from an inference engine into another CLI harness.
    prefix = model.split("/", 1)[0]
    if prefix.endswith("_cli") or prefix.startswith("aidiy_"):
        raise ValueError("Codex chatの内側モデルにCLIを再指定できません。推論モデルを指定してください。")
    args = [str(binary), "exec", "--aidiy-inference-only", "--ephemeral",
            "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check",
            "--output-schema", str(schema), "--output-last-message", str(result), "--color", "never"]
    if model.lower() not in {"same", "auto"}:
        args += ["--model", model]
    return args + ["-"]


async def chat(request):
    if __package__:
        from .harness_chat import INSTRUCTION, LIMIT, run_process
    else:
        from harness_chat import INSTRUCTION, LIMIT, run_process
    payload = json.dumps({"messages": request["messages"], "tools": request.get("tools", []),
                          "tool_choice": request.get("tool_choice", "auto")}, ensure_ascii=False)
    prompt = (INSTRUCTION + "\nFor this transport only, encode each tool_calls arguments as a JSON object serialized into a string.\n\n" + payload).encode("utf-8")
    if len(prompt) > LIMIT:
        raise ValueError("CLI chatへの入力が大きすぎます。")
    with tempfile.TemporaryDirectory(prefix="aidiy-codex-chat-") as scratch:
        folder = Path(scratch)
        schema, result = folder / "response-schema.json", folder / "response.json"
        schema.write_text(json.dumps(RESPONSE_SCHEMA), encoding="utf-8")
        # The mandatory flag fails closed on older binaries. No fallback to external
        # codex, no permission relaxation, no copying credentials into the scratch dir.
        await run_process(command(request["model"], schema, result), prompt, scratch)
        if not result.is_file() or result.stat().st_size > LIMIT:
            raise ValueError("Codex chatの構造化応答がありません、または大きすぎます。")
        try:
            value = json.loads(result.read_text(encoding="utf-8"))
        except (UnicodeError, ValueError) as exc:
            raise ValueError("Codex chatの構造化応答が不正です。") from exc
        from jsonschema import Draft202012Validator
        if not Draft202012Validator(RESPONSE_SCHEMA).is_valid(value):
            raise ValueError("Codex chatの構造化応答がschemaに一致しません。")
        for call in value["tool_calls"]:
            try:
                arguments = json.loads(call["arguments"])
            except (ValueError, TypeError) as exc:
                raise ValueError("Codex chatのツール引数JSONが不正です。") from exc
            if not isinstance(arguments, dict):
                raise ValueError("Codex chatのツール引数はobjectが必要です。")
            call["arguments"] = arguments
        return value
