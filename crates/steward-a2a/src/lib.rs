//! A2A server for Steward's sub-agents.
//!
//! Each sub-agent (research, action) is an A2A agent: `GET /.well-known/agent-card.json` lists
//! its skills from the profile, `message/send` runs one task, `tasks/get` returns it. It sits
//! behind Warden's A2A proxy, which filters the card per caller, checks the skill, binds tasks
//! to their creator and presents a token **exchanged** for the caller's (RFC 8693). The agent
//! verifies that token (it must be for this agent, with the delegation chain), exchanges it
//! once more for the MCP gateway's audience, and runs the turn with the same rig runtime as the
//! orchestrator. The gateway checks every tool call against the whole chain.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use steward_agents::{ChatEvent, Events, Runtime, TurnInput};
use steward_config::AgentRole;
use warden_identity::{now_unix, Verifier};

pub const CARD_PATH: &str = "/.well-known/agent-card.json";

/// Exchanges the incoming token for one the MCP gateway accepts (same user and chain).
#[derive(Clone)]
pub struct GatewayExchange {
    pub token_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub gateway_audience: String,
}

impl GatewayExchange {
    pub async fn exchange(&self, token: &str) -> Result<String, String> {
        let r = reqwest::Client::new()
            .post(&self.token_url)
            .basic_auth(&self.client_id, Some(&self.client_secret))
            .form(&[
                ("grant_type", warden_identity::TOKEN_EXCHANGE_GRANT),
                ("subject_token", token),
                ("audience", self.gateway_audience.as_str()),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = r.status();
        let v: Value = r.json().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!("token exchange refused: {}", v["error_description"].as_str().unwrap_or_default()));
        }
        v["access_token"].as_str().map(str::to_string).ok_or_else(|| "no access_token".into())
    }
}

struct Inner {
    role: AgentRole,
    runtime: Runtime,
    verifier: Verifier,
    exchange: GatewayExchange,
    public_url: String,
    tasks: Mutex<HashMap<String, Value>>,
}

#[derive(Clone)]
pub struct AgentServer(Arc<Inner>);

impl AgentServer {
    pub fn new(role: AgentRole, runtime: Runtime, verifier: Verifier, exchange: GatewayExchange, public_url: String) -> Self {
        Self(Arc::new(Inner { role, runtime, verifier, exchange, public_url, tasks: Mutex::new(HashMap::new()) }))
    }

    pub fn router(&self) -> Router {
        Router::new().route(CARD_PATH, get(card)).route("/", post(rpc)).route("/health", get(|| async { "ok" })).with_state(self.clone())
    }

    fn card(&self) -> Value {
        let p = &self.0.runtime.profile;
        let spec = p.agent(self.0.role);
        let skills: Vec<Value> = spec
            .map(|a| a.skills.clone())
            .unwrap_or_default()
            .iter()
            .map(|s| json!({"id": s, "name": s, "description": spec.map(|a| a.description.clone()).unwrap_or_default(), "tags": [self.0.role.as_str()]}))
            .collect();
        json!({
            "name": format!("{} ({})", p.meta.assistant_name, self.0.role.as_str()),
            "description": spec.map(|a| a.description.clone()).unwrap_or_default(),
            "url": self.0.public_url,
            "version": env!("CARGO_PKG_VERSION"),
            "protocolVersion": "0.3.0",
            "capabilities": {"streaming": false},
            "defaultInputModes": ["text/plain"],
            "defaultOutputModes": ["text/plain"],
            "skills": skills,
        })
    }
}

async fn card(State(s): State<AgentServer>) -> Json<Value> {
    Json(s.card())
}

fn rpc_err(id: Value, code: i64, msg: &str) -> Response {
    Json(json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": msg}})).into_response()
}

fn text_of(message: &Value) -> String {
    message["parts"].as_array().map(|p| p.iter().filter_map(|x| x["text"].as_str()).collect::<Vec<_>>().join("\n")).unwrap_or_default()
}

async fn rpc(State(s): State<AgentServer>, headers: HeaderMap, Json(msg): Json<Value>) -> Response {
    let id = msg["id"].clone();
    let Some(token) = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")) else {
        return (StatusCode::UNAUTHORIZED, "bearer token required").into_response();
    };
    let principal = match s.0.verifier.verify(token, now_unix()).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "a2a token rejected");
            return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
        }
    };
    let me = s.0.runtime.profile.agent(s.0.role).map(|a| a.client_id.clone()).unwrap_or_default();
    if principal.agent != me {
        return rpc_err(id, -32001, "token is for another agent");
    }
    match msg["method"].as_str().unwrap_or_default() {
        "message/send" => {
            let message = &msg["params"]["message"];
            let text = text_of(message);
            let skill = msg["params"]["metadata"]["skillId"]
                .as_str()
                .or_else(|| message["metadata"]["skillId"].as_str())
                .unwrap_or_default()
                .to_string();
            let gateway_token = match s.0.exchange.exchange(token).await {
                Ok(t) => t,
                Err(e) => return rpc_err(id, -32003, &e),
            };
            let (events, mut rx) = Events::channel();
            let input = TurnInput {
                role: s.0.role,
                principal: principal.clone(),
                token: gateway_token,
                message: text,
                history: vec![],
                session_id: None,
                only_tools: None,
            };
            let out = s.0.runtime.run(input, events).await;
            let mut log = Vec::new();
            while let Ok(e) = rx.try_recv() {
                if !matches!(e, ChatEvent::Token { .. } | ChatEvent::Done { .. }) {
                    log.push(serde_json::to_value(&e).unwrap_or(Value::Null));
                }
            }
            let task_id = hex::encode(rand::random::<[u8; 8]>());
            let (state, answer) = match out {
                Ok(o) if !o.budget_exceeded => ("completed", o.answer),
                Ok(o) => ("failed", o.answer),
                Err(e) => ("failed", e),
            };
            let task = json!({
                "kind": "task",
                "id": task_id,
                "contextId": message["contextId"].as_str().unwrap_or(&task_id),
                "status": {"state": state, "message": {"role": "agent", "kind": "message", "messageId": format!("{task_id}-r"), "parts": [{"kind": "text", "text": answer}]}},
                "artifacts": [{"artifactId": format!("{task_id}-a"), "parts": [{"kind": "text", "text": answer}]}],
                "metadata": {"skillId": skill, "agent": me, "subject": principal.subject.id, "act": principal.act, "events": log},
            });
            if let Ok(mut t) = s.0.tasks.lock() {
                t.insert(task_id, task.clone());
            }
            Json(json!({"jsonrpc": "2.0", "id": id, "result": task})).into_response()
        }
        "tasks/get" => {
            let task = msg["params"]["id"].as_str().unwrap_or_default();
            match s.0.tasks.lock().ok().and_then(|t| t.get(task).cloned()) {
                Some(t) => Json(json!({"jsonrpc": "2.0", "id": id, "result": t})).into_response(),
                None => rpc_err(id, -32001, "task not found"),
            }
        }
        _ => rpc_err(id, -32601, "method not found"),
    }
}

/// Call an A2A agent (through the Warden proxy) with a delegation token.
pub async fn send(proxy_url: &str, token: &str, skill: &str, text: &str) -> Result<Value, String> {
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "message/send",
        "params": {
            "message": {"role": "user", "kind": "message", "messageId": hex::encode(rand::random::<[u8; 8]>()), "parts": [{"kind": "text", "text": text}]},
            "metadata": {"skillId": skill}
        }
    });
    let r = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?
        .post(format!("{}/", proxy_url.trim_end_matches('/')))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("A2A: HTTP {}", r.status()));
    }
    r.json().await.map_err(|e| e.to_string())
}
