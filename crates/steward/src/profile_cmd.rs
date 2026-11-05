//! `steward profile generate|check`: derive Warden files from the profile's connectors.

use std::path::Path;

use steward_config::{generate_catalog, ConfigError, Connector};

fn read_connectors(profile: &Path) -> Result<(String, Vec<Connector>, Option<String>), String> {
    let meta: serde_json::Value =
        serde_norway::from_str(&std::fs::read_to_string(profile.join("profile.yaml")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let name = meta["name"].as_str().unwrap_or("profile").to_string();
    let mut files: Vec<_> = std::fs::read_dir(profile.join("connectors"))
        .map_err(|e| format!("connectors/: {e}"))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("yaml"))
        .collect();
    files.sort();
    let mut connectors = Vec::new();
    for f in files {
        let c: Connector = serde_norway::from_str(&std::fs::read_to_string(&f).map_err(|e| e.to_string())?)
            .map_err(|e| format!("{}: {e}", f.display()))?;
        connectors.push(c);
    }
    let extra_path = profile.join("warden/catalog.extra.yaml");
    let extra = if extra_path.exists() { Some(std::fs::read_to_string(&extra_path).map_err(|e| e.to_string())?) } else { None };
    Ok((name, connectors, extra))
}

/// Write (or with `check`, compare) `warden/catalog.yaml`, then load the whole profile.
pub fn run(profile: &Path, check: bool) -> Result<i32, String> {
    let (name, connectors, extra) = read_connectors(profile)?;
    let catalog = generate_catalog(&name, &connectors, extra.as_deref())?;
    let path = profile.join("warden/catalog.yaml");
    if check {
        let current = std::fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n");
        if current != catalog {
            eprintln!("{}: out of date; run `steward profile generate --profile {}`", path.display(), profile.display());
            return Ok(1);
        }
    } else {
        std::fs::write(&path, &catalog).map_err(|e| format!("{}: {e}", path.display()))?;
        eprintln!("wrote {}", path.display());
    }
    let p = steward_config::Profile::load(profile).map_err(|e: ConfigError| e.to_string())?;
    let engine = p.engine().map_err(|e| e.to_string())?;
    for w in engine.warnings() {
        eprintln!("warning: {w}");
    }
    println!(
        "profile `{}`: {} connectors, {} users, {} demo scenarios, policy {}",
        p.meta.name,
        p.connectors.len(),
        p.users.len(),
        p.scenarios.len(),
        engine.version()
    );
    Ok(0)
}
