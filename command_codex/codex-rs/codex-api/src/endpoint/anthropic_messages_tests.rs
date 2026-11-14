// AiDiy: tests for the AiDiy-added transport (not part of upstream Codex).
use super::*;
use crate::endpoint::chat_completions::ChatStreamState;
use codex_protocol::models::ResponseItem;
use pretty_assertions::assert_eq;

#[test]
fn converts_system_turns_tool_use_and_results() {
    let (body, _) = build_anthropic_request(&json!({
        "model": "claude-sonnet-4-5",
        "input": [
            {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "rules"}]},
            {"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": "look"},
                {"type": "input_image", "image_url": "data:image/png;base64,AAA"},
            ]},
            {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "checking"}]},
            {"type": "function_call", "name": "shell", "arguments": "{\"cmd\":\"ls\"}", "call_id": "t1"},
            {"type": "function_call_output", "call_id": "t1", "output": ""},
            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "next"}]},
        ],
        "tools": [{"type": "function", "name": "shell", "description": "run", "strict": false, "parameters": {"type": "object"}}],
    }));
    assert_eq!(body["system"], "rules");
    assert_eq!(body["max_tokens"], 32_000);
    assert_eq!(
        body["messages"],
        json!([
            {"role": "user", "content": [
                {"type": "text", "text": "look"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAA"}},
            ]},
            {"role": "assistant", "content": [
                {"type": "text", "text": "checking"},
                {"type": "tool_use", "id": "t1", "name": "shell", "input": {"cmd": "ls"}},
            ]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t1", "content": "(no output)"},
                {"type": "text", "text": "next"},
            ]},
        ])
    );
    assert_eq!(
        body["tools"],
        json!([{"name": "shell", "description": "run", "input_schema": {"type": "object", "properties": {}}}])
    );
}

#[test]
fn top_level_combinators_are_merged_into_one_object_schema() {
    let (body, _) = build_anthropic_request(&json!({
        "model": "m",
        "input": [],
        "tools": [
            {"type": "function", "name": "pick", "description": "d", "strict": false, "parameters": {
                "description": "either",
                "oneOf": [
                    {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"]},
                    {"type": "object", "properties": {"b": {"type": "number"}}, "required": ["b"]},
                ],
            }},
            {"type": "function", "name": "both", "description": "d", "strict": false, "parameters": {
                "type": "object",
                "properties": {"x": {"type": "string"}},
                "required": ["x"],
                "allOf": [{"properties": {"y": {"type": "string"}}, "required": ["y"]}],
            }},
        ],
    }));
    assert_eq!(
        body["tools"][0]["input_schema"],
        json!({"description": "either", "type": "object", "properties": {"a": {"type": "string"}, "b": {"type": "number"}}})
    );
    assert_eq!(
        body["tools"][1]["input_schema"],
        json!({"type": "object", "properties": {"x": {"type": "string"}, "y": {"type": "string"}}, "required": ["x", "y"]})
    );
}

#[test]
fn conversation_starts_with_user() {
    let (body, _) = build_anthropic_request(&json!({
        "model": "m",
        "input": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "hi"}]}],
    }));
    assert_eq!(body["messages"][0]["role"], "user");
    assert!(body.get("tools").is_none());
}

#[test]
fn streamed_events_become_response_events() {
    let (_, tools) = build_anthropic_request(&json!({
        "model": "m",
        "input": [],
        "tools": [{"type": "custom", "name": "apply_patch", "description": "patch", "format": {"type": "grammar", "syntax": "lark", "definition": "x"}}],
    }));
    let mut state = ChatStreamState::default();
    let mut events = Vec::new();
    for event in [
        json!({"type": "message_start", "message": {"id": "msg_1", "usage": {"input_tokens": 5, "cache_read_input_tokens": 2, "output_tokens": 1}}}),
        json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hi"}}),
        json!({"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "tu_1", "name": "apply_patch", "input": {}}}),
        json!({"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"input\":"}}),
        json!({"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "\"P\"}"}}),
        json!({"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 9}}),
        json!({"type": "message_stop"}),
    ] {
        events.extend(state.apply_anthropic_event(&event));
    }
    events.extend(state.finish(&tools));

    assert!(
        matches!(&events[0], ResponseEvent::Created { response_id: Some(id) } if id == "msg_1")
    );
    assert!(
        events
            .iter()
            .any(|event| matches!(event, ResponseEvent::OutputTextDelta(text) if text == "Hi"))
    );
    assert!(events.iter().any(|event| matches!(event,
        ResponseEvent::OutputItemDone(ResponseItem::CustomToolCall { name, input, call_id, .. })
            if name == "apply_patch" && input == "P" && call_id == "tu_1")));
    match events.last() {
        Some(ResponseEvent::Completed {
            token_usage: Some(usage),
            ..
        }) => {
            assert_eq!(usage.input_tokens, 7);
            assert_eq!(usage.cached_input_tokens, 2);
            assert_eq!(usage.output_tokens, 9);
        }
        other => panic!("expected Completed with usage, got {other:?}"),
    }
}
