//! AiDiy's dedicated, process-wide inference-only child. This switch is one-way:
//! it is set before startup and cannot be relaxed by config reloads or RPC turns.
use std::sync::atomic::{AtomicBool, Ordering};

static ENABLED: AtomicBool = AtomicBool::new(false);

pub const INSTRUCTIONS: &str = "You are an inference engine for the parent AiDiy harness. Follow the supplied conversation and output schema. Return requested parent tool calls as JSON data only. Never execute tools, access files, spawn agents, or delegate to another CLI. The parent harness alone executes tools and supplies their results.";

pub fn enable() {
    ENABLED.store(true, Ordering::SeqCst);
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

pub(crate) fn tool_policy() -> codex_extension_api::ToolPolicy {
    codex_extension_api::ToolPolicy {
        allowed_tools: Some(Vec::new()),
        expose_additional_permissions: false,
        ..Default::default()
    }
}

pub fn validate_model(model: Option<&str>, provider: &str) -> anyhow::Result<()> {
    if provider == codex_model_provider_info::AIDIY_CLI_PROVIDER
        || model.is_some_and(|m| codex_model_provider_info::split_aidiy_cli_model(m).is_some())
    {
        anyhow::bail!("--aidiy-inference-only requires an API/OAuth model, not a CLI model");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inference_policy_allows_no_tools() {
        let policy = tool_policy();
        assert!(policy.allowed_tools.as_ref().is_some_and(Vec::is_empty));
        assert!(!policy.expose_additional_permissions);
        for name in ["exec_command", "apply_patch", "spawn_agent", "tool_search"] {
            assert!(!policy.allows(&codex_extension_api::ToolName::plain(name)));
        }
        assert!(!policy.allows(&codex_extension_api::ToolName::namespaced("web", "run")));
        assert!(!policy.allows(&codex_extension_api::ToolName::namespaced("mcp", "read")));
    }

    #[test]
    fn cli_recursion_is_rejected() {
        assert!(validate_model(Some("codex_cli/same"), "openai").is_err());
        assert!(validate_model(Some("gpt-6-luna"), "aidiy_cli").is_err());
        assert!(validate_model(Some("openai_oauth/gpt-6-luna"), "openai").is_ok());
        assert!(validate_model(None, "openai").is_ok());
    }
}
