//! AiDiy: Anthropic Messages transport (`POST {base_url}/messages`) for the `claude_chat` section.
//!
//! AiDiy Hermes / Pi connect to Claude with the native Anthropic Messages API, so aidiy_codex does
//! the same. The Responses request is first converted with the Chat Completions mapping
//! (`chat_completions::build_chat_request`) and then reshaped into Anthropic's format; streamed
//! events are accumulated with the shared `ChatStreamState`.
//! Authentication headers (`x-api-key`, `anthropic-version`) come from the provider's `http_headers`.

use crate::auth::SharedAuthProvider;
use crate::common::ResponseEvent;
use crate::common::ResponseStream;
use crate::common::ResponsesApiRequest;
use crate::endpoint::chat_completions::ChatToolMap;
use crate::endpoint::chat_completions::StreamDialect;
use crate::endpoint::chat_completions::build_chat_request;
use crate::endpoint::chat_completions::process_chat_sse;
use crate::endpoint::responses::ResponsesOptions;
use crate::endpoint::session::EndpointSession;
use crate::error::ApiError;
use crate::provider::Provider;
use crate::telemetry::SseTelemetry;
use codex_client::EncodedJsonBody;
use codex_client::HttpTransport;
use codex_client::RequestTelemetry;
use http::HeaderValue;
use http::Method;
use serde_json::Value;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::mpsc;

const MESSAGES_PATH: &str = "/messages";
const REQUEST_ID_HEADER: &str = "request-id";
/// Anthropic requires `max_tokens`; this fits current Claude models.
const DEFAULT_MAX_TOKENS: u64 = 32_000;

pub struct AnthropicMessagesClient<T: HttpTransport> {
    session: EndpointSession<T>,
    sse_telemetry: Option<Arc<dyn SseTelemetry>>,
}

impl<T: HttpTransport> AnthropicMessagesClient<T> {
    pub fn new(transport: T, provider: Provider, auth: SharedAuthProvider) -> Self {
        Self {
            session: EndpointSession::new(transport, provider, auth),
            sse_telemetry: None,
        }
    }

    pub fn with_telemetry(
        self,
        request: Option<Arc<dyn RequestTelemetry>>,
        sse: Option<Arc<dyn SseTelemetry>>,
    ) -> Self {
        Self {
            session: self.session.with_request_telemetry(request),
            sse_telemetry: sse,
        }
    }

    pub async fn stream_request_with_observer(
        &self,
        request: ResponsesApiRequest,
        options: ResponsesOptions,
        on_encoded: impl FnOnce(&bytes::Bytes),
    ) -> Result<ResponseStream, ApiError> {
        let request = serde_json::to_value(&request)
            .map_err(|e| ApiError::Stream(format!("failed to encode anthropic request: {e}")))?;
        let (body, tools) = build_anthropic_request(&request);
        let body = EncodedJsonBody::encode(&body)
            .map_err(|e| ApiError::Stream(format!("failed to encode anthropic request: {e}")))?;
        on_encoded(body.shared_bytes());

        let stream_response = self
            .session
            .stream_encoded_json_with(
                Method::POST,
                MESSAGES_PATH,
                options.extra_headers,
                Some(body),
                |req| {
                    req.headers.insert(
                        http::header::ACCEPT,
                        HeaderValue::from_static("text/event-stream"),
                    );
                },
            )
            .await?;

        let upstream_request_id = stream_response
            .headers
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let idle_timeout = self.session.provider().stream_idle_timeout;
        let (tx_event, rx_event) = mpsc::channel::<Result<ResponseEvent, ApiError>>(1600);
        tokio::spawn(process_chat_sse(
            stream_response.bytes,
            tx_event,
            idle_timeout,
            self.sse_telemetry.clone(),
            tools,
            StreamDialect::Anthropic,
        ));
        Ok(ResponseStream {
            routing_affinity: None,
            rx_event,
            upstream_request_id,
            interrupt: None,
        })
    }
}

fn image_block(url: &str) -> Value {
    // `data:<media type>;base64,<data>` becomes an inline image; other URLs are referenced.
    if let Some(rest) = url.strip_prefix("data:")
        && let Some((meta, data)) = rest.split_once(',')
        && let Some(media_type) = meta.strip_suffix(";base64")
    {
        return json!({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}});
    }
    json!({"type": "image", "source": {"type": "url", "url": url}})
}

fn text_block(text: &str) -> Option<Value> {
    (!text.trim().is_empty()).then(|| json!({"type": "text", "text": text}))
}

/// Appends blocks to the conversation, merging consecutive messages of the same role
/// (Anthropic requires user / assistant to alternate).
fn push_blocks(messages: &mut Vec<Value>, role: &str, blocks: Vec<Value>) {
    if blocks.is_empty() {
        return;
    }
    if let Some(last) = messages.last_mut()
        && last.get("role").and_then(Value::as_str) == Some(role)
        && let Some(content) = last.get_mut("content").and_then(Value::as_array_mut)
    {
        content.extend(blocks);
        return;
    }
    messages.push(json!({"role": role, "content": blocks}));
}

/// Anthropic rejects `oneOf` / `anyOf` / `allOf` at the top level of `input_schema`.
/// Their variants' properties are merged into one object schema; `required` is kept only from
/// `allOf` (every variant applies) and dropped for `oneOf` / `anyOf` (only one variant applies).
fn anthropic_input_schema(schema: Option<Value>) -> Value {
    let Some(Value::Object(mut schema)) = schema else {
        return json!({"type": "object"});
    };
    let mut properties = match schema.remove("properties") {
        Some(Value::Object(properties)) => properties,
        _ => serde_json::Map::new(),
    };
    let mut required = match schema.remove("required") {
        Some(Value::Array(required)) => required,
        _ => Vec::new(),
    };
    for key in ["allOf", "anyOf", "oneOf"] {
        let Some(Value::Array(variants)) = schema.remove(key) else {
            continue;
        };
        for variant in variants {
            if let Some(Value::Object(variant_properties)) = variant.get("properties") {
                for (name, property) in variant_properties {
                    properties
                        .entry(name.clone())
                        .or_insert_with(|| property.clone());
                }
            }
            if key == "allOf"
                && let Some(Value::Array(variant_required)) = variant.get("required")
            {
                for name in variant_required {
                    if !required.contains(name) {
                        required.push(name.clone());
                    }
                }
            }
        }
    }
    schema.insert("type".to_string(), json!("object"));
    schema.insert("properties".to_string(), Value::Object(properties));
    if !required.is_empty() {
        schema.insert("required".to_string(), Value::Array(required));
    }
    Value::Object(schema)
}

/// Converts a serialized `ResponsesApiRequest` into an Anthropic Messages request body.
pub(crate) fn build_anthropic_request(request: &Value) -> (Value, ChatToolMap) {
    let (chat, tools) = build_chat_request(request);
    let mut system: Vec<String> = Vec::new();
    let mut messages: Vec<Value> = Vec::new();
    for message in chat
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let content = message.get("content").cloned().unwrap_or(Value::Null);
        match message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "system" => {
                if let Some(text) = content.as_str().filter(|text| !text.trim().is_empty()) {
                    system.push(text.to_string());
                }
            }
            "user" => {
                let blocks = match &content {
                    Value::String(text) => text_block(text).into_iter().collect(),
                    Value::Array(parts) => parts
                        .iter()
                        .filter_map(|part| match part.get("type").and_then(Value::as_str) {
                            Some("text") => part
                                .get("text")
                                .and_then(Value::as_str)
                                .and_then(text_block),
                            Some("image_url") => part
                                .pointer("/image_url/url")
                                .and_then(Value::as_str)
                                .map(image_block),
                            _ => None,
                        })
                        .collect(),
                    _ => Vec::new(),
                };
                push_blocks(&mut messages, "user", blocks);
            }
            "assistant" => {
                let mut blocks: Vec<Value> =
                    content.as_str().and_then(text_block).into_iter().collect();
                for call in message
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let arguments = call
                        .pointer("/function/arguments")
                        .and_then(Value::as_str)
                        .unwrap_or("{}");
                    let input = serde_json::from_str::<Value>(arguments)
                        .ok()
                        .filter(Value::is_object)
                        .unwrap_or_else(|| json!({}));
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": call.get("id").cloned().unwrap_or(Value::Null),
                        "name": call.pointer("/function/name").cloned().unwrap_or(Value::Null),
                        "input": input,
                    }));
                }
                push_blocks(&mut messages, "assistant", blocks);
            }
            "tool" => {
                let output = content
                    .as_str()
                    .filter(|output| !output.is_empty())
                    .unwrap_or("(no output)");
                push_blocks(
                    &mut messages,
                    "user",
                    vec![json!({
                        "type": "tool_result",
                        "tool_use_id": message.get("tool_call_id").cloned().unwrap_or(Value::Null),
                        "content": output,
                    })],
                );
            }
            _ => {}
        }
    }
    // The conversation must start with a user turn.
    if messages
        .first()
        .and_then(|message| message.get("role"))
        .and_then(Value::as_str)
        != Some("user")
    {
        messages.insert(
            0,
            json!({"role": "user", "content": [{"type": "text", "text": "(continue)"}]}),
        );
    }

    let mut body = json!({
        "model": chat.get("model").cloned().unwrap_or(Value::Null),
        "max_tokens": DEFAULT_MAX_TOKENS,
        "stream": true,
        "messages": messages,
    });
    if !system.is_empty() {
        body["system"] = Value::String(system.join("\n\n"));
    }
    let anthropic_tools: Vec<Value> = chat
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|tool| {
            json!({
                "name": tool.pointer("/function/name").cloned().unwrap_or(Value::Null),
                "description": tool.pointer("/function/description").cloned().unwrap_or(Value::Null),
                "input_schema": anthropic_input_schema(tool.pointer("/function/parameters").cloned()),
            })
        })
        .collect();
    if !anthropic_tools.is_empty() {
        body["tools"] = Value::Array(anthropic_tools);
    }
    (body, tools)
}

#[cfg(test)]
#[path = "anthropic_messages_tests.rs"]
mod tests;
