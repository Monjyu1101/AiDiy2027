"""Slack初期設定欄だけをfixtureで検証。実設定・外部接続は使わない。"""
import importlib.util
import json
import logging
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
with patch.dict(sys.modules, {'log_config': SimpleNamespace(get_logger=logging.getLogger)}):
    spec = importlib.util.spec_from_file_location('slack_defaults_fixture', ROOT / 'backend_server/conf/conf_json.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

KEYS = ['slack_bot_token', 'slack_app_token', 'slack_team_id', 'slack_allowed_user_id', 'slack_text_channel_id']


class SlackDefaultsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'AiDiy_key.json'

    def write(self, data):
        self.path.write_text(json.dumps(data), encoding='utf-8')

    def load(self):
        return module.conf_json(str(self.path))

    def saved(self):
        return json.loads(self.path.read_text(encoding='utf-8-sig'))

    def test_exact_five_keys_and_order(self):
        keys = list(module.conf_json.DEFAULT_CONFIG)
        index = keys.index('discord_voice_channel_id') + 1
        self.assertEqual(keys[index:index + 5], KEYS)
        self.assertEqual([key for key in keys if key.startswith('slack_')], KEYS)

    def test_defaults_are_string_placeholders(self):
        self.load()
        for key in KEYS:
            self.assertIsInstance(self.saved()[key], str)
            self.assertTrue(self.saved()[key].startswith('< your slack '))

    def test_existing_values_are_preserved(self):
        values = dict(zip(KEYS, ['bot-fixture', 'app-fixture', 'T123', 'U123', 'C123']))
        self.write(values)
        self.load()
        self.assertEqual({key: self.saved()[key] for key in KEYS}, values)

    def test_only_missing_keys_are_added(self):
        self.write({'slack_bot_token': '', 'slack_team_id': None})
        self.load()
        self.assertEqual(self.saved()['slack_bot_token'], '')
        self.assertIsNone(self.saved()['slack_team_id'])
        self.assertEqual(self.saved()['slack_app_token'], module.conf_json.DEFAULT_CONFIG['slack_app_token'])

    def test_unknown_and_discord_keys_survive(self):
        self.write({'discord_bot_token': 'discord-fixture', 'future_key': 'value'})
        self.load()
        self.assertEqual(self.saved()['discord_bot_token'], 'discord-fixture')
        self.assertEqual(self.saved()['future_key'], 'value')

    def test_config_preserves_existing_types_not_reader_validation(self):
        self.write({'slack_team_id': 123, 'slack_allowed_user_id': ['U123']})
        self.load()
        self.assertEqual(self.saved()['slack_team_id'], 123)
        self.assertEqual(self.saved()['slack_allowed_user_id'], ['U123'])

    def test_json_escaping_roundtrip(self):
        value = 'fixture-\\"日本語\nline'
        self.write({'slack_bot_token': value})
        self.load()
        self.assertEqual(self.saved()['slack_bot_token'], value)

    def test_reinitialize_does_not_rewrite_complete_config(self):
        self.load()
        before = self.path.read_bytes()
        with patch.object(module.os, 'replace', side_effect=AssertionError('unexpected rewrite')):
            self.load()
        self.assertEqual(self.path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
