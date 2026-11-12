# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
"""Browserのsession/tab_id契約。通常Chromeのauto互換は維持する。"""
import unittest
from unittest.mock import AsyncMock, Mock, patch

from test_browser_new_tab import adapter, api, httpx
CDPClient = adapter().__class__.__mro__[1]


def tab(identifier):
    return {'id': identifier, 'type': 'page', 'webSocketDebuggerUrl': 'ws://127.0.0.1:12345/' + identifier}


class BrowserTabRoutingTest(unittest.IsolatedAsyncioTestCase):
    async def test_browser_never_uses_auto_cache_even_with_one_tab(self):
        for session in ('aidiy_ide 1', 'aidiy_browser', 'aidiy_ide'):
            client = adapter(session)
            client._auto_tab = tab('cached')
            with patch.object(client, 'list_tabs', return_value=[tab('one')]) as listing:
                for value in (None, '', ' ', 'auto'):
                    with self.subTest(session=session, value=value):
                        with self.assertRaisesRegex(ValueError, 'session と tab_id'):
                            client.resolve_tab(value)
                        with self.assertRaisesRegex(ValueError, 'session と tab_id'):
                            await client.resolve_tab_async(value)
                listing.assert_not_called()

    async def test_explicit_id_revalidated_on_every_call_and_closed_id_rejected(self):
        client = adapter()
        with patch.object(client, 'list_tabs', side_effect=[
            [tab('a'), tab('b')], [tab('b'), tab('a')], [tab('b')]
        ]) as listing:
            self.assertEqual((await client.resolve_tab_async('a'))['id'], 'a')
            self.assertEqual((await client.resolve_tab_async('a'))['id'], 'a')
            with self.assertRaisesRegex(ValueError, '見つかりません'):
                await client.resolve_tab_async('a')
            self.assertEqual(listing.call_count, 3)

    async def test_foreign_session_and_closed_tab_send_no_cdp_command(self):
        clients = {'aidiy_ide 1': adapter(), 'aidiy_ide 2': adapter('aidiy_ide 2')}
        for index, client in enumerate(clients.values()):
            client.list_tabs = Mock(return_value=[tab(str(index))])
            client.send_command = AsyncMock(return_value={'result': {'value': 'ok'}})
        mcp, app = api(clients)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as http:
            for target in (None, 'auto', '1', 'closed'):
                with self.subTest(target=target):
                    with self.assertRaises(ValueError):
                        await mcp.tools['eval_js'](session='aidiy_ide 1', tab_id=target, expression='document.title')
                    response = await http.post('/aidiy_chrome_devtools/eval_js', json={
                        'session': 'aidiy_ide 1', 'tab_id': target, 'expression': 'document.title'
                    })
                    self.assertIn('error', response.json())
            for client in clients.values():
                client.send_command.assert_not_awaited()
            self.assertIn('ok', await mcp.tools['eval_js'](session='aidiy_ide 2', tab_id='1', expression='document.title'))
            clients['aidiy_ide 1'].send_command.assert_not_awaited()
            self.assertEqual(clients['aidiy_ide 2'].send_command.await_args.args[0], tab('1')['webSocketDebuggerUrl'])

    async def test_normal_chrome_auto_cache_is_unchanged(self):
        client = CDPClient()
        with patch.object(client, 'list_tabs', return_value=[tab('first'), tab('second')]) as listing:
            self.assertEqual(client.resolve_tab()['id'], 'first')
            self.assertEqual((await client.resolve_tab_async('auto'))['id'], 'first')
            listing.assert_called_once()


if __name__ == '__main__':
    unittest.main()
