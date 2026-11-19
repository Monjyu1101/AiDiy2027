# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Copilot の長文をモデル呼出しなしで argv / UTF-8 stdin 境界まで検証する。"""
import asyncio
import contextlib
import io
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from test_code_aidiy_codex import cli, options


class CopilotStdinTests(unittest.IsolatedAsyncioTestCase):
    def make(self, project, readonly=False):
        option = options.AI実行オプション(会話継続=not readonly, 履歴保存=False,
            ストリーム送信=False, 出力ファイル保存=False, CLI読取専用=readonly)
        ai = cli.CodeAI(AI_NAME='copilot_cli', AI_MODEL='claude-sonnet-5.5',
                        絶対パス=project, 実行オプション=option)
        ai.is_alive = True
        ai._CLI起動コマンド先頭 = Mock(return_value=(['fixture-copilot'], False))
        ai._aidiy参照プロンプト取得 = Mock(return_value='')
        ai._予測CLI準備 = AsyncMock()
        return ai

    async def test_long_prompt_initial_resume_readonly_and_cmd_fallback(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        prompt = ('日本語 "引用"\n次の行 & %PATH% | >\n' * 4000) + 'END_MARKER'
        for readonly in (False, True):
            for cmd_fallback in (False, True):
                with self.subTest(readonly=readonly, cmd_fallback=cmd_fallback), tempfile.TemporaryDirectory() as project:
                    ai = self.make(project, readonly)
                    ai._CLI起動コマンド先頭 = Mock(return_value=(['fixture-copilot'], cmd_fallback))
                    ai._subprocess実行 = AsyncMock(return_value='fixture answer')
                    for resume in (False, True):
                        self.assertEqual(await ai.実行(prompt, resume=resume), 'fixture answer')
                        sent = ai._subprocess実行.call_args.kwargs
                        command = sent['command']
                        self.assertNotIn('-p', command)
                        self.assertNotIn('--prompt', command)
                        self.assertLess(sum(map(len, command)), 5000)
                        self.assertIn(prompt, sent['stdin_text'])
                        self.assertEqual(command[command.index('--model') + 1], 'claude-sonnet-5.5')
                        self.assertEqual('--continue' in command, resume and not readonly)
                        self.assertEqual('--allow-all-tools' in command, not readonly)
                        if readonly:
                            for flag in ('--deny-tool=write', '--deny-tool=shell', '--disable-builtin-mcps'):
                                self.assertIn(flag, command)

    async def test_native_pipe_writes_exact_utf8_and_eof_without_shell(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        prompt = '日本語 "引用"\r\n& | > %PATH%\n' * 4000
        with tempfile.TemporaryDirectory() as project:
            ai = self.make(project)
            stdout, stderr = asyncio.StreamReader(), asyncio.StreamReader()
            stdout.feed_eof()
            stderr.feed_eof()
            stdin = Mock(drain=AsyncMock())
            process = SimpleNamespace(returncode=0, stdout=stdout, stderr=stderr,
                                      stdin=stdin, wait=AsyncMock(return_value=0))
            command = ai._コマンド構築(prompt, 初回=True, repo_path=project)
            with patch.object(cli.asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)) as spawn:
                await ai._subprocess実行(command, project, 5, stdin_text=prompt)
            stdin.write.assert_called_once_with(prompt.encode('utf-8'))
            stdin.drain.assert_awaited_once()
            stdin.close.assert_called_once()
            args, kwargs = spawn.call_args
            self.assertNotIn(prompt, args)
            self.assertNotIn('shell', kwargs)
            self.assertEqual(kwargs['stdin'], asyncio.subprocess.PIPE)
            self.assertLess(sum(len(str(arg)) for arg in args), 5000)
            self.assertEqual(list(args[args.index('--') + 1:]), command)


if __name__ == '__main__':
    unittest.main()
