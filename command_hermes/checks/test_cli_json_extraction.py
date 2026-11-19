# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import io
import json
import unittest
from unittest.mock import patch

from hermes_cli.aidiy_cli_json import parse_response
from hermes_cli.aidiy_cli_bridge import _show_local_preview


class ExtractionTest(unittest.TestCase):
    def test_prose_fences_and_wrapped_response(self):
        expected = {"content": '日本語 } { " [ ] \\', "tool_calls": []}
        payload = "[INFO] Result {example}\n```json\n" + json.dumps(expected) + "\n```\nDone"
        self.assertEqual(parse_response(payload), expected)
        self.assertEqual(parse_response(json.dumps(payload)), expected)

    def test_does_not_select_ambiguous_or_nested_objects(self):
        for payload in ('{"a":1} {"b":2}', '[{"a":1}]', 'note [{"a":1}]',
                        '{"a":1,"a":2} {"b":2}', '{"a": NaN}', '{"a": {"b":1}'):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                parse_response(payload)

    def test_preview_stays_local_and_escapes_controls(self):
        out = io.StringIO()
        with patch("sys.stderr", out):
            _show_local_preview("秘密")
            self.assertEqual(out.getvalue(), "")
        with patch("sys.stderr", out), patch.object(out, "isatty", return_value=True):
            _show_local_preview("秘密\x1b\n\u202e" + "a" * 3000 + "removed")
        display = out.getvalue().rstrip("\n")
        self.assertIn(r"秘密\x1b\n\u202e", display)
        self.assertNotIn("removed", display)
        self.assertNotIn("\x1b", display)
