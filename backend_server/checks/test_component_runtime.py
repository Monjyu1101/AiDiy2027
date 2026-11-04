# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""Backend / Hermes の実行条件を、インストール・通信・起動なしで検証する。"""

import contextlib
import importlib.util
import io
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
COMPONENTS = {
    "backend_local": "BACKEND_LOCAL_DIR",
    "backend_server": "BACKEND_DIR",
    "backend_tools": "BACKEND_TOOLS_DIR",
    "backend_taskteam": "BACKEND_TASKTEAM_DIR",
    "command_hermes": "BACKEND_HERMES_DIR",
}


def load_script(folder, name):
    spec = importlib.util.spec_from_file_location(
        f"runtime_{folder}_{name}", ROOT / folder / f"_{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ComponentRuntimeTests(unittest.TestCase):
    @contextlib.contextmanager
    def fixture(self, folder, name="start", requirement=">=3.13", environment=True):
        with tempfile.TemporaryDirectory() as temporary, contextlib.ExitStack() as stack:
            project = Path(temporary) / folder
            project.mkdir()
            (project / "pyproject.toml").write_text(
                f'[project]\nname = "fixture"\nrequires-python = "{requirement}"\n', encoding="utf-8"
            )
            for filename in ("taskteam_main.py", "cli_main.py"):
                (project / filename).write_text("raise AssertionError('must not run')", encoding="utf-8")
            if environment:
                for relative in (".venv/bin/python", ".venv/Scripts/python.exe"):
                    executable = project / relative
                    executable.parent.mkdir(parents=True, exist_ok=True)
                    executable.write_text("not a real interpreter", encoding="utf-8")
            module = load_script(folder, name)
            if name == "setup" and folder == "backend_tools":
                stack.enter_context(patch.object(module, "BASE_DIR", project.parent))
            else:
                stack.enter_context(patch.object(module, COMPONENTS[folder], project))
            if name == "setup" and folder == "backend_server":
                stack.enter_context(patch.object(module, "BACKEND_VENV_DIR", project / ".venv"))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(patch.object(subprocess, "Popen", side_effect=AssertionError("launch forbidden")))
            stack.enter_context(patch.object(shutil, "which", return_value=None))
            if name == "setup":
                stack.enter_context(patch.object(module, "check_uv_installed", return_value=True))
                for hook in ("upsert_vscode_local_chat", "install_standalone_launcher", "ensure_python_module_attribute"):
                    if hasattr(module, hook):
                        stack.enter_context(patch.object(module, hook, return_value=True))
            yield module, project, output

    def test_installed_python_is_checked_on_windows_and_posix(self):
        for folder in COMPONENTS:
            for platform in ("win32", "linux"):
                for version in ("3.12.9", "3.13.0", "3.14.1"):
                    with self.subTest(folder=folder, platform=platform, version=version), self.fixture(folder) as (module, project, output):
                        with patch.object(module.sys, "platform", platform), patch.object(
                            subprocess, "run", return_value=SimpleNamespace(stdout=f"Python {version}\n", stderr="")
                        ) as probe:
                            ok, detail = module.check_environment()
                        self.assertTrue(ok, detail)
                        self.assertIn(">=3.13", detail + output.getvalue())
                        if version == "3.12.9":
                            self.assertIn("[WARN]", output.getvalue())
                        executable = project / (".venv/Scripts/python.exe" if platform == "win32" else ".venv/bin/python")
                        self.assertEqual(probe.call_args.args[0], [str(executable), "--version"])
                        self.assertEqual(probe.call_args.kwargs["stdin"], subprocess.DEVNULL)
                        self.assertEqual(probe.call_args.kwargs["timeout"], 15)

    def test_runtime_requirement_comes_from_module_metadata(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder, requirement=">=3.14") as (module, _, output):
                with patch.object(subprocess, "run", return_value=SimpleNamespace(stdout="Python 3.13.9", stderr="")):
                    ok, detail = module.check_environment()
                self.assertTrue(ok)
                self.assertIn(">=3.14", output.getvalue())
                self.assertIn("[WARN]", output.getvalue())

    def test_unknown_version_is_warning_only(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder) as (module, _, output):
                with patch.object(subprocess, "run", return_value=SimpleNamespace(stdout="Python custom build", stderr="")):
                    self.assertTrue(module.check_environment()[0])
                self.assertIn("[WARN]", output.getvalue())

    def test_broken_or_unreadable_installed_interpreter_is_an_error(self):
        for folder in COMPONENTS:
            for failure in (OSError("broken"), subprocess.TimeoutExpired("fixture", 15), subprocess.CalledProcessError(1, "fixture")):
                with self.subTest(folder=folder, failure=type(failure).__name__), self.fixture(folder) as (module, _, _):
                    with patch.object(subprocess, "run", side_effect=failure), patch.object(shutil, "which", return_value="uv"):
                        self.assertFalse(module.check_environment()[0])

    def test_uv_can_select_python_when_environment_is_not_created(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder, environment=False) as (module, _, _):
                with patch.object(subprocess, "run", side_effect=AssertionError("probe forbidden")), \
                     patch.object(shutil, "which", return_value="uv"):
                    ok, detail = module.check_environment()
                self.assertTrue(ok, detail)
                self.assertIn("uv", detail)
                self.assertIn(">=3.13", detail)

    def test_no_environment_and_no_uv_is_an_error(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder, environment=False) as (module, _, _):
                with patch.object(subprocess, "run", side_effect=AssertionError("probe forbidden")):
                    self.assertFalse(module.check_environment()[0])

    def test_failed_start_exits_before_stop_or_launch_and_names_its_setup(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder) as (module, project, output):
                with contextlib.ExitStack() as stack:
                    stack.enter_context(patch.object(module, "check_environment", return_value=(False, "fixture runtime error")))
                    stack.enter_context(patch.object(subprocess, "run", side_effect=AssertionError("process forbidden")))
                    if hasattr(module, "kill_ports"):
                        stack.enter_context(patch.object(module, "kill_ports", side_effect=AssertionError("stop forbidden")))
                    with self.assertRaises(SystemExit) as caught:
                        module.main()
                self.assertEqual(caught.exception.code, 1)
                self.assertIn(str(project / "_setup.py"), output.getvalue())

    def test_metadata_read_failure_does_not_add_a_new_fatal_check(self):
        for folder in COMPONENTS:
            for missing in (True, False):
                with self.subTest(folder=folder, missing=missing), self.fixture(folder) as (module, project, output):
                    metadata = project / "pyproject.toml"
                    if missing:
                        metadata.unlink()
                    else:
                        metadata.write_text('[project]\nname = "fixture"\n', encoding="utf-8")
                    with patch.object(subprocess, "run", return_value=SimpleNamespace(stdout="Python 3.13.0", stderr="")) as probe:
                        ok, _ = module.check_environment()
                    # 従来から存在する4 backendのmanifest存在確認だけは維持する。
                    if missing and folder != "command_hermes":
                        self.assertFalse(ok)
                        probe.assert_not_called()
                    else:
                        self.assertTrue(ok)
                        self.assertIn("[WARN]", output.getvalue())
                        probe.assert_called_once()

    def test_unknown_requirement_still_preserves_executable_failure(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder) as (module, project, _):
                (project / "pyproject.toml").write_text('[project]\nname = "fixture"\n', encoding="utf-8")
                with patch.object(subprocess, "run", side_effect=OSError("broken interpreter")):
                    self.assertFalse(module.check_environment()[0])

    def test_tools_keeps_cross_os_environment_repair_error(self):
        with self.fixture("backend_tools", environment=False) as (module, project, _):
            (project / ".venv").mkdir()
            with patch.object(shutil, "which", return_value="uv"):
                ok, detail = module.check_environment()
            self.assertFalse(ok)
            self.assertIn("現在の OS で使えない .venv", detail)

    def test_setup_reports_target_requirement_but_does_not_reject_old_host(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder, "setup", requirement=">=3.14") as (module, _, output):
                with patch.object(module.sys, "version_info", (3, 10, 0)), \
                     patch.object(subprocess, "run", side_effect=AssertionError("process forbidden")), \
                     patch.object(module, "run_command", return_value=True) as run:
                    ok = module.setup_mcp_module(module.MODULE) if folder == "backend_tools" else module.setup()
                self.assertTrue(ok)
                self.assertIn("Python >=3.14", output.getvalue())
                self.assertIn("uv が互換 Python を選択", output.getvalue())
                self.assertTrue(any(call.args[0][:3] == ["uv", "sync", "--upgrade"] for call in run.call_args_list))

    def test_setup_sync_error_is_not_warning_only(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder, "setup") as (module, _, _):
                with patch.object(subprocess, "run", side_effect=AssertionError("process forbidden")), \
                     patch.object(module, "run_command", return_value=False):
                    ok = module.setup_mcp_module(module.MODULE) if folder == "backend_tools" else module.setup()
                self.assertFalse(ok)

    def test_setup_undeclared_metadata_warns_and_leaves_validation_to_uv(self):
        for folder in COMPONENTS:
            with self.subTest(folder=folder), self.fixture(folder, "setup") as (module, project, output):
                (project / "pyproject.toml").write_text('[project]\nname = "fixture"\n', encoding="utf-8")
                with patch.object(subprocess, "run", side_effect=AssertionError("process forbidden")), \
                     patch.object(module, "run_command", return_value=True) as run:
                    ok = module.setup_mcp_module(module.MODULE) if folder == "backend_tools" else module.setup()
                self.assertTrue(ok)
                self.assertIn("[WARN]", output.getvalue())
                self.assertTrue(run.called)


if __name__ == "__main__":
    unittest.main()
