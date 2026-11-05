//! The application on top of an in-process [`Stack`]: dev login with the seed users, the token
//! service as identity provider, and the research and action agents as A2A servers behind
//! Warden's A2A proxy. Used by `steward demo` and the end-to-end tests.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use steward_a2a::{AgentServer, GatewayExchange};
use steward_agents::{ModelFactory, Runtime, ScriptBook};
use steward_config::AgentRole;
use steward_cost::Ledger;
use steward_identity::{Directory, ProfileDirectory, SessionStore, TokenService};
use steward_memory::{Memory, SqliteStore};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use warden_a2a::{A2aProxy, A2aProxyConfig, UpstreamExchange};
use warden_audit::AuditSink;
use warden_core::{Context, IdentityConfig, KillSwitch};
use warden_identity::Verifier;

use crate::app::{session_identity, AppState, GatewayAdmin, Login, Shared};
use crate::delegate::A2aDelegator;
use crate::inbox::{Bus, Inbox};
use crate::stack::{Stack, A2A_PROXY_AUDIENCE, A2A_PROXY_SECRET, ADMIN_TOKEN, AGENTS_AUDIENCE, BOT_SECRET, CONSOLE_SECRET};

pub struct DevOptions {
    pub public_url: String,
    pub ui_dir: Option<PathBuf>,
    /// SQLite files for memory and the cost ledger; in memory when `None`.
    pub data_dir: Option<PathBuf>,
    pub otlp_traces: Option<String>,
}

/// The app state plus the A2A tasks it started (stopped on drop).
pub struct DevApp {
    pub state: Shared,
    pub agent_urls: HashMap<AgentRole, String>,
    tasks: Vec<JoinHandle<()>>,
}

impl Drop for DevApp {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
    }
}

pub const SCRIPTED_FALLBACK: &str = "(Offline-Demo) Für diese Frage gibt es kein Drehbuch. Probiere einen der Vorschläge, oder setze einen API-Schlüssel (models.yaml), damit ein echtes Modell antwortet.";

fn identity(issuer: &str, audience: &str) -> Result<IdentityConfig, String> {
    IdentityConfig::from_yaml_str(&format!(
        "version: 1\nissuers:\n  - {{ issuer: {issuer}, audience: {audience}, jwks_uri: {issuer}/jwks, algorithms: [ES256], mapping: {{ preset: keycloak, attrs: {{ org_unit: /org_unit, tenants: /tenants, teams: /teams, doc_scope: /doc_scope }} }} }}\ndelegation_issuers: [{issuer}]\nscope_claim: ignore\n"
    ))
}

async fn bind() -> Result<(TcpListener, String), String> {
    let l = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let a = l.local_addr().map_err(|e| e.to_string())?;
    Ok((l, format!("http://{a}")))
}

/// Build the app state for a running stack and start the sub-agents.
pub async fn dev_app(stack: &Stack, opts: DevOptions) -> Result<DevApp, String> {
    let profile = stack.profile.clone();
    let engine = Arc::new(profile.engine().map_err(|e| e.to_string())?);
    let book = Arc::new(ScriptBook::new(&profile.scenarios, SCRIPTED_FALLBACK));
    let (ledger, store) = match &opts.data_dir {
        Some(d) => {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
            (
                Ledger::open(&d.join("costs.sqlite")).map_err(|e| e.to_string())?,
                SqliteStore::open(&d.join("memory.sqlite")).map_err(|e| e.to_string())?,
            )
        }
        None => (Ledger::in_memory().map_err(|e| e.to_string())?, SqliteStore::in_memory().map_err(|e| e.to_string())?),
    };
    let ledger = Arc::new(ledger);
    let m = &profile.meta.memory;
    let memory = Memory::new(Arc::new(store), engine.clone(), &m.never_store, m.retention_days, m.max_facts_per_user);
    let directory: Arc<dyn Directory> = Arc::new(ProfileDirectory::new(&profile.users));
    let kill = Arc::new(RwLock::new(KillSwitch::Off));
    let k2 = kill.clone();
    let context = Arc::new(move || Context { kill_switch: k2.read().map(|k| *k).unwrap_or(KillSwitch::Off), ..Default::default() });
    let spans = opts.otlp_traces.clone().map(|e| steward_cost::otlp::SpanExporter::spawn(e, "steward".into()));
    let client = |r: AgentRole| profile.agent(r).map(|a| a.client_id.clone()).unwrap_or_default();
    let orchestrator = client(AgentRole::Orchestrator);
    let tokens = TokenService::new(&stack.sts_url, (&orchestrator, BOT_SECRET), ("steward-console", CONSOLE_SECRET));
    let base = Runtime {
        profile: profile.clone(),
        engine: engine.clone(),
        models: Arc::new(ModelFactory::new(profile.models.clone(), book)),
        ledger: ledger.clone(),
        gateway_url: stack.gateway_url.clone(),
        memory: None,
        delegator: None,
        spans,
        context,
    };

    // Sub-agents: A2A server behind Warden's A2A proxy each.
    let mut tasks = Vec::new();
    let mut endpoints = HashMap::new();
    let mut agent_urls = HashMap::new();
    for role in [AgentRole::Research, AgentRole::Action] {
        let (agent_l, agent_url) = bind().await?;
        let (proxy_l, proxy_url) = bind().await?;
        let server = AgentServer::new(
            role,
            base.clone(),
            Verifier::new(identity(&stack.sts_url, AGENTS_AUDIENCE)?),
            GatewayExchange {
                token_url: format!("{}/token", stack.sts_url),
                client_id: client(role),
                client_secret: BOT_SECRET.into(),
                gateway_audience: stack.gateway_url.clone(),
            },
            agent_url.clone(),
        );
        let r = server.router();
        tasks.push(tokio::spawn(async move {
            let _ = axum::serve(agent_l, r).await;
        }));
        let proxy = A2aProxy::new(
            A2aProxyConfig {
                upstream_url: agent_url.clone(),
                upstream_card_url: None,
                public_url: proxy_url.clone(),
                skill_prefix: String::new(),
                upstream_token: None,
                upstream_exchange: Some(UpstreamExchange {
                    token_url: format!("{}/token", stack.sts_url),
                    client_id: "a2a-proxy".into(),
                    client_secret: A2A_PROXY_SECRET.into(),
                    audience: AGENTS_AUDIENCE.into(),
                }),
            },
            engine.clone(),
            Arc::new(Verifier::new(identity(&stack.sts_url, A2A_PROXY_AUDIENCE)?)),
            stack.audit.clone() as Arc<dyn AuditSink>,
            b"steward-dev-hmac".to_vec(),
        );
        let r = proxy.router();
        tasks.push(tokio::spawn(async move {
            let _ = axum::serve(proxy_l, r).await;
        }));
        endpoints.insert(role, (client(role), proxy_url.clone()));
        agent_urls.insert(role, proxy_url);
    }

    let mut runtime = base;
    runtime.memory = Some(memory.clone());
    runtime.delegator = Some(Arc::new(A2aDelegator::new(tokens.clone(), endpoints, A2A_PROXY_AUDIENCE.into(), orchestrator)));
    let bus = Arc::new(Bus::default());
    let inbox = Inbox::new(profile.approvals.clone(), directory.clone(), bus.clone(), None);
    let verifier =
        Verifier::new(session_identity(&stack.sts_url, &format!("{}/jwks", stack.sts_url), &stack.gateway_url, "ES256", &stack.sts_url)?);
    let state = Arc::new(AppState {
        profile,
        engine,
        runtime,
        login: Login::Dev { sts: stack.sts.clone(), audience: stack.gateway_url.clone() },
        sessions: SessionStore::new(Duration::from_secs(8 * 3600)),
        directory,
        tokens,
        verifier,
        inbox,
        bus,
        gateway: GatewayAdmin { url: stack.admin_url.clone(), token: ADMIN_TOKEN.into(), http: reqwest::Client::new() },
        ledger,
        memory,
        kill,
        history: Mutex::new(Default::default()),
        busy: Mutex::new(Default::default()),
        ui_dir: opts.ui_dir,
        docrag_url: None,
        public_url: opts.public_url,
        secure_cookies: false,
        audit_dir: None,
    });
    Ok(DevApp { state, agent_urls, tasks })
}
