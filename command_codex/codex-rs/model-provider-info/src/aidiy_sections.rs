// AiDiy: `--model <区分>/<モデル名>` の区分から、内部で使う接続先を決める。
//
// AiDiy（Hermes / Pi / aidiy_diag のモデル一覧）はモデルを `gemini_chat/gemini-3-pro` のように区分名付きで扱う。
// aidiy_codex でも `--model` などの元のパラメータは区分名付きのまま持ち回し、接続先はモデル名の区分から
// 内部で決める（`model_provider` の選択肢・組み込みプロバイダ一覧は増やさない）。
// 区分を外すのは API へ送るモデル名だけ（`aidiy_api_model`）。openai_oauth は組み込みの `openai`。
//
// 接続方法は AiDiy Hermes（command_hermes/cli_main.py）・Pi（command_pi/aidiy/aidiy-providers.ts）に合わせる:
// - openai_chat:  OpenAI API キー（Responses API。Pi と同じ）
// - xai_oauth:    xAI（Chat Completions。xAI の Responses は Codex の namespace / custom ツールを受け付けない）。
//                 トークンは Grok の共有ログインから取る（login の aidiy_grok.rs。Rust 実装）
// - claude_chat:  Anthropic Messages API（Hermes / Pi と同じ）
// - gemini_chat / freeai_chat: Google の OpenAI 互換 Chat Completions（Hermes と同じ）
// - openrt_chat / openrt_free / local_chat: Chat Completions
// - ollama_chat:  キーがあれば Ollama Cloud、無ければローカル（Hermes と同じ。Chat Completions）
// キーは AiDiy の `_config/AiDiy_key.json` から読む（Hermes / Pi と同じキー名）。AiDiy の場所は
// 実行ファイルと同じフォルダの `aidiy_codex_settings.json` の `aidiy_root`（command_codex/_compile.py が書き出す。手修正可）。

use crate::ModelProviderInfo;
use serde_json::Value;
use serde_json::json;
use std::path::Path;
use std::path::PathBuf;

/// 組み込みの openai（ChatGPT ログイン）で動く区分。
pub const AIDIY_OPENAI_OAUTH_SECTION: &str = "openai_oauth";
/// aidiy_codex の設定ファイル（実行ファイルと同じフォルダ）。`aidiy_root`（AiDiy の場所）と
/// `client_version`（送る版番号。codex-login の aidiy_settings.rs）を持つ。
pub const AIDIY_SETTINGS_FILE: &str = "aidiy_codex_settings.json";
/// 設定ファイルの AiDiy の場所の項目名。
const AIDIY_ROOT_KEY: &str = "aidiy_root";

/// xai_oauth のトークン取得に使う内部の名前。`auth.command` がこれなら外部コマンドを起動せず、
/// codex-login の aidiy_grok.rs が Grok の共有ログイン（~/.grok/auth.json）から取り出す。
pub const AIDIY_GROK_AUTH_COMMAND: &str = "aidiy:grok-login";

/// openai_oauth 以外の AiDiy の区分。区分名がそのままモデルプロバイダ ID になる。
pub const AIDIY_SECTIONS: &[&str] = &[
    "openai_chat",
    "xai_oauth",
    "claude_chat",
    "gemini_chat",
    "freeai_chat",
    "openrt_chat",
    "openrt_free",
    "ollama_chat",
    "local_chat",
];

const OLLAMA_CLOUD_BASE_URL: &str = "https://ollama.com/v1";
const DEFAULT_OLLAMA_HOST: &str = "http://localhost:11434";
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// OpenRouter の利用元表示（Hermes は同梱元のサイトと "AiDiy Hermes"）。
const OPENROUTER_REFERER: &str = "https://github.com/openai/codex";
const OPENROUTER_TITLE: &str = "AiDiy Codex";

/// `<区分>/<モデル名>` を分ける（openai_oauth を含む AiDiy の区分のみ）。それ以外は None。
pub fn split_aidiy_model(model: &str) -> Option<(&str, &str)> {
    let (section, name) = model.trim().split_once('/')?;
    let name = name.trim();
    let known = section == AIDIY_OPENAI_OAUTH_SECTION || AIDIY_SECTIONS.contains(&section);
    (known && !name.is_empty()).then_some((section, name))
}

/// API へ送るモデル名。`<区分>/<モデル名>` は区分を外す（それ以外はそのまま）。
pub fn aidiy_api_model(model: &str) -> String {
    match split_aidiy_model(model) {
        Some((section, name)) => aidiy_section_model(section, name),
        None => model.to_string(),
    }
}

/// 区分の接続先で使うモデル名（Ollama Cloud では Hermes と同じく -cloud / :cloud を外す）。
fn aidiy_section_model(section: &str, name: &str) -> String {
    if section == "ollama_chat" && valid_key(&load_key_config(), "ollama_key_id").is_some() {
        return strip_cloud_suffix(name);
    }
    name.to_string()
}

/// `<区分>/<モデル名>` の区分の接続先（内部用。ID は区分名）。openai_oauth・区分なしは None。
pub fn aidiy_model_provider(model: &str) -> Option<(String, ModelProviderInfo)> {
    // AiDiy: CLI は core のローカル委譲経路で処理する。OpenAI ログインを要求しない。
    if crate::split_aidiy_cli_model(model).is_some() {
        let provider = serde_json::from_value(json!({
            "name": "AiDiy CLI", "base_url": "http://127.0.0.1:1/aidiy-cli",
            "wire_api": "chat", "requires_openai_auth": false,
            "supports_websockets": false
        }))
        .ok()?;
        return Some((crate::AIDIY_CLI_PROVIDER.to_string(), provider));
    }
    let (section, _) = split_aidiy_model(model)?;
    if section == AIDIY_OPENAI_OAUTH_SECTION {
        return None;
    }
    section_provider(section, &load_key_config()).map(|provider| (section.to_string(), provider))
}

/// Hermes の `_is_valid_key` と同じ: 空・`< your ... key >` の雛形は未設定扱い。
fn valid_key<'a>(config: &'a Value, name: &str) -> Option<&'a str> {
    config
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty() && !key.starts_with('<'))
}

fn config_text(config: &Value, name: &str) -> Option<String> {
    config
        .get(name)
        .and_then(|value| match value {
            Value::String(text) => Some(text.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
        .filter(|text| !text.is_empty() && !text.starts_with('<'))
}

fn strip_cloud_suffix(model: &str) -> String {
    let lower = model.to_ascii_lowercase();
    for suffix in ["-cloud", ":cloud"] {
        if lower.ends_with(suffix) {
            return model[..model.len() - suffix.len()].to_string();
        }
    }
    model.to_string()
}

/// 区分の接続先（Hermes / Pi と同じ接続方法）。
fn section_provider(section: &str, config: &Value) -> Option<ModelProviderInfo> {
    let mut value = match section {
        "openai_chat" => json!({
            "name": "OpenAI API (AiDiy)",
            "base_url": "https://api.openai.com/v1",
            "wire_api": "responses",
            "experimental_bearer_token": valid_key(config, "openai_key_id"),
        }),
        // Pi / Hermes と同じ Grok の共有ログイン（~/.grok/auth.json）からトークンを取る（Rust 実装）。
        // xAI の Responses API は Codex のツール（namespace / custom）を受け付けないため、
        // ツールを function に変換して戻す Chat Completions で接続する。
        "xai_oauth" => json!({
            "name": "xAI Grok OAuth (AiDiy)",
            "base_url": "https://api.x.ai/v1",
            "wire_api": "chat",
            "auth": {"command": AIDIY_GROK_AUTH_COMMAND, "timeout_ms": 30_000, "refresh_interval_ms": 300_000},
        }),
        "claude_chat" => {
            let mut headers = json!({"anthropic-version": ANTHROPIC_VERSION});
            if let Some(key) = valid_key(config, "claude_key_id") {
                headers["x-api-key"] = json!(key);
            }
            json!({"name": "Claude (AiDiy)", "base_url": "https://api.anthropic.com/v1", "wire_api": "anthropic", "http_headers": headers})
        }
        "gemini_chat" | "freeai_chat" => json!({
            "name": if section == "freeai_chat" { "FreeAI Gemini (AiDiy)" } else { "Google Gemini (AiDiy)" },
            "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
            "wire_api": "chat",
            "experimental_bearer_token": valid_key(config, if section == "freeai_chat" { "freeai_key_id" } else { "gemini_key_id" }),
        }),
        "openrt_chat" | "openrt_free" => json!({
            "name": if section == "openrt_free" { "OpenRouter Free (AiDiy)" } else { "OpenRouter (AiDiy)" },
            "base_url": "https://openrouter.ai/api/v1",
            "wire_api": "chat",
            "experimental_bearer_token": valid_key(config, "openrt_key_id"),
            // Hermes と同じ OpenRouter の利用元表示（認証には使わない）。
            "http_headers": {"HTTP-Referer": OPENROUTER_REFERER, "X-Title": OPENROUTER_TITLE},
        }),
        "ollama_chat" => match valid_key(config, "ollama_key_id") {
            Some(key) => {
                json!({"name": "Ollama Cloud (AiDiy)", "base_url": OLLAMA_CLOUD_BASE_URL, "wire_api": "chat", "experimental_bearer_token": key})
            }
            None => {
                let host = config_text(config, "ollama_host")
                    .unwrap_or_else(|| DEFAULT_OLLAMA_HOST.to_string());
                json!({
                    "name": "Ollama Local (AiDiy)",
                    "base_url": format!("{}/v1", host.trim_end_matches('/')),
                    "wire_api": "chat",
                    "experimental_bearer_token": "no-key-required",
                })
            }
        },
        "local_chat" => json!({
            "name": "Local Chat backend_local (AiDiy)",
            "base_url": format!("http://localhost:{}/v1", config_text(config, "PORT_LOCAL").unwrap_or_else(|| "8096".to_string())),
            "wire_api": "chat",
            "experimental_bearer_token": "no-key-required",
        }),
        _ => return None,
    };
    // キーが無い場合は付けずに送り、プロバイダの認証エラーをそのまま返す。
    if let Some(object) = value.as_object_mut() {
        object.retain(|_, value| !value.is_null());
    }
    serde_json::from_value::<ModelProviderInfo>(value).ok()
}

/// AiDiy の場所。実行ファイルの隣の aidiy_codex_settings.json の `aidiy_root`。
pub fn aidiy_root() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    read_settings_root(&dir)
}

fn read_settings_root(dir: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(dir.join(AIDIY_SETTINGS_FILE)).ok()?;
    let settings: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let root = PathBuf::from(settings.get(AIDIY_ROOT_KEY)?.as_str()?.trim());
    (!root.as_os_str().is_empty() && root.is_dir()).then_some(root)
}

fn load_key_config() -> Value {
    aidiy_root()
        .as_deref()
        .map(read_key_config)
        .unwrap_or(Value::Null)
}

fn read_key_config(root: &Path) -> Value {
    std::fs::read_to_string(root.join("_config").join("AiDiy_key.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')).ok())
        .filter(Value::is_object)
        .unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WireApi;
    use pretty_assertions::assert_eq;

    fn provider(section: &str, config: &Value) -> ModelProviderInfo {
        section_provider(section, config).expect("provider")
    }

    #[test]
    fn splits_aidiy_sections_only() {
        assert_eq!(
            split_aidiy_model(" gemini_chat/ g-3 "),
            Some(("gemini_chat", "g-3"))
        );
        assert_eq!(
            split_aidiy_model("openrt_chat/google/gemini-2.5-pro"),
            Some(("openrt_chat", "google/gemini-2.5-pro"))
        );
        assert_eq!(
            split_aidiy_model("openai_oauth/gpt-6-luna"),
            Some(("openai_oauth", "gpt-6-luna"))
        );
        for model in [
            "gpt-6-luna",
            "openai_oauth/",
            "OPENAI_OAUTH/gpt-6-luna",
            "vendor/model",
        ] {
            assert_eq!(split_aidiy_model(model), None, "{model}");
            assert_eq!(aidiy_api_model(model), model);
        }
        assert_eq!(aidiy_api_model("openai_oauth/gpt-6-astra"), "gpt-6-astra");
        assert_eq!(aidiy_api_model("openai_chat/gpt-6-astra"), "gpt-6-astra");
        assert_eq!(aidiy_api_model("openrt_chat/google/g-4"), "google/g-4");
    }

    #[test]
    fn sections_are_not_added_to_built_in_providers() {
        let providers = crate::built_in_model_providers(/*openai_base_url*/ None);
        for section in AIDIY_SECTIONS {
            assert!(!providers.contains_key(*section), "{section}");
        }
        assert_eq!(
            aidiy_model_provider("gemini_chat/g-4")
                .map(|(id, _)| id)
                .as_deref(),
            Some("gemini_chat")
        );
        assert!(aidiy_model_provider("openai_oauth/gpt-6-astra").is_none());
        assert!(aidiy_model_provider("gpt-6-astra").is_none());
    }

    #[test]
    fn sections_follow_hermes_and_pi_connections() {
        let config = json!({"gemini_key_id": "g-key", "openai_key_id": "< your key >", "claude_key_id": "c-key", "PORT_LOCAL": 9000});
        let gemini = provider("gemini_chat", &config);
        assert_eq!(gemini.wire_api, WireApi::Chat);
        assert_eq!(
            gemini.base_url.as_deref(),
            Some("https://generativelanguage.googleapis.com/v1beta/openai")
        );
        assert!(gemini.experimental_bearer_token.is_some());
        let openai = provider("openai_chat", &config);
        assert_eq!(openai.wire_api, WireApi::Responses);
        assert!(
            openai.experimental_bearer_token.is_none(),
            "template key is not used"
        );
        let claude = provider("claude_chat", &config);
        assert_eq!(claude.wire_api, WireApi::Anthropic);
        let headers = claude.http_headers.expect("headers");
        assert!(headers.contains_key("x-api-key") && headers.contains_key("anthropic-version"));
        let xai = provider("xai_oauth", &config);
        assert_eq!(xai.wire_api, WireApi::Chat);
        assert!(
            xai.auth.is_some(),
            "token comes from the shared Grok login command"
        );
        for section in ["openrt_chat", "openrt_free"] {
            let openrt = provider(section, &json!({"openrt_key_id": "r-key"}));
            assert_eq!(openrt.wire_api, WireApi::Chat);
            assert!(openrt.experimental_bearer_token.is_some(), "{section}");
            let headers = openrt.http_headers.expect("attribution headers");
            assert_eq!(
                headers.get("X-Title").map(|value| value.as_str()),
                Some(OPENROUTER_TITLE)
            );
            assert_eq!(
                headers.get("HTTP-Referer").map(|value| value.as_str()),
                Some(OPENROUTER_REFERER)
            );
        }
        let local = provider("local_chat", &config);
        assert_eq!(local.base_url.as_deref(), Some("http://localhost:9000/v1"));
    }

    #[test]
    fn ollama_uses_cloud_only_with_key() {
        let local = provider("ollama_chat", &json!({"ollama_host": "http://host:1/"}));
        assert_eq!(local.base_url.as_deref(), Some("http://host:1/v1"));
        let cloud = provider("ollama_chat", &json!({"ollama_key_id": "o-key"}));
        assert_eq!(cloud.base_url.as_deref(), Some(OLLAMA_CLOUD_BASE_URL));
        assert_eq!(strip_cloud_suffix("gpt-oss:120b-cloud"), "gpt-oss:120b");
        assert_eq!(
            strip_cloud_suffix("deepseek-v4-flash:cloud"),
            "deepseek-v4-flash"
        );
    }

    #[test]
    fn settings_root_points_to_aidiy() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = tempfile::tempdir().expect("root");
        let path = dir.path().join(AIDIY_SETTINGS_FILE);
        let settings =
            json!({"client_version": "0.169.0", "aidiy_root": root.path().to_string_lossy()});
        std::fs::write(&path, format!("\u{feff}{settings}")).expect("write");
        assert_eq!(
            read_settings_root(dir.path()),
            Some(root.path().to_path_buf())
        );
        for text in [
            r#"{"aidiy_root": "Z:/missing/aidiy"}"#,
            r#"{"aidiy_root": ""}"#,
            "{}",
            "not json",
        ] {
            std::fs::write(&path, text).expect("write");
            assert_eq!(read_settings_root(dir.path()), None, "{text}");
        }
    }
}
