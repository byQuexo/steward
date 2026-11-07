#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Warden is pinned in three places: the crates (Cargo.toml), the security-gates action in CI,
//! and the Docker image that builds the `warden` binaries for the compose stack. They must agree,
//! or the stack runs a policy engine that does not know what the profile uses.

use std::path::Path;

fn read(rel: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(rel)).unwrap()
}

/// Every 40-hex rev that follows `marker` in `text`.
fn revs(text: &str, marker: &str) -> Vec<String> {
    text.match_indices(marker)
        .map(|(i, _)| text[i + marker.len()..].chars().take_while(|c| c.is_ascii_hexdigit()).collect::<String>())
        .filter(|r| r.len() == 40)
        .collect()
}

#[test]
fn warden_is_pinned_to_one_commit_everywhere() {
    let cargo = [revs(&read("Cargo.toml"), "warden\", rev = \""), revs(&read("crates/steward/Cargo.toml"), "warden\", rev = \"")].concat();
    let ci = revs(&read(".github/workflows/ci.yml"), "byQuexo/warden@");
    let docker = revs(&read("Dockerfile"), "ARG WARDEN_REV=");
    assert!(!cargo.is_empty() && !ci.is_empty() && !docker.is_empty(), "pins not found: {cargo:?} {ci:?} {docker:?}");
    let all: Vec<&String> = cargo.iter().chain(&ci).chain(&docker).collect();
    assert!(all.windows(2).all(|w| w[0] == w[1]), "Warden pins differ: Cargo {cargo:?}, CI {ci:?}, Dockerfile {docker:?}");
}
