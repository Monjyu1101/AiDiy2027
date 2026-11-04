import contextlib, io, types, unittest
from pathlib import Path
from unittest.mock import Mock, patch
import subprocess
ROOT=Path(__file__).resolve().parents[2]
CAND=ROOT

def load(relative):
    module=types.ModuleType('candidate_'+relative.replace('/','_'))
    module.__file__=str(ROOT/relative)
    exec(compile((CAND/relative).read_text(),module.__file__,'exec'),module.__dict__)
    return module

class BestEffortTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
    def test_viewer_attempts_later_steps_after_each_failure(self):
        m=load('frontend_ide/viewer/_setup.py')
        with patch.object(m.subprocess,'run',side_effect=subprocess.CalledProcessError(1,'fixture')) as run, patch.object(m,'frontend_dependency_guard',return_value=None), patch.object(m,'prepare_electron_binary',return_value=False) as prepare, patch.object(m,'install_launcher') as launcher, patch.dict(m.os.environ,{'DISPLAY':':fixture'},clear=True):
            self.assertFalse(m._setup_best_effort('npm',{}))
            self.assertGreaterEqual(run.call_count,3)
            self.assertTrue(any(call.args[0][1:3]==['run','build'] for call in run.call_args_list))
            prepare.assert_called_once(); launcher.assert_called_once()
    def test_viewer_copy_warning_only_is_not_failure(self):
        m=load('frontend_ide/viewer/_setup.py'); choices={'continue_on_error':True}
        def copy_failure(*args,**kwargs):
            kwargs['copy_warnings'].append('fixture copy failed')
            return False
        with patch.object(m.subprocess,'run'), patch.object(m,'frontend_dependency_guard',return_value=None), patch.object(m,'prepare_electron_binary',side_effect=copy_failure), patch.object(m,'install_launcher'), patch.dict(m.os.environ,{'DISPLAY':':fixture'},clear=True):
            self.assertTrue(m._setup_best_effort('npm',choices));self.assertEqual(choices['_setup_warnings'],['fixture copy failed'])
    def test_viewer_noncopy_prepare_failure_remains_failure(self):
        m=load('frontend_ide/viewer/_setup.py')
        with patch.object(m.subprocess,'run'), patch.object(m,'frontend_dependency_guard',return_value=None), patch.object(m,'prepare_electron_binary',return_value=False), patch.object(m,'install_launcher') as launcher, patch.dict(m.os.environ,{'DISPLAY':':fixture'},clear=True):
            self.assertFalse(m._setup_best_effort('npm',{'continue_on_error':True}));launcher.assert_called_once()
    def test_copy_warning_does_not_hide_build_failure(self):
        m=load('frontend_ide/viewer/_setup.py')
        def copy_failure(*args,**kwargs):
            kwargs['copy_warnings'].append('fixture copy failed')
            return False
        def run(command,**kwargs):
            if command[1:3]==['run','build']:raise subprocess.CalledProcessError(1,command)
        with patch.object(m.subprocess,'run',side_effect=run), patch.object(m,'frontend_dependency_guard',return_value=None), patch.object(m,'prepare_electron_binary',side_effect=copy_failure), patch.object(m,'install_launcher') as launcher, patch.dict(m.os.environ,{'DISPLAY':':fixture'},clear=True):
            self.assertFalse(m._setup_best_effort('npm',{'continue_on_error':True}));launcher.assert_called_once()
    def test_host_dependencies_failure_continues_assets_only_when_requested(self):
        m=load('frontend_ide/host/_setup.py')
        with patch.object(m,'check_project_node_runtime',return_value=(True,'')),patch.object(m.shutil,'which',return_value='npm'),patch.object(m,'setup_dependencies',return_value=False),patch.object(m,'run_command',return_value=False) as run,patch.object(m,'setup_assets',return_value=True) as assets:
            self.assertFalse(m.setup({'continue_on_error':True})); assets.assert_called_once(); self.assertIn('continue_on_error=True',run.call_args.args[0][2])
            assets.reset_mock();run.reset_mock();self.assertFalse(m.setup());assets.assert_not_called();run.assert_not_called()
    def test_previous_module_warning_is_not_attributed_to_host(self):
        m=load('frontend_ide/host/_setup.py')
        choices={'continue_on_error':True,'_setup_warnings':['Diag: copy warning']}
        with patch.object(m,'find_vscode_cli',return_value=None), patch.object(m,'run_command',return_value=True), patch.object(m,'install_standalone_launcher',return_value=True), patch.object(m,'print_warning') as warning:
            self.assertTrue(m.setup_assets('npm',choices=choices))
            self.assertFalse(any('コピーの警告' in str(call) for call in warning.call_args_list))
        self.assertEqual(choices['_setup_warnings'],['Diag: copy warning'])
    def test_failed_package_not_installed_but_launcher_attempted(self):
        m=load('frontend_ide/host/_setup.py')
        with patch.object(m,'find_vscode_cli',return_value='code'),patch.object(m,'run_command',return_value=False),patch.object(m,'install_extensions') as install,patch.object(m,'install_standalone_launcher',return_value=True) as launcher:
            self.assertFalse(m.setup_assets('npm',choices={'continue_on_error':True}));install.assert_not_called();launcher.assert_called_once()
    def test_parent_continues_other_children(self):
        m=load('frontend_ide/_setup.py'); child=Mock();child.setup.return_value=False
        with patch.object(m,'load_setup_module',return_value=child) as load_child,patch.object(m,'register_launchers',return_value=True) as register:
            self.assertFalse(m.setup({'continue_on_error':True}));self.assertEqual(child.setup.call_count,7);register.assert_called_once()
            self.assertEqual([call.args[0] for call in load_child.call_args_list], [f'frontend_ide/{folder}/_setup.py' for folder in ('aidiy_navi', 'aidiy_console', 'host', 'viewer', 'aidiy_task', 'aidiy_team', 'aidiy_browser')])
            child.reset_mock();register.reset_mock();self.assertFalse(m.setup());self.assertEqual(child.setup.call_count,1);register.assert_not_called()
    def test_launcher_failure_does_not_skip_remaining(self):
        m=load('frontend_ide/_setup.py');launcher=Mock();launcher.install_launcher.side_effect=OSError('fixture');host=Mock();host.install_standalone_launcher.return_value=False
        with patch.object(m,'load_setup_module',return_value=launcher):
            self.assertFalse(m.register_launchers(host,continue_on_error=True));self.assertEqual(launcher.install_launcher.call_count,6);launcher.ensure_launcher_path.assert_called_once()
            self.assertEqual([call.args[1] for call in launcher.install_launcher.call_args_list], ['navi', 'console', 'ide', 'task', 'team', 'browser'])
            host.install_standalone_launcher.assert_called_once_with(register_path=False)

if __name__=='__main__': unittest.main()
