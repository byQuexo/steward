//! Approvals and the admin console: users and roles, effective rights, test-as-user, audit,
//! kill switch, connector health.

use std::collections::BTreeMap;

use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use steward_config::AgentRole;
use steward_identity::DirUser;
use warden_core::{Action, ActionKind, AttrValue, Context, Engine, Principal, Subject};

use crate::app::{err, Authed, Shared};
use crate::inbox::DecideError;

/// Tools (catalog `tool` entries) this principal is offered.
pub fn visible_tools(engine: &Engine, p: &Principal, ctx: &Context) -> Vec<String> {
    engine
        .catalog()
        .entries()
        .filter(|(k, name, _)| **k == ActionKind::Tool && !name.contains('*'))
        .filter(|(_, name, _)| engine.visible(p, &Action::tool(name.to_string(), Value::Null), ctx))
        .map(|(_, name, _)| name.clone())
        .collect()
}

pub fn attr_value(v: &Value) -> Option<AttrValue> {
    Some(match v {
        Value::String(s) => AttrValue::String(s.clone()),
        Value::Bool(b) => AttrValue::Bool(*b),
        Value::Number(n) => AttrValue::Number(n.as_f64()?),
        Value::Array(a) => AttrValue::List(a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()),
        _ => return None,
    })
}

/// The principal a directory user would have when chatting with the assistant.
pub fn principal_for(st: &Shared, u: &DirUser) -> Principal {
    let mut s = Subject::user(u.id.clone()).with_roles(u.roles.iter().cloned());
    for (k, v) in &u.attrs {
        if let Some(a) = attr_value(v) {
            s = s.with_attr(k.clone(), a);
        }
    }
    let agent = st.profile.agent(AgentRole::Orchestrator).map(|a| a.client_id.clone()).unwrap_or_default();
    Principal::new(s, agent)
}

fn require_admin(st: &Shared, a: &Authed) -> Result<(), Response> {
    if st.is_admin(&a.principal) {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "admin role required"))
    }
}

pub async fn approvals(State(st): State<Shared>, a: Authed) -> Response {
    let (to_decide, mine) = st.inbox.for_user(&a.principal.subject.id);
    Json(json!({"to_decide": to_decide, "mine": mine})).into_response()
}

#[derive(Deserialize)]
pub struct DecideBody {
    pub decision: String,
    #[serde(default)]
    pub reason: Option<String>,
}

pub async fn decide(State(st): State<Shared>, a: Authed, Path(id): Path<String>, Json(b): Json<DecideBody>) -> Response {
    if a.principal.impersonated_by.is_some() {
        return err(StatusCode::FORBIDDEN, "test sessions cannot decide approvals");
    }
    let approve = match b.decision.as_str() {
        "approve" => true,
        "deny" => false,
        _ => return err(StatusCode::BAD_REQUEST, "decision must be approve or deny"),
    };
    match st.inbox.decide(&id, &a.principal.subject.id, approve, b.reason) {
        Ok(ap) => Json(json!({"approval": ap})).into_response(),
        Err(DecideError::NotFound) => err(StatusCode::NOT_FOUND, "no such approval"),
        Err(DecideError::NotAnApprover) => err(StatusCode::FORBIDDEN, "you are not an approver for this request"),
        Err(DecideError::SelfApproval) => err(StatusCode::FORBIDDEN, "you cannot approve your own request"),
        Err(DecideError::AlreadyDecided) => err(StatusCode::CONFLICT, "already decided"),
        Err(DecideError::NotTheRequester) => err(StatusCode::FORBIDDEN, "waiting for the requester to confirm"),
    }
}

pub async fn users(State(st): State<Shared>, a: Authed) -> Response {
    if let Err(r) = require_admin(&st, &a) {
        return r;
    }
    match st.directory.users().await {
        Ok(users) => {
            let roles: Vec<&String> = st.engine.policy().roles.keys().collect();
            let rows: Vec<Value> = users
                .iter()
                .map(|u| {
                    let p = principal_for(&st, u);
                    json!({"user": u, "effective_scopes": st.engine.effective_scopes(&p), "title": st.profile.user(&u.id).map(|d| d.title.clone())})
                })
                .collect();
            Json(json!({"users": rows, "roles": roles})).into_response()
        }
        Err(e) => err(StatusCode::BAD_GATEWAY, e.to_string()),
    }
}

#[derive(Deserialize)]
pub struct RolesBody {
    pub roles: Vec<String>,
}

/// Change a user's roles, then revoke their tokens and end their sessions: the next call with
/// an old token is refused by the gateway (introspection), not at token expiry.
pub async fn set_roles(State(st): State<Shared>, a: Authed, Path(id): Path<String>, Json(b): Json<RolesBody>) -> Response {
    if let Err(r) = require_admin(&st, &a) {
        return r;
    }
    if let Some(bad) = b.roles.iter().find(|r| !st.engine.policy().roles.contains_key(*r)) {
        return err(StatusCode::BAD_REQUEST, format!("unknown role `{bad}`"));
    }
    if let Err(e) = st.directory.set_roles(&id, &b.roles).await {
        return err(StatusCode::BAD_GATEWAY, e.to_string());
    }
    let logout = st.directory.logout(&id).await.err().map(|e| e.to_string());
    let revoke = st.tokens.revoke_subject(&id).await.err().map(|e| e.to_string());
    let ended = st.sessions.remove_user(&id);
    tracing::info!(user = %id, by = %a.principal.subject.id, roles = ?b.roles, ended, "roles changed");
    Json(json!({"ok": true, "sessions_ended": ended, "logout_error": logout, "revoke_error": revoke})).into_response()
}

pub async fn effective(State(st): State<Shared>, a: Authed, Path(id): Path<String>) -> Response {
    if let Err(r) = require_admin(&st, &a) {
        return r;
    }
    let Ok(u) = st.directory.user(&id).await else { return err(StatusCode::NOT_FOUND, "unknown user") };
    let p = principal_for(&st, &u);
    let ctx = st.context();
    Json(json!({
        "user": u,
        "principal": p,
        "effective_scopes": st.engine.effective_scopes(&p),
        "tools": visible_tools(&st.engine, &p, &ctx),
        "policy_version": st.engine.version(),
    }))
    .into_response()
}

/// Catalog and policy text for the browser's what-if calculator (Warden WASM).
pub async fn policy(State(st): State<Shared>, a: Authed) -> Response {
    if let Err(r) = require_admin(&st, &a) {
        return r;
    }
    let dir = st.profile.warden_dir();
    let read = |f: &str| std::fs::read_to_string(dir.join(f)).unwrap_or_default();
    let agents: BTreeMap<String, String> =
        st.profile.meta.agents.iter().map(|(r, s)| (r.as_str().to_string(), s.client_id.clone())).collect();
    Json(json!({"catalog": read("catalog.yaml"), "policy": read("policy.yaml"), "version": st.engine.version(), "agents": agents}))
        .into_response()
}

#[derive(Deserialize)]
pub struct TestAsBody {
    pub user: String,
}

/// Start a read-only "test as user" session (token service impersonation).
pub async fn test_as(State(st): State<Shared>, a: Authed, Json(b): Json<TestAsBody>) -> Response {
    if let Err(r) = require_admin(&st, &a) {
        return r;
    }
    if b.user == a.principal.subject.id {
        return err(StatusCode::BAD_REQUEST, "pick another user");
    }
    let Ok(target) = st.directory.user(&b.user).await else { return err(StatusCode::NOT_FOUND, "unknown user") };
    let token = match st.tokens.impersonate(&a.session.access_token, &target).await {
        Ok(t) => t,
        Err(e) => return err(StatusCode::BAD_GATEWAY, e.to_string()),
    };
    let mut s = st.sessions.create(&target.id, &target.name, token, None, None);
    s.impersonated_by = Some(a.principal.subject.id.clone());
    s.parent = Some(a.session.id.clone());
    st.sessions.put(s.clone());
    tracing::info!(operator = %a.principal.subject.id, user = %target.id, "test-as session started");
    let mut r = Json(json!({"ok": true, "user": target.id, "impersonated_by": a.principal.subject.id})).into_response();
    if let Ok(v) = st.cookie(&s.id, None).parse() {
        r.headers_mut().insert(header::SET_COOKIE, v);
    }
    r
}

pub async fn end_test_as(State(st): State<Shared>, a: Authed) -> Response {
    let Some(parent) = a.session.parent.clone() else { return err(StatusCode::BAD_REQUEST, "not a test session") };
    st.sessions.remove(&a.session.id);
    let mut r = Json(json!({"ok": true})).into_response();
    if let Ok(v) = st.cookie(&parent, None).parse() {
        r.headers_mut().insert(header::SET_COOKIE, v);
    }
    r
}

#[derive(Deserialize)]
pub struct TailQuery {
    #[serde(default = "n")]
    pub n: usize,
}

fn n() -> usize {
    100
}

pub async fn audit(State(st): State<Shared>, a: Authed, Query(q): Query<TailQuery>) -> Response {
    if let Err(r) = require_admin(&st, &a) {
        return r;
    }
    match st.gateway.get(&format!("/v1/audit/tail?n={}", q.n.min(500))).await {
        Ok(v) => Json(json!({"events": v["events"], "verify": st.audit_verify()})).into_response(),
        Err(e) => err(StatusCode::BAD_GATEWAY, e),
    }
}

pub async fn kill_get(State(st): State<Shared>, a: Authed) -> Response {
    if let Err(r) = require_admin(&st, &a) {
        return r;
    }
    match st.gateway.get("/v1/kill").await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err(StatusCode::BAD_GATEWAY, e),
    }
}

#[derive(Deserialize)]
pub struct KillBody {
    pub mode: String,
}

pub async fn kill_set(State(st): State<Shared>, a: Authed, Json(b): Json<KillBody>) -> Response {
    if let Err(r) = require_admin(&st, &a) {
        return r;
    }
    if !matches!(b.mode.as_str(), "off" | "writes" | "all") {
        return err(StatusCode::BAD_REQUEST, "mode must be off, writes or all");
    }
    match st.gateway.post("/v1/kill", json!({"mode": b.mode})).await {
        Ok(v) => {
            let k = match b.mode.as_str() {
                "writes" => warden_core::KillSwitch::Writes,
                "all" => warden_core::KillSwitch::All,
                _ => warden_core::KillSwitch::Off,
            };
            if let Ok(mut w) = st.kill.write() {
                *w = k;
            }
            tracing::warn!(mode = %b.mode, by = %a.principal.subject.id, "kill switch changed");
            Json(v).into_response()
        }
        Err(e) => err(StatusCode::BAD_GATEWAY, e),
    }
}

pub async fn connectors(State(st): State<Shared>, a: Authed) -> Response {
    if let Err(r) = require_admin(&st, &a) {
        return r;
    }
    let health = st.gateway.get("/v1/upstreams").await.unwrap_or(Value::Null);
    let states: BTreeMap<String, Value> =
        health["health"].as_array().into_iter().flatten().filter_map(|h| h["name"].as_str().map(|n| (n.to_string(), h.clone()))).collect();
    let rows: Vec<Value> = st
        .profile
        .connectors
        .iter()
        .map(|c| {
            json!({
                "name": c.name,
                "title": c.title,
                "description": c.description,
                "server": c.server,
                "tools": c.tools.iter().map(|(t, s)| json!({"name": format!("{}.{t}", c.name), "scopes": s.scopes, "sensitivity": s.sensitivity, "tags": s.tags})).collect::<Vec<_>>(),
                "health": states.get(&c.name).cloned().unwrap_or(json!({"state": "closed", "consecutive_failures": 0})),
            })
        })
        .collect();
    Json(json!({"connectors": rows})).into_response()
}

#[derive(Deserialize)]
pub struct WhatIfAction {
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Deserialize)]
pub struct WhatIfBody {
    pub principal: Principal,
    pub action: WhatIfAction,
}

/// "What if": the full decision trace for any principal and action, with the live policy and
/// kill switch. The browser can compute the same with Warden's WASM build; this is the reference.
pub async fn what_if(State(st): State<Shared>, a: Authed, Json(b): Json<WhatIfBody>) -> Response {
    if let Err(r) = require_admin(&st, &a) {
        return r;
    }
    let Ok(kind) = b.action.kind.parse::<ActionKind>() else { return err(StatusCode::BAD_REQUEST, "unknown action kind") };
    let args = if b.action.args.is_null() { json!({}) } else { b.action.args };
    let d = st.engine.explain(&b.principal, &Action::new(kind, b.action.name, args), &st.context());
    Json(d).into_response()
}
