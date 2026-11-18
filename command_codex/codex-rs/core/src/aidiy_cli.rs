//! AiDiy: Pi と共通の CodeAI アダプターへ委譲し、進捗・回答を通常イベントへ戻す。
//! 子の失敗は再試行しない。正常終了したchatのJSON構文不正だけ1回形式修正する。会話全文を毎回渡し、子の別セッションを resume しない。

#[path = "aidiy_cli_json.rs"]
mod json_wrapper;

use crate::client_common::{Prompt, ResponseEvent, ResponseStream};
use codex_protocol::error::{CodexErr, Result};
use codex_protocol::models::{ContentItem, PermissionProfile, ResponseItem};
use codex_protocol::protocol::{AskForApproval, SandboxPolicy};
use serde::Deserialize;
use serde_json::json;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

// AiDiy: CLI launch selection is process-local, not persisted to user configuration.
static PASSTHROUGH: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_passthrough(enabled: bool) {
    PASSTHROUGH.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

const MAX_BYTES: usize = 16 * 1024 * 1024;
const IDLE: Duration = Duration::from_secs(900);

fn invalid(message: impl Into<String>) -> CodexErr {
    CodexErr::InvalidRequest(message.into())
}

fn execution_mode(
    permissions: &PermissionProfile,
    approvals: AskForApproval,
    cwd: &Path,
) -> Result<&'static str> {
    match permissions.to_legacy_sandbox_policy(cwd) {
        Ok(SandboxPolicy::DangerFullAccess) => Ok(if approvals == AskForApproval::Never {
            "yolo"
        } else {
            "normal"
        }),
        Ok(SandboxPolicy::ReadOnly { .. }) => Ok("read-only"),
        _ => Err(invalid(
            "この権限制約は外部 CLI に引き継げません。read-only または全アクセスのモードで起動してください。",
        )),
    }
}

fn delegated_prompt(prompt: &Prompt) -> Result<String> {
    if prompt.output_schema.is_some() {
        return Err(invalid("外部 CLI 委譲は構造化出力に未対応です。"));
    }
    let mut text = format!(
        "以下は AiDiy Codex から委譲された会話です。最後のユーザー依頼を自身のツールで処理し、最終回答を返してください。\n\n[system]\n{}",
        prompt.base_instructions.text
    );
    for item in &prompt.input {
        if let ResponseItem::Message {
            role, content, id, ..
        } = item
        {
            // AiDiy: 子 CLI の進捗（コマンドや入力の echo）を次回の会話へ再注入しない。
            if id.as_ref().is_some_and(|id| {
                id.as_str().starts_with("aidiy-cli-") && id.as_str().contains("-progress-")
            }) {
                continue;
            }
            text.push_str(&format!("\n\n[{role}]\n"));
            for part in content {
                match part {
                    ContentItem::InputText { text: value }
                    | ContentItem::OutputText { text: value, .. } => {
                        text.push_str(value);
                        text.push('\n');
                    }
                    _ => return Err(invalid("外部 CLI 委譲はテキスト入力だけに対応しています。")),
                }
            }
        }
    }
    if text.len() > MAX_BYTES {
        return Err(invalid(
            "外部 CLI に渡す会話が大きすぎます。新しい会話を開始してください。",
        ));
    }
    Ok(text)
}

fn chat_request(prompt: &Prompt) -> Result<(serde_json::Value, codex_api::CliChatCodec)> {
    if prompt.output_schema.is_some() {
        return Err(invalid("CLI chat は構造化最終出力に未対応です。"));
    }
    // Reject modalities the bridge cannot carry rather than silently dropping them.
    for item in &prompt.input {
        if let ResponseItem::Message { content, .. } = item {
            if content.iter().any(|part| {
                !matches!(
                    part,
                    ContentItem::InputText { .. } | ContentItem::OutputText { .. }
                )
            }) {
                return Err(invalid("CLI chat はテキスト入力だけに対応しています。"));
            }
        }
    }
    let mut input = vec![json!({"type": "message", "role": "system",
        "content": [{"type": "input_text", "text": prompt.base_instructions.text}]})];
    for item in &prompt.input {
        if matches!(item, ResponseItem::Message { id: Some(id), .. } if id.as_str().starts_with("aidiy-cli-") && id.as_str().contains("-progress-"))
        {
            continue;
        }
        input.push(
            serde_json::to_value(item).map_err(|_| invalid("CLI chat 履歴を変換できません。"))?,
        );
    }
    Ok(codex_api::CliChatCodec::request(
        &json!({"input": input, "tools": prompt.tools}),
    ))
}

fn validate_chat_message(message: &serde_json::Value) -> Result<()> {
    if message.get("role").and_then(serde_json::Value::as_str) != Some("assistant") {
        return Err(invalid("CLI chat のroleが不正です。"));
    }
    // AiDiy: a non-array tool_calls field must not be silently ignored just because
    // the response also contains text. The CLI bridge is a structured protocol.
    if message
        .get("tool_calls")
        .is_some_and(|calls| !calls.is_array())
        || message
            .get("content")
            .is_some_and(|content| !content.is_null() && !content.is_string())
    {
        return Err(invalid("CLI chat の応答構造が不正です。"));
    }
    let has_text = message
        .get("content")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|s| !s.trim().is_empty());
    let calls = message
        .get("tool_calls")
        .and_then(serde_json::Value::as_array);
    if !has_text && calls.is_none_or(|calls| calls.is_empty()) {
        return Err(invalid("CLI chat の応答が空です。"));
    }
    let mut ids = std::collections::HashSet::new();
    for call in calls.into_iter().flatten() {
        let id = call
            .get("id")
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty());
        let name = call
            .pointer("/function/name")
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty());
        let args = call
            .pointer("/function/arguments")
            .and_then(serde_json::Value::as_str)
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());
        if call.get("type").and_then(serde_json::Value::as_str) != Some("function")
            || name.is_none()
            || id.is_none()
            || !ids.insert(id.unwrap_or_default())
            || !args.is_some_and(|a| a.is_object())
        {
            return Err(invalid("CLI chat のツール要求が不正です。"));
        }
    }
    Ok(())
}

pub(crate) async fn stream(
    prompt: &Prompt,
    model: &str,
    cwd: &Path,
    permissions: &PermissionProfile,
    approvals: AskForApproval,
) -> Result<ResponseStream> {
    let (provider, model) = codex_model_provider_info::split_aidiy_cli_model(model)
        .ok_or_else(|| invalid("未対応の CLI モデルです。"))?;
    let passthrough = PASSTHROUGH.load(std::sync::atomic::Ordering::Relaxed);
    let mode = if passthrough {
        execution_mode(permissions, approvals, cwd)?
    } else {
        // Child only generates decisions; the outer Codex enforces its own sandbox/approval.
        "read-only"
    };
    let root = codex_model_provider_info::aidiy_root()
        .ok_or_else(|| invalid("aidiy_codex_settings.json の aidiy_root を確認してください。"))?;
    let suffix = if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    };
    let python = ["backend_tools", "backend_server"]
        .iter()
        .map(|name| root.join(name).join(".venv").join(suffix))
        .find(|path| path.is_file())
        .ok_or_else(|| {
            invalid(
                "外部 CLI 委譲には backend_tools または backend_server の Python 環境が必要です。",
            )
        })?;
    let (payload, codec) = if passthrough {
        (
            json!({"provider": provider, "model": model, "project": cwd,
            "prompt": delegated_prompt(prompt)?, "mode": mode, "cli_mode": "passthrough"}),
            None,
        )
    } else {
        let (body, codec) = chat_request(prompt)?;
        (
            json!({"provider": provider, "model": model, "project": cwd,
            "messages": body["messages"], "tools": body.get("tools").cloned().unwrap_or(json!([])),
            "mode": mode, "cli_mode": "chat", "engine_prompt": json_wrapper::engine_prompt(&body)}),
            Some(codec),
        )
    };
    let request =
        serde_json::to_vec(&payload).map_err(|_| invalid("外部 CLI の入力を作成できません。"))?;
    if request.len() > MAX_BYTES {
        return Err(invalid("外部 CLI の入力が大きすぎます。"));
    }
    let mut command = Command::new(&python);
    command
        .arg("-B")
        .arg(root.join("backend_tools/tools_proc/process_lifetime.py"))
        .arg("--parent-pid")
        .arg(std::process::id().to_string())
        .arg("--")
        .arg(&python)
        .arg("-B")
        .arg(root.join("backend_tools/tools_proc/harness_cli.py"))
        .current_dir(cwd)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = command
        .spawn()
        .map_err(|_| invalid("外部 CLI のアダプターを起動できません。"))?;
    let consumer_dropped = CancellationToken::new();
    let cancel = consumer_dropped.clone();
    let (tx, rx_event) = mpsc::channel(32);
    tokio::spawn(async move {
        let response_id = format!("aidiy-cli-{}", uuid::Uuid::new_v4());
        let outcome = async {
            let mut request = request;
            for attempt in 0..2 {
                let repair = tokio::select! {
                    biased;
                    _ = cancel.cancelled() => return Err(CodexErr::TurnAborted),
                    result = run_child(&mut child, &request, &tx, codec.as_ref(), &python, &root, &response_id, attempt == 0) => result?,
                };
                let Some(text) = repair else { return Ok(()); };
                if attempt == 1 {
                    return Err(invalid("CLI chat の JSON 形式修正に失敗しました。"));
                }
                request = json_wrapper::repair_request(&request, &text)
                    .map_err(invalid)?;
                if request.len() > MAX_BYTES {
                    return Err(invalid("CLI chat の形式修正入力が大きすぎます。"));
                }
                if cancel.is_cancelled() {
                    return Err(CodexErr::TurnAborted);
                }
                child = command.spawn()
                    .map_err(|_| invalid("CLI chat の形式修正を開始できません。"))?;
            }
            unreachable!("bounded format repair loop")
        }.await;
        if let Err(error) = outcome {
            stop_child(&mut child).await;
            let _ = tx.send(Err(error)).await;
        }
    });
    Ok(ResponseStream {
        routing_affinity: None,
        rx_event,
        interrupt: None,
        consumer_dropped,
    })
}

async fn stop_child(child: &mut Child) {
    // Windows Job は強制終了でも子孫を回収。POSIX は監視ラッパーに後始末を依頼する。
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
        if tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .is_ok()
        {
            return;
        }
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AdapterEvent {
    Progress {
        text: String,
    },
    Result {
        ok: bool,
        #[serde(default)]
        text: String,
        #[serde(default)]
        message: Option<serde_json::Value>,
    },
}

// The Rust wrapper owns prompt construction and JSON extraction. Reuse the local
// schema validator only after parsing: it never calls a CLI or executes a tool.
async fn validate_chat_response(
    python: &Path,
    root: &Path,
    request: &[u8],
    value: serde_json::Value,
) -> Result<serde_json::Value> {
    let mut payload: serde_json::Value =
        serde_json::from_slice(request).map_err(|_| invalid("CLI chat の検証入力が不正です。"))?;
    payload["cli_mode"] = json!("validate_chat");
    payload["response"] = value;
    payload.as_object_mut().unwrap().remove("engine_prompt");
    let mut command = Command::new(python);
    command
        .arg("-B")
        .arg(root.join("backend_tools/tools_proc/harness_cli.py"))
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut process = command
        .spawn()
        .map_err(|_| invalid("CLI chat 検証を開始できません。"))?;
    let bytes =
        serde_json::to_vec(&payload).map_err(|_| invalid("CLI chat 検証入力を作成できません。"))?;
    if bytes.len() > MAX_BYTES {
        return Err(invalid("CLI chat 検証入力が大きすぎます。"));
    }
    let mut stdin = process
        .stdin
        .take()
        .ok_or_else(|| invalid("CLI chat 検証入力がありません。"))?;
    tokio::time::timeout(Duration::from_secs(30), stdin.write_all(&bytes))
        .await
        .map_err(|_| invalid("CLI chat 検証入力がタイムアウトしました。"))?
        .map_err(|_| invalid("CLI chat 検証入力を送信できません。"))?;
    drop(stdin);
    let output = tokio::time::timeout(Duration::from_secs(30), process.wait_with_output())
        .await
        .map_err(|_| invalid("CLI chat 検証がタイムアウトしました。"))?
        .map_err(|_| invalid("CLI chat 検証結果を取得できません。"))?;
    if output.stdout.len() > MAX_BYTES {
        return Err(invalid("CLI chat 検証結果が大きすぎます。"));
    }
    let event = serde_json::from_slice::<AdapterEvent>(&output.stdout)
        .map_err(|_| invalid("CLI chat 検証結果が不正です。"))?;
    match event {
        AdapterEvent::Result {
            ok: true,
            message: Some(message),
            ..
        } if output.status.success() => Ok(message),
        AdapterEvent::Result { text, .. } => Err(invalid(if text.is_empty() {
            "CLI chat の schema 検証に失敗しました。".to_string()
        } else {
            text
        })),
        _ => Err(invalid("CLI chat の schema 検証に失敗しました。")),
    }
}

async fn send(tx: &mpsc::Sender<Result<ResponseEvent>>, event: ResponseEvent) -> Result<()> {
    tx.send(Ok(event)).await.map_err(|_| CodexErr::TurnAborted)
}

fn message(id: &str, phase: &str, text: &str) -> Result<ResponseItem> {
    serde_json::from_value(
        json!({"type":"message", "id":id, "role":"assistant", "phase":phase,
        "content":[{"type":"output_text", "text":text}]}),
    )
    .map_err(|_| invalid("外部 CLI の表示イベントを作成できません。"))
}

async fn run_child(
    child: &mut Child,
    request: &[u8],
    tx: &mpsc::Sender<Result<ResponseEvent>>,
    codec: Option<&codex_api::CliChatCodec>,
    python: &Path,
    root: &Path,
    response_id: &str,
    emit_created: bool,
) -> Result<Option<String>> {
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| invalid("外部 CLI の入力パイプがありません。"))?;
    tokio::time::timeout(IDLE, stdin.write_all(request))
        .await
        .map_err(|_| invalid("外部 CLI への入力がタイムアウトしました。"))?
        .map_err(|_| invalid("外部 CLI に入力を送信できません。"))?;
    drop(stdin);
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| invalid("外部 CLI の出力パイプがありません。"))?;
    if emit_created {
        send(
            tx,
            ResponseEvent::Created {
                response_id: Some(response_id.to_string()),
            },
        )
        .await?;
    }
    let mut buffer = [0u8; 8192];
    let mut pending = Vec::new();
    let mut answer = None;
    let mut chat_answer = None;
    let mut progress_index = 0;
    loop {
        let size = tokio::time::timeout(IDLE, stdout.read(&mut buffer))
            .await
            .map_err(|_| invalid("外部 CLI の出力が途絶えたため終了しました。"))?
            .map_err(|_| invalid("外部 CLI の出力を読み取れません。"))?;
        if size == 0 {
            break;
        }
        pending.extend_from_slice(&buffer[..size]);
        if pending.len() > MAX_BYTES {
            return Err(invalid("外部 CLI の応答が大きすぎます。"));
        }
        while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
            let event = serde_json::from_slice::<AdapterEvent>(&pending[..end])
                .map_err(|_| invalid("外部 CLI の応答形式が不正です。"))?;
            pending.drain(..=end);
            if answer.is_some() || chat_answer.is_some() {
                return Err(invalid("外部 CLI が最終回答の後に出力しました。"));
            }
            match event {
                AdapterEvent::Progress { text } => {
                    if codec.is_some() {
                        continue;
                    }
                    if text.is_empty() {
                        continue;
                    }
                    let id = format!("{response_id}-progress-{progress_index}");
                    progress_index += 1;
                    send(
                        tx,
                        ResponseEvent::OutputItemAdded(message(&id, "commentary", "")?),
                    )
                    .await?;
                    send(tx, ResponseEvent::OutputTextDelta(text.clone())).await?;
                    send(
                        tx,
                        ResponseEvent::OutputItemDone(message(&id, "commentary", &text)?),
                    )
                    .await?;
                }
                AdapterEvent::Result { ok: true, text, .. } if codec.is_some() => {
                    // AiDiy: defer parsing until the adapter exits successfully.
                    chat_answer = Some(text);
                }
                AdapterEvent::Result { ok: true, text, .. }
                    if codec.is_none() && !text.trim().is_empty() =>
                {
                    answer = Some(text)
                }
                AdapterEvent::Result { text, .. } => {
                    return Err(invalid(if text.is_empty() {
                        "外部 CLI の回答が空です。".to_string()
                    } else {
                        text
                    }));
                }
            }
        }
    }
    let status = tokio::time::timeout(IDLE, child.wait())
        .await
        .map_err(|_| invalid("外部 CLI の終了がタイムアウトしました。"))?
        .map_err(|_| invalid("外部 CLI の終了状態を取得できません。"))?;
    if !status.success() || !pending.is_empty() {
        return Err(invalid("外部 CLI が正常終了しませんでした。"));
    }
    if let Some(codec) = codec {
        let text = chat_answer.ok_or_else(|| invalid("CLI chat の構造化応答がありません。"))?;
        let value = match json_wrapper::extract_object(&text) {
            Ok(value) => value,
            Err(_) if json_wrapper::repairable_syntax(&text) => return Ok(Some(text)),
            Err(error) => return Err(invalid(error)),
        };
        let answer = validate_chat_response(python, root, request, value).await?;
        validate_chat_message(&answer)?;
        for event in codec.response(&answer, response_id) {
            if !matches!(event, ResponseEvent::Created { .. }) {
                send(tx, event).await?;
            }
        }
        return Ok(None);
    }
    let answer = answer.ok_or_else(|| invalid("外部 CLI の最終回答を取得できませんでした。"))?;
    let id = format!("{response_id}-answer");
    send(
        tx,
        ResponseEvent::OutputItemAdded(message(&id, "final_answer", "")?),
    )
    .await?;
    send(tx, ResponseEvent::OutputTextDelta(answer.clone())).await?;
    send(
        tx,
        ResponseEvent::OutputItemDone(message(&id, "final_answer", &answer)?),
    )
    .await?;
    send(
        tx,
        ResponseEvent::Completed {
            response_id: response_id.to_string(),
            token_usage: None,
            usage_metadata: None,
            reasoning_removals: None,
            end_turn: Some(true),
        },
    )
    .await?;
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    // AiDiy: malformed engine JSON is repairable only after a successful child exit.
    #[cfg(unix)]
    #[tokio::test]
    async fn chat_format_repair_waits_for_successful_process_exit() {
        for (exit_code, repairable) in [(0, true), (1, false)] {
            let mut child = Command::new("sh")
                .arg("-c")
                .arg(format!("cat >/dev/null; printf '%s\\n' '{{\"type\":\"result\",\"ok\":true,\"text\":\"bad JSON\"}}'; exit {exit_code}"))
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .unwrap();
            let (_, codec) = codex_api::CliChatCodec::request(&json!({"input":[],"tools":[]}));
            let (tx, mut rx) = mpsc::channel(32);
            let result = run_child(
                &mut child,
                b"{}",
                &tx,
                Some(&codec),
                Path::new("unused"),
                Path::new("unused"),
                "repair-test",
                true,
            )
            .await;
            if repairable {
                assert_eq!(result.unwrap(), Some("bad JSON".to_string()));
            } else {
                assert!(result.is_err());
            }
            assert!(matches!(
                rx.try_recv().unwrap().unwrap(),
                ResponseEvent::Created { .. }
            ));
            assert!(
                rx.try_recv().is_err(),
                "invalid output must not emit tools or completion"
            );
        }
    }

    #[test]
    fn chat_history_keeps_calls_and_results() {
        let mut prompt = Prompt::default();
        prompt.base_instructions.text = "SYSTEM".to_string();
        prompt.input = vec![
            serde_json::from_value(
                json!({"type":"function_call","call_id":"call_1","name":"read","arguments":"{}"}),
            )
            .unwrap(),
            serde_json::from_value(
                json!({"type":"function_call_output","call_id":"call_1","output":"READ_RESULT"}),
            )
            .unwrap(),
        ];
        let (request, _) = chat_request(&prompt).unwrap();
        assert_eq!(request["messages"][0]["content"], "SYSTEM");
        assert_eq!(request["messages"][1]["tool_calls"][0]["id"], "call_1");
        assert_eq!(request["messages"][2]["tool_call_id"], "call_1");
        assert_eq!(request["messages"][2]["content"], "READ_RESULT");
    }

    #[test]
    fn chat_rejects_malformed_tool_calls() {
        assert!(validate_chat_message(&json!({"role":"assistant", "content":"answer"})).is_ok());
        assert!(
            validate_chat_message(&json!({"role":"assistant", "tool_calls":[
                {"id":"c1", "type":"function", "function":{"name":"read", "arguments":"{}"}}
            ]}))
            .is_ok()
        );
        assert!(
            validate_chat_message(&json!({"role":"assistant", "tool_calls":[
                {"id":"c1", "type":"function", "function":{"name":"read", "arguments":"not json"}}
            ]}))
            .is_err()
        );
        assert!(validate_chat_message(&json!({"role":"assistant"})).is_err());
        assert!(
            validate_chat_message(
                &json!({"role":"assistant", "content":"answer", "tool_calls":{}})
            )
            .is_err()
        );
        assert!(validate_chat_message(&json!({"role":"assistant", "content":["answer"]})).is_err());
    }

    #[test]
    fn permissions_are_not_silently_elevated() {
        let cwd = std::env::current_dir().unwrap();
        assert_eq!(
            execution_mode(&PermissionProfile::Disabled, AskForApproval::Never, &cwd).unwrap(),
            "yolo"
        );
        assert_eq!(
            execution_mode(
                &PermissionProfile::Disabled,
                AskForApproval::OnRequest,
                &cwd
            )
            .unwrap(),
            "normal"
        );
        assert_eq!(
            execution_mode(&PermissionProfile::read_only(), AskForApproval::Never, &cwd).unwrap(),
            "read-only"
        );
    }

    #[test]
    fn display_events_have_distinct_phases() {
        assert!(matches!(
            message("cli-progress", "commentary", "作業中").unwrap(),
            ResponseItem::Message { .. }
        ));
        assert!(message("cli-answer", "final_answer", "完了").is_ok());
        assert!(
            serde_json::from_slice::<AdapterEvent>(br#"{"type":"result","text":"missing ok"}"#)
                .is_err()
        );
    }

    #[test]
    fn conversation_keeps_answers_but_does_not_echo_progress_again() {
        let mut prompt = Prompt::default();
        prompt.input = vec![
            message("aidiy-cli-fixture-progress-0", "commentary", "ECHO_NOT_FOR_NEXT_TURN").unwrap(),
            message("aidiy-cli-fixture-answer", "final_answer", "PREVIOUS_ANSWER").unwrap(),
            serde_json::from_value(json!({"type":"message", "role":"user", "content":[{"type":"input_text", "text":"FOLLOW_UP"}]})).unwrap(),
        ];
        let text = delegated_prompt(&prompt).unwrap();
        assert!(!text.contains("ECHO_NOT_FOR_NEXT_TURN"));
        assert!(text.contains("PREVIOUS_ANSWER"));
        assert!(text.contains("FOLLOW_UP"));
        prompt.output_schema = Some(json!({"type":"object"}));
        assert!(delegated_prompt(&prompt).is_err());
    }
}
