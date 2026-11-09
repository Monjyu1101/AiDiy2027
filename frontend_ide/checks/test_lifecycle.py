# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""IDE群の一括選択と安全な解除を、外部プロセスを変更せず確認する。"""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

setup = load('ide_group_root_setup_test', ROOT / '_setup.py')
cleanup = load('ide_group_root_cleanup_test', ROOT / '_cleanup.py')
group = load('ide_group_cleanup_test', ROOT / 'frontend_ide/_cleanup.py')
group_setup = load('ide_group_setup_test', ROOT / 'frontend_ide/_setup.py')

class IDEGroupTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_setup_and_cleanup_have_one_group_choice(self):
        for module, method in ((setup, 'collect_setup_choices'), (cleanup, 'collect_cleanup_choices')):
            group_label = 'Console / Code / Live / IDE' if module is setup else 'IDE群'
            with self.subTest(method=method), tempfile.TemporaryDirectory() as tmp, patch.object(
                module, 'ask_start_mode', return_value=(True, False)
            ), patch.object(module, 'ask_yes_no', side_effect=lambda prompt, default='n': group_label in prompt) as ask:
                choices = getattr(module, method)(*([Path(tmp)] if module is cleanup else []))
            self.assertTrue(choices['ide'])
            self.assertNotIn('vscode', choices)
            self.assertEqual(sum(group_label in call.args[0] for call in ask.call_args_list), 1)
            prompts = [call.args[0] for call in ask.call_args_list]
            self.assertLess(next(i for i, p in enumerate(prompts) if group_label in p), next(i for i, p in enumerate(prompts) if 'Discord' in p))

    def test_root_cleanup_delegates_group_once(self):
        choices = dict.fromkeys(('npm_uninstall', 'backup', 'local', 'tools', 'backend', 'taskteam', 'web', 'avatar', 'hermes', 'discord'), False)
        choices['ide'] = True
        with patch.object(cleanup, 'stop_all_services'), patch.object(cleanup, 'cleanup_backup'), patch.object(cleanup, '_run_folder_cleanup', return_value=True) as run, patch.object(cleanup, 'cleanup_temp_directories', return_value=True), patch.object(cleanup, '_remove_folder_import_cache'), patch.object(cleanup, '_remove_root_python_caches'), patch.object(cleanup.time, 'sleep'):
            self.assertTrue(cleanup.execute_cleanup(ROOT, choices))
        run.assert_called_once_with('frontend_ide', choices)

    def test_unselected_group_does_nothing(self):
        with patch.object(group, '_load_cleanup') as load_child, patch.object(group.shutil, 'rmtree') as remove:
            self.assertTrue(group.cleanup({'ide': False}))
        load_child.assert_not_called()
        remove.assert_not_called()
        with patch.object(group_setup.importlib.util, 'spec_from_file_location') as load_child:
            self.assertTrue(group_setup.setup({'ide': False}))
        load_child.assert_not_called()

    def test_group_cleanup_preserves_shared_ui_if_a_child_fails(self):
        for failed in ('navi', 'console', 'code', 'live', 'ide', 'task', 'team', 'browser', 'shared'):
            children = {name: Mock() for name in ('aidiy_navi', 'aidiy_console', 'host', 'viewer', 'aidiy_task', 'aidiy_team', 'aidiy_browser')}
            children['aidiy_navi'].cleanup.return_value = failed != 'navi'
            children['aidiy_console'].cleanup.return_value = failed != 'console'
            children['host'].cleanup_app.side_effect = lambda name, **kwargs: name != failed
            children['host'].cleanup_shared.return_value = failed != 'shared'
            children['viewer'].cleanup.return_value = failed != 'ide'
            children['aidiy_task'].cleanup.return_value = failed != 'task'
            children['aidiy_team'].cleanup.return_value = failed != 'team'
            children['aidiy_browser'].cleanup.return_value = failed != 'browser'
            with self.subTest(failed=failed), patch.object(group, '_load_cleanup', side_effect=children.__getitem__) as load_child, patch.object(group.shutil, 'rmtree') as remove:
                self.assertFalse(group.cleanup({'ide': True}))
                self.assertEqual([c.args[0] for c in load_child.call_args_list], ['aidiy_navi', 'aidiy_console', 'host', 'viewer', 'aidiy_task', 'aidiy_team', 'aidiy_browser'])
                self.assertEqual([c.args[0] for c in children['host'].cleanup_app.call_args_list], ['code', 'live'])
                if failed != 'shared':
                    children['host'].cleanup_shared.assert_not_called()
                remove.assert_not_called()

    def test_success_cleans_only_shared_outputs_after_children(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            for name in ('node_modules', 'dist', '__pycache__', 'src'):
                (root / name).mkdir()
                (root / name / 'keep.txt').write_text('test', encoding='utf-8')
            order = []
            def child(name):
                self.assertTrue((root / 'dist').exists())
                if name == 'host':
                    return Mock(cleanup_app=Mock(side_effect=lambda app, **kwargs: order.append(app) or True),
                                cleanup_shared=Mock(side_effect=lambda **kwargs: order.append('shared') or True))
                return Mock(cleanup=Mock(side_effect=lambda choices, **kwargs: order.append(name.removeprefix('aidiy_') if name.startswith('aidiy_') else 'ide') or True))
            with patch.object(group, 'ROOT', root), patch.object(group, '_load_cleanup', side_effect=child):
                self.assertTrue(group.cleanup({'ide': True}))
            self.assertEqual(order, ['navi', 'console', 'code', 'live', 'ide', 'task', 'team', 'browser', 'shared'])
            self.assertTrue((root / 'src/keep.txt').is_file())
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['src'])

    def test_group_reports_one_cleanup_without_individual_sections(self):
        host = load('ide_group_host_report_test', ROOT / 'frontend_ide/host/_cleanup.py')
        viewer = load('ide_group_viewer_report_test', ROOT / 'frontend_ide/viewer/_cleanup.py')
        output = io.StringIO()
        with contextlib.redirect_stdout(output), patch.object(group, '_load_cleanup', side_effect={'aidiy_navi': Mock(cleanup=Mock(return_value=True)), 'aidiy_console': Mock(cleanup=Mock(return_value=True)), 'aidiy_task': Mock(cleanup=Mock(return_value=True)), 'aidiy_team': Mock(cleanup=Mock(return_value=True)), 'aidiy_browser': Mock(cleanup=Mock(return_value=True)), 'host': host, 'viewer': viewer}.__getitem__), patch.object(
            host, 'uninstall_extension', return_value=(True, 0)
        ), patch.object(host, 'stop_standalone_processes', return_value=True), patch.object(host, 'remove_file', return_value=True), patch.object(
            host, 'remove_directory', return_value=True
        ), patch.object(viewer, '_load_start_module', return_value=Mock()), patch.object(viewer, 'remove_launcher', return_value=True), patch.object(
            viewer, 'remove_directory', return_value=True
        ), patch.object(group.shutil, 'rmtree'):
            self.assertTrue(group.cleanup({'ide': True}))
        lines = output.getvalue().splitlines()
        self.assertEqual([line for line in lines if line.endswith('のクリーンアップ')], ['IDE群(Navi / Console / Code / Live / IDE / Task / Team / Browser) のクリーンアップ'])
        self.assertEqual([line for line in lines if 'クリーンアップ完了' in line], ['[OK] IDE群(Navi / Console / Code / Live / IDE / Task / Team / Browser) のクリーンアップ完了'])

if __name__ == '__main__':
    unittest.main()
