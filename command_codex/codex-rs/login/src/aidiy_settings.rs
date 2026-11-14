// AiDiy: aidiy_codex の設定を、実行ファイルと同じフォルダの aidiy_codex_settings.json に外出しする。
//
// 項目は `client_version`（サーバーへ送る版番号。ここで読む）と `aidiy_root`（AiDiy の場所。
// codex-model-provider-info の aidiy_sections.rs で読み、command_codex/_compile.py が書き足す）。
// サーバーはクライアントの版でモデルを
// 出し分ける（例: gpt-6-luna は 0.155.0 以上）。`~/.aidiy/bin/aidiy_codex(.exe)` の隣の
// `aidiy_codex_settings.json` を読み、無ければ `{"client_version": "0.169.0"}` で書き出す。
// 手で書き換えた場合はその値を送る（再ビルド不要）。不正な内容なら既定値を使い、ファイルは上書きしない。
// 使い道は User-Agent（default_client::get_codex_user_agent）とモデル一覧取得の client_version。

use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::LazyLock;

/// 設定ファイルの名前（実行ファイルと同じフォルダ。codex-model-provider-info と共通）。
pub use codex_model_provider_info::AIDIY_SETTINGS_FILE;
/// 送る版番号の項目名。
pub const AIDIY_CLIENT_VERSION_KEY: &str = "client_version";
/// ファイルが無いとき・内容が不正なときに使う版番号。
pub const AIDIY_DEFAULT_CLIENT_VERSION: &str = "0.169.0";

static CLIENT_VERSION: LazyLock<String> = LazyLock::new(|| {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .map_or_else(
            || AIDIY_DEFAULT_CLIENT_VERSION.to_string(),
            |dir| read_or_init_client_version(&dir),
        )
});

/// サーバーへ送る版番号（例: `0.169.0`）。プロセス内では最初に読んだ値を使い続ける。
pub fn aidiy_client_version() -> &'static str {
    CLIENT_VERSION.as_str()
}

/// 版番号の `x.y.z` 部分（`1.2.3-alpha.4` → `1.2.3`）。モデル一覧取得の client_version に使う。
pub fn aidiy_client_version_whole() -> String {
    aidiy_client_version()
        .split(['-', '+'])
        .next()
        .unwrap_or(AIDIY_DEFAULT_CLIENT_VERSION)
        .to_string()
}

/// `dir` の設定ファイルから版番号を読む。無ければ既定値で作る（作れなくても既定値で動く）。
/// 内容が不正なら既定値を使い、手修正されたファイルは上書きしない。
pub fn read_or_init_client_version(dir: &Path) -> String {
    let path = dir.join(AIDIY_SETTINGS_FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_client_version(&text)
            .unwrap_or_else(|| AIDIY_DEFAULT_CLIENT_VERSION.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // 同時に起動しても片方だけが書くよう、新規作成のときだけ書き込む。
            if let Ok(mut file) = OpenOptions::new().write(true).create_new(true).open(&path) {
                let settings = serde_json::json!({ AIDIY_CLIENT_VERSION_KEY: AIDIY_DEFAULT_CLIENT_VERSION });
                if let Ok(text) = serde_json::to_string_pretty(&settings) {
                    let _ = writeln!(file, "{text}");
                }
            }
            AIDIY_DEFAULT_CLIENT_VERSION.to_string()
        }
        Err(_) => AIDIY_DEFAULT_CLIENT_VERSION.to_string(),
    }
}

/// 設定 JSON の `client_version` を読む。`数字.数字.数字` に続けて `-` / `+` の付記だけを許す。
fn parse_client_version(text: &str) -> Option<String> {
    let settings: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let version = settings.get(AIDIY_CLIENT_VERSION_KEY)?.as_str()?.trim();
    if version.len() > 64 {
        return None;
    }
    let core = version.split(['-', '+']).next()?;
    let parts: Vec<&str> = core.split('.').collect();
    let numeric = parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
    let suffix_ok = version[core.len()..]
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '+' | '.'));
    (numeric && suffix_ok).then(|| version.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn missing_file_is_written_with_default() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert_eq!(read_or_init_client_version(dir.path()), "0.169.0");
        let written =
            std::fs::read_to_string(dir.path().join(AIDIY_SETTINGS_FILE)).expect("written");
        let settings: Value = serde_json::from_str(&written).expect("json");
        assert_eq!(settings, serde_json::json!({"client_version": "0.169.0"}));
    }

    #[test]
    fn hand_edited_value_is_used_and_kept() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(AIDIY_SETTINGS_FILE);
        let text = "\u{feff}{\r\n  \"client_version\": \" 0.171.2 \"\r\n}\r\n";
        std::fs::write(&path, text).expect("write");
        assert_eq!(read_or_init_client_version(dir.path()), "0.171.2");
        assert_eq!(std::fs::read_to_string(&path).expect("read"), text);
    }

    #[test]
    fn invalid_value_falls_back_without_overwriting() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(AIDIY_SETTINGS_FILE);
        for text in [
            "",
            "0.169.0",
            "{}",
            r#"{"client_version": 169}"#,
            r#"{"client_version": "0.169"}"#,
            r#"{"client_version": "0.169.0 extra"}"#,
            r#"{"client_version": "1.2.3/4"}"#,
        ] {
            std::fs::write(&path, text).expect("write");
            assert_eq!(read_or_init_client_version(dir.path()), "0.169.0", "{text:?}");
            assert_eq!(std::fs::read_to_string(&path).expect("read"), text);
        }
    }

    #[test]
    fn prerelease_suffix_is_allowed() {
        assert_eq!(
            parse_client_version(r#"{"client_version": "0.170.0-alpha.1"}"#),
            Some("0.170.0-alpha.1".to_string())
        );
    }
}
