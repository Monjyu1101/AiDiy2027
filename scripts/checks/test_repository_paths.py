"""Windows clone path budget and short Codex snapshot aliases.

Run: python -m unittest discover -s scripts/checks -p test_repository_paths.py
"""
import json
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
# Leave 79 UTF-16 code units for the checkout root and separator under MAX_PATH.
MAX_RELATIVE_PATH = 180
MAX_FILENAME = 70


def checkout_paths():
    result = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
    ).decode("utf-8")
    return [p for p in set(result.split("\0")) if p and (ROOT / p).exists()]


class RepositoryPathTests(unittest.TestCase):
    def test_checkout_paths_fit_windows_budget(self):
        oversized = [p for p in checkout_paths()
                     if len(p.encode("utf-16-le")) // 2 > MAX_RELATIVE_PATH]
        self.assertEqual(oversized, [], "Shorten paths instead of relying on long-path mode")

    def test_filenames_fit_target(self):
        oversized = [p for p in checkout_paths()
                     if len(Path(p).name.encode("utf-16-le")) // 2 > MAX_FILENAME]
        self.assertEqual(oversized, [], "Keep individual filenames within 70 characters")

    def test_snapshot_paths_are_case_insensitively_unique(self):
        seen = {}
        for path in checkout_paths():
            if not path.endswith(".snap"):
                continue
            key = path.casefold()
            self.assertNotIn(key, seen, f"Windows snapshot collision: {path}")
            seen[key] = path

    def test_aliases_preserve_unsuffixed_names_and_windows_branch(self):
        # These 31 assertions had no @suffix variants before the rename.
        aliases = json.loads(Path(__file__).with_name("codex_snapshot_aliases.json").read_text())
        for entry in aliases:
            with self.subTest(alias=entry["alias"]):
                snap = ROOT / entry["snapshot"]
                self.assertEqual(list(snap.parent.glob(entry["alias"] + "@*.snap")), [])
                source = (ROOT / entry["source"]).read_text(encoding="utf-8")
                self.assertNotRegex(source, r"(?:set_snapshot_suffix|snapshot_suffix\s*=>)")
                # Scope changes only the filename prefix; do not clear inherited settings.
                self.assertRegex(source, (
                    r"with_settings!\(\{prepend_module_to_snapshot => false\}, \{\s*"
                    r'(?:insta::)?assert_snapshot!\(\s*"' + re.escape(entry["alias"]) + r'"'
                ))
        source = (ROOT / "command_codex/codex-rs/tui/src/external_agent_config_migration/mod.rs").read_text()
        self.assertRegex(source, (
            r"#\[cfg\(windows\)\]\s*insta::with_settings!\("
            r"\{prepend_module_to_snapshot => false\}, \{\s*"
            r'assert_snapshot!\(\s*"customize_windows"'
        ))
        self.assertRegex(source, (
            r"#\[cfg\(not\(windows\)\)\]\s*insta::with_settings!\("
            r"\{prepend_module_to_snapshot => false\}, \{\s*"
            r'assert_snapshot!\("external_agent_config_migration_customize_action"'
        ))

    def test_snapshot_manifest_covers_all_files_and_preserves_suffixes(self):
        entries = json.loads(Path(__file__).with_name("codex_snapshot_renames.json").read_text())
        seen = set()
        for entry in entries:
            with self.subTest(path=entry["new"]):
                key = entry["new"].casefold()
                self.assertNotIn(key, seen)
                seen.add(key)
                self.assertTrue((ROOT / entry["new"]).is_file())
                old_suffix = Path(entry["old"]).stem.partition("@")[2]
                new_suffix = Path(entry["new"]).stem.partition("@")[2]
                self.assertEqual(old_suffix, new_suffix)
        actual = {str(p.relative_to(ROOT)).casefold()
                  for p in (ROOT / "command_codex/codex-rs").rglob("*.snap")}
        self.assertEqual(seen, actual)

    def test_snapshot_aliases_match_assertions_and_sources(self):
        aliases = json.loads((Path(__file__).with_name("codex_snapshot_aliases.json")).read_text())
        seen = set()
        for entry in aliases:
            with self.subTest(alias=entry["alias"]):
                snap = ROOT / entry["snapshot"]
                self.assertNotIn(entry["snapshot"], seen)
                seen.add(entry["snapshot"])
                self.assertEqual(snap.name, entry["alias"] + ".snap")
                self.assertLessEqual(len(snap.name), 70)
                self.assertIn(
                    "source: " + entry["source"].removeprefix("command_codex/codex-rs/"),
                    snap.read_text(encoding="utf-8"),
                )
                source = (ROOT / entry["source"]).read_text(encoding="utf-8")
                self.assertRegex(source, r"with_settings!\(\{prepend_module_to_snapshot => false\}")
                self.assertEqual(len(re.findall(
                    r'assert_snapshot!\(\s*"' + re.escape(entry["alias"]) + r'"\s*,', source
                )), 1)


if __name__ == "__main__":
    unittest.main()
