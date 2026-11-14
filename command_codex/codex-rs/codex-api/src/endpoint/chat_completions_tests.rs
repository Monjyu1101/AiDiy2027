// AiDiy: tests for the AiDiy-added transport (not part of upstream Codex).
use super::*;
use codex_protocol::models::ResponseItem;
use pretty_assertions::assert_eq;
use serde_json::json;

fn request() -> Value {
    json!({
        "model": "gemini-3-pro",
        "stream": true,
        "input": [
            {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "be brief"}]},
            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "list files"}]},
            {"type": "reasoning", "summary": [], "encrypted_content": "x"},
            {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "ok"}]},
            {"type": "function_call", "name": "shell", "arguments": "{\"cmd\":\"ls\"}", "call_id": "c1"},
            {"type": "function_call_output", "call_id": "c1", "output": "a.txt"},
            {"type": "custom_tool_call", "name": "apply_patch", "input": "*** Begin Patch", "call_id": "c2"},
            {"type": "custom_tool_call_output", "call_id": "c2", "output": [{"type": "input_text", "text": "done"}]},
            {"type": "function_call_output", "call_id": "unknown", "output": "dropped"},
        ],
        "tools": [
            {"type": "function", "name": "shell", "description": "run", "strict": false, "parameters": {"type": "object"}},
            {"type": "custom", "name": "apply_patch", "description": "patch", "format": {"type": "grammar", "syntax": "lark", "definition": "start: x"}},
            {"type": "namespace", "name": "mcp__fs", "description": "", "tools": [
                {"type": "function", "name": "read", "description": "read file", "strict": false, "parameters": {"type": "object"}}
            ]},
            {"type": "web_search"},
        ],
        "tool_choice": "auto",
        "parallel_tool_calls": true,
    })
}

#[test]
fn converts_messages_tool_calls_and_outputs() {
    let (body, _) = build_chat_request(&request());
    assert_eq!(body["model"], "gemini-3-pro");
    assert_eq!(body["stream"], true);
    assert_eq!(body["stream_options"], json!({"include_usage": true}));
    assert_eq!(
        body["messages"],
        json!([
            {"role": "system", "content": "be brief"},
            {"role": "user", "content": "list files"},
            {"role": "assistant", "content": "ok", "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "shell", "arguments": "{\"cmd\":\"ls\"}"}},
            ]},
            {"role": "tool", "tool_call_id": "c1", "content": "a.txt"},
            {"role": "assistant", "content": null, "tool_calls": [
                {"id": "c2", "type": "function", "function": {"name": "apply_patch", "arguments": "{\"input\":\"*** Begin Patch\"}"}},
            ]},
            {"role": "tool", "tool_call_id": "c2", "content": "done"},
        ])
    );
}

#[test]
fn converts_function_custom_and_namespace_tools() {
    let (body, map) = build_chat_request(&request());
    let names: Vec<&str> = body["tools"]
        .as_array()
        .expect("tools")
        .iter()
        .map(|tool| tool["function"]["name"].as_str().expect("name"))
        .collect();
    assert_eq!(names, vec!["shell", "apply_patch", "mcp__fs__read"]);
    assert_eq!(body["tool_choice"], "auto");
    assert_eq!(
        body["tools"][1]["function"]["parameters"]["required"],
        json!(["input"])
    );
    assert!(
        body["tools"][1]["function"]["description"]
            .as_str()
            .expect("description")
            .contains("start: x")
    );
    assert_eq!(
        map.0.get("mcp__fs__read"),
        Some(&ChatTool::Function {
            namespace: Some("mcp__fs".to_string()),
            name: "read".to_string()
        })
    );
}

#[test]
fn user_images_become_content_parts() {
    let (body, _) = build_chat_request(&json!({
        "model": "m",
        "input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": "see"},
            {"type": "input_image", "image_url": "data:image/png;base64,AAA"},
        ]}],
    }));
    assert_eq!(
        body["messages"][0]["content"],
        json!([
            {"type": "text", "text": "see"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}},
        ])
    );
    assert!(body.get("tools").is_none());
}

#[test]
fn streamed_text_and_tool_calls_become_response_events() {
    let (_, tools) = build_chat_request(&request());
    let mut state = ChatStreamState::default();
    let mut events = Vec::new();
    for chunk in [
        json!({"id": "r1", "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Hel"}}]}),
        json!({"id": "r1", "choices": [{"index": 0, "delta": {"content": "lo"}}]}),
        json!({"id": "r1", "choices": [{"index": 0, "delta": {"tool_calls": [
            {"index": 0, "id": "call_a", "type": "function", "function": {"name": "shell", "arguments": "{\"cmd\":"}},
        ]}}]}),
        json!({"id": "r1", "choices": [{"index": 0, "delta": {"tool_calls": [
            {"index": 0, "function": {"arguments": "\"ls\"}"}},
            {"index": 1, "id": "call_b", "function": {"name": "apply_patch", "arguments": "{\"input\":\"P\"}"}},
        ]}, "finish_reason": "tool_calls"}]}),
        json!({"id": "r1", "choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14,
            "prompt_tokens_details": {"cached_tokens": 3}}}),
    ] {
        events.extend(state.apply_chunk(&chunk));
    }
    assert!(state.finished);
    events.extend(state.finish(&tools));

    assert!(matches!(&events[0], ResponseEvent::Created { response_id: Some(id) } if id == "r1"));
    assert!(matches!(
        &events[1],
        ResponseEvent::OutputItemAdded(ResponseItem::Message { .. })
    ));
    let deltas: Vec<&str> = events
        .iter()
        .filter_map(|event| match event {
            ResponseEvent::OutputTextDelta(delta) => Some(delta.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(deltas, vec!["Hel", "lo"]);
    let done: Vec<&ResponseItem> = events
        .iter()
        .filter_map(|event| match event {
            ResponseEvent::OutputItemDone(item) => Some(item),
            _ => None,
        })
        .collect();
    assert_eq!(done.len(), 3);
    assert!(
        matches!(done[0], ResponseItem::Message { content, .. } if serde_json::to_value(content).expect("content")
        == json!([{"type": "output_text", "text": "Hello"}]))
    );
    assert!(
        matches!(done[1], ResponseItem::FunctionCall { name, arguments, call_id, .. }
        if name == "shell" && arguments == "{\"cmd\":\"ls\"}" && call_id == "call_a")
    );
    assert!(
        matches!(done[2], ResponseItem::CustomToolCall { name, input, call_id, .. }
        if name == "apply_patch" && input == "P" && call_id == "call_b")
    );
    match events.last() {
        Some(ResponseEvent::Completed {
            response_id,
            token_usage: Some(usage),
            ..
        }) => {
            assert_eq!(response_id, "r1");
            assert_eq!(usage.input_tokens, 10);
            assert_eq!(usage.cached_input_tokens, 3);
            assert_eq!(usage.output_tokens, 4);
            assert_eq!(usage.total_tokens, 14);
        }
        other => panic!("expected Completed with usage, got {other:?}"),
    }
}

#[test]
fn namespaced_tool_call_maps_back_to_namespace() {
    let (_, tools) = build_chat_request(&request());
    let mut state = ChatStreamState::default();
    state.apply_chunk(&json!({"id": "r2", "choices": [{"delta": {"tool_calls": [
        {"index": 0, "id": "c", "function": {"name": "mcp__fs__read", "arguments": "{}"}},
    ]}, "finish_reason": "tool_calls"}]}));
    let events = state.finish(&tools);
    assert!(events.iter().any(|event| matches!(event,
        ResponseEvent::OutputItemDone(ResponseItem::FunctionCall { name, namespace: Some(namespace), .. })
            if name == "read" && namespace == "mcp__fs")));
}

#[test]
fn chat_tool_names_are_sanitized() {
    assert_eq!(chat_tool_name(Some("a.b"), "c d"), "a_b__c_d");
    assert_eq!(chat_tool_name(None, &"x".repeat(80)).len(), 64);
}
