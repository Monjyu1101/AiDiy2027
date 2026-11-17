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
    if provider != codex_model_provider_info::AIDIY_CLI_PROVIDER {
        return models;
    }
    models
        .into_iter()
        .filter(|preset| {
            codex_model_provider_info::split_aidiy_model(&preset.model).is_some()
                || codex_model_provider_info::split_aidiy_cli_model(&preset.model).is_some()
        })
        .collect()
}

// AiDiy: API 由来の能力メタデータは保持し、区分付き ID でのみ重複を除く。
fn merge_aidiy_models(mut models: Vec<ModelPreset>, aidiy: Vec<ModelPreset>) -> Vec<ModelPreset> {
    for preset in aidiy {
        if !models.iter().any(|existing| existing.model == preset.model) {
            models.push(preset);
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
