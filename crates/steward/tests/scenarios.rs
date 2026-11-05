#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Every demo scenario of every profile, replayed over HTTP against the full stack.

use std::path::Path;

async fn replay(profile: &str) {
    std::env::remove_var("OPENROUTER_API_KEY");
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../profiles").join(profile);
    let results = steward::replay::run_all(&dir).await.unwrap();
    assert!(!results.is_empty(), "no scenarios in {profile}");
    let mut failed = Vec::new();
    for r in &results {
        println!("{} {:<24} {:>4} events {:>6} ms  {}", if r.passed { "PASS" } else { "FAIL" }, r.id, r.events, r.millis, r.title);
        for f in &r.failures {
            println!("       {f}");
        }
        if !r.passed {
            failed.push(r.id.clone());
        }
    }
    assert!(failed.is_empty(), "failed scenarios: {failed:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn acme_demo_scenarios() {
    replay("acme").await;
}

/// The same binaries with another company: no code change between profiles.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn devteam_demo_scenarios() {
    replay("devteam").await;
}
