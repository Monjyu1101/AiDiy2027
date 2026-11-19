//! AiDiy: Pi と共通の CodeAI アダプターへ委譲し、進捗・回答を通常イベントへ戻す。
//! 子の失敗は再試行しない。会話全文を毎回渡し、子の別セッションを resume しない。

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

pub(crate) async fn stream(
    prompt: &Prompt,
    model: &str,
    cwd: &Path,
    permissions: &PermissionProfile,
    approvals: AskForApproval,
) -> Result<ResponseStream> {
    let (provider, model) = codex_model_provider_info::split_aidiy_cli_model(model)
        .ok_or_else(|| invalid("未対応の CLI モデルです。"))?;
    let mode = execution_mode(permissions, approvals, cwd)?;
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
    // AiDiy: 外部 CLI がツールを含めたターン全体を実行する。親へツール呼出しは返さない。
    let payload = json!({
        "provider": provider,
        "model": model,
        "project": cwd,
        "prompt": delegated_prompt(prompt)?,
        "mode": mode,
    });
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
        let outcome = tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(CodexErr::TurnAborted),
            result = run_child(&mut child, &request, &tx, &response_id) => result,
        };
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
    },
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
    response_id: &str,
) -> Result<()> {
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
    send(
        tx,
        ResponseEvent::Created {
            response_id: Some(response_id.to_string()),
        },
    )
    .await?;
    let mut buffer = [0u8; 8192];
    let mut pending = Vec::new();
    let mut answer = None;
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
            if answer.is_some() {
                return Err(invalid("外部 CLI が最終回答の後に出力しました。"));
            }
            match event {
                AdapterEvent::Progress { text } => {
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
                AdapterEvent::Result { ok: true, text } if !text.trim().is_empty() => {
                    answer = Some(text);
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // AiDiy: child text is rendered as a final answer, never as a parent-side tool call.
    #[cfg(unix)]
    #[tokio::test]
    async fn delegation_only_displays_plain_text_and_requires_successful_exit() {
        let text = r#"{"tool_calls":[{"name":"read"}]}"#;
        let line = json!({"type":"result","ok":true,"text":text}).to_string();
        for exit_code in [0, 1] {
            let mut child = Command::new("sh")
                .arg("-c")
                .arg(r#"cat >/dev/null; printf '%s\n' "$1"; exit "$2""#)
                .arg("aidiy-cli-test")
                .arg(&line)
                .arg(exit_code.to_string())
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .unwrap();
            let (tx, mut rx) = mpsc::channel(32);
            let result = run_child(&mut child, b"{}", &tx, "delegation-test").await;
            assert!(matches!(
                rx.try_recv().unwrap().unwrap(),
                ResponseEvent::Created { .. }
            ));
            if exit_code == 0 {
                result.unwrap();
                assert!(matches!(
                    rx.try_recv().unwrap().unwrap(),
                    ResponseEvent::OutputItemAdded(ResponseItem::Message { .. })
                ));
                assert!(matches!(
                    rx.try_recv().unwrap().unwrap(),
                    ResponseEvent::OutputTextDelta(answer) if answer == text
                ));
                assert!(matches!(
                    rx.try_recv().unwrap().unwrap(),
                    ResponseEvent::OutputItemDone(ResponseItem::Message { .. })
                ));
                assert!(matches!(
                    rx.try_recv().unwrap().unwrap(),
                    ResponseEvent::Completed {
                        end_turn: Some(true),
                        ..
                    }
                ));
            } else {
                assert!(result.is_err());
            }
            assert!(rx.try_recv().is_err());
        }
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
        assert!(
            execution_mode(
                &PermissionProfile::workspace_write(),
                AskForApproval::OnRequest,
                &cwd
            )
            .is_err()
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
