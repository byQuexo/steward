use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use warden_core::{Catalog, Engine, Policy};

use crate::connectors::{generate_catalog, Connector};
use crate::models::{ApprovalRouting, DocsAcl, ModelsConfig, Pricing};
use crate::scenario::DemoScenario;
use crate::{read_yaml, ConfigError};

/// The three agents of a profile. Each is a Warden agent (OAuth client) with its own ceiling.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Orchestrator,
    Research,
    Action,
}

impl AgentRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentRole::Orchestrator => "orchestrator",
            AgentRole::Research => "research",
            AgentRole::Action => "action",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AgentSpec {
    /// OAuth client id = Warden agent id.
    pub client_id: String,
    /// Prompt file under `prompts/` (without `.md`).
    pub prompt: String,
    #[serde(default)]
    pub description: String,
    /// A2A skills this agent offers (must be `a2a_skill` entries in the catalog).
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default = "max_turns")]
    pub max_turns: usize,
}

fn max_turns() -> usize {
    8
}

/// Texts shown to users, in the profile's language.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Messages {
    pub denied: String,
    pub abstained: String,
    pub approval_pending: String,
    pub approval_denied: String,
    pub budget_exceeded: String,
    pub greeting: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MemorySettings {
    #[serde(default = "retention")]
    pub retention_days: u32,
    /// Built-in PII detectors whose matches are never stored: iban, credit_card, email, phone.
    #[serde(default)]
    pub never_store: Vec<String>,
    #[serde(default = "facts")]
    pub max_facts_per_user: usize,
}

fn retention() -> u32 {
    90
}
fn facts() -> usize {
    200
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileMeta {
    pub name: String,
    pub display_name: String,
    /// BCP 47, e.g. `de` or `en`.
    pub locale: String,
    pub assistant_name: String,
    pub agents: BTreeMap<AgentRole, AgentSpec>,
    pub messages: Messages,
    pub memory: MemorySettings,
    /// Roles that may open the admin console.
    #[serde(default)]
    pub admin_roles: Vec<String>,
    /// Suggested first questions per role, shown in the empty chat.
    #[serde(default)]
    pub suggestions: BTreeMap<String, Vec<String>>,
}

/// A user from the seed (`data/users.json`). Passwords exist only for the local demo realm.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DemoUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub title: String,
    pub roles: Vec<String>,
    pub teams: Vec<String>,
    /// Token claims Warden maps to subject attributes (tenants, org_unit, doc_scope, …).
    #[serde(default)]
    pub attrs: BTreeMap<String, Value>,
    #[serde(default)]
    pub password: Option<String>,
}

/// A loaded, validated profile.
#[derive(Clone, Debug)]
pub struct Profile {
    pub root: PathBuf,
    pub meta: ProfileMeta,
    pub models: ModelsConfig,
    pub pricing: Pricing,
    pub approvals: ApprovalRouting,
    pub docs_acl: DocsAcl,
    pub connectors: Vec<Connector>,
    pub prompts: BTreeMap<String, String>,
    pub users: Vec<DemoUser>,
    pub scenarios: Vec<DemoScenario>,
}

impl Profile {
    pub fn load(root: impl AsRef<Path>) -> Result<Self, ConfigError> {
        let root = root.as_ref().to_path_buf();
        let meta: ProfileMeta = read_yaml(&root.join("profile.yaml"))?;
        let name = meta.name.clone();
        let invalid = |m: String| ConfigError::invalid(&name, m);

        let models: ModelsConfig = read_yaml(&root.join("models.yaml"))?;
        models.validate().map_err(invalid)?;
        let pricing: Pricing = read_yaml(&root.join("pricing.yaml"))?;
        let approvals: ApprovalRouting = read_yaml(&root.join("approvals.yaml"))?;
        approvals.validate().map_err(invalid)?;
        let docs_acl: DocsAcl = read_yaml(&root.join("docs_acl.yaml"))?;

        let mut connectors = Vec::new();
        for path in sorted_files(&root.join("connectors"), "yaml")? {
            let c: Connector = read_yaml(&path)?;
            c.validate().map_err(|m| invalid(format!("{}: {m}", path.display())))?;
            connectors.push(c);
        }
        let mut prompts = BTreeMap::new();
        for path in sorted_files(&root.join("prompts"), "md")? {
            let key = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();
            let text = std::fs::read_to_string(&path).map_err(|e| ConfigError::Io(path.display().to_string(), e))?;
            prompts.insert(key, text);
        }
        let users_path = root.join("data/users.json");
        let users: Vec<DemoUser> = if users_path.exists() {
            let text = std::fs::read_to_string(&users_path).map_err(|e| ConfigError::Io(users_path.display().to_string(), e))?;
            serde_json::from_str(&text).map_err(|e| ConfigError::Parse(users_path.display().to_string(), e.to_string()))?
        } else {
            Vec::new()
        };
        let mut scenarios = Vec::new();
        for path in sorted_files(&root.join("scenarios/demo"), "yaml")? {
            scenarios.push(read_yaml::<DemoScenario>(&path)?);
        }

        let p = Profile { root, meta, models, pricing, approvals, docs_acl, connectors, prompts, users, scenarios };
        p.validate()?;
        Ok(p)
    }

    pub fn warden_dir(&self) -> PathBuf {
        self.root.join("warden")
    }

    pub fn data_dir(&self) -> PathBuf {
        self.root.join("data")
    }

    pub fn agent(&self, role: AgentRole) -> Option<&AgentSpec> {
        self.meta.agents.get(&role)
    }

    pub fn prompt(&self, role: AgentRole) -> &str {
        self.agent(role).and_then(|a| self.prompts.get(&a.prompt)).map(String::as_str).unwrap_or("")
    }

    pub fn user(&self, id: &str) -> Option<&DemoUser> {
        self.users.iter().find(|u| u.id == id)
    }

    /// Build the Warden engine from `warden/catalog.yaml`, `policy.yaml` and `catalog.lock`.
    pub fn engine(&self) -> Result<Engine, ConfigError> {
        let dir = self.warden_dir();
        let read = |f: &str| {
            let p = dir.join(f);
            std::fs::read_to_string(&p).map_err(|e| ConfigError::Io(p.display().to_string(), e))
        };
        let lock = dir.join("catalog.lock");
        let mut b = Engine::builder().catalog_yaml(&read("catalog.yaml")?).policy_yaml(&read("policy.yaml")?);
        if lock.exists() {
            b = b.lock_json(&read("catalog.lock")?);
        }
        b.build().map_err(|e| ConfigError::invalid(&self.meta.name, format!("warden policy: {e}")))
    }

    fn validate(&self) -> Result<(), ConfigError> {
        let invalid = |m: String| ConfigError::invalid(&self.meta.name, m);
        for role in [AgentRole::Orchestrator, AgentRole::Research, AgentRole::Action] {
            let a = self.agent(role).ok_or_else(|| invalid(format!("profile.yaml: agent `{}` is missing", role.as_str())))?;
            if !self.prompts.contains_key(&a.prompt) {
                return Err(invalid(format!("agent `{}`: prompts/{}.md not found", role.as_str(), a.prompt)));
            }
        }
        let dir = self.warden_dir();
        if !dir.join("policy.yaml").exists() {
            return Ok(()); // a profile under construction; `engine()` reports it
        }
        let policy_text = std::fs::read_to_string(dir.join("policy.yaml")).map_err(|e| ConfigError::Io("policy.yaml".into(), e))?;
        let policy = Policy::from_yaml_str(&policy_text).map_err(|e| invalid(format!("warden/policy.yaml: {e}")))?;
        for (role, a) in &self.meta.agents {
            if !policy.agents.contains_key(&a.client_id) {
                return Err(invalid(format!("agent `{}` (`{}`) is not defined in warden/policy.yaml", role.as_str(), a.client_id)));
            }
        }
        let rule_ids: Vec<&str> = policy.rules.iter().map(|r| r.id.as_str()).collect();
        for r in &self.approvals.routes {
            if r.rule != "*" && !rule_ids.contains(&r.rule.as_str()) {
                return Err(invalid(format!("approvals.yaml: rule `{}` is not in the policy", r.rule)));
            }
        }
        // The catalog is generated from the connectors; a hand edit or a stale file is an error.
        let catalog_path = dir.join("catalog.yaml");
        if catalog_path.exists() {
            let committed = std::fs::read_to_string(&catalog_path).map_err(|e| ConfigError::Io("catalog.yaml".into(), e))?;
            let extra = dir.join("catalog.extra.yaml");
            let extra = if extra.exists() {
                Some(std::fs::read_to_string(&extra).map_err(|e| ConfigError::Io("catalog.extra.yaml".into(), e))?)
            } else {
                None
            };
            let generated = generate_catalog(&self.meta.name, &self.connectors, extra.as_deref()).map_err(invalid)?;
            if normalize_newlines(&committed) != normalize_newlines(&generated) {
                return Err(invalid("warden/catalog.yaml is out of date with connectors/; run `steward profile generate`".into()));
            }
            Catalog::from_yaml_str(&committed).map_err(|e| invalid(format!("warden/catalog.yaml: {e}")))?;
        }
        Ok(())
    }
}

fn normalize_newlines(s: &str) -> String {
    s.replace("\r\n", "\n")
}

fn sorted_files(dir: &Path, ext: &str) -> Result<Vec<PathBuf>, ConfigError> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| ConfigError::Io(dir.display().to_string(), e))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some(ext))
        .collect();
    out.sort();
    Ok(out)
}
