//! Chat over SSE, the user's live event stream, and the Warden approval webhook.

use std::convert::Infallible;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures::StreamExt;
use rig_core::message::Message;
use serde::Deserialize;
use serde_json::{json, Value};
use steward_agents::{ChatEvent, Events, TurnInput};
use steward_config::AgentRole;
use tokio_stream::wrappers::ReceiverStream;

use crate::app::{err, Authed, Shared};

#[derive(Deserialize)]
pub struct ChatRequest {
    pub message: String,
}

fn sse_event(v: &Value) -> Event {
    let kind = v["type"].as_str().unwrap_or("message").to_string();
    Event::default().event(kind).data(v.to_string())
}

/// `POST /api/chat`: run one turn and stream its events (plus approval updates for this user).
pub async fn chat(State(st): State<Shared>, a: Authed, Json(req): Json<ChatRequest>) -> Response {
    let message = req.message.trim().to_string();
    if message.is_empty() || message.chars().count() > 4000 {
        return err(StatusCode::BAD_REQUEST, "message must be 1-4000 characters");
    }
    {
        let Ok(mut busy) = st.busy.lock() else { return err(StatusCode::INTERNAL_SERVER_ERROR, "busy lock") };
        if !busy.insert(a.session.id.clone()) {
            return err(StatusCode::CONFLICT, "a turn is already running in this session");
        }
    }
    let history = st.history.lock().ok().and_then(|h| h.get(&a.session.id).cloned()).unwrap_or_default();
    let (events, mut rx) = Events::channel();
    let mut bus = st.bus.subscribe(&a.principal.subject.id);
    let (out_tx, out_rx) = tokio::sync::mpsc::channel::<Event>(256);

    let input = TurnInput {
        role: AgentRole::Orchestrator,
        principal: a.principal.clone(),
        token: a.session.access_token.clone(),
        message: message.clone(),
        history,
        session_id: Some(a.session.id.clone()),
        only_tools: None,
    };
    let st2 = st.clone();
    let session_id = a.session.id.clone();
    tokio::spawn(async move {
        let result = st2.runtime.run(input, events.clone()).await;
        match result {
            Ok(out) => {
                if let Ok(mut h) = st2.history.lock() {
                    let entry = h.entry(session_id.clone()).or_default();
                    entry.push(Message::user(message));
                    entry.push(Message::assistant(out.answer));
                    let len = entry.len();
                    if len > 40 {
                        entry.drain(..len - 40);
                    }
                }
            }
            Err(e) => {
                events.emit(ChatEvent::Error { message: e.clone() });
                events.emit(ChatEvent::Done { answer: String::new(), run_id: String::new(), eur: 0.0 });
            }
        }
        if let Ok(mut b) = st2.busy.lock() {
            b.remove(&session_id);
        }
    });
    tokio::spawn(async move {
        loop {
            tokio::select! {
                e = rx.recv() => {
                    let Some(e) = e else { break };
                    let done = matches!(e, ChatEvent::Done { .. });
                    let v = serde_json::to_value(&e).unwrap_or(Value::Null);
                    if out_tx.send(sse_event(&v)).await.is_err() || done { break; }
                }
                b = bus.recv() => {
                    if let Ok(v) = b {
                        if matches!(v["type"].as_str(), Some("approval_pending" | "approval_decided")) && out_tx.send(sse_event(&v)).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    });
    Sse::new(ReceiverStream::new(out_rx).map(Ok::<_, Infallible>))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(10)))
        .into_response()
}

pub async fn history(State(st): State<Shared>, a: Authed) -> Response {
    let h = st.history.lock().ok().and_then(|h| h.get(&a.session.id).cloned()).unwrap_or_default();
    let items: Vec<Value> = h
        .iter()
        .filter_map(|m| match m {
            Message::User { content } => content.iter().find_map(|c| match c {
                rig_core::message::UserContent::Text(t) => Some(json!({"role": "user", "text": t.text})),
                _ => None,
            }),
            Message::Assistant(a) => a.content.iter().find_map(|c| match c {
                rig_core::message::AssistantContent::Text(t) => Some(json!({"role": "assistant", "text": t.text})),
                _ => None,
            }),
            _ => None,
        })
        .collect();
    Json(json!({"messages": items})).into_response()
}

pub async fn clear(State(st): State<Shared>, a: Authed) -> Response {
    if let Ok(mut h) = st.history.lock() {
        h.remove(&a.session.id);
    }
    Json(json!({"ok": true})).into_response()
}

/// `GET /api/events`: live updates for this user (approval requests to decide, decisions).
pub async fn events(State(st): State<Shared>, a: Authed) -> Response {
    let mut bus = st.bus.subscribe(&a.principal.subject.id);
    let (tx, rx) = tokio::sync::mpsc::channel::<Event>(64);
    tokio::spawn(async move {
        while let Ok(v) = bus.recv().await {
            if tx.send(sse_event(&v)).await.is_err() {
                break;
            }
        }
    });
    Sse::new(ReceiverStream::new(rx).map(Ok::<_, Infallible>))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
        .into_response()
}

/// `POST /hooks/warden/approval`: Warden's webhook protocol v1. Held open until decided.
pub async fn warden_webhook(State(st): State<Shared>, headers: HeaderMap, body: Bytes) -> Response {
    let sig = headers.get("x-warden-signature").or_else(|| headers.get("x-agent-scope-signature")).and_then(|v| v.to_str().ok());
    if !st.inbox.verify_signature(&body, sig) {
        return err(StatusCode::UNAUTHORIZED, "bad signature");
    }
    let Ok(req) = serde_json::from_slice::<Value>(&body) else { return err(StatusCode::BAD_REQUEST, "invalid JSON") };
    if req["v"] != 1 {
        return err(StatusCode::BAD_REQUEST, "unsupported protocol version");
    }
    Json(st.inbox.request(req).await).into_response()
}
