# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
Gemma function calling（tool_call）パーサ

Gemma 3/4 のチャットテンプレートは、ツール呼び出しを次の独自フォーマットで出力する:

    <|tool_call>call:FUNCTION_NAME{key:value,key:value}<tool_call|>

引数値（format_argument, escape_keys=False）の文法:
    string  : <|"|>...<|"|>
    boolean : true / false
    object  : {key:value,...}   （key は bare）
    array   : [v,v,...]
    number  : 生のトークン（123 / 1.5 など）

この値部分を Python オブジェクトへ再帰的にパースし、OpenAI ChatCompletion の
tool_calls 形式（function.arguments は JSON 文字列）へ変換する。
"""

import json
import re
import uuid
from typing import Any

_QUOTE = '<|"|>'  # Gemma の文字列クォートトークン
_CALL_RE = re.compile(r"call:([^\{]+)\{(.*)\}\s*$", re.DOTALL)


class _ArgParser:
    """Gemma 引数フォーマットの再帰下降パーサ。"""

    def __init__(self, text: str):
        self.s = text
        self.i = 0
        self.n = len(text)

    def _skip_ws(self) -> None:
        while self.i < self.n and self.s[self.i] in " \t\r\n":
            self.i += 1

    def parse_object_body(self) -> dict:
        """`{` と `}` の中身（key:value,... ）をパースする。"""
        obj: dict[str, Any] = {}
        self._skip_ws()
        if self.i >= self.n:
            return obj
        while self.i < self.n:
            self._skip_ws()
            if self.i < self.n and self.s[self.i] == "}":
                self.i += 1
                break
            key = self._parse_key()
            self._skip_ws()
            if self.i < self.n and self.s[self.i] == ":":
                self.i += 1
            value = self._parse_value()
            obj[key] = value
            self._skip_ws()
            if self.i < self.n and self.s[self.i] == ",":
                self.i += 1
                continue
            if self.i < self.n and self.s[self.i] == "}":
                self.i += 1
                break
            if self.i >= self.n:
                break
        return obj

    def _parse_key(self) -> str:
        # key は bare（escape_keys=False）だが、念のため <|"|> 囲みも許容する
        self._skip_ws()
        if self.s.startswith(_QUOTE, self.i):
            return self._parse_quoted_string()
        start = self.i
        while self.i < self.n and self.s[self.i] not in ":,}":
            self.i += 1
        return self.s[start:self.i].strip()

    def _parse_value(self) -> Any:
        self._skip_ws()
        if self.i >= self.n:
            return None
        ch = self.s[self.i]
        if self.s.startswith(_QUOTE, self.i):
            return self._parse_quoted_string()
        if ch == "{":
            self.i += 1
            return self.parse_object_body()
        if ch == "[":
            return self._parse_array()
        # bare token: 次の区切り（, } ]）まで
        start = self.i
        while self.i < self.n and self.s[self.i] not in ",}]":
            self.i += 1
        token = self.s[start:self.i].strip()
        return self._coerce_scalar(token)

    def _parse_quoted_string(self) -> str:
        # 先頭の <|"|> を消費し、次の <|"|> までを文字列とする
        self.i += len(_QUOTE)
        end = self.s.find(_QUOTE, self.i)
        if end == -1:
            val = self.s[self.i:]
            self.i = self.n
            return val
        val = self.s[self.i:end]
        self.i = end + len(_QUOTE)
        return val

    def _parse_array(self) -> list:
        arr: list[Any] = []
        self.i += 1  # consume '['
        self._skip_ws()
        while self.i < self.n:
            self._skip_ws()
            if self.i < self.n and self.s[self.i] == "]":
                self.i += 1
                break
            arr.append(self._parse_value())
            self._skip_ws()
            if self.i < self.n and self.s[self.i] == ",":
                self.i += 1
                continue
            if self.i < self.n and self.s[self.i] == "]":
                self.i += 1
                break
            if self.i >= self.n:
                break
        return arr

    @staticmethod
    def _coerce_scalar(token: str) -> Any:
        if token == "" or token.lower() == "null" or token.lower() == "none":
            return None
        if token == "true":
            return True
        if token == "false":
            return False
        try:
            if re.fullmatch(r"-?\d+", token):
                return int(token)
            return float(token)
        except ValueError:
            return token


def parse_tool_calls(raw_text: str) -> list[dict]:
    """skip_special_tokens=False でデコードした生成テキストから tool_calls を抽出する。

    `<|tool_call>call:NAME{ARGS}<tool_call|>` 形式を全て拾い、
    OpenAI ChatCompletion の tool_calls（list[dict]）へ変換して返す。
    """
    tool_calls: list[dict] = []
    # <|tool_call> ... <tool_call|> ブロックを抽出
    for m in re.finditer(r"<\|tool_call>(.*?)<tool_call\|>", raw_text, re.DOTALL):
        inner = m.group(1).strip()
        cm = _CALL_RE.match(inner)
        if not cm:
            continue
        name = cm.group(1).strip()
        args_body = cm.group(2)
        try:
            args = _ArgParser(args_body).parse_object_body()
        except Exception:
            args = {}
        tool_calls.append({
            "id": f"call_{uuid.uuid4().hex[:24]}",
            "type": "function",
            "function": {
                "name": name,
                "arguments": json.dumps(args, ensure_ascii=False),
            },
        })
    return tool_calls
