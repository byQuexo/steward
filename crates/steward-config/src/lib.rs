//! A Steward **profile** is everything that makes the assistant belong to one company:
//! who the agents are, which systems (connectors) exist, what the model costs, who approves
//! what, which documents each team may read, the prompts, and the Warden policy.
//!
//! ```text
//! profiles/<name>/
//! ├── profile.yaml        # name, locale, agents, messages, memory settings
//! ├── models.yaml         # model routes per agent, voice models
//! ├── pricing.yaml        # prices per model, budgets
//! ├── approvals.yaml      # which Warden rule is approved by whom (four-eyes)
//! ├── docs_acl.yaml       # documents per team
//! ├── connectors/*.yaml   # systems and their tools (source of the Warden catalog)
//! ├── prompts/*.md        # agent preambles
//! ├── warden/             # catalog.yaml (generated), policy.yaml, identity.yaml, catalog.lock
//! ├── scenarios/          # demo conversations (replay tests) and Warden eval suites
//! └── data/               # seed output: users, records, documents
//! ```
//!
//! Nothing in the Steward binaries knows a company; swapping the profile swaps the company.

mod connectors;
mod error;
mod models;
mod profile;
mod scenario;

pub use connectors::{generate_catalog, generate_gateway_yaml, Connector, GatewayTargets, ServerSpec, ToolSpec, BUILTINS};
pub use error::ConfigError;
pub use models::{ApprovalRoute, ApprovalRouting, Budgets, DocsAcl, ModelPrice, ModelRef, ModelsConfig, Pricing, VoiceConfig};
pub use profile::{AgentRole, AgentSpec, DemoUser, MemorySettings, Messages, Profile, ProfileMeta};
pub use scenario::{DemoScenario, Expect, ScriptStep, Turn, UsageSpec};

/// The claim mapping Steward uses for every token (Keycloak users, warden sts delegation and
/// test-as tokens): the user is `preferred_username` (Keycloak's `sub` is a UUID), the agent the
/// OAuth client, plus the attributes the policy uses.
pub const TOKEN_MAPPING: &str = "{ subject: [/preferred_username, /sub], agent: /azp, roles: /realm_access/roles, act: /act, token_type: { path: /typ, equals: Bearer }, service_if: { path: /preferred_username, prefix: service-account- }, attrs: { org_unit: /org_unit, tenants: /tenants, teams: /teams, doc_scope: /doc_scope, repos: /repos, channels: /channels } }";

/// Read a YAML file into `T`, rejecting unknown keys (the types use `deny_unknown_fields`).
pub(crate) fn read_yaml<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> Result<T, ConfigError> {
    let text = std::fs::read_to_string(path).map_err(|e| ConfigError::Io(path.display().to_string(), e))?;
    serde_norway::from_str(&text).map_err(|e| ConfigError::Parse(path.display().to_string(), e.to_string()))
}
