// AiDiy: provider/model display formatting; never changes routing or authentication IDs.
pub(super) fn model_provider_label(model: &str, provider: &str) -> String {
    let model = model.trim();
    if codex_model_provider_info::split_aidiy_model(model).is_some()
        || codex_model_provider_info::split_aidiy_cli_model(model).is_some()
        || model
            .strip_prefix(provider)
            .is_some_and(|rest| rest.starts_with('/'))
    {
        return model.to_string();
    }
    format!("{provider}/{model}")
}

// AiDiy: model sections determine the route for each turn. The session config's
// provider may still describe the provider used before /model switched it.
// Use the raw selected model ID, never a friendly catalog display name.
pub(super) fn selected_provider_label<'a>(model: &'a str, configured_provider: &'a str) -> &'a str {
    codex_model_provider_info::split_aidiy_model(model)
        .or_else(|| codex_model_provider_info::split_aidiy_cli_model(model))
        .map_or(configured_provider, |(section, _)| section)
}

#[cfg(test)]
mod tests {
    use super::model_provider_label;
    use super::selected_provider_label;

    #[test]
    fn selected_provider_follows_model_in_both_switch_directions() {
        for (model, configured, expected) in [
            ("openai_oauth/gpt-6.2-sol", "openai_chat", "openai_oauth"),
            ("openai_chat/gpt-6.2-sol", "openai", "openai_chat"),
            ("openai_oauth/gpt-6.2-sol", "openai", "openai_oauth"),
            ("copilot_cli/same", "openai_chat", "copilot_cli"),
            (
                "openrt_chat/anthropic/claude-sonnet",
                "openai",
                "openrt_chat",
            ),
            ("gpt-6.2-sol", "custom", "custom"),
            ("custom/model", "gateway", "gateway"),
            ("openai_oauth/", "custom", "custom"),
        ] {
            assert_eq!(selected_provider_label(model, configured), expected);
        }
    }

    #[test]
    fn aidiy_footer_provider_labels() {
        for (model, provider, expected) in [
            ("gpt-6.2-sol", "openai", "openai/gpt-6.2-sol"),
            (
                "openai_oauth/gpt-6.2-sol",
                "openai",
                "openai_oauth/gpt-6.2-sol",
            ),
            (
                "copilot_cli/claude-sonnet-5.5",
                "aidiy_cli",
                "copilot_cli/claude-sonnet-5.5",
            ),
            (
                "openrt_chat/anthropic/claude-sonnet",
                "openrt_chat",
                "openrt_chat/anthropic/claude-sonnet",
            ),
            (
                "anthropic/claude-sonnet",
                "openrouter",
                "openrouter/anthropic/claude-sonnet",
            ),
            ("custom/model", "custom", "custom/model"),
        ] {
            assert_eq!(model_provider_label(model, provider), expected);
        }
    }
}
