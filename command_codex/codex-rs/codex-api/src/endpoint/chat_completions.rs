//! AiDiy: OpenAI-compatible Chat Completions transport (`POST {base_url}/chat/completions`).
//!
//! aidiy_codex keeps OpenAI (`openai_oauth` / `openai_chat`) on the Responses API and sends every
//! other AiDiy section (Gemini, OpenRouter, Ollama, backend_local, Claude, ...) through this client.
//! The request core builds for the Responses API is converted to a Chat Completions request, and
//! the streamed chunks are mapped back to `ResponseEvent`s, so the rest of Codex stays unchanged.
//!
//! Tool mapping:
//! - `function` tools become Chat Completions functions.
//! - `custom` (freeform) tools become functions with a single string parameter `input`.
//! - tools inside a `namespace` are flattened to `<namespace>__<name>`.
//! - other built-in Responses tools (web search, tool search, ...) are not sent.

use crate::auth::SharedAuthProvider;
use crate::common::ResponseEvent;
use crate::common::ResponseStream;
use crate::common::ResponsesApiRequest;
use crate::endpoint::responses::ResponsesOptions;
use crate::endpoint::session::EndpointSession;
use crate::error::ApiError;
use crate::provider::Provider;
use crate::telemetry::SseTelemetry;
use codex_client::ByteStream;
use codex_client::EncodedJsonBody;
use codex_client::HttpTransport;
use codex_client::RequestTelemetry;
use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::TokenUsage;
use eventsource_stream::Eventsource;
use futures::StreamExt;
use http::HeaderValue;
use http::Method;
use serde_json::Value;
use serde_json::json;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio::time::timeout;
use tracing::debug;
use tracing::trace;

const CHAT_COMPLETIONS_PATH: &str = "/chat/completions";
const REQUEST_ID_HEADER: &str = "x-request-id";
const MAX_CHAT_TOOL_NAME_LEN: usize = 64;

pub struct ChatCompletionsClient<T: HttpTransport> {
    session: EndpointSession<T>,
    sse_telemetry: Option<Arc<dyn SseTelemetry>>,
}

impl<T: HttpTransport> ChatCompletionsClient<T> {
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

    /// Same contract as `ResponsesClient::stream_request_with_observer`: the observer receives the
    /// exact JSON sent on the wire (here the converted Chat Completions body).
    pub async fn stream_request_with_observer(
        &self,
        request: ResponsesApiRequest,
        options: ResponsesOptions,
        on_encoded: impl FnOnce(&bytes::Bytes),
    ) -> Result<ResponseStream, ApiError> {
        let request = serde_json::to_value(&request)
            .map_err(|e| ApiError::Stream(format!("failed to encode chat request: {e}")))?;
        let (body, tools) = build_chat_request(&request);
        let body = EncodedJsonBody::encode(&body)
            .map_err(|e| ApiError::Stream(format!("failed to encode chat request: {e}")))?;
        on_encoded(body.shared_bytes());

        let stream_response = self
            .session
            .stream_encoded_json_with(
                Method::POST,
                CHAT_COMPLETIONS_PATH,
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
        let telemetry = self.sse_telemetry.clone();
        let (tx_event, rx_event) = mpsc::channel::<Result<ResponseEvent, ApiError>>(1600);
        tokio::spawn(process_chat_sse(
            stream_response.bytes,
            tx_event,
            idle_timeout,
            telemetry,
            tools,
            StreamDialect::Chat,
        ));
        Ok(ResponseStream {
            routing_affinity: None,
            rx_event,
            upstream_request_id,
            interrupt: None,
        })
    }
}

/// Original Codex tool behind a Chat Completions function name.
#[derive(Debug, Clone, PartialEq)]
enum ChatTool {
    Function {
        namespace: Option<String>,
        name: String,
    },
    Custom {
        namespace: Option<String>,
        name: String,
    },
}

/// Chat Completions function name -> original tool.
#[derive(Debug, Clone, Default)]
pub(crate) struct ChatToolMap(HashMap<String, ChatTool>);

fn chat_tool_name(namespace: Option<&str>, name: &str) -> String {
    let joined = match namespace.filter(|namespace| !namespace.is_empty()) {
        Some(namespace) => format!("{namespace}__{name}"),
        None => name.to_string(),
    };
    // Chat Completions function names allow only [A-Za-z0-9_-] (max 64).
    joined
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .take(MAX_CHAT_TOOL_NAME_LEN)
        .collect()
}

fn add_tool(tool: &Value, namespace: Option<&str>, out: &mut Vec<Value>, map: &mut ChatToolMap) {
    let kind = tool.get("type").and_then(Value::as_str).unwrap_or_default();
    let name = tool.get("name").and_then(Value::as_str).unwrap_or_default();
    let description = tool
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match kind {
        "namespace" => {
            for nested in tool
                .get("tools")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                add_tool(nested, Some(name), out, map);
            }
        }
        "function" if !name.is_empty() => {
            let chat_name = chat_tool_name(namespace, name);
            let parameters = tool
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| json!({"type": "object", "properties": {}}));
            out.push(json!({
                "type": "function",
                "function": {"name": chat_name, "description": description, "parameters": parameters},
            }));
            map.0.insert(
                chat_name,
                ChatTool::Function {
                    namespace: namespace.map(str::to_string),
                    name: name.to_string(),
                },
            );
        }
        "custom" if !name.is_empty() => {
            let chat_name = chat_tool_name(namespace, name);
            let mut description =
                format!("{description}\n\nPass the complete raw tool input as the `input` string.");
            if let Some(format) = tool.get("format") {
                let syntax = format
                    .get("syntax")
                    .and_then(Value::as_str)
                    .unwrap_or("text");
                if let Some(definition) = format.get("definition").and_then(Value::as_str) {
                    description.push_str(&format!("\nInput format ({syntax}):\n{definition}"));
                }
            }
            out.push(json!({
                "type": "function",
                "function": {
                    "name": chat_name,
                    "description": description,
                    "parameters": {
                        "type": "object",
                        "properties": {"input": {"type": "string", "description": "Raw tool input."}},
                        "required": ["input"],
                    },
                },
            }));
            map.0.insert(
                chat_name,
                ChatTool::Custom {
                    namespace: namespace.map(str::to_string),
                    name: name.to_string(),
                },
            );
        }
        // Built-in Responses tools (web_search, tool_search, image_generation, ...) have no
        // Chat Completions equivalent.
        _ => {}
    }
}

fn content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| match item.get("type").and_then(Value::as_str) {
                Some("input_text") | Some("output_text") | Some("text") => {
                    item.get("text").and_then(Value::as_str).map(str::to_string)
                }
                Some("input_image") => Some("[image omitted]".to_string()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn user_content(content: &Value) -> Option<Value> {
    let items = content.as_array()?;
    let has_image = items
        .iter()
        .any(|item| item.get("type").and_then(Value::as_str) == Some("input_image"));
    if !has_image {
        let text = content_text(content);
        return (!text.is_empty()).then(|| Value::String(text));
    }
    let parts: Vec<Value> = items
        .iter()
        .filter_map(|item| match item.get("type").and_then(Value::as_str) {
            Some("input_text") | Some("output_text") => item
                .get("text")
                .and_then(Value::as_str)
                .map(|text| json!({"type": "text", "text": text})),
            Some("input_image") => item
                .get("image_url")
                .and_then(Value::as_str)
                .map(|url| json!({"type": "image_url", "image_url": {"url": url}})),
            _ => None,
        })
        .collect();
    (!parts.is_empty()).then(|| Value::Array(parts))
}

fn push_tool_call(messages: &mut Vec<Value>, call: Value) {
    if let Some(last) = messages.last_mut()
        && last.get("role").and_then(Value::as_str) == Some("assistant")
        && let Some(object) = last.as_object_mut()
    {
        let calls = object
            .entry("tool_calls")
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(calls) = calls.as_array_mut() {
            calls.push(call);
            return;
        }
    }
    messages.push(json!({"role": "assistant", "content": Value::Null, "tool_calls": [call]}));
}

/// Converts a serialized `ResponsesApiRequest` into a Chat Completions request body.
pub(crate) fn build_chat_request(request: &Value) -> (Value, ChatToolMap) {
    let mut tools = Vec::new();
    let mut map = ChatToolMap::default();
    for tool in request
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        add_tool(tool, None, &mut tools, &mut map);
    }

    let mut messages: Vec<Value> = Vec::new();
    let mut known_calls: HashSet<String> = HashSet::new();
    for item in request
        .get("input")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let field = |key: &str| item.get(key).and_then(Value::as_str).unwrap_or_default();
        match field("type") {
            "message" => {
                let content = item.get("content").cloned().unwrap_or(Value::Null);
                match field("role") {
                    "user" => {
                        if let Some(content) = user_content(&content) {
                            messages.push(json!({"role": "user", "content": content}));
                        }
                    }
                    role @ ("assistant" | "system" | "developer") => {
                        let text = content_text(&content);
                        if !text.is_empty() {
                            let role = if role == "assistant" {
                                "assistant"
                            } else {
                                "system"
                            };
                            messages.push(json!({"role": role, "content": text}));
                        }
                    }
                    _ => {}
                }
            }
            kind @ ("function_call" | "custom_tool_call") => {
                let call_id = field("call_id");
                if call_id.is_empty() {
                    continue;
                }
                let namespace = item.get("namespace").and_then(Value::as_str);
                let arguments = if kind == "function_call" {
                    let arguments = field("arguments");
                    if arguments.is_empty() {
                        "{}".to_string()
                    } else {
                        arguments.to_string()
                    }
                } else {
                    json!({"input": field("input")}).to_string()
                };
                known_calls.insert(call_id.to_string());
                push_tool_call(
                    &mut messages,
                    json!({
                        "id": call_id,
                        "type": "function",
                        "function": {"name": chat_tool_name(namespace, field("name")), "arguments": arguments},
                    }),
                );
            }
            "function_call_output" | "custom_tool_call_output" => {
                let call_id = field("call_id");
                // Calls that could not be sent (e.g. built-in tools) cannot have a tool message.
                if known_calls.contains(call_id) {
                    let output = item.get("output").map(content_text).unwrap_or_default();
                    messages
                        .push(json!({"role": "tool", "tool_call_id": call_id, "content": output}));
                }
            }
            // Reasoning, web search and other Responses-only items have no Chat equivalent.
            _ => {}
        }
    }

    let mut body = json!({
        "model": request.get("model").cloned().unwrap_or(Value::Null),
        "messages": messages,
        "stream": true,
        "stream_options": {"include_usage": true},
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools);
        body["tool_choice"] = Value::String("auto".to_string());
    }
    (body, map)
}

#[derive(Debug, Default)]
struct ToolCallAcc {
    id: String,
    name: String,
    arguments: String,
}

/// Accumulates streamed Chat Completions chunks into Responses-shaped events.
#[derive(Debug, Default)]
pub(crate) struct ChatStreamState {
    response_id: Option<String>,
    message_started: bool,
    text: String,
    tool_calls: BTreeMap<u64, ToolCallAcc>,
    usage: Option<Value>,
    finished: bool,
}

fn message_item(id: &str, text: &str) -> Option<ResponseItem> {
    let content = if text.is_empty() {
        json!([])
    } else {
        json!([{"type": "output_text", "text": text}])
    };
    serde_json::from_value(
        json!({"type": "message", "role": "assistant", "id": id, "content": content}),
    )
    .map_err(|e| debug!("failed to build chat message item: {e}"))
    .ok()
}

fn token_usage(usage: &Value) -> TokenUsage {
    let number = |value: Option<&Value>| value.and_then(Value::as_i64).unwrap_or(0);
    let input_tokens = number(usage.get("prompt_tokens"));
    let output_tokens = number(usage.get("completion_tokens"));
    TokenUsage {
        input_tokens,
        cached_input_tokens: number(usage.pointer("/prompt_tokens_details/cached_tokens")),
        output_tokens,
        reasoning_output_tokens: number(
            usage.pointer("/completion_tokens_details/reasoning_tokens"),
        ),
        total_tokens: usage
            .get("total_tokens")
            .and_then(Value::as_i64)
            .unwrap_or(input_tokens + output_tokens),
        ..TokenUsage::default()
    }
}

impl ChatStreamState {
    fn response_id(&self) -> String {
        self.response_id
            .clone()
            .unwrap_or_else(|| "chatcmpl".to_string())
    }

    fn message_id(&self) -> String {
        format!("msg_{}", self.response_id())
    }

    fn ensure_created(&mut self, id: Option<&str>, events: &mut Vec<ResponseEvent>) {
        if self.response_id.is_none() {
            self.response_id = Some(
                id.filter(|id| !id.is_empty())
                    .unwrap_or("chatcmpl")
                    .to_string(),
            );
            events.push(ResponseEvent::Created {
                response_id: self.response_id.clone(),
            });
        }
    }

    fn push_text(&mut self, text: &str, events: &mut Vec<ResponseEvent>) {
        if text.is_empty() {
            return;
        }
        if !self.message_started {
            self.message_started = true;
            if let Some(item) = message_item(&self.message_id(), "") {
                events.push(ResponseEvent::OutputItemAdded(item));
            }
        }
        self.text.push_str(text);
        events.push(ResponseEvent::OutputTextDelta(text.to_string()));
    }

    /// AiDiy: Anthropic Messages stream events, accumulated with the same state as Chat chunks.
    pub(crate) fn apply_anthropic_event(&mut self, event: &Value) -> Vec<ResponseEvent> {
        let mut events = Vec::new();
        let number = |value: Option<&Value>| value.and_then(Value::as_i64).unwrap_or(0);
        match event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "message_start" => {
                let message = event.get("message").cloned().unwrap_or(Value::Null);
                self.ensure_created(message.get("id").and_then(Value::as_str), &mut events);
                let usage = message.get("usage").cloned().unwrap_or(Value::Null);
                let cached = number(usage.get("cache_read_input_tokens"));
                let input = number(usage.get("input_tokens"))
                    + cached
                    + number(usage.get("cache_creation_input_tokens"));
                self.usage = Some(json!({
                    "prompt_tokens": input,
                    "completion_tokens": number(usage.get("output_tokens")),
                    "prompt_tokens_details": {"cached_tokens": cached},
                }));
            }
            "content_block_start" => {
                self.ensure_created(None, &mut events);
                let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
                let block = event.get("content_block").cloned().unwrap_or(Value::Null);
                match block.get("type").and_then(Value::as_str) {
                    Some("tool_use") => {
                        let acc = self.tool_calls.entry(index).or_default();
                        acc.id = block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        acc.name = block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                    }
                    Some("text") => {
                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            self.push_text(text, &mut events);
                        }
                    }
                    _ => {}
                }
            }
            "content_block_delta" => {
                self.ensure_created(None, &mut events);
                let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
                let delta = event.get("delta").cloned().unwrap_or(Value::Null);
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        if let Some(text) = delta.get("text").and_then(Value::as_str) {
                            self.push_text(text, &mut events);
                        }
                    }
                    Some("input_json_delta") => {
                        if let Some(partial) = delta.get("partial_json").and_then(Value::as_str) {
                            self.tool_calls
                                .entry(index)
                                .or_default()
                                .arguments
                                .push_str(partial);
                        }
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(output) = event
                    .pointer("/usage/output_tokens")
                    .and_then(Value::as_i64)
                    && let Some(usage) = self.usage.as_mut()
                {
                    usage["completion_tokens"] = json!(output);
                }
                if event
                    .pointer("/delta/stop_reason")
                    .is_some_and(|reason| !reason.is_null())
                {
                    self.finished = true;
                }
            }
            "message_stop" => self.finished = true,
            _ => {}
        }
        events
    }

    pub(crate) fn apply_chunk(&mut self, chunk: &Value) -> Vec<ResponseEvent> {
        let mut events = Vec::new();
        self.ensure_created(chunk.get("id").and_then(Value::as_str), &mut events);
        if let Some(usage) = chunk.get("usage").filter(|usage| usage.is_object()) {
            self.usage = Some(usage.clone());
        }
        for choice in chunk
            .get("choices")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let delta = choice.get("delta").or_else(|| choice.get("message"));
            if let Some(text) = delta
                .and_then(|delta| delta.get("content"))
                .and_then(Value::as_str)
            {
                self.push_text(text, &mut events);
            }
            for (position, call) in delta
                .and_then(|delta| delta.get("tool_calls"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let index = call
                    .get("index")
                    .and_then(Value::as_u64)
                    .unwrap_or(position as u64);
                let acc = self.tool_calls.entry(index).or_default();
                if let Some(id) = call
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                {
                    acc.id = id.to_string();
                }
                if let Some(name) = call
                    .pointer("/function/name")
                    .and_then(Value::as_str)
                    .filter(|name| !name.is_empty())
                    && acc.name.is_empty()
                {
                    acc.name = name.to_string();
                }
                if let Some(arguments) = call.pointer("/function/arguments").and_then(Value::as_str)
                {
                    acc.arguments.push_str(arguments);
                }
            }
            if choice
                .get("finish_reason")
                .is_some_and(|reason| !reason.is_null())
            {
                self.finished = true;
            }
        }
        events
    }

    fn tool_call_item(
        &self,
        index: u64,
        acc: &ToolCallAcc,
        tools: &ChatToolMap,
    ) -> Option<ResponseItem> {
        let call_id = if acc.id.is_empty() {
            format!("call_{}_{index}", self.response_id())
        } else {
            acc.id.clone()
        };
        let arguments = if acc.arguments.trim().is_empty() {
            "{}".to_string()
        } else {
            acc.arguments.clone()
        };
        let value = match tools.0.get(&acc.name) {
            Some(ChatTool::Custom { namespace, name }) => {
                let input = serde_json::from_str::<Value>(&arguments)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("input")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .unwrap_or(arguments);
                json!({"type": "custom_tool_call", "call_id": call_id, "name": name, "namespace": namespace, "input": input})
            }
            Some(ChatTool::Function { namespace, name }) => {
                json!({"type": "function_call", "call_id": call_id, "name": name, "namespace": namespace, "arguments": arguments})
            }
            // Unknown name: hand it to core as-is so the usual "unknown tool" handling applies.
            None => {
                json!({"type": "function_call", "call_id": call_id, "name": acc.name, "arguments": arguments})
            }
        };
        serde_json::from_value(value)
            .map_err(|e| debug!("failed to build chat tool call item: {e}"))
            .ok()
    }

    /// Events that close the turn: final message, tool calls and `Completed`.
    pub(crate) fn finish(&mut self, tools: &ChatToolMap) -> Vec<ResponseEvent> {
        let mut events = Vec::new();
        if self.response_id.is_none() {
            self.response_id = Some("chatcmpl".to_string());
            events.push(ResponseEvent::Created {
                response_id: self.response_id.clone(),
            });
        }
        if self.message_started
            && let Some(item) = message_item(&self.message_id(), &self.text)
        {
            events.push(ResponseEvent::OutputItemDone(item));
        }
        for (index, acc) in &self.tool_calls {
            if let Some(item) = self.tool_call_item(*index, acc, tools) {
                events.push(ResponseEvent::OutputItemDone(item));
            }
        }
        events.push(ResponseEvent::Completed {
            response_id: self.response_id(),
            token_usage: self.usage.as_ref().map(token_usage),
            usage_metadata: None,
            reasoning_removals: None,
            end_turn: None,
        });
        events
    }
}

pub(crate) async fn send_all(
    tx_event: &mpsc::Sender<Result<ResponseEvent, ApiError>>,
    events: Vec<ResponseEvent>,
) -> bool {
    for event in events {
        if tx_event.send(Ok(event)).await.is_err() {
            return false;
        }
    }
    true
}

/// Wire format of the streamed events.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum StreamDialect {
    /// OpenAI-compatible Chat Completions chunks, terminated by `[DONE]`.
    Chat,
    /// Anthropic Messages events, terminated by `message_stop`.
    Anthropic,
}

pub(crate) async fn process_chat_sse(
    stream: ByteStream,
    tx_event: mpsc::Sender<Result<ResponseEvent, ApiError>>,
    idle_timeout: Duration,
    telemetry: Option<Arc<dyn SseTelemetry>>,
    tools: ChatToolMap,
    dialect: StreamDialect,
) {
    let mut stream = stream.eventsource();
    let mut state = ChatStreamState::default();
    loop {
        let start = Instant::now();
        let response = tokio::select! {
            biased;
            _ = tx_event.closed() => return,
            response = timeout(idle_timeout, stream.next()) => response,
        };
        if let Some(t) = telemetry.as_ref() {
            t.on_sse_poll(&response, start.elapsed());
        }
        let sse = match response {
            Ok(Some(Ok(sse))) => sse,
            Ok(Some(Err(e))) => {
                debug!("Chat Completions SSE error: {e:#}");
                let _ = tx_event.send(Err(ApiError::Stream(e.to_string()))).await;
                return;
            }
            Ok(None) => {
                // Some providers close the stream after the final chunk without `[DONE]`.
                if state.finished {
                    send_all(&tx_event, state.finish(&tools)).await;
                } else {
                    let _ = tx_event
                        .send(Err(ApiError::Stream(
                            "model stream closed before completion".into(),
                        )))
                        .await;
                }
                return;
            }
            Err(_) => {
                let _ = tx_event
                    .send(Err(ApiError::Stream("idle timeout waiting for SSE".into())))
                    .await;
                return;
            }
        };
        trace!("Chat Completions SSE event: {}", &sse.data);
        if sse.data.trim() == "[DONE]" {
            send_all(&tx_event, state.finish(&tools)).await;
            return;
        }
        let chunk: Value = match serde_json::from_str(&sse.data) {
            Ok(chunk) => chunk,
            Err(e) => {
                debug!("failed to parse Chat Completions chunk: {e}");
                continue;
            }
        };
        if let Some(error) = chunk.get("error").filter(|error| !error.is_null()) {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .map_or_else(|| error.to_string(), str::to_string);
            let _ = tx_event
                .send(Err(ApiError::Stream(format!(
                    "model provider error: {message}"
                ))))
                .await;
            return;
        }
        let events = match dialect {
            StreamDialect::Chat => state.apply_chunk(&chunk),
            StreamDialect::Anthropic => state.apply_anthropic_event(&chunk),
        };
        if !send_all(&tx_event, events).await {
            return;
        }
        if dialect == StreamDialect::Anthropic
            && chunk.get("type").and_then(Value::as_str) == Some("message_stop")
        {
            send_all(&tx_event, state.finish(&tools)).await;
            return;
        }
    }
}

#[cfg(test)]
#[path = "chat_completions_tests.rs"]
mod tests;

// AiDiy: Reuse the API transport's tool mapping for the local CLI chat engine.
pub struct CliChatCodec {
    tools: ChatToolMap,
}

impl CliChatCodec {
    pub fn request(request: &Value) -> (Value, Self) {
        let (body, tools) = build_chat_request(request);
        (body, Self { tools })
    }

    pub fn response(&self, message: &Value, response_id: &str) -> Vec<ResponseEvent> {
        let mut state = ChatStreamState::default();
        let mut events = state.apply_chunk(&json!({
            "id": response_id, "choices": [{"message": message}]
        }));
        events.extend(state.finish(&self.tools));
        events
    }
}

#[cfg(test)]
mod cli_chat_tests {
    use super::*;

    #[test]
    fn cli_chat_restores_custom_and_namespaced_tools() {
        let (body, codec) = CliChatCodec::request(&json!({"input":[], "tools":[
            {"type":"custom", "name":"apply_patch", "description":"patch"},
            {"type":"namespace", "name":"files", "tools":[{"type":"function", "name":"read", "parameters":{"type":"object"}}]}
        ]}));
        assert_eq!(body["tools"].as_array().unwrap().len(), 2);
        let events = codec.response(&json!({"role":"assistant", "tool_calls":[
            {"id":"c1","type":"function","function":{"name":"apply_patch","arguments":"{\"input\":\"PATCH\"}"}},
            {"id":"c2","type":"function","function":{"name":"files__read","arguments":"{}"}}
        ]}), "r1");
        let items: Vec<_> = events
            .into_iter()
            .filter_map(|event| match event {
                ResponseEvent::OutputItemDone(item) => Some(serde_json::to_value(item).unwrap()),
                _ => None,
            })
            .collect();
        assert_eq!(items[0]["type"], "custom_tool_call");
        assert_eq!(items[0]["input"], "PATCH");
        assert_eq!(items[1]["namespace"], "files");
        assert_eq!(items[1]["name"], "read");
    }
}
