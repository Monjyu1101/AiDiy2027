//! AiDiy: 外部 CLI の識別と Diag のモデル一覧。認証・API 接続は子 CLI が担当する。

use codex_protocol::openai_models::ModelPreset;
use serde_json::Value;
use serde_json::json;

pub const AIDIY_CLI_PROVIDER: &str = "aidiy_cli";
pub const AIDIY_CLI_SECTIONS: &[&str] = &[
    "claude_cli",
    "antigravity_cli",
    "codex_cli",
    "copilot_cli",
    "opencode_cli",
    "grok_cli",
];

pub fn split_aidiy_cli_model(model: &str) -> Option<(&str, &str)> {
    let (section, model) = model.split_once('/')?;
    (AIDIY_CLI_SECTIONS.contains(&section)
        && !model.trim().is_empty()
        && model.len() <= 300
        && !model.chars().any(char::is_control))
    .then_some((section, model))
}

pub fn aidiy_cli_presets() -> Vec<ModelPreset> {
    let Some(root) = crate::aidiy_sections::aidiy_root() else {
        return Vec::new();
    };
    let Ok(text) =
        std::fs::read_to_string(root.join("_AIDIY/aidiy_diag/aidiy_codex_models_info.json"))
    else {
        return Vec::new();
    };
    let Ok(catalog) = serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) else {
        return Vec::new();
    };
    cli_presets(&catalog)
}

fn cli_presets(catalog: &Value) -> Vec<ModelPreset> {
    let mut presets = Vec::new();
    for section in AIDIY_CLI_SECTIONS {
        let Some(models) = catalog[section]["models"].as_object() else {
            continue;
        };
        for (model, description) in models {
            let route = format!("{section}/{model}");
            if model == "auto" || split_aidiy_cli_model(&route).is_none() {
                continue;
            }
            if let Ok(preset) = serde_json::from_value(json!({
                "id": route, "model": route, "display_name": route,
                "description": format!("外部 CLI に委譲: {}", description.as_str().unwrap_or(model)),
                "default_reasoning_effort": "medium", "supported_reasoning_efforts": [],
                "is_default": false, "upgrade": null, "show_in_picker": true,
                "availability_nux": null, "supported_in_api": true, "input_modalities": ["text"]
            })) {
                presets.push(preset);
            }
        }
    }
    presets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_preserve_nested_models_and_disallow_recursive_harnesses() {
        assert_eq!(
            split_aidiy_cli_model("opencode_cli/openai/gpt-6-luna"),
            Some(("opencode_cli", "openai/gpt-6-luna"))
        );
        assert_eq!(
            split_aidiy_cli_model("codex_cli/same"),
            Some(("codex_cli", "same"))
        );
        for invalid in [
            "aidiy_codex/codex_cli/same",
            "aidiy_pi/same",
            "codex_cli/",
            "codex_cli/a\nb",
        ] {
            assert!(split_aidiy_cli_model(invalid).is_none());
        }
    }

    #[test]
    fn picker_includes_only_cli_models_and_preserves_same() {
        let presets = cli_presets(&json!({
            "codex_cli": {"models": {"same": "変更なし", "auto": "自動", "gpt-6-luna": "Luna"}},
            "opencode_cli": {"models": {"openai/gpt-6-luna": "Luna"}},
            "openai_chat": {"models": {"gpt-6-luna": "API"}}
        }));
        assert_eq!(presets.len(), 3);
        assert!(presets.iter().any(|p| p.model == "codex_cli/same"));
        assert!(
            presets
                .iter()
                .any(|p| p.model == "opencode_cli/openai/gpt-6-luna")
        );
    }
}
