# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""ローカル Git 管理情報を走査・クリーンアップから保護する回帰試験。"""
import ast
import importlib.util
from pathlib import Path
import tempfile
import unittest
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]


class LocalGitExclusionTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('git'), 'Git が未導入')
    def test_parent_repository_ignores_local_git_at_every_depth(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copyfile(ROOT / '.gitignore', root / '.gitignore')
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            paths = ['.git_local/HEAD', 'frontend_ide/.git_local/config',
                     'nested/project/.git_local/objects/ab/example']
            for name in paths + ['nested/project/source.py']:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('fixture\n', encoding='utf-8')
            # text=True は Windows で入力の改行を CRLF に変えるため、バイト列で渡す。
            result = subprocess.run(['git', '-C', str(root), 'check-ignore', '--stdin'],
                                    input=('\n'.join(paths) + '\n').encode('utf-8'),
                                    capture_output=True, check=True)
            self.assertEqual(result.stdout.decode('utf-8').splitlines(), paths)
            subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
            tracked = subprocess.check_output(['git', '-C', str(root), 'ls-files'], text=True)
            self.assertIn('nested/project/source.py', tracked.splitlines())
            self.assertFalse(any('.git_local/' in p for p in tracked.splitlines()))

    def test_cleanup_does_not_descend_into_git_metadata(self):
        spec = importlib.util.spec_from_file_location('cleanup_local_git_test', ROOT / '_cleanup.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # 大文字小文字を区別しないファイルシステムでは .GIT_LOCAL は .git_local と同じ実体になる。
            for name in ('.git', '.git_local', '.GIT_LOCAL', 'source'):
                (root / name / 'temp').mkdir(parents=True, exist_ok=True)
            self.assertEqual(module.find_temp_directories(root), [root / 'source' / 'temp'])
            self.assertTrue((root / '.git_local' / 'temp').is_dir())

    def test_python_scan_exclusions(self):
        # Importing these application modules would load services or execute a BOM scan.
        for path, variable in (
            ('scripts/remove_bom.py', 'IGNORE_DIRS'),
            ('scripts/bom_anomaly_list.py', 'IGNORE_DIRS'),
            ('backend_server/AIコア/AIバックアップ.py', '_バックアップ除外フォルダ'),
            ('backend_tools/aidiy_automations/ビデオページ生成/utils/steps.py', '除外フォルダ'),
        ):
            with self.subTest(path=path):
                tree = ast.parse((ROOT / path).read_text(encoding='utf-8-sig'))
                values = [ast.literal_eval(node.value) for node in ast.walk(tree)
                          if isinstance(node, ast.Assign) and any(
                              isinstance(target, ast.Name) and target.id == variable for target in node.targets)]
                self.assertEqual(len(values), 1)
                self.assertIn('.git', values[0])
                self.assertIn('.git_local', values[0])


if __name__ == '__main__':
    unittest.main()
