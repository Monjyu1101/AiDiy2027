"""AiDiy must not contact upstream CLI release services or use their cache."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class UpstreamUpdateTests(unittest.TestCase):
    def test_release_tui_entries(self):
        rustc = os.environ.get("RUSTC") or shutil.which("rustc")
        if not rustc:
            self.skipTest("rustc is required for the release entry point tests")
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / ("updates.exe" if os.name == "nt" else "updates")
            subprocess.run([rustc, "--edition=2024", "--test", "-C", "debug-assertions=no",
                            str(ROOT / "scripts/checks/codex_updates.rs"), "-o", str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

    def test_cli_doctor_has_no_release_probe(self):
        source = (ROOT / "command_codex/codex-rs/cli/src/doctor/updates.rs").read_text(encoding="utf-8")
        for removed in ("GITHUB_LATEST_RELEASE_URL", "HOMEBREW_CASK_API_URL",
                        "fetch_latest_version", "push_cached_version_details"):
            self.assertNotIn(removed, source)
        self.assertIn("upstream CLI update checks are disabled", source)
        # Explicit diagnostics for a separate installed Desktop app are intact.
        self.assertIn("async fn append_desktop_update", source)


if __name__ == "__main__":
    unittest.main()
