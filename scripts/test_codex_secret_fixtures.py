"""Codex の合成テスト値・ローカル認証情報の Git 混入防止チェック。値は出力しない。"""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'command_codex/codex-rs/cli/src/doctor/output.rs'


class SecretFixtureTests(unittest.TestCase):
    def test_no_complete_aws_id_literal(self):
        source = (ROOT / SOURCE).read_text(encoding='utf-8')
        self.assertFalse(re.search(r'(?:AKIA|ASIA)[A-Z0-9]{16}', source),
                         'Complete AWS-shaped test ID must not be committed')

    def test_both_runtime_fixture_cases_remain(self):
        source = (ROOT / SOURCE).read_text(encoding='utf-8')
        self.assertIn('for key_prefix in ["AKIA", "ASIA"]', source)
        self.assertIn('"X".repeat(16)', source)
        self.assertIn('for prefix in ["env var", "bearer token env var", "header env var"]', source)

    def test_local_credentials_ignored(self):
        for path in ['.aws/credentials', 'nested/.aws/credentials', '.aws/config',
                     '.codex/auth.json', 'nested/.codex/auth.json', '.codex/auth.json.bak']:
            with self.subTest(path=path):
                result = subprocess.run(['git', 'check-ignore', '--no-index', '-q', path], cwd=ROOT)
                self.assertEqual(result.returncode, 0)

    def test_source_and_examples_not_ignored(self):
        for path in [SOURCE, '.codex/config.toml', 'sample/aws.example.json']:
            with self.subTest(path=path):
                result = subprocess.run(['git', 'check-ignore', '--no-index', '-q', path], cwd=ROOT)
                self.assertEqual(result.returncode, 1)
        result = subprocess.run(['git', 'ls-files', '--error-unmatch', SOURCE], cwd=ROOT,
                                stdout=subprocess.DEVNULL)
        self.assertEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
