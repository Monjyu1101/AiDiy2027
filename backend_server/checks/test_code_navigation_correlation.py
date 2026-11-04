# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Core request boundaries with stub AI; no providers, config, or database startup."""
import ast
import asyncio
import importlib.util
import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import AsyncMock

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'AIコア' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


correlation = load('AI要求相関').ナビ要求相関
response = load('AI応答')


def fixture(result='done'):
    source = ROOT / 'AIコア/AIコード.py'
    tree = ast.parse(source.read_text(encoding='utf-8'))
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'CodeAgent')
    cls.body = [node for node in cls.body if isinstance(node, ast.AsyncFunctionDef)
                and node.name in ('_実行状態つき要求処理', '_処理_input_text')]
    ns = dict(asyncio=asyncio, Optional=Optional, AIストリーム開始='\x02', ナビ要求相関=correlation,
              エラー応答判定=response.エラー応答判定, 応答正規化=response.応答正規化,
              logger=logging.getLogger('navigation-test'))
    exec(compile(ast.fix_missing_locations(ast.Module(body=[cls], type_ignores=[])), str(source), 'exec'), ns)
    agent = ns['CodeAgent']()
    packets = []

    async def send(channel, packet):
        packets.append(dict(packet))

    agent.接続 = SimpleNamespace(send_to_channel=send)
    agent.セッションID = 'session'
    agent.チャンネル = '1'
    agent.強制停止フラグ = False
    agent._停止ロック = asyncio.Lock()
    agent._基本AI処理 = AsyncMock(return_value=result)
    agent._ensure_ai_instance = AsyncMock(return_value=object())
    agent._自己改善書き込み実行 = AsyncMock()
    return agent, packets


def request(identifier='nav-1'):
    data = {'メッセージ識別': 'input_text', 'メッセージ内容': 'test', '実行状態通知': True}
    if identifier is not None:
        data['navigationRequestId'] = identifier
    return data


class NavigationCorrelationTest(unittest.IsolatedAsyncioTestCase):
    async def test_success_matches_whole_request(self):
        agent, packets = fixture()
        await agent._実行状態つき要求処理(request())
        self.assertEqual([p['メッセージ識別'] for p in packets], ['output_stream', 'output_end'])
        self.assertTrue(packets[0]['実行中'])
        self.assertEqual(packets[0]['メッセージ内容'], '\x02')
        self.assertEqual([p['navigationRequestId'] for p in packets], ['nav-1', 'nav-1'])
        self.assertEqual(packets[-1]['navigationStatus'], 'succeeded')
        self.assertFalse(packets[-1]['実行中'])

    async def test_error_and_empty_result_never_succeed(self):
        for result in ('! provider failure', '!', '', '   ', None):
            with self.subTest(result=result):
                agent, packets = fixture(result)
                await agent._実行状態つき要求処理(request())
                self.assertEqual(packets[-1]['navigationStatus'], 'failed')

    async def test_postprocessing_exception_never_succeeds(self):
        agent, packets = fixture()
        agent._自己改善書き込み実行.side_effect = RuntimeError('postprocessing failed')
        with self.assertRaises(RuntimeError):
            await agent._実行状態つき要求処理(request())
        self.assertEqual(packets[-1]['navigationStatus'], 'failed')

    async def test_swallowed_child_cancellation_never_succeeds(self):
        agent, packets = fixture()
        agent._基本AI処理.side_effect = asyncio.CancelledError()
        await agent._実行状態つき要求処理(request())
        self.assertNotEqual(packets[-1]['navigationStatus'], 'succeeded')

    async def test_force_stop_reports_cancelled(self):
        agent, packets = fixture()
        async def stop(data):
            agent.強制停止フラグ = True
            return 'done'
        agent._基本AI処理.side_effect = stop
        await agent._実行状態つき要求処理(request())
        self.assertEqual(packets[-1]['navigationStatus'], 'cancelled')

    async def test_legacy_packets_unchanged(self):
        agent, packets = fixture()
        await agent._実行状態つき要求処理(request(None))
        for packet in packets:
            self.assertNotIn('navigationRequestId', packet)
            self.assertNotIn('navigationStatus', packet)

    async def test_sequential_requests_do_not_leak_correlation(self):
        agent, packets = fixture()
        for identifier in ('one', None, 'two'):
            await agent._実行状態つき要求処理(request(identifier))
        self.assertEqual([p.get('navigationRequestId') for p in packets], ['one', 'one', None, None, 'two', 'two'])

    def test_invalid_ids_are_not_reflected(self):
        for value in (None, '', ' ', 123, {}, [], 'x' * 129):
            self.assertEqual(correlation({'navigationRequestId': value}), {})


if __name__ == '__main__':
    unittest.main()
