"""Tools → TaskTeam の応答契約と認証 transport 委譲を socket なしで検証。"""
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import requests
from tools_proc.task_agents import TaskAgents
from tools_proc.team_agents import TeamAgents


class OutboundTests(unittest.TestCase):
    def clients(self):
        with patch.dict('os.environ', {}, clear=True):
            return ((TaskAgents(), '_post_task_api', '/task/タスク要求/AI登録'),
                    (TeamAgents(), '_post_team_api', '/team/依頼/登録'))

    def test_default_health_and_post_response_contract(self):
        for client, method, path in self.clients():
            with self.subTest(client=type(client).__name__):
                reply = {'status': 'OK', 'data': {'id': 'fixture'}}
                response = Mock(ok=True, text='OK', status_code=200)
                response.json.return_value = reply
                with patch('requests.get', return_value=response) as get, patch(f'tools_proc.{"task_agents" if isinstance(client, TaskAgents) else "team_agents"}.post_taskteam', return_value=response) as post:
                    self.assertTrue(client.get_config()['health']['ok'])
                    get.assert_called_once_with('http://127.0.0.1:8093/health', timeout=3)
                    payload = {'利用者ID': 'fixture', '要求内容': 'not executed'}
                    self.assertEqual(getattr(client, method)(path, payload, 15), reply)
                    post.assert_called_once_with('http://127.0.0.1:8093' + path, payload, timeout=15)

    def test_override_configuration_is_preserved_transport_validates_before_sending(self):
        with patch.dict('os.environ', {'AIDIY_TASK_API_BASE': 'http://fixture.invalid:18093/', 'AIDIY_TEAM_API_BASE': 'http://fixture.invalid:28093/'}):
            self.assertEqual(TaskAgents().task_api_base, 'http://fixture.invalid:18093')
            self.assertEqual(TeamAgents().team_api_base, 'http://fixture.invalid:28093')

    def test_failure_remains_structured(self):
        for client, method, path in self.clients():
            with self.subTest(client=type(client).__name__), patch(f'tools_proc.{"task_agents" if isinstance(client, TaskAgents) else "team_agents"}.post_taskteam', side_effect=requests.ConnectionError('fixture')):
                self.assertEqual(getattr(client, method)(path, {}, 15)['status'], 'NG')


if __name__ == '__main__':
    unittest.main()
