//! Models from `models.yaml`: any provider rig's catalog knows (`provider/model`), or the
//! scripted model. A missing API key falls back to the profile's `fallback` model.

use std::sync::Arc;

use rig_core::catalog::Catalog;
use rig_core::operation::Completion;
use rig_core::providers::registry::ConnectOptions;
use rig_core::DynModel;
use steward_config::{ModelRef, ModelsConfig};

use crate::scripted::{scripted_model, ScriptBook};

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
}

impl ModelFactory {
    pub fn new(config: ModelsConfig, book: Arc<ScriptBook>) -> Self {
        Self { config, book }
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
            let key = std::env::var(var).map_err(|_| format!("{var} is not set"))?;
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
        match self.connect_ref(r) {
            Ok(c) => Ok(c),
            Err(e) => {
                let Some(fb) = self.config.fallback.as_ref().and_then(|f| self.config.models.get(f)) else { return Err(e) };
                tracing::warn!(role, error = %e, fallback = %fb.model, "model unavailable, using fallback");
                self.connect_ref(fb)
            }
        }
    }
}
