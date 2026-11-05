//! The backend for the browser: login, chat, approvals, console. The browser only ever holds
//! an opaque, HttpOnly session cookie; tokens stay here.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use axum::extract::{FromRequestParts, Query, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use rig_core::message::Message;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Digest as _;
use steward_agents::Runtime;
use steward_config::Profile;
use steward_cost::Ledger;
use steward_identity::oidc::{jwt_claim, OidcClient};
use steward_identity::{Directory, Session, SessionStore, TokenService};
use steward_memory::Memory;
use warden_core::{Context, Engine, IdentityConfig, KillSwitch, Principal};
use warden_identity::{now_unix, Sts, Verifier};

use crate::inbox::{Bus, Inbox};

pub const COOKIE: &str = "steward_session";

/// How users log in.
pub enum Login {
    /// Local demo: pick a seed user; the token service issues the token (never in production).
    Dev { sts: Arc<Sts>, audience: String },
    /// Any OIDC provider (Keycloak in compose), code flow with PKCE.
    Oidc(Arc<OidcClient>),
}

/// Gateway admin API (kill switch, audit, upstream health).
#[derive(Clone)]
pub struct GatewayAdmin {
    pub url: String,
    pub token: String,
    pub http: reqwest::Client,
}

impl GatewayAdmin {
    pub async fn get(&self, path: &str) -> Result<Value, String> {
        let r = self.http.get(format!("{}{path}", self.url)).bearer_auth(&self.token).send().await.map_err(|e| e.to_string())?;
        if !r.status().is_success() {
            return Err(format!("gateway admin {path}: HTTP {}", r.status()));
        }
        r.json().await.map_err(|e| e.to_string())
    }

    pub async fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        let r =
            self.http.post(format!("{}{path}", self.url)).bearer_auth(&self.token).json(&body).send().await.map_err(|e| e.to_string())?;
        if !r.status().is_success() {
            return Err(format!("gateway admin {path}: HTTP {}", r.status()));
        }
        r.json().await.map_err(|e| e.to_string())
    }
}

pub struct AppState {
    pub profile: Arc<Profile>,
    pub engine: Arc<Engine>,
    pub runtime: Runtime,
    pub login: Login,
    pub sessions: SessionStore,
    pub directory: Arc<dyn Directory>,
    pub tokens: TokenService,
    /// Verifies session tokens locally (the gateway verifies again, with introspection).
    pub verifier: Verifier,
    pub inbox: Inbox,
    pub bus: Arc<Bus>,
    pub gateway: GatewayAdmin,
    pub ledger: Arc<Ledger>,
    pub memory: Memory,
    pub kill: Arc<RwLock<KillSwitch>>,
    /// Chat history per session (text only).
    pub history: Mutex<HashMap<String, Vec<Message>>>,
    pub busy: Mutex<std::collections::HashSet<String>>,
    pub ui_dir: Option<PathBuf>,
    pub docrag_url: Option<String>,
    pub public_url: String,
    /// Secure cookies (HTTPS deployments).
    pub secure_cookies: bool,
    /// The gateway's audit directory (read-only mount), for the console's verify status.
    pub audit_dir: Option<PathBuf>,
}

pub type Shared = Arc<AppState>;

/// The identity config the BFF verifies session tokens with: same issuers and claim mapping as
/// the gateway, without introspection (the gateway does that on every call).
pub fn session_identity(
    issuer: &str,
    jwks_uri: &str,
    audience: &str,
    algorithms: &str,
    delegation_issuer: &str,
) -> Result<IdentityConfig, String> {
    let mapping = steward_config::TOKEN_MAPPING;
    IdentityConfig::from_yaml_str(&format!(
        "version: 1\nissuers:\n  - {{ issuer: {issuer}, audience: {audience}, jwks_uri: {jwks_uri}, algorithms: [{algorithms}], mapping: {mapping} }}\ndelegation_issuers: [{delegation_issuer}]\nscope_claim: ignore\n"
    ))
}

impl AppState {
    pub fn context(&self) -> Context {
        Context { kill_switch: self.kill.read().map(|k| *k).unwrap_or(KillSwitch::Off), ..Default::default() }
    }

    pub fn is_admin(&self, p: &Principal) -> bool {
        p.impersonated_by.is_none() && p.subject.roles.iter().any(|r| self.profile.meta.admin_roles.contains(r))
    }

    pub fn can_see_costs(&self, p: &Principal) -> bool {
        self.is_admin(p) || (p.impersonated_by.is_none() && p.subject.roles.iter().any(|r| self.profile.meta.cost_roles.contains(r)))
    }

    pub fn cookie(&self, value: &str, max_age: Option<u64>) -> String {
        let secure = if self.secure_cookies { "; Secure" } else { "" };
        let age = max_age.map(|a| format!("; Max-Age={a}")).unwrap_or_default();
        format!("{COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax{secure}{age}")
    }

    /// Hash-chain and checkpoint verification of the gateway's audit files.
    pub fn audit_verify(&self) -> Value {
        let Some(dir) = &self.audit_dir else { return json!({"status": "not configured"}) };
        match warden_audit::verify_dir(dir, None, 10_000) {
            Ok(r) => json!({"status": "ok", "chains": r.chains}),
            Err(e) => json!({"status": "failed", "error": e.to_string()}),
        }
    }

    /// Keep the kill-switch view in sync with the gateway.
    pub fn spawn_kill_sync(self: &Arc<Self>) {
        let st = self.clone();
        tokio::spawn(async move {
            loop {
                if let Ok(v) = st.gateway.get("/v1/kill").await {
                    let k = match v["mode"].as_str() {
                        Some("writes") => KillSwitch::Writes,
                        Some("all") => KillSwitch::All,
                        _ => KillSwitch::Off,
                    };
                    if let Ok(mut w) = st.kill.write() {
                        *w = k;
                    }
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });
    }
}

/// An authenticated request: the session and the verified principal.
pub struct Authed {
    pub session: Session,
    pub principal: Principal,
}

pub fn err(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({"error": msg.into()}))).into_response()
}

fn cookie_value(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().strip_prefix(&format!("{COOKIE}=")).map(str::to_string))
        .next()
}

impl FromRequestParts<Shared> for Authed {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, st: &Shared) -> Result<Self, Self::Rejection> {
        let unauthorized = || err(StatusCode::UNAUTHORIZED, "not logged in");
        // API clients (scripts, the compose smoke test) may send the IdP's access token
        // instead of a cookie; no cookie means no CSRF exposure.
        if let Some(token) = parts.headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer "))
        {
            let principal = st.verifier.verify(token, now_unix()).await.map_err(|_| unauthorized())?;
            let session = Session {
                id: format!("bearer:{}", &hex::encode(sha2::Sha256::digest(token.as_bytes()))[..16]),
                user: principal.subject.id.clone(),
                name: principal.subject.id.clone(),
                access_token: token.to_string(),
                refresh_token: None,
                expires_at: None,
                impersonated_by: principal.impersonated_by.clone(),
                parent: None,
                created: std::time::Instant::now(),
            };
            return Ok(Authed { session, principal });
        }
        let id = cookie_value(&parts.headers).ok_or_else(unauthorized)?;
        let session = st.sessions.get(&id).ok_or_else(unauthorized)?;
        // State-changing requests carry a header a cross-site form cannot set (CSRF).
        if parts.method != axum::http::Method::GET && parts.headers.get("x-steward").is_none() {
            return Err(err(StatusCode::FORBIDDEN, "missing X-Steward header"));
        }
        let principal = match st.verifier.verify(&session.access_token, now_unix()).await {
            Ok(p) => p,
            Err(e) => {
                tracing::info!(user = %session.user, error = %e, "session token rejected");
                st.sessions.remove(&id);
                return Err(unauthorized());
            }
        };
        Ok(Authed { session, principal })
    }
}

#[derive(Deserialize)]
struct Callback {
    code: String,
    state: String,
}

#[derive(Deserialize)]
struct DevLogin {
    user: String,
}

async fn login(State(st): State<Shared>) -> Response {
    match &st.login {
        Login::Oidc(c) => Redirect::to(&c.authorize_url()).into_response(),
        Login::Dev { .. } => Redirect::to("/?login=dev").into_response(),
    }
}

async fn callback(State(st): State<Shared>, Query(q): Query<Callback>) -> Response {
    let Login::Oidc(c) = &st.login else { return err(StatusCode::NOT_FOUND, "OIDC login is not configured") };
    match c.exchange(&q.code, &q.state).await {
        Ok(t) => {
            let user = jwt_claim(&t.access_token, "preferred_username").unwrap_or_default();
            let name = jwt_claim(&t.access_token, "name").unwrap_or_else(|| user.clone());
            let s = st.sessions.create(&user, &name, t.access_token, t.refresh_token, t.expires_in.map(Duration::from_secs));
            let mut r = Redirect::to("/").into_response();
            if let Ok(v) = st.cookie(&s.id, None).parse() {
                r.headers_mut().insert(header::SET_COOKIE, v);
            }
            r
        }
        Err(e) => err(StatusCode::UNAUTHORIZED, e.to_string()),
    }
}

/// Dev login: the token service issues a token for a directory user, with the directory's
/// current roles (so role changes show after the next login).
async fn dev_login(State(st): State<Shared>, headers: HeaderMap, Json(b): Json<DevLogin>) -> Response {
    let Login::Dev { sts, audience } = &st.login else { return err(StatusCode::NOT_FOUND, "dev login is disabled") };
    if headers.get("x-steward").is_none() {
        return err(StatusCode::FORBIDDEN, "missing X-Steward header");
    }
    let Ok(u) = st.directory.user(&b.user).await else { return err(StatusCode::NOT_FOUND, "unknown user") };
    let client = st.profile.agent(steward_config::AgentRole::Orchestrator).map(|a| a.client_id.clone()).unwrap_or_default();
    let mut attrs = serde_json::Map::new();
    for (k, v) in &u.attrs {
        attrs.insert(k.clone(), v.clone());
    }
    attrs.insert("name".into(), json!(u.name));
    attrs.insert("email".into(), json!(u.email));
    let roles: Vec<&str> = u.roles.iter().map(String::as_str).collect();
    match sts.user_token(&u.id, &client, &roles, Value::Object(attrs), audience, &[], 3600) {
        Ok(token) => {
            let s = st.sessions.create(&u.id, &u.name, token, None, Some(Duration::from_secs(3600)));
            let mut r = Json(json!({"ok": true, "user": u.id})).into_response();
            if let Ok(v) = st.cookie(&s.id, None).parse() {
                r.headers_mut().insert(header::SET_COOKIE, v);
            }
            r
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn logout(State(st): State<Shared>, a: Authed) -> Response {
    st.sessions.remove(&a.session.id);
    if let Ok(mut h) = st.history.lock() {
        h.remove(&a.session.id);
    }
    let mut r = Json(json!({"ok": true})).into_response();
    if let Ok(v) = st.cookie("", Some(0)).parse() {
        r.headers_mut().insert(header::SET_COOKIE, v);
    }
    r
}

/// Public facts for the login screen: profile name, demo users in dev mode.
async fn info(State(st): State<Shared>) -> Response {
    let dev_users: Vec<Value> = match &st.login {
        Login::Dev { .. } => st
            .directory
            .users()
            .await
            .unwrap_or_default()
            .iter()
            .map(|u| json!({"id": u.id, "name": u.name, "roles": u.roles, "title": st.profile.user(&u.id).map(|d| d.title.clone())}))
            .collect(),
        Login::Oidc(_) => vec![],
    };
    Json(json!({
        "profile": st.profile.meta.name,
        "company": st.profile.meta.display_name,
        "assistant": st.profile.meta.assistant_name,
        "locale": st.profile.meta.locale,
        "login": if matches!(st.login, Login::Dev { .. }) { "dev" } else { "oidc" },
        "dev_users": dev_users,
    }))
    .into_response()
}

async fn me(State(st): State<Shared>, a: Authed) -> Response {
    let p = &a.principal;
    let suggestions: Vec<String> = p.subject.roles.iter().filter_map(|r| st.profile.meta.suggestions.get(r)).flatten().cloned().collect();
    let visible = crate::admin::visible_tools(&st.engine, p, &st.context());
    Json(json!({
        "user": p.subject.id,
        "name": a.session.name,
        "roles": p.subject.roles,
        "attrs": p.subject.attrs,
        "agent": p.agent,
        "impersonated_by": p.impersonated_by,
        "admin": st.is_admin(p),
        "costs": st.can_see_costs(p),
        "assistant": st.profile.meta.assistant_name,
        "company": st.profile.meta.display_name,
        "greeting": st.profile.meta.messages.greeting,
        "suggestions": suggestions,
        "tools": visible,
        "kill_switch": st.context().kill_switch,
    }))
    .into_response()
}

pub fn router(st: Shared) -> Router {
    let api = Router::new()
        .route("/info", get(info))
        .route("/me", get(me))
        .route("/logout", post(logout))
        .route("/dev-login", post(dev_login))
        .route("/chat", post(crate::chat::chat))
        .route("/chat/history", get(crate::chat::history).delete(crate::chat::clear))
        .route("/events", get(crate::chat::events))
        .route("/approvals", get(crate::admin::approvals))
        .route("/approvals/{id}", post(crate::admin::decide))
        .route("/docs/pages/{doc}/{file}", get(crate::pages::page_image))
        .route("/memory", get(crate::pages::memory_list).delete(crate::pages::memory_forget_all))
        .route("/memory/{id}", delete(crate::pages::memory_forget))
        .route("/costs", get(crate::pages::costs))
        .route("/admin/users", get(crate::admin::users))
        .route("/admin/users/{id}/roles", post(crate::admin::set_roles))
        .route("/admin/effective/{id}", get(crate::admin::effective))
        .route("/admin/policy", get(crate::admin::policy))
        .route("/admin/what-if", post(crate::admin::what_if))
        .route("/admin/test-as", post(crate::admin::test_as))
        .route("/admin/test-as/end", post(crate::admin::end_test_as))
        .route("/admin/audit", get(crate::admin::audit))
        .route("/admin/kill", get(crate::admin::kill_get).post(crate::admin::kill_set))
        .route("/admin/connectors", get(crate::admin::connectors));
    let mut app = Router::new()
        .nest("/api", api)
        .route("/auth/login", get(login))
        .route("/auth/callback", get(callback))
        .route("/hooks/warden/approval", post(crate::chat::warden_webhook))
        .route("/health", get(|| async { Json(json!({"status": "ok"})) }));
    if let Some(dir) = &st.ui_dir {
        let index = dir.join("index.html");
        app = app.fallback_service(tower_http::services::ServeDir::new(dir).fallback(tower_http::services::ServeFile::new(index)));
    }
    app.layer(tower_http::catch_panic::CatchPanicLayer::new()).with_state(st)
}
