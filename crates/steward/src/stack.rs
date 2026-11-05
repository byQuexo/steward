//! The whole Steward stack in one process: token service (as dev identity provider and for
//! delegation, impersonation and revocation), the profile's MCP servers, and the Warden gateway
//! in front of them. Used by `steward demo`, the end-to-end tests and local development; the
//! compose deployment runs the same pieces as separate containers with Keycloak as the IdP.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use steward_config::{AgentRole, Profile, ServerSpec};
use steward_mcp_servers::{router as mcp_router, servers_for, CallerAuth, EffectLog, ServerOptions};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use warden_audit::{AuditSink, MemorySink};
use warden_core::IdentityConfig;
use warden_gateway::{Approver, DenyAll, Gateway, UpstreamAuth, WebhookApprover};
use warden_identity::{ClientDef, Sts, StsConfig, Verifier};

/// Audience of tokens the gateway exchanges for the built-in MCP servers.
pub const UPSTREAM_AUDIENCE: &str = "steward-mcp";
/// Dev-only secrets. The env var exists because Warden reads introspection secrets from the environment.
pub const GATEWAY_SECRET: &str = "dev-gateway-secret";
pub const GATEWAY_SECRET_ENV: &str = "STEWARD_DEV_GATEWAY_SECRET";
pub const BOT_SECRET: &str = "dev-bot-secret";
pub const CONSOLE_SECRET: &str = "dev-console-secret";
pub const ADMIN_TOKEN: &str = "dev-admin-token";

/// How the gateway asks for approvals.
#[derive(Clone)]
pub enum ApproverMode {
    /// Every approval is denied (no inbox running).
    DenyAll,
    /// Warden webhook protocol v1 to Steward's approvals inbox.
    Webhook { url: String, secret: Option<Vec<u8>> },
}

#[derive(Clone)]
pub struct StackOptions {
    pub approver: ApproverMode,
    pub docrag_url: Option<String>,
    /// Token lifetime for user logins (short lifetimes make revocation tests cheap).
    pub token_ttl_s: i64,
    /// Gateway → token service introspection cache (0 = revocation takes effect immediately).
    pub introspection_cache_s: u64,
}

impl Default for StackOptions {
    fn default() -> Self {
        Self { approver: ApproverMode::DenyAll, docrag_url: None, token_ttl_s: 900, introspection_cache_s: 0 }
    }
}

/// A running stack. Dropping it stops every task.
pub struct Stack {
    pub profile: Arc<Profile>,
    pub sts: Arc<Sts>,
    pub sts_url: String,
    pub gateway: Gateway,
    /// MCP endpoint of the gateway (also the audience of user tokens).
    pub gateway_url: String,
    pub admin_url: String,
    pub mcp_base: String,
    pub effects: EffectLog,
    pub audit: Arc<MemorySink>,
    tasks: Vec<JoinHandle<()>>,
}

impl Drop for Stack {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
    }
}

async fn bind() -> Result<(TcpListener, String), String> {
    let l = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let addr = l.local_addr().map_err(|e| e.to_string())?;
    Ok((l, format!("http://{addr}")))
}

/// Identity config of the gateway: user and delegation tokens from the token service, checked
/// against it by introspection so revocation applies to the next call.
pub fn gateway_identity(issuer: &str, audience: &str, introspection_cache_s: u64) -> Result<IdentityConfig, String> {
    IdentityConfig::from_yaml_str(&format!(
        r#"version: 1
issuers:
  - issuer: {issuer}
    audience: {audience}
    jwks_uri: {issuer}/jwks
    algorithms: [ES256]
    mapping: {{ preset: keycloak, attrs: {{ org_unit: /org_unit, tenants: /tenants, teams: /teams, doc_scope: /doc_scope }} }}
    introspection: {{ endpoint: {issuer}/introspect, client_id: gateway, secret_env: {GATEWAY_SECRET_ENV}, cache_s: {introspection_cache_s} }}
delegation_issuers: [{issuer}]
scope_claim: ignore
"#
    ))
}

/// Identity config the built-in MCP servers use for exchanged tokens.
pub fn upstream_identity(issuer: &str) -> Result<IdentityConfig, String> {
    IdentityConfig::from_yaml_str(&format!(
        "version: 1\nissuers:\n  - {{ issuer: {issuer}, audience: {UPSTREAM_AUDIENCE}, jwks_uri: {issuer}/jwks, algorithms: [ES256], mapping: {{ preset: keycloak, attrs: {{ doc_scope: /doc_scope, teams: /teams, org_unit: /org_unit, tenants: /tenants }} }} }}\ndelegation_issuers: [{issuer}]\nscope_claim: ignore\n"
    ))
}

impl Stack {
    pub async fn start(profile: Profile, opts: StackOptions) -> Result<Self, String> {
        // Warden reads the introspection secret from the environment; same constant everywhere.
        std::env::set_var(GATEWAY_SECRET_ENV, GATEWAY_SECRET);
        let profile = Arc::new(profile);
        let engine = profile.engine().map_err(|e| e.to_string())?;
        let (sts_l, sts_url) = bind().await?;
        let (mcp_l, mcp_base) = bind().await?;
        let (gw_l, gw_base) = bind().await?;
        let (admin_l, admin_url) = bind().await?;
        let gateway_url = format!("{gw_base}/mcp");
        let mut tasks = Vec::new();

        // Token service: dev IdP for the seed users, delegation (A2A), impersonation, revocation.
        let agent = |r: AgentRole| profile.agent(r).map(|a| a.client_id.clone()).unwrap_or_default();
        let mut clients = HashMap::new();
        clients
            .insert(agent(AgentRole::Orchestrator), ClientDef { secret: BOT_SECRET.into(), can_impersonate: true, ..Default::default() });
        for r in [AgentRole::Research, AgentRole::Action] {
            clients.insert(agent(r), ClientDef { secret: BOT_SECRET.into(), ..Default::default() });
        }
        clients.insert(
            "gateway".into(),
            ClientDef {
                secret: GATEWAY_SECRET.into(),
                accept_audiences: vec![gateway_url.clone()],
                may_exchange_to: vec![UPSTREAM_AUDIENCE.into()],
                ..Default::default()
            },
        );
        clients
            .insert("steward-console".into(), ClientDef { secret: CONSOLE_SECRET.into(), can_revoke_subjects: true, ..Default::default() });
        let policy = engine.policy().clone();
        let sts = Arc::new(
            Sts::new(StsConfig { issuer: sts_url.clone(), token_ttl_s: opts.token_ttl_s, clients }, None)?.with_delegation_check(Arc::new(
                move |from: &str, to: &str| policy.agents.get(from).is_some_and(|a| a.delegation.may_delegate_to.iter().any(|t| t == to)),
            )),
        );
        let r = sts.clone().router();
        tasks.push(tokio::spawn(async move {
            let _ = axum::serve(sts_l, r).await;
        }));

        // Built-in MCP servers, verifying the exchanged tokens the gateway forwards.
        let effects = EffectLog::default();
        let server_opts = ServerOptions { docrag_url: opts.docrag_url.clone(), page_url_prefix: None };
        let servers = servers_for(&profile, &server_opts, &effects)?;
        let auth = CallerAuth::Verify(Arc::new(Verifier::new(upstream_identity(&sts_url)?)));
        let r = mcp_router(servers, auth);
        tasks.push(tokio::spawn(async move {
            let _ = axum::serve(mcp_l, r).await;
        }));

        // The Warden gateway in front of them.
        let audit = MemorySink::new();
        let approver: Arc<dyn Approver> = match &opts.approver {
            ApproverMode::DenyAll => Arc::new(DenyAll),
            ApproverMode::Webhook { url, secret } => {
                Arc::new(WebhookApprover::new(url.clone(), secret.clone(), Duration::from_secs(profile.approvals.timeout_s + 5)))
            }
        };
        let mut b = Gateway::builder()
            .engine(engine)
            .verifier(Verifier::new(gateway_identity(&sts_url, &gateway_url, opts.introspection_cache_s)?))
            .approver(approver)
            .approval_timeout(Duration::from_secs(profile.approvals.timeout_s))
            .progress_interval(Duration::from_millis(500))
            .audit(audit.clone() as Arc<dyn AuditSink>)
            .hmac_key(b"steward-dev-hmac".to_vec())
            .public_url(gateway_url.clone())
            .admin_token(Some(ADMIN_TOKEN.into()));
        for c in &profile.connectors {
            let url = match &c.server {
                ServerSpec::Builtin(_) => format!("{mcp_base}/{}/mcp", c.name),
                ServerSpec::Url(u) => u.clone(),
                ServerSpec::Command(_) => continue, // stdio servers are a compose/production concern
            };
            let auth = UpstreamAuth::TokenExchange {
                token_url: format!("{sts_url}/token"),
                client_id: "gateway".into(),
                secret: GATEWAY_SECRET.into(),
                audience: UPSTREAM_AUDIENCE.into(),
                scope: None,
            };
            b = b.upstream(&c.name, &url, auth, c.resources.clone());
        }
        let gateway = b.build().map_err(|e| e.to_string())?;
        let g = gateway.clone();
        tasks.push(tokio::spawn(async move {
            let _ = g.serve(gw_l, Some(admin_l)).await;
        }));

        Ok(Self { profile, sts, sts_url, gateway, gateway_url, admin_url, mcp_base, effects, audit, tasks })
    }

    /// A login token for a seed user, as the identity provider would issue it to the assistant.
    pub fn user_token(&self, user: &str) -> Result<String, String> {
        let u = self.profile.user(user).ok_or_else(|| format!("unknown user `{user}`"))?;
        let roles: Vec<&str> = u.roles.iter().map(String::as_str).collect();
        let attrs: Value = Value::Object(u.attrs.iter().map(|(k, v)| (k.clone(), v.clone())).collect());
        let client = self.profile.agent(AgentRole::Orchestrator).map(|a| a.client_id.as_str()).unwrap_or("assistant");
        let mut attrs = attrs;
        attrs["name"] = json!(u.name);
        attrs["email"] = json!(u.email);
        self.sts.user_token(&u.id, client, &roles, attrs, &self.gateway_url, &[], 900)
    }
}
