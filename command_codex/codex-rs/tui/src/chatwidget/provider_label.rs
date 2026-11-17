// AiDiy: footer-only provider/model formatting; never changes routing IDs.
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

#[cfg(test)]
mod tests {
    use super::model_provider_label;

    #[test]
    fn aidiy_footer_provider_labels() {
        for (model, provider, expected) in [
            ("gpt-6.1-sol", "openai", "openai/gpt-6.1-sol"),
            (
                "openai_oauth/gpt-6.1-sol",
                "openai",
                "openai_oauth/gpt-6.1-sol",
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
