# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""予測要求の接続パス・非保存オプションをSDK/実DBなしで検査する。"""
import ast
import asyncio
from contextlib import nullcontext
from datetime import datetime
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, Mock

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'backend_tools/tools_proc/prediction_llm.py'


def load():
    tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
    names = {'PredictionReadonlyUnavailable', 'PredictionLLM', '_prediction_prompt'}
    nodes = [n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in names]
    env = dict(asyncio=asyncio, Path=Path, datetime=datetime,
               prediction_private_logs=nullcontext, HISTORY_MAX_TURNS=10,
               HISTORY_MAX_CHARS=24000, CLI_PROVIDERS=('codex_cli','copilot_cli','aidiy_hermes'),
               PROVIDERS=('codex_cli','copilot_cli','aidiy_hermes','openai_chat'),
               _CLI_MARKER='[[PREDICTION]]', _CLI_INSTRUCTION='readonly', _SYSTEM_INSTRUCTION='predict',
               normalize_project_path=lambda p: str(Path(p)) if p and Path(p).is_absolute() else None,
               AI実行オプション=types.SimpleNamespace(読取専用予測=lambda: 'readonly'))
    env['read_prediction_history'] = Mock(return_value=[dict(role='user',turn_id=1,content='rename file')])
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(SOURCE),'exec'),env)
    obj=object.__new__(env['PredictionLLM'])
    obj.root=ROOT
    obj._resolve=lambda *a: ('codex_cli','model')
    obj._code=types.SimpleNamespace(run_async=AsyncMock(return_value={'status':'OK','result':'[[PREDICTION]]next'}))
    obj._chat=types.SimpleNamespace(complete_async=AsyncMock(return_value={'status':'OK','content':'next'}))
    return obj,env


class ScopeTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_and_cli_same_project(self):
        obj,env=load()
        with tempfile.TemporaryDirectory() as path:
            out=await obj._run_async(path)
            self.assertEqual(out['status'],'OK')
            self.assertEqual(env['read_prediction_history'].call_args.args[1],path)
            kw=obj._code.run_async.call_args.kwargs
            self.assertEqual(kw['project_path'],path)
            self.assertEqual(kw['実行オプション'],'readonly')
            self.assertFalse(kw['resume'])
            self.assertEqual(kw['self_check_loop'],0)
            self.assertTrue(env['read_prediction_history'].call_args.kwargs['user_only'])

    async def test_invalid_scope_has_no_fallback(self):
        for path in ('','relative',None):
            obj,env=load()
            self.assertEqual((await obj._run_async(path))['status'],'NG')
            env['read_prediction_history'].assert_not_called()
            obj._code.run_async.assert_not_called()

    async def test_missing_cli_project_has_no_fallback(self):
        obj,_=load()
        with tempfile.TemporaryDirectory() as path:
            missing=str(Path(path)/'absent')
            with self.assertRaises(ValueError):
                await obj._run_cli('codex_cli','model','history',10,missing)
        obj._code.run_async.assert_not_called()

    async def test_exclamation_is_success(self):
        obj,_=load()
        for text in ('! insufficient','！情報不足'):
            obj._code.run_async.return_value={'status':'OK','result':'[[PREDICTION]]'+text}
            self.assertEqual(await obj._run_cli('codex_cli','m','h',10,str(ROOT)),text)

    async def test_failed_empty_unmarked_rejected(self):
        obj,_=load()
        for response in ({'status':'NG','result':'[[PREDICTION]]partial'}, {'status':'OK','result':'[[PREDICTION]] '}, {'status':'OK','result':'! failure'}):
            obj._code.run_async.return_value=response
            with self.assertRaises(ValueError):
                await obj._run_cli('codex_cli','m','h',10,str(ROOT))

    async def test_chat_path_unchanged(self):
        obj,_=load();obj._resolve=lambda *a:('openai_chat','m')
        self.assertEqual((await obj._run_async(str(ROOT)))['status'],'OK')
        obj._code.run_async.assert_not_called()
        kw=obj._chat.complete_async.call_args.kwargs
        self.assertIsNone(kw['tools']);self.assertIsNone(kw['tool_choice'])

    async def test_unsupported_safe_error_no_retry(self):
        obj,_=load()
        obj._code.run_async.return_value={'status':'NG','result':'PRIVATE ERROR','prediction_readonly_unavailable':True}
        result=await obj._run_async(str(ROOT))
        self.assertEqual(result['status'],'NG')
        self.assertIn('読取専用',result['result'])
        self.assertNotIn('PRIVATE',result['result'])
        self.assertEqual(obj._code.run_async.await_count,1)

    async def test_cancellation_propagates(self):
        obj,_=load();obj._code.run_async.side_effect=asyncio.CancelledError
        with self.assertRaises(asyncio.CancelledError): await obj._run_async(str(ROOT))


if __name__ == '__main__': unittest.main()
