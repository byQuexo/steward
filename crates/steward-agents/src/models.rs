//! Models from `models.yaml`: any provider rig's catalog knows (`provider/model`), or the
//! scripted model. A missing API key falls back to the profile's `fallback` model.

use std::sync::Arc;

use rig_core::catalog::Catalog;
use rig_core::operation::Completion;
use rig_core::providers::registry::ConnectOptions;
use rig_core::DynModel;
use steward_config::{ModelRef, ModelsConfig};

use crate::scripted::{scripted_model, ScriptBook};

/// Credential-store services searched for API keys, in order: Steward's own entry, then the
/// one docrag-bench writes (both store the key under the environment variable's name).
const KEYRING_SERVICES: &[&str] = &["steward", "docrag"];

/// An API key from the environment, else from the OS credential store (Windows Credential
/// Manager, macOS Keychain, Secret Service). The key never leaves this process.
pub fn api_key(var: &str) -> Option<String> {
    if let Ok(v) = std::env::var(var) {
        if !v.trim().is_empty() {
            return Some(v);
        }
    }
    let services: Vec<String> =
        std::env::var("STEWARD_KEYRING_SERVICE").ok().into_iter().chain(KEYRING_SERVICES.iter().map(|s| s.to_string())).collect();
    for service in services {
        // Python's keyring (docrag-bench) uses the service as the target name; keyring-rs
        // defaults to "<user>.<service>". Try both.
        let entries = [keyring::Entry::new_with_target(&service, &service, var), keyring::Entry::new(&service, var)];
        for entry in entries.into_iter().flatten() {
            if let Ok(key) = entry.get_password() {
                if !key.trim().is_empty() {
                    tracing::info!(%service, var, "API key read from the OS credential store");
                    return Some(key);
                }
            }
        }
    }
    None
}

/// A connected model and the route it is priced by.
pub struct Connected {
    pub model: DynModel<Completion>,
    /// Model route (`models.yaml` `model:`), the pricing key.
    pub route: String,
    pub scripted: bool,
}

pub struct ModelFactory {
    config: ModelsConfig,
    book: Arc<ScriptBook>,
    offline: bool,
}

impl ModelFactory {
    pub fn new(config: ModelsConfig, book: Arc<ScriptBook>) -> Self {
        Self { config, book, offline: false }
    }

    /// Never call a provider: every role gets the scripted model, even when an API key is
    /// available. Replays and tests use this so they stay deterministic and free.
    pub fn offline(config: ModelsConfig, book: Arc<ScriptBook>) -> Self {
        Self { config, book, offline: true }
    }

    /// Whether `role` would get a live model (its route is not scripted and its key is found).
    pub fn is_live(&self, role: &str) -> bool {
        !self.offline
            && self
                .config
                .for_role(role)
                .is_some_and(|(_, r)| !r.is_scripted() && r.api_key_env.as_deref().is_none_or(|v| api_key(v).is_some()))
    }

    pub fn book(&self) -> Arc<ScriptBook> {
        self.book.clone()
    }

    fn connect_ref(&self, r: &ModelRef) -> Result<Connected, String> {
        if r.is_scripted() {
            return Ok(Connected { model: scripted_model(self.book.clone()).into(), route: r.model.clone(), scripted: true });
        }
        let mut opts = ConnectOptions::new();
        if let Some(var) = &r.api_key_env {
            let key = api_key(var).ok_or_else(|| format!("{var} is not set (environment or OS credential store)"))?;
            opts = opts.api_key(key);
        }
        if let Some(url) = &r.base_url {
            opts = opts.base_url(url.clone());
        }
        let model = Catalog::builtin().connect_with(r.model.as_str(), opts).map_err(|e| format!("{}: {e}", r.model))?;
        Ok(Connected { model, route: r.model.clone(), scripted: false })
    }

    /// The model for an agent role (`orchestrator`, `research`, `action`, `judge`).
    pub fn for_role(&self, role: &str) -> Result<Connected, String> {
        let (_, r) = self.config.for_role(role).ok_or_else(|| format!("models.yaml has no route for `{role}`"))?;
        let fallback = self.config.fallback.as_ref().and_then(|f| self.config.models.get(f));
        if self.offline {
            // Priced under the fallback's own route, not the live model's.
            let fb = fallback.filter(|f| f.is_scripted()).ok_or("offline needs a scripted `fallback` in models.yaml")?;
            return self.connect_ref(fb);
        }
        match self.connect_ref(r) {
            Ok(c) => Ok(c),
            Err(e) => {
                let Some(fb) = fallback else { return Err(e) };
                tracing::warn!(role, error = %e, fallback = %fb.model, "model unavailable, using fallback");
                self.connect_ref(fb)
            }
        }
    }
}
