# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""日時逆転を登録・部分更新で拒否し、既存行を変更しないことを検証。"""
import ast
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "backend_server/apps_crud/日時検証.py"
spec = importlib.util.spec_from_file_location("datetime_validation", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RangeTests(unittest.TestCase):
    def test_valid_and_invalid_ranges(self):
        for end in ("2026-10-26T09:00", "2026-10-26T10:30", "2026-10-27T00:00"):
            module.日時範囲検証("2026-10-26T09:00", end)
        for start, end in (("2026-10-26T09:00", "2026-10-26T08:30"), ("", "2026-10-26"), ("2026-02-30T09:00", "2026-03-01T09:00")):
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                module.日時範囲検証(start, end)

    def test_create_and_partial_update_reject_before_mutation(self):
        for kind in ("配車", "生産"):
            source = ROOT / f"backend_server/apps_crud/T{kind}.py"
            tree = ast.parse(source.read_text(encoding="utf-8-sig"))
            functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in (f"create_T{kind}", f"update_T{kind}")]
            for fn in functions:
                fn.returns = None
                for arg in fn.args.args:
                    arg.annotation = None
            old = SimpleNamespace(**{f"{kind}開始日時":"2026-10-26T09:00", f"{kind}終了日時":"2026-10-26T10:30", "明細SEQ":0})
            class Input:
                def __getattr__(self, key):
                    return None
                def model_dump(self, **kwargs):
                    return {f"{kind}終了日時":"2026-10-26T08:30"}
            request = Input()
            setattr(request, f"{kind}伝票ID", "SELFTEST")
            setattr(request, f"{kind}終了日時", "2026-10-26T08:30")
            # 生産の未変更欄は既存ヘッダーから読む。
            for name in ("受入商品ID", "最小ロット数量", "受入数量", "生産区分ID", "生産工程ID", "段取分数", "時間生産数量", "生産時間"):
                setattr(old, name, None)
            ns = {"日時範囲検証":module.日時範囲検証, f"get_T{kind}":lambda *args: [old] if kind=="生産" else old}
            exec(compile(ast.Module(body=functions,type_ignores=[]),str(source),"exec"),ns)
            db = Mock()
            with self.subTest(kind=kind, action="partial_update"), self.assertRaises(ValueError):
                ns[f"update_T{kind}"](db, "SELFTEST", request)
            self.assertEqual(getattr(old,f"{kind}終了日時"),"2026-10-26T10:30")
            db.commit.assert_not_called()
            setattr(request, f"{kind}開始日時", "2026-10-26T09:00")
            with self.subTest(kind=kind, action="create"), self.assertRaises(ValueError):
                ns[f"create_T{kind}"](db, request)
            db.add.assert_not_called()


if __name__ == "__main__":
    unittest.main()
