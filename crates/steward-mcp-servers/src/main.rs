//! `steward-mcp`: serve a profile's built-in MCP servers.
//!
//! ```text
//! steward-mcp --profile profiles/acme --listen 0.0.0.0:8100 \
//!     --issuer http://sts:9400 --audience steward-mcp [--docrag http://docrag:8000]
//! ```

use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use steward_mcp_servers::{router, servers_for, CallerAuth, EffectLog, ServerOptions};
use warden_core::IdentityConfig;
use warden_identity::Verifier;

#[derive(Parser)]
#[command(name = "steward-mcp", version, about = "Steward's built-in MCP servers over seed data")]
struct Args {
    #[arg(long)]
    profile: PathBuf,
    #[arg(long, default_value = "127.0.0.1:8100")]
    listen: String,
    /// Issuer of the exchanged tokens the gateway forwards (the token service).
    #[arg(long)]
    issuer: Option<String>,
    /// JWKS URL if it differs from `<issuer>/jwks`.
    #[arg(long)]
    jwks_uri: Option<String>,
    #[arg(long, default_value = "steward-mcp")]
    audience: String,
    /// Trust the network instead of verifying tokens (documents then return nothing).
    #[arg(long)]
    no_auth: bool,
    /// docrag-bench base URL; the built-in lexical document backend otherwise.
    #[arg(long, env = "STEWARD_DOCRAG_URL")]
    docrag: Option<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    if let Err(e) = run(Args::parse()).await {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

async fn run(a: Args) -> Result<(), String> {
    let profile = steward_config::Profile::load(&a.profile).map_err(|e| e.to_string())?;
    let opts = ServerOptions { docrag_url: a.docrag.clone(), page_url_prefix: None };
    let servers = servers_for(&profile, &opts, &EffectLog::default())?;
    let auth = match (&a.issuer, a.no_auth) {
        (_, true) => CallerAuth::None,
        (Some(iss), false) => {
            let jwks = a.jwks_uri.clone().unwrap_or_else(|| format!("{}/jwks", iss.trim_end_matches('/')));
            CallerAuth::Verify(Arc::new(Verifier::new(identity(iss, &jwks, &a.audience)?)))
        }
        (None, false) => return Err("pass --issuer (token service) or --no-auth".into()),
    };
    let listener = tokio::net::TcpListener::bind(&a.listen).await.map_err(|e| format!("{}: {e}", a.listen))?;
    tracing::info!(listen = %a.listen, servers = ?servers.keys().collect::<Vec<_>>(), docs_backend = if a.docrag.is_some() { "docrag" } else { "lexical" }, "steward-mcp ready");
    axum::serve(listener, router(servers, auth)).await.map_err(|e| e.to_string())
}

/// Tokens forwarded by the gateway are exchanged by the token service: same subject and
/// claims, audience `steward-mcp`, possibly an `act` chain.
pub fn identity(issuer: &str, jwks: &str, audience: &str) -> Result<IdentityConfig, String> {
    IdentityConfig::from_yaml_str(&format!(
        "version: 1\nissuers:\n  - issuer: {issuer}\n    audience: {audience}\n    jwks_uri: {jwks}\n    algorithms: [ES256, RS256]\n    mapping: {{ preset: keycloak, attrs: {{ doc_scope: /doc_scope, teams: /teams, org_unit: /org_unit, tenants: /tenants }} }}\ndelegation_issuers: [{issuer}]\nscope_claim: ignore\n"
    ))
}
