//! AiDiy: 外部 CLI の識別と Diag の全区分モデル一覧。
//! API / OAuth の認証は親、CLI 区分の認証は子 CLI が担当する。

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

/// AiDiy: Diag と同じ API / OAuth / CLI の全候補を返す。
pub fn aidiy_model_presets() -> Vec<ModelPreset> {
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
    model_presets(&catalog)
}

pub fn aidiy_cli_presets() -> Vec<ModelPreset> {
    aidiy_model_presets()
        .into_iter()
        .filter(|p| split_aidiy_cli_model(&p.model).is_some())
        .collect()
}

fn model_presets(catalog: &Value) -> Vec<ModelPreset> {
    let mut presets = Vec::new();
    let Some(sections) = catalog.as_object() else {
        return presets;
    };
    for (section, entry) in sections {
        let is_cli = AIDIY_CLI_SECTIONS.contains(&section.as_str());
        if !is_cli
            && section != crate::aidiy_sections::AIDIY_OPENAI_OAUTH_SECTION
            && !crate::aidiy_sections::AIDIY_SECTIONS.contains(&section.as_str())
        {
            continue;
        }
        let Some(models) = entry["models"].as_object() else {
            continue;
        };
        for (model, description) in models {
            let route = format!("{section}/{model}");
            if model.trim().is_empty()
                || model == "auto"
                || (!is_cli && model == "same")
                || model.len() > 300
                || model.chars().any(char::is_control)
                || (is_cli && split_aidiy_cli_model(&route).is_none())
            {
                continue;
            }
            let Some(description) = description.as_str() else {
                continue;
            };
            if let Ok(preset) = serde_json::from_value(json!({
                "id": route, "model": route, "display_name": route,
                "description": description,
                "default_reasoning_effort": "medium", "supported_reasoning_efforts": [],
                "is_default": false, "upgrade": null, "show_in_picker": true,
                "availability_nux": null, "supported_in_api": true, "input_modalities": ["text"]
            })) {
                presets.push(preset);
            }
        }
    }
    presets.sort_by(|a, b| a.model.cmp(&b.model));
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
    fn picker_includes_api_oauth_and_cli_models_and_preserves_routes() {
        let presets = model_presets(&json!({
            "codex_cli": {"models": {"same": "変更なし", "auto": "自動", "gpt-6-luna": "Luna"}},
            "opencode_cli": {"models": {"openai/gpt-6-luna": "Luna"}},
            "openai_chat": {"models": {"gpt-6-luna": "API"}}
        }));
        assert_eq!(presets.len(), 4);
        assert!(presets.iter().any(|p| p.model == "openai_chat/gpt-6-luna"));
        assert!(presets.iter().any(|p| p.model == "codex_cli/same"));
        assert!(
            presets
                .iter()
                .any(|p| p.model == "opencode_cli/openai/gpt-6-luna")
        );
    }
}

#[cfg(test)]
mod catalog_tests {
    use super::*;

    #[test]
    fn all_supported_sections_are_visible_without_merging_same_named_models() {
        let mut catalog = serde_json::Map::new();
        for section in crate::aidiy_sections::AIDIY_SECTIONS
            .iter()
            .chain(std::iter::once(
                &crate::aidiy_sections::AIDIY_OPENAI_OAUTH_SECTION,
            ))
            .chain(AIDIY_CLI_SECTIONS.iter())
        {
            catalog.insert(
                (*section).into(),
                json!({"models": {"shared": "同名", "vendor/nested": "入れ子"}}),
            );
        }
        let presets = model_presets(&Value::Object(catalog));
        assert_eq!(
            presets.len(),
            (crate::aidiy_sections::AIDIY_SECTIONS.len() + 1 + AIDIY_CLI_SECTIONS.len()) * 2
        );
        assert!(presets.windows(2).all(|p| p[0].model < p[1].model));
        assert!(
            presets
                .iter()
                .all(|p| p.show_in_picker && p.model == p.display_name)
        );
    }

    #[test]
    fn invalid_entries_and_recursive_harnesses_are_excluded() {
        let presets = model_presets(&json!({
            "aidiy_codex": {"models": {"same": "再帰"}},
            "unknown": {"models": {"a": "未知"}},
            "openai_chat": {"models": {"": "空", "auto": "自動", "same": "既定", "bad\nname": "改行", "not-label": 2}},
            "copilot_cli": {"models": {"same": "既定"}}
        }));
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].model, "copilot_cli/same");
    }
}
