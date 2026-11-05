//! Built-in MCP servers for Steward profiles, serving seed data.
//!
//! One process hosts every server of a profile under `/<name>/mcp` (Streamable HTTP, JSON
//! responses). They sit **behind the Warden gateway**: the gateway has already decided whether
//! the call is allowed and passes an exchanged token for the same user. Servers that need the
//! user (documents: which files may be searched) verify that token; the others only record it.
//!
//! The servers are deliberately thin: real systems replace them by pointing a connector at a
//! URL, without changing the assistant.

pub mod crm;
pub mod docs;
pub mod hr;
pub mod mcp;
pub mod mocks;
pub mod ticket;

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use steward_config::{Profile, ServerSpec};
use warden_core::Principal;

pub use mcp::{router, router_with, Caller, CallerAuth, Outages};

/// A tool as listed to the gateway.
#[derive(Clone, Debug)]
pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

impl ToolDef {
    pub fn to_json(&self) -> Value {
        json!({"name": self.name, "description": self.description, "inputSchema": self.input_schema})
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    /// The arguments are wrong (reported to the model as a tool error).
    #[error("{0}")]
    Invalid(String),
    #[error("not found: {0}")]
    NotFound(String),
    /// The caller is not entitled (defense in depth behind Warden).
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("{0}")]
    Internal(String),
}

/// One built-in server.
#[async_trait::async_trait]
pub trait McpServer: Send + Sync {
    fn name(&self) -> &str;
    fn tools(&self) -> Vec<ToolDef>;
    async fn call(&self, caller: &Caller, tool: &str, args: &Value) -> Result<Value, ToolError>;
}

/// Writes executed by the servers, for tests and the demo ("never executed upstream").
#[derive(Clone, Debug, Default)]
pub struct EffectLog(Arc<Mutex<Vec<Effect>>>);

#[derive(Clone, Debug, PartialEq)]
pub struct Effect {
    pub server: String,
    pub tool: String,
    pub subject: Option<String>,
    pub args: Value,
}

impl EffectLog {
    pub fn push(&self, server: &str, tool: &str, caller: &Caller, args: &Value) {
        if let Ok(mut l) = self.0.lock() {
            l.push(Effect { server: server.into(), tool: tool.into(), subject: caller.subject().map(str::to_string), args: args.clone() });
        }
    }
    pub fn all(&self) -> Vec<Effect> {
        self.0.lock().map(|l| l.clone()).unwrap_or_default()
    }
    pub fn executed(&self, qualified_tool: &str) -> bool {
        self.all().iter().any(|e| format!("{}.{}", e.server, e.tool) == qualified_tool)
    }
}

/// Helpers for argument parsing.
pub(crate) fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key).and_then(Value::as_str).ok_or_else(|| ToolError::Invalid(format!("`{key}` (string) is required")))
}

pub(crate) fn opt_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

pub(crate) fn schema(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required, "additionalProperties": false})
}

pub(crate) fn load_json(path: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Options for building a profile's servers.
#[derive(Clone, Default)]
pub struct ServerOptions {
    /// docrag-bench base URL for the docs server; the built-in lexical backend otherwise.
    pub docrag_url: Option<String>,
    /// Public path prefix for page images (served by the assistant, ACL-checked).
    pub page_url_prefix: Option<String>,
}

/// Build every built-in server the profile's connectors use.
pub fn servers_for(profile: &Profile, opts: &ServerOptions, effects: &EffectLog) -> Result<BTreeMap<String, Arc<dyn McpServer>>, String> {
    let mut out: BTreeMap<String, Arc<dyn McpServer>> = BTreeMap::new();
    for c in &profile.connectors {
        let ServerSpec::Builtin(kind) = &c.server else { continue };
        let data = c.data.as_ref().map(|d| profile.root.join(d)).ok_or_else(|| format!("connector `{}` needs `data:`", c.name))?;
        let data = load_json(&data)?;
        let server: Arc<dyn McpServer> = match kind.as_str() {
            "hr" => Arc::new(hr::Hr::new(&c.name, data)?),
            "crm" => Arc::new(crm::Crm::new(&c.name, data, effects.clone())?),
            "ticket" => Arc::new(ticket::Tickets::new(&c.name, data, effects.clone())?),
            "docs" => Arc::new(docs::Docs::new(&c.name, data, opts.docrag_url.clone(), opts.page_url_prefix.clone())?),
            "jira" => Arc::new(mocks::Jira::new(&c.name, data, effects.clone())?),
            "chat" => Arc::new(mocks::Chat::new(&c.name, data, effects.clone())?),
            "github" => Arc::new(mocks::Github::new(&c.name, data, effects.clone())?),
            other => return Err(format!("unknown built-in server `{other}`")),
        };
        out.insert(c.name.clone(), server);
    }
    Ok(out)
}

/// The verified user behind a call, if the server verifies tokens.
pub(crate) fn principal(caller: &Caller) -> Option<&Principal> {
    caller.principal.as_ref()
}
