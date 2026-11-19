//! TUI model and collaboration inventories; refreshing models preserves the server mode catalog.

use crate::backend_id::BackendId;
use codex_protocol::config_types::CollaborationModeMask;
use codex_protocol::openai_models::ModelPreset;
use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Held during the config RPC. A confirmed or possible switch makes this backend's untagged model list
/// unsafe to apply for the rest of this TUI session, including after reconnecting.
pub(crate) type ProviderWrite = Arc<Mutex<bool>>;

pub(crate) const LUNA_RESERVE_MODEL: &str = "gpt-reserve";
pub(crate) const LUNA_MODEL: &str = "gpt-6-luna";

pub(crate) fn model_display_name(model: &str) -> &str {
    if model.eq_ignore_ascii_case(LUNA_RESERVE_MODEL) {
        "Luna Reserve"
    } else {
        model
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ModelCatalog {
    pub(crate) backend: Option<BackendId>,
    pub(crate) provider_write: ProviderWrite,
    pub(crate) models: Vec<ModelPreset>,
    pub(crate) collaboration_modes: Vec<CollaborationModeMask>,
}

impl ModelCatalog {
    pub(crate) fn new(models: Vec<ModelPreset>) -> Self {
        Self {
            backend: None,
            provider_write: ProviderWrite::default(),
            models,
            collaboration_modes: Vec::new(),
        }
    }

    pub(crate) fn for_backend(
        mut self,
        backend: BackendId,
        writes: &mut HashMap<BackendId, ProviderWrite>,
    ) -> Self {
        self.backend = Some(backend);
        self.provider_write = writes.entry(backend).or_default().clone();
        self
    }

    pub(crate) fn provider_may_have_changed(&self) -> bool {
        self.provider_write
            .try_lock()
            .map_or(true, |changed| *changed)
    }

    pub(crate) fn with_collaboration_modes(mut self, modes: Vec<CollaborationModeMask>) -> Self {
        self.collaboration_modes = modes;
        self
    }

    pub(crate) fn try_list_models(&self) -> Result<Vec<ModelPreset>, Infallible> {
        Ok(Self::with_aidiy_models(self.models.clone()))
    }

    // AiDiy: キャッシュ表示・初回の非同期取得・更新後の表示で同じ候補を使う。
    pub(crate) fn with_aidiy_models(models: Vec<ModelPreset>) -> Vec<ModelPreset> {
        merge_aidiy_models(models, codex_model_provider_info::aidiy_model_presets())
    }

    pub(crate) fn display_name<'a>(&'a self, model: &'a str) -> &'a str {
        self.models
            .iter()
            .find(|preset| preset.model == model)
            .map(|preset| preset.display_name.as_str())
            .unwrap_or_else(|| model_display_name(model))
    }
}

// AiDiy: CLI で開始した session にサーバー既定の裸 GPT 候補を出さない。
// 裸 ID は開始時 provider に属するため、CLI のダミー接続先では実行できない。
pub(crate) fn routable_picker_models(models: Vec<ModelPreset>, provider: &str) -> Vec<ModelPreset> {
    // AiDiy: 表示だけを整理する。保存済み裸 ID と custom provider の候補は保持する。
    let oauth_models: std::collections::HashSet<String> = models
        .iter()
        .filter(|preset| preset.show_in_picker)
        .filter_map(|preset| {
            preset
                .model
                .strip_prefix("openai_oauth/")
                .map(str::to_owned)
        })
        .collect();
    if provider != codex_model_provider_info::AIDIY_CLI_PROVIDER {
        return models
            .into_iter()
            .filter(|preset| {
                !matches!(provider, "openai" | "openai_chat")
                    || !oauth_models.contains(&preset.model)
            })
            .collect();
    }
    models
        .into_iter()
        .filter(|preset| {
            codex_model_provider_info::split_aidiy_model(&preset.model).is_some()
                || codex_model_provider_info::split_aidiy_cli_model(&preset.model).is_some()
        })
        .collect()
}

// AiDiy: effort 選択は明示 OpenAI 区分に限定。裸 ID の実行互換性は変えない。
pub(crate) fn aidiy_effort_selection_allowed(model: &str, provider: &str) -> bool {
    matches!(model.split_once('/'), Some(("openai_oauth" | "openai_chat", name)) if !name.is_empty())
        || (!model.contains('/') && matches!(provider, "openai" | "openai_chat"))
}

// AiDiy: API 由来の能力メタデータは保持し、区分付き ID でのみ重複を除く。
fn merge_aidiy_models(mut models: Vec<ModelPreset>, aidiy: Vec<ModelPreset>) -> Vec<ModelPreset> {
    for preset in aidiy {
        if !models.iter().any(|existing| existing.model == preset.model) {
            models.push(preset);
        }
    }
    // 合成候補は能力情報を持たない。既知の同一 OpenAI モデルだけから effort を補完する。
    let capabilities = models
        .iter()
        .filter(|preset| !preset.model.contains('/'))
        .map(|preset| {
            (
                preset.model.clone(),
                (
                    preset.default_reasoning_effort.clone(),
                    preset.supported_reasoning_efforts.clone(),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    for preset in &mut models {
        if aidiy_effort_selection_allowed(&preset.model, "")
            && preset.supported_reasoning_efforts.is_empty()
        {
            if let Some((_, name)) = preset.model.split_once('/') {
                if let Some((default, supported)) = capabilities.get(name) {
                    if !supported.is_empty() {
                        preset.default_reasoning_effort = default.clone();
                        preset.supported_reasoning_efforts = supported.clone();
                    }
                }
                // AiDiy: 公式モデル一覧 (2026-11-19) の明示値だけを UI の不足時に補完。
                // https://developers.openai.com/api/docs/models
                // API-key 接続は catalog discovery 非対応の場合がある。未知モデルへは広げない。
                if preset.supported_reasoning_efforts.is_empty()
                    && matches!(name, "gpt-6.2-sol" | "gpt-6.2-astra")
                {
                    use codex_protocol::openai_models::ReasoningEffort;
                    use codex_protocol::openai_models::ReasoningEffortPreset;
                    preset.default_reasoning_effort = ReasoningEffort::Medium;
                    preset.supported_reasoning_efforts = [
                        ReasoningEffort::Low,
                        ReasoningEffort::Medium,
                        ReasoningEffort::High,
                        ReasoningEffort::XHigh,
                        ReasoningEffort::Max,
                    ]
                    .into_iter()
                    .map(|effort| ReasoningEffortPreset {
                        description: effort.to_string(),
                        effort,
                    })
                    .collect();
                }
            }
        }
    }
    models
}

#[cfg(test)]
mod aidiy_tests {
    use super::*;

    fn preset(model: &str) -> ModelPreset {
        serde_json::from_value(serde_json::json!({
            "id": model, "model": model, "display_name": model, "description": "",
            "default_reasoning_effort": "medium", "supported_reasoning_efforts": [],
            "is_default": false, "upgrade": null, "show_in_picker": true,
            "availability_nux": null, "supported_in_api": true, "input_modalities": ["text"]
        }))
        .unwrap()
    }

    #[test]
    fn cli_start_hides_unqualified_server_fallbacks_but_keeps_all_routes() {
        let models = vec![
            preset("gpt-6-luna"),
            preset("codex-auto-fast"),
            preset("openai_oauth/gpt-6-luna"),
            preset("openrt_chat/vendor/model"),
            preset("copilot_cli/same"),
            preset("unknown/model"),
        ];
        let filtered = routable_picker_models(
            models.clone(),
            codex_model_provider_info::AIDIY_CLI_PROVIDER,
        );
        assert_eq!(
            filtered
                .iter()
                .map(|p| p.model.as_str())
                .collect::<Vec<_>>(),
            vec![
                "openai_oauth/gpt-6-luna",
                "openrt_chat/vendor/model",
                "copilot_cli/same"
            ]
        );
        assert_eq!(routable_picker_models(models.clone(), "openai"), models);
    }

    #[test]
    fn openai_picker_deduplicates_only_usable_oauth_equivalents() {
        let mut hidden = preset("openai_oauth/hidden");
        hidden.show_in_picker = false;
        let models = vec![
            preset("gpt-6.2-sol"),
            preset("openai_oauth/gpt-6.2-sol"),
            preset("openai_chat/gpt-6.2-sol"),
            preset("other"),
            preset("hidden"),
            hidden,
        ];
        let filtered = routable_picker_models(models.clone(), "openai");
        assert!(!filtered.iter().any(|p| p.model == "gpt-6.2-sol"));
        assert!(filtered.iter().any(|p| p.model == "hidden"));
        assert!(filtered.iter().any(|p| p.model == "other"));
        assert_eq!(routable_picker_models(models.clone(), "custom"), models);
        // 元の catalog は残り、保存済み bare ID の解決には影響しない。
        assert!(models.iter().any(|p| p.model == "gpt-6.2-sol"));
    }

    #[test]
    fn only_openai_routes_borrow_exact_known_effort_metadata() {
        let mut native = preset("gpt-6.2-sol");
        native.supported_reasoning_efforts = serde_json::from_value(serde_json::json!([
            {"effort": "low", "description": "Low"},
            {"effort": "high", "description": "High"}
        ]))
        .unwrap();
        let models = merge_aidiy_models(
            vec![native.clone()],
            vec![
                preset("openai_oauth/gpt-6.2-sol"),
                preset("openai_chat/gpt-6.2-sol"),
                preset("openai_chat/unknown"),
                preset("claude_chat/gpt-6.2-sol"),
                preset("copilot_cli/gpt-6.2-sol"),
            ],
        );
        for model in &models[1..3] {
            assert_eq!(
                model.supported_reasoning_efforts,
                native.supported_reasoning_efforts
            );
            assert_eq!(
                model.default_reasoning_effort,
                native.default_reasoning_effort
            );
        }
        for model in &models[3..] {
            assert!(model.supported_reasoning_efforts.is_empty());
        }
        assert_eq!(models[0], native);
        assert_eq!(merge_aidiy_models(models.clone(), Vec::new()), models);
    }

    #[test]
    fn documented_62_fallback_is_exact_and_does_not_infer_other_models() {
        for section in ["openai_oauth", "openai_chat"] {
            for slug in ["gpt-6.2-sol", "gpt-6.2-astra"] {
                let models =
                    merge_aidiy_models(Vec::new(), vec![preset(&format!("{section}/{slug}"))]);
                assert_eq!(models[0].default_reasoning_effort.to_string(), "medium");
                assert_eq!(
                    models[0]
                        .supported_reasoning_efforts
                        .iter()
                        .map(|option| option.effort.to_string())
                        .collect::<Vec<_>>(),
                    vec!["low", "medium", "high", "xhigh", "max"]
                );
            }
        }
        for id in [
            "gpt-6.2-sol",
            "claude_chat/gpt-6.2-sol",
            "openai_chat/gpt-6.2-sol-preview",
            "openai_chat/unknown",
            "openrt_chat/gpt-6.2-astra",
        ] {
            assert!(
                merge_aidiy_models(Vec::new(), vec![preset(id)])[0]
                    .supported_reasoning_efforts
                    .is_empty()
            );
        }
    }

    #[test]
    fn effort_ui_is_limited_to_openai_routes_and_legacy_openai_sessions() {
        assert!(aidiy_effort_selection_allowed("gpt-6.2-sol", "openai"));
        assert!(aidiy_effort_selection_allowed("gpt-6.2-sol", "openai_chat"));
        for id in ["openai_oauth/gpt-6.2-sol", "openai_chat/gpt-6.2-sol"] {
            assert!(aidiy_effort_selection_allowed(id, "custom"));
        }
        for id in [
            "gpt-6.2-sol",
            "openai_chat/",
            "claude_chat/model",
            "copilot_cli/model",
            "openrt_chat/openai/model",
            "ollama_chat/model",
            "local_chat/model",
            "xai_oauth/model",
        ] {
            assert!(!aidiy_effort_selection_allowed(id, "custom"));
        }
    }

    #[test]
    fn catalog_keeps_distinct_providers_and_existing_capabilities() {
        let mut existing = preset("openai_oauth/shared");
        existing.description = "server metadata".into();
        let models = merge_aidiy_models(
            vec![existing.clone()],
            vec![
                preset("openai_oauth/shared"),
                preset("openai_chat/shared"),
                preset("copilot_cli/shared"),
                preset("openrt_chat/vendor/nested"),
            ],
        );
        assert_eq!(models.len(), 4);
        assert_eq!(models[0], existing);
        assert_eq!(merge_aidiy_models(models.clone(), models.clone()), models);
    }
}
