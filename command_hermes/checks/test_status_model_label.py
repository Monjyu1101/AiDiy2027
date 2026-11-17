"""状態バーの provider/model と狭い端末幅のオフライン回帰。"""
import ast
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'base')]
from hermes_cli.aidiy_model_preferences import status_model_display_name

# SDK・実キーを読み込まず、実際の TUI メソッドをそのまま検証する。
tree = ast.parse((ROOT / 'cli_main.py').read_text(encoding='utf-8'))
source = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'HermesCLI')
names = {'_get_status_model_label', '_status_bar_display_width', '_trim_status_bar_text',
         '_right_align_status_title', '_right_align_status_title_fragments'}
cls = ast.ClassDef(name='Footer', bases=[], keywords=[], decorator_list=[],
                  body=[n for n in source.body if isinstance(n, ast.FunctionDef) and n.name in names])
ns = {'status_model_display_name': status_model_display_name}
exec(compile(ast.fix_missing_locations(ast.Module(body=[cls], type_ignores=[])), str(ROOT / 'cli_main.py'), 'exec'), ns)
Footer = ns['Footer']


class StatusModelTests(unittest.TestCase):
    def test_provider_types(self):
        for provider, model, expected in [
            ('copilot-cli', 'claude-sonnet-5.5', 'copilot_cli/claude-sonnet-5.5'),
            ('openai_oauth', 'gpt-6.1-sol', 'openai_oauth/gpt-6.1-sol'),
            ('openai-codex', 'gpt-6.1-sol', 'openai_oauth/gpt-6.1-sol'),
            ('openai', 'gpt-6.1-sol', 'openai_chat/gpt-6.1-sol'),
            ('openrt_chat', 'anthropic/claude-sonnet-5.5', 'openrt_chat/anthropic/claude-sonnet-5.5'),
            ('custom:local', 'model.gguf', 'custom:local/model.gguf'),
            ('copilot-cli', 'auto', 'copilot_cli/auto'),
            ('copilot-cli', 'same', 'copilot_cli/same'),
            ('copilot-cli', 'copilot_cli/claude-sonnet-5.5', 'copilot_cli/claude-sonnet-5.5'),
            ('openai_oauth', 'openai_oauth/gpt-6.1-sol', 'openai_oauth/gpt-6.1-sol'),
            ('auto', '', '自動選択'),
        ]:
            with self.subTest(provider=provider, model=model):
                self.assertEqual(status_model_display_name(model, provider), expected)

    def test_switch_fallback_and_restore(self):
        footer = Footer()
        footer._current_aidiy_provider_slug = lambda: 'copilot-cli'
        agent = SimpleNamespace(provider='custom')
        self.assertEqual(footer._get_status_model_label(agent, 'claude-sonnet-5.5'), 'copilot_cli/claude-sonnet-5.5')
        agent.provider, agent._fallback_activated = 'openai-codex', True
        self.assertEqual(footer._get_status_model_label(agent, 'gpt-6.1-sol'), 'openai_oauth/gpt-6.1-sol')
        agent._fallback_activated = False
        self.assertEqual(footer._get_status_model_label(agent, 'claude-sonnet-5.5'), 'copilot_cli/claude-sonnet-5.5')
        footer._current_aidiy_provider_slug = lambda: 'gemini'
        self.assertEqual(footer._get_status_model_label(None, 'gemini-test'), 'gemini_chat/gemini-test')

    def test_terminal_widths(self):
        for width in (20, 40, 51, 52, 75, 76, 100, 160):
            for title in ('', '今日の作業'):
                label = '⚕ ' + status_model_display_name('claude-sonnet-5.5', 'copilot-cli')
                text = Footer._right_align_status_title(label, title, width)
                self.assertLessEqual(Footer._status_bar_display_width(text), width)
                if width == 160:
                    self.assertIn('copilot_cli/claude-sonnet-5.5', text)
                frags = Footer._right_align_status_title_fragments([('model', label)], title, width)
                # Styled footer applies its existing final cell-width trim.
                rendered = Footer._trim_status_bar_text(''.join(t for _, t in frags), width)
                self.assertLessEqual(Footer._status_bar_display_width(rendered), width)
                self.assertNotIn('\n', rendered)


if __name__ == '__main__':
    unittest.main()
