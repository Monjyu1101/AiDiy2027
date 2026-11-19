"""AiDiy Codex picker policy: compile actual helper functions without the full TUI graph."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
TUI = ROOT / 'command_codex/codex-rs/tui/src'


class CodexPickerTests(unittest.TestCase):
    def test_actual_catalog_policy_with_rust(self):
        rustc = os.environ.get('RUSTC') or shutil.which('rustc')
        if not rustc:
            self.skipTest('rustc required for isolated policy execution')
        source = (TUI / 'model_catalog.rs').read_text(encoding='utf-8')
        helpers = source[source.index('pub(crate) fn routable_picker_models'):source.index('#[cfg(test)]')]
        # Only dependency types are synthetic; production policy bodies are compiled unchanged.
        harness = '''
use std::collections::HashMap;
mod codex_protocol { pub mod openai_models {
    #[derive(Clone, Debug, PartialEq)]
    pub enum ReasoningEffort { Low, Medium, High, XHigh, Max }
    impl std::fmt::Display for ReasoningEffort {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "{}", match self { Self::Low => "low", Self::Medium => "medium",
                Self::High => "high", Self::XHigh => "xhigh", Self::Max => "max" })
        }
    }
    impl From<&str> for ReasoningEffort {
        fn from(s: &str) -> Self { match s { "low"=>Self::Low, "high"=>Self::High,
            "xhigh"=>Self::XHigh, "max"=>Self::Max, _=>Self::Medium } }
    }
    #[derive(Clone, Debug, PartialEq)]
    pub struct ReasoningEffortPreset { pub effort: ReasoningEffort, pub description: String }
    impl From<&str> for ReasoningEffortPreset {
        fn from(s: &str) -> Self { Self { effort:s.into(), description:s.into() } }
    }
}}
use codex_protocol::openai_models::{ReasoningEffort, ReasoningEffortPreset};
#[derive(Clone, Debug, PartialEq)]
struct ModelPreset { model: String, show_in_picker: bool, default_reasoning_effort: ReasoningEffort,
                     supported_reasoning_efforts: Vec<ReasoningEffortPreset> }
mod codex_model_provider_info {
    pub const AIDIY_CLI_PROVIDER: &str = "aidiy_cli";
    pub fn split_aidiy_model(s: &str) -> Option<(&str, &str)> {
        s.split_once('/').filter(|(p, _)| ["openai_oauth", "openai_chat", "claude_chat"].contains(p))
    }
    pub fn split_aidiy_cli_model(s: &str) -> Option<(&str, &str)> {
        s.split_once('/').filter(|(p, _)| *p == "copilot_cli")
    }
}
fn p(model: &str) -> ModelPreset { ModelPreset { model: model.into(), show_in_picker: true,
    default_reasoning_effort: "medium".into(), supported_reasoning_efforts: vec![] } }
''' + helpers + '''
#[test] fn duplicate_filter_is_ui_only_and_provider_scoped() {
    let models = vec![p("gpt-6.2-sol"), p("openai_oauth/gpt-6.2-sol"), p("openai_chat/gpt-6.2-sol"), p("other")];
    for provider in ["openai", "openai_chat"] {
        assert_eq!(routable_picker_models(models.clone(), provider).len(), 3);
    }
    assert_eq!(routable_picker_models(models.clone(), "custom"), models);
    let mut hidden = models.clone(); hidden[1].show_in_picker = false;
    assert_eq!(routable_picker_models(hidden.clone(), "openai"), hidden);
}
#[test] fn metadata_transfer_is_exact_and_preserves_existing() {
    let mut native = p("gpt-6.2-sol"); native.supported_reasoning_efforts = vec!["low".into(), "high".into()];
    native.default_reasoning_effort = "high".into();
    let mut existing = p("openai_chat/gpt-6.2-sol"); existing.supported_reasoning_efforts = vec!["medium".into()];
    let models = merge_aidiy_models(vec![native.clone(), existing.clone()], vec![p("openai_oauth/gpt-6.2-sol"), p("claude_chat/gpt-6.2-sol"), p("openai_chat/unknown")]);
    assert_eq!(models[0], native); assert_eq!(models[1], existing);
    assert_eq!(models[2].supported_reasoning_efforts, native.supported_reasoning_efforts);
    assert_eq!(models[2].default_reasoning_effort.to_string(), "high");
    assert!(models[3].supported_reasoning_efforts.is_empty());
    assert!(models[4].supported_reasoning_efforts.is_empty());
    assert_eq!(merge_aidiy_models(models.clone(), vec![]), models);
}
#[test] fn documented_62_fallback_only_when_metadata_missing() {
    for section in ["openai_oauth", "openai_chat"] {
        for slug in ["gpt-6.2-sol", "gpt-6.2-astra"] {
            let models = merge_aidiy_models(vec![], vec![p(&format!("{section}/{slug}"))]);
            assert_eq!(models[0].default_reasoning_effort.to_string(), "medium");
            assert_eq!(models[0].supported_reasoning_efforts.iter().map(|e| e.effort.to_string()).collect::<Vec<_>>(), vec!["low", "medium", "high", "xhigh", "max"]);
        }
    }
    for id in ["gpt-6.2-sol", "copilot_cli/gpt-6.2-sol", "openai_chat/gpt-6.2-sol-preview", "openai_chat/unknown"] {
        assert!(merge_aidiy_models(vec![], vec![p(id)])[0].supported_reasoning_efforts.is_empty());
    }
}
#[test] fn explicit_routes_and_legacy_openai_only() {
    for model in ["openai_oauth/gpt-6.2-sol", "openai_chat/gpt-6.2-sol"] {
        assert!(aidiy_effort_selection_allowed(model, "custom"));
    }
    assert!(aidiy_effort_selection_allowed("gpt-6.2-sol", "openai"));
    for model in ["gpt-6.2-sol", "openai_chat/", "claude_chat/model", "copilot_cli/model", "openrt_chat/openai/model", "ollama_chat/model"] {
        assert!(!aidiy_effort_selection_allowed(model, "custom"));
    }
}
'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'policy.rs'
            binary = Path(directory) / 'policy'
            path.write_text(harness, encoding='utf-8')
            subprocess.run([rustc, '--edition=2024', '--test', str(path), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

    def test_all_effort_ui_entry_points_use_policy(self):
        for name in ['model_popups.rs', 'model_command.rs', 'reasoning_shortcuts.rs', 'quick_dials.rs']:
            source = (TUI / 'chatwidget' / name).read_text(encoding='utf-8')
            self.assertIn('aidiy_effort_selection_allowed', source)
        popup = (TUI / 'chatwidget/model_popups.rs').read_text(encoding='utf-8')
        for method in ['open_reasoning_popup', 'open_advanced_reasoning_popup']:
            body = popup[popup.index('fn ' + method):]
            self.assertIn('aidiy_effort_selection_allowed', body[:600])
        command = (TUI / 'chatwidget/model_command.rs').read_text(encoding='utf-8')
        self.assertIn('chat.model_catalog.try_list_models()', command)


if __name__ == '__main__':
    unittest.main()
