// AiDiy: xai_oauth 用。xAI OAuth（SuperGrok / X Premium+）のアクセストークンを取り出す。
//
// Pi（command_pi/aidiy/aidiy-oauth.ts）・Hermes と同じ共有ログイン `${GROK_HOME:-~/.grok}/auth.json` を読み、
// 期限切れ（5分前）ならリフレッシュして同じファイルへ書き戻す。モデルプロバイダの `auth.command` が
// `AIDIY_GROK_AUTH_COMMAND` のとき、外部コマンドを起動する代わりに external_bearer からここを呼ぶ
// （キャッシュ・再取得・401 時の更新は Codex の external_bearer の仕組みのまま）。トークンはログに出さない。

use crate::default_client::create_client;
use crate::oauth::ErrorBodyLimit;
use crate::oauth::OAuthClient;
use crate::oauth::OAuthError;
use crate::oauth::RefreshTokenGrant;
use crate::oauth::TokenEncoding;
use crate::oauth::TokenEndpoint;
use base64::Engine;
use chrono::DateTime;
use chrono::Utc;
use serde_json::Map;
use serde_json::Value;
use std::io;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

const REFRESH_SKEW_SECONDS: i64 = 5 * 60;
const XAI_CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_TOKEN_URL: &str = "https://auth.x.ai/oauth2/token";
const GROK_ENTRY_KEY: &str = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";
const REFRESH_TIMEOUT: Duration = Duration::from_secs(20);

/// 共有ログインからアクセストークンを取り出す（期限が近ければリフレッシュして書き戻す）。
pub(crate) async fn grok_access_token() -> io::Result<String> {
    let path = grok_auth_path()?;
    let entry = read_entry(&read_json(&path));
    let access = entry_text(&entry, "key").ok_or_else(|| {
        io::Error::other(
            "xAI OAuth（grok login）が未ログインです。Grok CLI または aidiy_pi でログインしてください。",
        )
    })?;
    let refresh = entry_text(&entry, "refresh_token");
    let expires = entry
        .get("expires_at")
        .and_then(Value::as_str)
        .and_then(parse_expires_at)
        .or_else(|| jwt_expiry(&access));
    let Some(refresh) = refresh.filter(|_| !is_fresh(expires, Utc::now().timestamp())) else {
        return Ok(access);
    };

    let body = refresh_access_token(&refresh).await?;
    let new_access = body
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| io::Error::other("トークン更新応答にアクセストークンがありません。"))?
        .to_string();

    // 更新中に他のプロセスが書いた内容を消さないよう、読み直してからこのエントリだけ差し替える。
    let mut latest = read_json(&path);
    let mut updated = read_entry(&latest);
    updated.insert("key".to_string(), Value::String(new_access.clone()));
    // xAI はローテーションしない場合 refresh_token を省略する。
    if let Some(rotated) = body
        .get("refresh_token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
    {
        updated.insert("refresh_token".to_string(), Value::String(rotated.to_string()));
    }
    if let Some(expiry) = jwt_expiry(&new_access)
        && let Some(expiry) = DateTime::<Utc>::from_timestamp(expiry, 0)
    {
        updated.insert(
            "expires_at".to_string(),
            Value::String(expiry.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        );
    }
    latest.insert(GROK_ENTRY_KEY.to_string(), Value::Object(updated));
    write_json(&path, &latest)?;
    Ok(new_access)
}

fn grok_auth_path() -> io::Result<PathBuf> {
    let home = std::env::var("GROK_HOME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let dir = match home {
        Some(home) => PathBuf::from(home),
        None => std::env::home_dir()
            .ok_or_else(|| io::Error::other("ホームフォルダが見つかりません。"))?
            .join(".grok"),
    };
    Ok(dir.join("auth.json"))
}

fn read_json(path: &Path) -> Map<String, Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

fn read_entry(auth: &Map<String, Value>) -> Map<String, Value> {
    match auth.get(GROK_ENTRY_KEY) {
        Some(Value::Object(entry)) => entry.clone(),
        _ => Map::new(),
    }
}

fn entry_text(entry: &Map<String, Value>, name: &str) -> Option<String> {
    entry
        .get(name)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// 一時ファイル経由で置き換える（途中で壊れたファイルを残さない）。
fn write_json(path: &Path, value: &Map<String, Value>) -> io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    let text = serde_json::to_string_pretty(value).map_err(io::Error::other)?;
    writeln!(file, "{text}")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(file.path(), std::fs::Permissions::from_mode(0o600));
    }
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

/// JWT の `exp`（UNIX 秒）。読めなければ None。
fn jwt_expiry(token: &str) -> Option<i64> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    let exp = claims.get("exp")?;
    exp.as_i64().or_else(|| exp.as_f64().map(|exp| exp as i64))
}

fn parse_expires_at(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.timestamp())
}

/// 期限が不明、または 5 分より先なら更新しない。
fn is_fresh(expires: Option<i64>, now: i64) -> bool {
    expires.is_none_or(|expires| expires - now > REFRESH_SKEW_SECONDS)
}

async fn refresh_access_token(refresh: &str) -> io::Result<Map<String, Value>> {
    let http_client = create_client();
    let client = OAuthClient::new(
        &http_client,
        TokenEndpoint {
            url: XAI_TOKEN_URL,
            client_id: XAI_CLIENT_ID,
            encoding: TokenEncoding::Form,
            timeout: Some(REFRESH_TIMEOUT),
            error_body_limit: ErrorBodyLimit::Bytes(4096),
        },
    );
    client
        .refresh::<Map<String, Value>>(RefreshTokenGrant {
            refresh_token: refresh,
            resource: None,
            refresh_reason: None,
        })
        .await
        .map_err(|error| match error {
            OAuthError::Rejected(rejection) => io::Error::other(format!(
                "xAI OAuth（grok login）のトークン更新に失敗しました（HTTP {}）。ログインし直してください。",
                rejection.status.as_u16()
            )),
            other => io::Error::other(format!(
                "xAI OAuth（grok login）のトークン更新に失敗しました: {other}"
            )),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    fn jwt(exp: i64) -> String {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::json!({"exp": exp}).to_string());
        format!("h.{payload}.s")
    }

    #[test]
    fn reads_expiry_from_jwt_and_rfc3339() {
        assert_eq!(jwt_expiry(&jwt(1_900_000_000)), Some(1_900_000_000));
        assert_eq!(jwt_expiry("not-a-jwt"), None);
        assert_eq!(parse_expires_at("2030-03-17T17:46:40Z"), Some(1_900_000_000));
        assert_eq!(parse_expires_at("soon"), None);
    }

    #[test]
    fn refreshes_only_within_five_minutes() {
        assert!(is_fresh(None, 0));
        assert!(is_fresh(Some(1_000), 1_000 - 301));
        assert!(!is_fresh(Some(1_000), 1_000 - 300));
        assert!(!is_fresh(Some(1_000), 2_000));
    }

    #[tokio::test]
    async fn fresh_token_is_returned_without_refresh() {
        let dir = tempfile::tempdir().expect("tempdir");
        let token = jwt(Utc::now().timestamp() + 3_600);
        std::fs::write(
            dir.path().join("auth.json"),
            serde_json::json!({GROK_ENTRY_KEY: {"key": token, "refresh_token": "r"}}).to_string(),
        )
        .expect("write");
        // SAFETY: このテストだけが GROK_HOME を使う。
        unsafe { std::env::set_var("GROK_HOME", dir.path()) };
        let result = grok_access_token().await;
        unsafe { std::env::remove_var("GROK_HOME") };
        assert_eq!(result.expect("token"), token);
    }

    #[test]
    fn write_json_replaces_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("auth.json");
        std::fs::write(&path, "{}").expect("write");
        let mut value = Map::new();
        value.insert("a".to_string(), Value::from(1));
        write_json(&path, &value).expect("write_json");
        assert_eq!(read_json(&path), value);
    }
}
