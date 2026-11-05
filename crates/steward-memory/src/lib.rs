//! What the assistant remembers about a user ("I look after Müller AG") and, for leads, about
//! a team. Three properties matter more than recall quality:
//!
//! * **Authorized like a tool.** Every read, write and forget is a Warden action of the custom
//!   kind `x-memory` (`memory.read_own`, `memory.write`, `memory.forget`, `memory.read_team`),
//!   checked by `warden-core` in process. The policy, not this crate, says whose memory you see,
//!   and memory access appears in `warden eval` like everything else.
//! * **Some things are never stored.** IBANs, card numbers and phone numbers are refused
//!   before they touch the database (configurable per profile).
//! * **Forgetting works.** Facts expire after the profile's retention and can be deleted one by
//!   one or all at once.

mod pii;
mod store;

use std::sync::Arc;

use serde_json::json;
use warden_core::{Action, ActionKind, Context, Effect, Engine, Principal};

pub use pii::{detect, PiiKind};
pub use store::{Fact, SqliteStore};

#[derive(Debug, thiserror::Error)]
pub enum MemoryError {
    #[error("not permitted ({rule})")]
    Denied { rule: String },
    #[error("contains {0}, which is never stored")]
    Pii(PiiKind),
    #[error("too many facts (limit {0})")]
    Full(usize),
    #[error("storage: {0}")]
    Storage(String),
}

/// Memory with Warden in front of it.
#[derive(Clone)]
pub struct Memory {
    store: Arc<SqliteStore>,
    engine: Arc<Engine>,
    never_store: Vec<PiiKind>,
    retention_days: u32,
    max_facts: usize,
}

impl Memory {
    pub fn new(store: Arc<SqliteStore>, engine: Arc<Engine>, never_store: &[String], retention_days: u32, max_facts: usize) -> Self {
        let never_store = never_store.iter().filter_map(|k| PiiKind::parse(k)).collect();
        Self { store, engine, never_store, retention_days, max_facts }
    }

    pub fn set_engine(&mut self, engine: Arc<Engine>) {
        self.engine = engine;
    }

    fn check(&self, p: &Principal, name: &str, args: serde_json::Value, ctx: &Context) -> Result<(), MemoryError> {
        let d = self.engine.check(p, &Action::new(ActionKind::Custom("x-memory".into()), name, args), ctx);
        match d.effect {
            Effect::Allow => Ok(()),
            _ => Err(MemoryError::Denied { rule: d.rule }),
        }
    }

    /// Store a fact for the principal. PII is refused, not masked: a masked IBAN is useless and
    /// a partly stored one is still personal data.
    pub fn remember(&self, p: &Principal, fact: &str, ctx: &Context) -> Result<Fact, MemoryError> {
        let owner = p.subject.id.as_str();
        self.check(p, "memory.write", json!({ "owner": owner, "fact": fact }), ctx)?;
        if let Some(kind) = detect(fact).into_iter().find(|k| self.never_store.contains(k)) {
            return Err(MemoryError::Pii(kind));
        }
        self.store.purge_older_than(self.retention_days)?;
        if self.store.count(owner)? >= self.max_facts {
            return Err(MemoryError::Full(self.max_facts));
        }
        let team = p.subject.attrs.get("teams").and_then(|t| match t {
            warden_core::AttrValue::List(l) => l.first().cloned(),
            warden_core::AttrValue::String(s) => Some(s.clone()),
            _ => None,
        });
        self.store.insert(owner, team.as_deref(), fact.trim())
    }

    /// The principal's own facts, newest first.
    pub fn recall(&self, p: &Principal, ctx: &Context) -> Result<Vec<Fact>, MemoryError> {
        let owner = p.subject.id.as_str();
        self.check(p, "memory.read_own", json!({ "owner": owner }), ctx)?;
        self.store.purge_older_than(self.retention_days)?;
        self.store.list(owner)
    }

    /// Facts of a team (leads).
    pub fn recall_team(&self, p: &Principal, team: &str, ctx: &Context) -> Result<Vec<Fact>, MemoryError> {
        self.check(p, "memory.read_team", json!({ "team": team }), ctx)?;
        self.store.list_team(team)
    }

    /// Read another user's memory: only ever allowed if the policy says so (it does not in Acme).
    pub fn recall_of(&self, p: &Principal, owner: &str, ctx: &Context) -> Result<Vec<Fact>, MemoryError> {
        self.check(p, "memory.read_own", json!({ "owner": owner }), ctx)?;
        self.store.list(owner)
    }

    /// Forget one fact (`Some(id)`) or everything (`None`). Returns how many were deleted.
    pub fn forget(&self, p: &Principal, id: Option<i64>, ctx: &Context) -> Result<usize, MemoryError> {
        let owner = p.subject.id.as_str();
        self.check(p, "memory.forget", json!({ "owner": owner }), ctx)?;
        self.store.delete(owner, id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use warden_core::{AttrValue, Subject};

    const CATALOG: &str = "version: 1\nx-memory:\n  memory.read_own: { scopes: [memory:own], tags: [owner-scoped] }\n  memory.write: { scopes: [memory:own], sensitivity: write, tags: [owner-scoped] }\n  memory.forget: { scopes: [memory:own], sensitivity: write, tags: [owner-scoped] }\n  memory.read_team: { scopes: [memory:team] }\n";
    const POLICY: &str = "version: 1\nroles:\n  staff: [memory:own]\n  lead: [memory:own, memory:team]\nagents:\n  bot: { max: [memory:own, memory:team] }\nrules:\n  - id: memory-owner\n    match: { tag: owner-scoped }\n    require: { arg: owner, equals: \"{subject.id}\" }\n  - id: memory-team\n    match: { kind: x-memory, name: memory.read_team }\n    require: { arg: team, in: \"{subject.attrs.teams}\" }\n";

    fn memory() -> Memory {
        let engine = Arc::new(Engine::builder().catalog_yaml(CATALOG).policy_yaml(POLICY).build().unwrap());
        Memory::new(Arc::new(SqliteStore::in_memory().unwrap()), engine, &["iban".into(), "credit_card".into()], 90, 3)
    }

    fn user(id: &str, role: &str, team: &str) -> Principal {
        Principal::new(Subject::user(id).with_roles([role]).with_attr("teams", AttrValue::List(vec![team.into()])), "bot")
    }

    #[test]
    fn own_facts_round_trip_and_forget() {
        let m = memory();
        let sven = user("sven", "staff", "sales");
        let ctx = Context::default();
        let f = m.remember(&sven, "Ich betreue die Müller Maschinenbau AG.", &ctx).unwrap();
        assert_eq!(m.recall(&sven, &ctx).unwrap()[0].text, "Ich betreue die Müller Maschinenbau AG.");
        assert_eq!(m.forget(&sven, Some(f.id), &ctx).unwrap(), 1);
        assert!(m.recall(&sven, &ctx).unwrap().is_empty());
    }

    #[test]
    fn pii_is_refused_before_storage() {
        let m = memory();
        let sven = user("sven", "staff", "sales");
        let err = m.remember(&sven, "Meine IBAN ist DE89 3704 0044 0532 0130 00", &Context::default()).unwrap_err();
        assert!(matches!(err, MemoryError::Pii(PiiKind::Iban)), "{err}");
        assert!(m.recall(&sven, &Context::default()).unwrap().is_empty());
    }

    #[test]
    fn other_users_and_teams_are_policy_decisions() {
        let m = memory();
        let ctx = Context::default();
        let sven = user("sven", "staff", "sales");
        let hanna = user("hanna", "staff", "hr");
        let lead = user("sara", "lead", "sales");
        m.remember(&sven, "Fakt", &ctx).unwrap();
        assert!(matches!(m.recall_of(&hanna, "sven", &ctx), Err(MemoryError::Denied { rule }) if rule == "memory-owner"));
        assert_eq!(m.recall_team(&lead, "sales", &ctx).unwrap().len(), 1);
        assert!(m.recall_team(&lead, "hr", &ctx).is_err());
        assert!(m.recall_team(&sven, "sales", &ctx).is_err(), "no memory:team scope");
        // Impersonated sessions read but never write.
        let test_as = user("sven", "staff", "sales").impersonated_by("ines");
        assert!(m.recall(&test_as, &ctx).is_ok());
        assert!(matches!(m.remember(&test_as, "x", &ctx), Err(MemoryError::Denied { rule }) if rule == "impersonation.read_only"));
    }

    #[test]
    fn limit_per_user() {
        let m = memory();
        let sven = user("sven", "staff", "sales");
        for i in 0..3 {
            m.remember(&sven, &format!("Fakt {i}"), &Context::default()).unwrap();
        }
        assert!(matches!(m.remember(&sven, "zu viel", &Context::default()), Err(MemoryError::Full(3))));
    }
}
