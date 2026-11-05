//! The MCP wire protocol, server side: JSON-RPC over `POST /<server>/mcp` with JSON responses.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, RwLock};

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use warden_core::Principal;
use warden_identity::{now_unix, Verifier};

use crate::{McpServer, ToolError};

pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// How servers learn who is calling.
#[derive(Clone)]
pub enum CallerAuth {
    /// Verify the exchanged token the gateway forwards (production, compose, e2e tests).
    Verify(Arc<Verifier>),
    /// Trust the network; servers see no principal (unit tests of single servers).
    None,
}

/// Who called: the verified principal (if verified) and the raw bearer presence.
#[derive(Clone, Debug, Default)]
pub struct Caller {
    pub principal: Option<Principal>,
}

impl Caller {
    pub fn subject(&self) -> Option<&str> {
        self.principal.as_ref().map(|p| p.subject.id.as_str())
    }
    pub fn anonymous() -> Self {
        Self { principal: None }
    }
    pub fn of(p: Principal) -> Self {
        Self { principal: Some(p) }
    }
}

/// Servers taken down on purpose (outage drills, tests): they answer 503.
#[derive(Clone, Default)]
pub struct Outages(Arc<RwLock<BTreeSet<String>>>);

impl Outages {
    pub fn set(&self, server: &str, down: bool) {
        if let Ok(mut s) = self.0.write() {
            if down {
                s.insert(server.to_string());
            } else {
                s.remove(server);
            }
        }
    }
    pub fn is_down(&self, server: &str) -> bool {
        self.0.read().map(|s| s.contains(server)).unwrap_or(false)
    }
}

#[derive(Clone)]
struct AppState {
    servers: Arc<BTreeMap<String, Arc<dyn McpServer>>>,
    auth: CallerAuth,
    outages: Outages,
}

/// `/<name>/mcp` for every server, plus `/health`.
pub fn router(servers: BTreeMap<String, Arc<dyn McpServer>>, auth: CallerAuth) -> Router {
    router_with(servers, auth, Outages::default())
}

pub fn router_with(servers: BTreeMap<String, Arc<dyn McpServer>>, auth: CallerAuth, outages: Outages) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(json!({"status": "ok"})) }))
        .route("/{server}/mcp", post(handle))
        .with_state(AppState { servers: Arc::new(servers), auth, outages })
}

fn ok(id: Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn err(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn respond(status: StatusCode, body: Option<Value>, session: bool) -> Response {
    let mut b = Response::builder().status(status);
    if body.is_some() {
        b = b.header("content-type", "application/json");
    }
    if session {
        b = b.header("mcp-session-id", "steward");
    }
    b.body(body.map(|v| Body::from(v.to_string())).unwrap_or_default()).unwrap_or_default()
}

async fn handle(State(st): State<AppState>, Path(name): Path<String>, headers: HeaderMap, Json(msg): Json<Value>) -> Response {
    let Some(server) = st.servers.get(&name).cloned() else {
        return respond(StatusCode::NOT_FOUND, Some(json!({"error": "unknown server"})), false);
    };
    if st.outages.is_down(&name) {
        return respond(StatusCode::SERVICE_UNAVAILABLE, Some(json!({"error": "server is down"})), false);
    }
    let caller = match &st.auth {
        CallerAuth::None => Caller::anonymous(),
        CallerAuth::Verify(v) => {
            let token = headers
                .get("authorization")
                .and_then(|h| h.to_str().ok())
                .and_then(|h| h.strip_prefix("Bearer ").or_else(|| h.strip_prefix("bearer ")));
            match token {
                None => return respond(StatusCode::UNAUTHORIZED, Some(json!({"error": "missing bearer token"})), false),
                Some(t) => match v.verify(t, now_unix()).await {
                    Ok(p) => Caller::of(p),
                    Err(e) => {
                        tracing::warn!(server = %name, error = %e, "rejected token");
                        return respond(StatusCode::UNAUTHORIZED, Some(json!({"error": "invalid token"})), false);
                    }
                },
            }
        }
    };
    let method = msg.get("method").and_then(Value::as_str).unwrap_or_default().to_string();
    let Some(id) = msg.get("id").cloned().filter(|_| !method.is_empty()) else {
        return respond(StatusCode::ACCEPTED, None, false); // notification or response
    };
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let reply = match method.as_str() {
        "initialize" => ok(
            id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": false}},
                "serverInfo": {"name": format!("steward-{}", server.name()), "version": env!("CARGO_PKG_VERSION")}
            }),
        ),
        "ping" => ok(id, json!({})),
        "tools/list" => ok(id, json!({"tools": server.tools().iter().map(|t| t.to_json()).collect::<Vec<_>>()})),
        "resources/list" => ok(id, json!({"resources": []})),
        "resources/templates/list" => ok(id, json!({"resourceTemplates": []})),
        "prompts/list" => ok(id, json!({"prompts": []})),
        "tools/call" => {
            let tool = params.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            if !server.tools().iter().any(|t| t.name == tool) {
                err(id, -32602, "unknown tool")
            } else {
                match server.call(&caller, &tool, &args).await {
                    Ok(v) => ok(id, tool_result(&v, false)),
                    Err(e) => {
                        if matches!(e, ToolError::Internal(_)) {
                            tracing::error!(server = %name, %tool, error = %e, "tool failed");
                        }
                        ok(id, tool_result(&json!({"error": e.to_string()}), true))
                    }
                }
            }
        }
        _ => err(id, -32601, "method not found"),
    };
    respond(StatusCode::OK, Some(reply), method == "initialize")
}

fn tool_result(v: &Value, is_error: bool) -> Value {
    let text = match v {
        Value::String(s) => s.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_default(),
    };
    let mut out = json!({"content": [{"type": "text", "text": text}], "isError": is_error});
    if v.is_object() {
        out["structuredContent"] = v.clone();
    }
    out
}
