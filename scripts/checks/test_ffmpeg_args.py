# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""FFmpegへ渡すWindowsパスと引用符の回帰確認。"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend_tools'))
from tools_proc.ffmpeg_control import FfmpegControl, FfmpegControlError


class FfmpegArgsTest(unittest.TestCase):
    def test_windows_path_with_spaces(self):
        self.assertEqual(
            FfmpegControl._split_args(r'-i "C:\試験 音声\入力.wav" -ar 16000 "C:\出力 音声.wav"'),
            ['-i', r'C:\試験 音声\入力.wav', '-ar', '16000', r'C:\出力 音声.wav'],
        )

    def test_filter_and_single_quotes(self):
        self.assertEqual(FfmpegControl._split_args('-af "volume=0.5,adelay=100|100" -i \'音声 入力.wav\''),
                         ['-af', 'volume=0.5,adelay=100|100', '-i', '音声 入力.wav'])

    def test_unquoted_and_invalid(self):
        self.assertEqual(FfmpegControl._split_args('-y -version'), ['-y', '-version'])
        with self.assertRaises(FfmpegControlError):
            FfmpegControl._split_args('-i "unfinished')


if __name__ == '__main__':
    unittest.main()
