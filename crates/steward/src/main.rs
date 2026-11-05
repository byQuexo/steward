use std::path::PathBuf;

use clap::{Parser, Subcommand, ValueEnum};
use steward::dev::{dev_app, DevOptions};
use steward::stack::{ApproverMode, Stack, StackOptions};
use steward_config::{AgentRole, Profile};

#[derive(Parser)]
#[command(name = "steward", version, about = "A company assistant whose every tool call is authorized by Warden")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Clone, Copy, ValueEnum)]
enum Role {
    Research,
    Action,
}

#[derive(Subcommand)]
enum Cmd {
    /// Everything in one process: token service, MCP servers, Warden gateway, A2A agents,
    /// the assistant and the UI. Dev login with the profile's users; no Docker, no API key.
    Demo {
        #[arg(long, default_value = "profiles/acme")]
        profile: PathBuf,
        #[arg(long, default_value = "127.0.0.1:8000")]
        listen: String,
        /// Built UI (ui/dist).
        #[arg(long, default_value = "ui/dist")]
        ui: PathBuf,
        /// Keep memory and costs in SQLite files here.
        #[arg(long)]
        data: Option<PathBuf>,
        /// OTLP/HTTP traces endpoint (Phoenix: http://localhost:6006/v1/traces).
        #[arg(long)]
        otlp: Option<String>,
    },
    /// Replay the profile's demo scenarios against the full stack and report.
    Replay {
        #[arg(long, default_value = "profiles/acme")]
        profile: PathBuf,
        /// Write the results as JSON.
        #[arg(long)]
        json: Option<PathBuf>,
        /// Write a Markdown report.
        #[arg(long)]
        markdown: Option<PathBuf>,
    },
    /// Run the assistant against external components (compose, Kubernetes).
    Serve {
        #[arg(long)]
        config: PathBuf,
    },
    /// Run a sub-agent as an A2A server (behind Warden's A2A proxy).
    Agent {
        #[arg(long)]
        config: PathBuf,
        #[arg(long, value_enum)]
        role: Role,
        #[arg(long, default_value = "0.0.0.0:9600")]
        listen: String,
        #[arg(long)]
        public_url: String,
    },
    /// Warden's A2A proxy in front of a sub-agent (skill checks, task ownership, token exchange).
    A2aProxy {
        #[arg(long)]
        config: PathBuf,
        /// The agent's A2A endpoint.
        #[arg(long)]
        upstream: String,
        #[arg(long, default_value = "0.0.0.0:9500")]
        listen: String,
        #[arg(long)]
        public_url: String,
    },
    /// Profile tooling.
    Profile {
        #[command(subcommand)]
        cmd: ProfileCmd,
    },
}

#[derive(Subcommand)]
enum ProfileCmd {
    /// Generate warden/catalog.yaml from connectors/ and validate the profile.
    Generate {
        #[arg(long)]
        profile: PathBuf,
    },
    /// Fail if generated files are out of date; validate the profile.
    Check {
        #[arg(long)]
        profile: PathBuf,
    },
    /// Write the compose configuration for a profile (deploy/<profile>/).
    Deploy {
        #[arg(long)]
        profile: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
}

async fn demo(profile: PathBuf, listen: String, ui: PathBuf, data: Option<PathBuf>, otlp: Option<String>) -> Result<i32, String> {
    let profile = Profile::load(&profile).map_err(|e| e.to_string())?;
    let listener = tokio::net::TcpListener::bind(&listen).await.map_err(|e| format!("{listen}: {e}"))?;
    let base = format!("http://{}", listener.local_addr().map_err(|e| e.to_string())?);
    let opts = StackOptions {
        approver: ApproverMode::Webhook { url: format!("{base}/hooks/warden/approval"), secret: None },
        ..Default::default()
    };
    let stack = Stack::start(profile, opts).await?;
    let ui_dir = ui.join("index.html").exists().then_some(ui);
    let app = dev_app(&stack, DevOptions { public_url: base.clone(), ui_dir: ui_dir.clone(), data_dir: data, otlp_traces: otlp }).await?;
    app.state.spawn_kill_sync();
    let p = &stack.profile;
    let live = p.models.for_role("orchestrator").and_then(|(_, m)| m.api_key_env.as_ref()).is_some_and(|v| std::env::var(v).is_ok());
    eprintln!("\n  {} · {} (profile `{}`)\n", p.meta.assistant_name, p.meta.display_name, p.meta.name);
    eprintln!("  assistant      {base}{}", if ui_dir.is_none() { "   (UI not built: cd ui && npm ci && npm run build)" } else { "" });
    eprintln!("  warden gateway {}   admin {}", stack.gateway_url, stack.admin_url);
    eprintln!("  model          {}", if live { "live (API key found)" } else { "scripted (offline demo: try the suggested questions)" });
    eprintln!("  users          {}", p.users.iter().map(|u| u.id.as_str()).collect::<Vec<_>>().join(", "));
    eprintln!("\n  Ctrl+C to stop.\n");
    axum::serve(listener, steward::app::router(app.state.clone())).await.map_err(|e| e.to_string())?;
    Ok(0)
}

async fn replay(profile: PathBuf, json: Option<PathBuf>, markdown: Option<PathBuf>) -> Result<i32, String> {
    let results = steward::replay::run_all(&profile).await?;
    let passed = results.iter().filter(|r| r.passed).count();
    let mut md = String::from("| Scenario | User | Result | Events | Cost (EUR) | ms |\n|---|---|---|---:|---:|---:|\n");
    for r in &results {
        println!("{} {:<26} {:>4} events {:>6} ms  {}", if r.passed { "PASS" } else { "FAIL" }, r.id, r.events, r.millis, r.title);
        for f in &r.failures {
            println!("       {f}");
        }
        md.push_str(&format!(
            "| {} {} | {} | {} | {} | {:.4} | {} |\n",
            r.id,
            r.title,
            r.user,
            if r.passed { "✅" } else { "❌" },
            r.events,
            r.eur,
            r.millis
        ));
    }
    println!("\n{passed}/{} scenarios passed", results.len());
    if let Some(p) = json {
        std::fs::write(&p, serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    if let Some(p) = markdown {
        std::fs::write(&p, format!("**{passed}/{} demo scenarios passed**\n\n{md}", results.len())).map_err(|e| e.to_string())?;
    }
    Ok(if passed == results.len() { 0 } else { 1 })
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,rig=warn".into()))
        .init();
    let code = match Cli::parse().cmd {
        Cmd::Demo { profile, listen, ui, data, otlp } => demo(profile, listen, ui, data, otlp).await,
        Cmd::Replay { profile, json, markdown } => replay(profile, json, markdown).await,
        Cmd::Serve { config } => match steward::serve::load(&config) {
            Ok(cfg) => steward::serve::serve(cfg).await.map(|_| 0),
            Err(e) => Err(e),
        },
        Cmd::Agent { config, role, listen, public_url } => {
            let role = match role {
                Role::Research => AgentRole::Research,
                Role::Action => AgentRole::Action,
            };
            match steward::serve::load(&config) {
                Ok(cfg) => steward::serve::agent(cfg, role, &listen, &public_url).await.map(|_| 0),
                Err(e) => Err(e),
            }
        }
        Cmd::A2aProxy { config, upstream, listen, public_url } => match steward::serve::load(&config) {
            Ok(cfg) => steward::serve::a2a_proxy(cfg, &upstream, &listen, &public_url).await.map(|_| 0),
            Err(e) => Err(e),
        },
        Cmd::Profile { cmd: ProfileCmd::Generate { profile } } => steward::profile_cmd::run(&profile, false),
        Cmd::Profile { cmd: ProfileCmd::Check { profile } } => steward::profile_cmd::run(&profile, true),
        Cmd::Profile { cmd: ProfileCmd::Deploy { profile, out } } => steward::profile_cmd::deploy(&profile, &out),
    };
    match code {
        Ok(c) => std::process::exit(c),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    }
}
