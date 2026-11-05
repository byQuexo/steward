use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "steward", version, about = "A company assistant whose every tool call is authorized by Warden")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
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
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let code = match Cli::parse().cmd {
        Cmd::Profile { cmd: ProfileCmd::Generate { profile } } => steward::profile_cmd::run(&profile, false),
        Cmd::Profile { cmd: ProfileCmd::Check { profile } } => steward::profile_cmd::run(&profile, true),
    };
    match code {
        Ok(c) => std::process::exit(c),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    }
}
