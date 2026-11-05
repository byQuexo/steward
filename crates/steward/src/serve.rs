//! `steward serve` and `steward agent`: the deployed form (compose, Kubernetes). Every other
//! component (Keycloak, the Warden gateway, `warden sts`, the A2A proxies, the MCP servers)
//! runs as its own process; this binary only knows their URLs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::Deserialize;
use steward_a2a::{AgentServer, GatewayExchange};
use steward_agents::{ModelFactory, Runtime, ScriptBook};
use steward_config::{AgentRole, Profile};
use steward_cost::Ledger;
use steward_identity::keycloak::KeycloakDirectory;
use steward_identity::oidc::OidcClient;
use steward_identity::{Directory, ProfileDirectory, SessionStore, TokenService};
use steward_memory::{Memory, SqliteStore};
use warden_core::{Context, IdentityConfig, KillSwitch};
use warden_identity::Verifier;

use crate::app::{AppState, GatewayAdmin, Login};
use crate::delegate::A2aDelegator;
use crate::inbox::{Bus, Inbox};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OidcCfg {
    pub issuer: String,
    /// Origin reachable from the server, if the issuer's public origin is not (containers).
    #[serde(default)]
    pub backchannel: Option<String>,
    pub client_id: String,
    pub client_secret_env: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeycloakCfg {
    pub base: String,
    pub realm: String,
    pub client_id: String,
    pub client_secret_env: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GatewayCfg {
    /// MCP endpoint (also the audience of user tokens).
    pub url: String,
    pub admin_url: String,
    pub admin_token_env: String,
    /// The gateway's audit directory, mounted read-only, for verification in the console.
    #[serde(default)]
    pub audit_dir: Option<PathBuf>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StsCfg {
    pub url: String,
    /// Public issuer of tokens it signs (may differ from `url` behind a proxy).
    #[serde(default)]
    pub issuer: Option<String>,
    pub bot_secret_env: String,
    pub console_secret_env: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct A2aCfg {
    /// Warden A2A proxy in front of the research agent.
    pub research: String,
    pub action: String,
    #[serde(default = "a2a_aud")]
    pub audience: String,
}

fn a2a_aud() -> String {
    crate::stack::A2A_PROXY_AUDIENCE.into()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServeConfig {
    pub profile: PathBuf,
    #[serde(default = "listen")]
    pub listen: String,
    pub public_url: String,
    #[serde(default)]
    pub data_dir: Option<PathBuf>,
    #[serde(default)]
    pub ui_dir: Option<PathBuf>,
    pub oidc: OidcCfg,
    /// Keycloak admin API for the console; seed users (read-only roles) otherwise.
    #[serde(default)]
    pub keycloak: Option<KeycloakCfg>,
    pub gateway: GatewayCfg,
    pub sts: StsCfg,
    #[serde(default)]
    pub a2a: Option<A2aCfg>,
    #[serde(default)]
    pub approval_secret_env: Option<String>,
    #[serde(default)]
    pub docrag_url: Option<String>,
    #[serde(default)]
    pub otlp_traces: Option<String>,
    #[serde(default)]
    pub secure_cookies: bool,
}

fn listen() -> String {
    "0.0.0.0:8000".into()
}

fn env(var: &str) -> Result<String, String> {
    std::env::var(var).map_err(|_| format!("environment variable `{var}` is not set"))
}

pub fn load(path: &Path) -> Result<ServeConfig, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_norway::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Users' tokens come from the IdP; impersonation and delegation tokens from the token service.
pub fn token_identity(cfg: &ServeConfig, audience: &str) -> Result<IdentityConfig, String> {
    let idp_jwks = match &cfg.oidc.backchannel {
        Some(b) => {
            let path = cfg.oidc.issuer.splitn(4, '/').nth(3).unwrap_or("");
            format!("{}/{}/protocol/openid-connect/certs", b.trim_end_matches('/'), path)
        }
        None => format!("{}/protocol/openid-connect/certs", cfg.oidc.issuer),
    };
    let sts_iss = cfg.sts.issuer.clone().unwrap_or_else(|| cfg.sts.url.clone());
    let attrs = "{ org_unit: /org_unit, tenants: /tenants, teams: /teams, doc_scope: /doc_scope }";
    IdentityConfig::from_yaml_str(&format!(
        "version: 1\nissuers:\n  - {{ issuer: {iss}, audience: {audience}, jwks_uri: {idp_jwks}, algorithms: [RS256], mapping: {{ preset: keycloak, attrs: {attrs} }} }}\n  - {{ issuer: {sts_iss}, audience: {audience}, jwks_uri: {sts}/jwks, algorithms: [ES256], mapping: {{ preset: keycloak, attrs: {attrs} }} }}\ndelegation_issuers: [{sts_iss}]\nscope_claim: ignore\n",
        iss = cfg.oidc.issuer,
        sts = cfg.sts.url.trim_end_matches('/'),
    ))
}

fn stores(profile: &Profile, data_dir: &Option<PathBuf>) -> Result<(Arc<Ledger>, Arc<SqliteStore>), String> {
    let _ = profile;
    Ok(match data_dir {
        Some(d) => {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
            (
                Arc::new(Ledger::open(&d.join("costs.sqlite")).map_err(|e| e.to_string())?),
                Arc::new(SqliteStore::open(&d.join("memory.sqlite")).map_err(|e| e.to_string())?),
            )
        }
        None => (Arc::new(Ledger::in_memory().map_err(|e| e.to_string())?), Arc::new(SqliteStore::in_memory().map_err(|e| e.to_string())?)),
    })
}

fn kill_context(kill: &Arc<RwLock<KillSwitch>>) -> steward_agents::guard::ContextFn {
    let k = kill.clone();
    Arc::new(move || Context { kill_switch: k.read().map(|k| *k).unwrap_or(KillSwitch::Off), ..Default::default() })
}

/// `steward serve`.
pub async fn serve(cfg: ServeConfig) -> Result<(), String> {
    let profile = Arc::new(Profile::load(&cfg.profile).map_err(|e| e.to_string())?);
    let engine = Arc::new(profile.engine().map_err(|e| e.to_string())?);
    let (ledger, store) = stores(&profile, &cfg.data_dir)?;
    let m = &profile.meta.memory;
    let memory = Memory::new(store, engine.clone(), &m.never_store, m.retention_days, m.max_facts_per_user);
    let kill = Arc::new(RwLock::new(KillSwitch::Off));
    let orchestrator = profile.agent(AgentRole::Orchestrator).map(|a| a.client_id.clone()).unwrap_or_default();
    let tokens = TokenService::new(
        &cfg.sts.url,
        (&orchestrator, &env(&cfg.sts.bot_secret_env)?),
        ("steward-console", &env(&cfg.sts.console_secret_env)?),
    );
    let delegator = cfg.a2a.as_ref().map(|a| {
        let client = |r: AgentRole| profile.agent(r).map(|s| s.client_id.clone()).unwrap_or_default();
        let endpoints = HashMap::from([
            (AgentRole::Research, (client(AgentRole::Research), a.research.clone())),
            (AgentRole::Action, (client(AgentRole::Action), a.action.clone())),
        ]);
        Arc::new(A2aDelegator::new(tokens.clone(), endpoints, a.audience.clone(), orchestrator.clone()))
            as Arc<dyn steward_agents::Delegator>
    });
    let runtime = Runtime {
        profile: profile.clone(),
        engine: engine.clone(),
        models: Arc::new(ModelFactory::new(
            profile.models.clone(),
            Arc::new(ScriptBook::new(&profile.scenarios, crate::dev::SCRIPTED_FALLBACK)),
        )),
        ledger: ledger.clone(),
        gateway_url: cfg.gateway.url.clone(),
        memory: Some(memory.clone()),
        delegator,
        spans: cfg.otlp_traces.clone().map(|e| steward_cost::otlp::SpanExporter::spawn(e, "steward".into())),
        context: kill_context(&kill),
    };
    let directory: Arc<dyn Directory> = match &cfg.keycloak {
        Some(k) => Arc::new(KeycloakDirectory::new(
            &k.base,
            &k.realm,
            &k.client_id,
            &env(&k.client_secret_env)?,
            engine.policy().roles.keys().cloned().collect(),
        )),
        None => Arc::new(ProfileDirectory::new(&profile.users)),
    };
    let oidc = OidcClient::discover(
        &cfg.oidc.issuer,
        cfg.oidc.backchannel.as_deref(),
        &cfg.oidc.client_id,
        &env(&cfg.oidc.client_secret_env)?,
        &format!("{}/auth/callback", cfg.public_url.trim_end_matches('/')),
    )
    .await
    .map_err(|e| e.to_string())?;
    let secret = cfg.approval_secret_env.as_deref().map(env).transpose()?.map(String::into_bytes);
    let bus = Arc::new(Bus::default());
    let state = Arc::new(AppState {
        profile: profile.clone(),
        engine,
        runtime,
        login: Login::Oidc(Arc::new(oidc)),
        sessions: SessionStore::new(Duration::from_secs(8 * 3600)),
        directory: directory.clone(),
        tokens,
        verifier: Verifier::new(token_identity(&cfg, &cfg.gateway.url)?),
        inbox: Inbox::new(profile.approvals.clone(), directory, bus.clone(), secret),
        bus,
        gateway: GatewayAdmin {
            url: cfg.gateway.admin_url.clone(),
            token: env(&cfg.gateway.admin_token_env)?,
            http: reqwest::Client::new(),
        },
        ledger,
        memory,
        kill,
        history: Mutex::new(Default::default()),
        busy: Mutex::new(Default::default()),
        ui_dir: cfg.ui_dir.clone(),
        docrag_url: cfg.docrag_url.clone(),
        public_url: cfg.public_url.clone(),
        secure_cookies: cfg.secure_cookies,
        audit_dir: cfg.gateway.audit_dir.clone(),
    });
    state.spawn_kill_sync();
    let listener = tokio::net::TcpListener::bind(&cfg.listen).await.map_err(|e| format!("{}: {e}", cfg.listen))?;
    tracing::info!(listen = %cfg.listen, profile = %profile.meta.name, policy = %state.engine.version(), "steward ready");
    axum::serve(listener, crate::app::router(state)).await.map_err(|e| e.to_string())
}

/// `steward agent --role research|action`: a sub-agent as an A2A server.
pub async fn agent(cfg: ServeConfig, role: AgentRole, listen: &str, public_url: &str) -> Result<(), String> {
    let profile = Arc::new(Profile::load(&cfg.profile).map_err(|e| e.to_string())?);
    let engine = Arc::new(profile.engine().map_err(|e| e.to_string())?);
    let (ledger, _) = stores(&profile, &cfg.data_dir)?;
    let kill = Arc::new(RwLock::new(KillSwitch::Off));
    let runtime = Runtime {
        profile: profile.clone(),
        engine,
        models: Arc::new(ModelFactory::new(
            profile.models.clone(),
            Arc::new(ScriptBook::new(&profile.scenarios, crate::dev::SCRIPTED_FALLBACK)),
        )),
        ledger,
        gateway_url: cfg.gateway.url.clone(),
        memory: None,
        delegator: None,
        spans: cfg.otlp_traces.clone().map(|e| steward_cost::otlp::SpanExporter::spawn(e, format!("steward-{}", role.as_str()))),
        context: kill_context(&kill),
    };
    let client = profile.agent(role).map(|a| a.client_id.clone()).ok_or("agent not in profile")?;
    let sts_iss = cfg.sts.issuer.clone().unwrap_or_else(|| cfg.sts.url.clone());
    let identity = IdentityConfig::from_yaml_str(&format!(
        "version: 1\nissuers:\n  - {{ issuer: {sts_iss}, audience: {aud}, jwks_uri: {sts}/jwks, algorithms: [ES256], mapping: {{ preset: keycloak, attrs: {{ org_unit: /org_unit, tenants: /tenants, teams: /teams, doc_scope: /doc_scope }} }} }}\ndelegation_issuers: [{sts_iss}]\nscope_claim: ignore\n",
        aud = crate::stack::AGENTS_AUDIENCE,
        sts = cfg.sts.url.trim_end_matches('/'),
    ))?;
    let server = AgentServer::new(
        role,
        runtime,
        Verifier::new(identity),
        GatewayExchange {
            token_url: format!("{}/token", cfg.sts.url.trim_end_matches('/')),
            client_id: client,
            client_secret: env(&cfg.sts.bot_secret_env)?,
            gateway_audience: cfg.gateway.url.clone(),
        },
        public_url.into(),
    );
    let listener = tokio::net::TcpListener::bind(listen).await.map_err(|e| format!("{listen}: {e}"))?;
    tracing::info!(role = role.as_str(), %listen, "steward agent ready");
    axum::serve(listener, server.router()).await.map_err(|e| e.to_string())
}
