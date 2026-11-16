"""AiDiy: exercise actual CLI codec source without the full V8 workspace.

This is a focused logic check, NOT a replacement for workspace type checking.
ResponseEvent/ResponseItem are reduced test doubles; conversion/validation code
is extracted unchanged from the production Rust files.
Requires Cargo/Rust 2024 support and the official serde/serde_json crates.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1] / 'codex-rs'
codec = (ROOT / 'codex-api/src/endpoint/chat_completions.rs').read_text(encoding='utf-8')
bridge = (ROOT / 'core/src/aidiy_cli.rs').read_text(encoding='utf-8')
logic = codec[codec.index('/// Original Codex tool'):codec.index('pub(crate) async fn send_all')]
wrapper = codec[codec.index('// AiDiy: Reuse the API transport'):]
validation = bridge[bridge.index('fn validate_chat_message'):bridge.index('pub(crate) async fn stream')]
prelude = r'''
#![allow(dead_code)]
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};
const MAX_CHAT_TOOL_NAME_LEN: usize = 64;
type ResponseItem = Value;
type Result<T> = std::result::Result<T, String>;
fn invalid(s: &str) -> String { s.into() }
macro_rules! debug { ($($arg:tt)*) => { { let _ = format_args!($($arg)*); } } }
#[derive(Default)]
struct TokenUsage { input_tokens:i64, cached_input_tokens:i64, output_tokens:i64,
reasoning_output_tokens:i64, total_tokens:i64 }
enum ResponseEvent { Created{response_id:Option<String>}, OutputItemAdded(Value),
OutputItemDone(Value), OutputTextDelta(String), Completed { response_id:String,
token_usage:Option<TokenUsage>, usage_metadata:Option<()>, reasoning_removals:Option<()>, end_turn:Option<()> } }
'''
tests = r'''
#[cfg(test)] mod smoke {
use super::*;
#[test] fn greeting() {
 let (body, codec)=CliChatCodec::request(&json!({"input":[{"type":"message","role":"system","content":[{"type":"input_text","text":"KNOWLEDGE"}]},{"type":"message","role":"user","content":[{"type":"input_text","text":"おはよう"}]}]}));
 assert_eq!(body["messages"][0]["content"],"KNOWLEDGE");
 let message=json!({"role":"assistant","content":"おはようございます"});
 validate_chat_message(&message).unwrap();
 assert!(codec.response(&message,"r1").iter().any(|e| matches!(e, ResponseEvent::OutputItemDone(v) if v["content"][0]["text"]=="おはようございます")));
}
#[test] fn parent_tool_result_roundtrip() {
 let (body, _)=CliChatCodec::request(&json!({"input":[
 {"type":"function_call","name":"read_file","call_id":"id1","arguments":"{}"},
 {"type":"function_call_output","call_id":"id1","output":"mtime=TODAY contents=REPORT"}]}));
 assert_eq!(body["messages"][0]["tool_calls"][0]["id"],"id1");
 assert_eq!(body["messages"][1]["tool_call_id"],"id1");
 assert_eq!(body["messages"][1]["content"],"mtime=TODAY contents=REPORT");
}
#[test] fn malformed_response_rejected() {
 for value in [json!({}), json!({"role":"assistant","content":"answer","tool_calls":{}}), json!({"role":"assistant","content":["answer"]}), json!({"role":"user","content":"bad"}), json!({"role":"assistant","tool_calls":[{"id":"1","type":"function","function":{"name":"read","arguments":"not json"}}]}), json!({"role":"assistant","tool_calls":[{"id":"1","type":"function","function":{"name":"read","arguments":"{}"}},{"id":"1","type":"function","function":{"name":"read","arguments":"{}"}}]})] {
 assert!(validate_chat_message(&value).is_err());
 }
}
}
'''
with tempfile.TemporaryDirectory(prefix='aidiy-codec-check-') as directory:
    root = Path(directory)
    (root / 'src').mkdir()
    (root / 'Cargo.toml').write_text('[package]\nname="aidiy-codec-check"\nversion="0.1.0"\nedition="2024"\n[dependencies]\nserde_json="=1.0.145"\n', encoding='utf-8')
    (root / 'src/lib.rs').write_text(prelude + logic + wrapper + validation + tests, encoding='utf-8')
    subprocess.run(['cargo', 'test', '--manifest-path', str(root / 'Cargo.toml')], check=True)
