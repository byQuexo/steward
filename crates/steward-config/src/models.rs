//! models.yaml, pricing.yaml, approvals.yaml and docs_acl.yaml.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A model route: `provider/model` as understood by rig's provider catalog
/// (`openrouter/anthropic/claude-haiku-5.5`, `ollama/qwen3:4b`, …) or `scripted`, which replays
/// the profile's demo scenarios and needs no key.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelRef {
    pub model: String,
    /// Environment variable holding the API key (none for local or scripted models).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
}

impl ModelRef {
    pub fn is_scripted(&self) -> bool {
        self.model == "scripted"
    }
}

/// Speech for voice mode. Browser speech (Web Speech API) is the default and needs nothing
/// here; a server model can be configured for transcription and synthesis instead.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct VoiceConfig {
    /// `browser` (default) or `server`.
    #[serde(default = "browser")]
    pub mode: String,
    /// OpenAI-compatible `/audio/transcriptions` endpoint model, e.g. `whisper-1`.
    #[serde(default)]
    pub stt: Option<ModelRef>,
    /// OpenAI-compatible `/audio/speech` model, e.g. `gpt-4o-mini-tts`.
    #[serde(default)]
    pub tts: Option<ModelRef>,
    #[serde(default)]
    pub tts_voice: Option<String>,
    /// BCP 47 language for recognition and synthesis; defaults to the profile locale.
    #[serde(default)]
    pub language: Option<String>,
}

fn browser() -> String {
    "browser".into()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ModelsConfig {
    /// Named models.
    pub models: BTreeMap<String, ModelRef>,
    /// Agent role (orchestrator, research, action, judge) → model name.
    pub routes: BTreeMap<String, String>,
    /// Used when the configured key is missing: `scripted` keeps the demo runnable offline.
    #[serde(default)]
    pub fallback: Option<String>,
    #[serde(default)]
    pub voice: VoiceConfig,
}

impl ModelsConfig {
    pub fn for_role(&self, role: &str) -> Option<(&str, &ModelRef)> {
        let name = self.routes.get(role).or_else(|| self.routes.get("default"))?;
        self.models.get(name).map(|m| (name.as_str(), m))
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        for (role, name) in &self.routes {
            if !self.models.contains_key(name) {
                return Err(format!("models.yaml: route `{role}` points to unknown model `{name}`"));
            }
        }
        if let Some(f) = &self.fallback {
            if !self.models.contains_key(f) {
                return Err(format!("models.yaml: fallback `{f}` is not a model"));
            }
        }
        if !matches!(self.voice.mode.as_str(), "browser" | "server") {
            return Err(format!("models.yaml: voice.mode must be `browser` or `server`, got `{}`", self.voice.mode));
        }
        if self.voice.mode == "server" && (self.voice.stt.is_none() || self.voice.tts.is_none()) {
            return Err("models.yaml: voice.mode `server` needs `stt` and `tts`".into());
        }
        Ok(())
    }
}

/// Price per million tokens in the profile currency.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelPrice {
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
    #[serde(default)]
    pub cached_input_per_mtok: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Budgets {
    /// One chat turn (all model calls of one run, including sub-agents).
    #[serde(default)]
    pub per_run: Option<f64>,
    #[serde(default)]
    pub per_user_daily: Option<f64>,
    /// Team → monthly budget.
    #[serde(default)]
    pub team_monthly: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Pricing {
    #[serde(default = "eur")]
    pub currency: String,
    /// Model route (as in models.yaml `model:`) → price.
    pub models: BTreeMap<String, ModelPrice>,
    #[serde(default)]
    pub budgets: Budgets,
}

fn eur() -> String {
    "EUR".into()
}

impl Pricing {
    /// Cost of one model call; unknown models cost nothing but are reported by `validate`.
    pub fn cost(&self, model: &str, input_tokens: u64, output_tokens: u64, cached_input_tokens: u64) -> f64 {
        let Some(p) = self.models.get(model) else { return 0.0 };
        let cached = cached_input_tokens.min(input_tokens);
        let fresh = input_tokens - cached;
        let cached_price = p.cached_input_per_mtok.unwrap_or(p.input_per_mtok);
        (fresh as f64 * p.input_per_mtok + cached as f64 * cached_price + output_tokens as f64 * p.output_per_mtok) / 1_000_000.0
    }
}

/// Which approver handles which Warden rule.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ApprovalRoute {
    /// Warden rule id, or `*` for every other rule.
    pub rule: String,
    /// `role:<role>` or `user:<id>`.
    pub approvers: Vec<String>,
    /// Two different approvers must agree.
    #[serde(default)]
    pub four_eyes: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovalRouting {
    #[serde(default = "timeout")]
    pub timeout_s: u64,
    pub routes: Vec<ApprovalRoute>,
}

fn timeout() -> u64 {
    120
}

impl ApprovalRouting {
    pub fn route_for(&self, rule: &str) -> Option<&ApprovalRoute> {
        self.routes.iter().find(|r| r.rule == rule).or_else(|| self.routes.iter().find(|r| r.rule == "*"))
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        for r in &self.routes {
            if r.approvers.is_empty() {
                return Err(format!("approvals.yaml: route `{}` has no approvers", r.rule));
            }
            for a in &r.approvers {
                if !(a.starts_with("role:") || a.starts_with("user:")) {
                    return Err(format!("approvals.yaml: approver `{a}` must be `role:<name>` or `user:<id>`"));
                }
            }
        }
        Ok(())
    }
}

/// Team → document id patterns (`*` wildcard). The seed writes each user's resulting list
/// into the `doc_scope` attribute that Warden checks with `subset_of`.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DocsAcl {
    pub teams: BTreeMap<String, Vec<String>>,
}

impl DocsAcl {
    pub fn allowed<'a>(&self, teams: &[String], doc_ids: impl IntoIterator<Item = &'a str>) -> Vec<String> {
        let patterns: Vec<&String> = teams.iter().filter_map(|t| self.teams.get(t)).flatten().collect();
        let mut out: Vec<String> =
            doc_ids.into_iter().filter(|d| patterns.iter().any(|p| wildcard(p, d))).map(str::to_string).collect();
        out.sort();
        out.dedup();
        out
    }
}

/// `*` matches any run of characters; everything else is literal.
pub(crate) fn wildcard(pattern: &str, s: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == s;
    }
    let mut rest = s;
    for (i, part) in parts.iter().enumerate() {
        if i == 0 {
            match rest.strip_prefix(part) {
                Some(r) => rest = r,
                None => return false,
            }
        } else if i == parts.len() - 1 {
            return rest.ends_with(part);
        } else {
            match rest.find(part) {
                Some(pos) => rest = &rest[pos + part.len()..],
                None => return false,
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcard_matching() {
        assert!(wildcard("hr-*", "hr-handbook"));
        assert!(!wildcard("hr-*", "it-handbook"));
        assert!(wildcard("*", "x"));
        assert!(wildcard("a*c*e", "abcde"));
        assert!(wildcard("exact", "exact"));
        assert!(!wildcard("exact", "exactly"));
    }

    #[test]
    fn cost_uses_cached_price() {
        let p: Pricing = serde_norway::from_str("models:\n  m: { input_per_mtok: 1.0, output_per_mtok: 4.0, cached_input_per_mtok: 0.1 }\n").unwrap();
        let c = p.cost("m", 1_000_000, 1_000_000, 500_000);
        assert!((c - (0.5 + 0.05 + 4.0)).abs() < 1e-9, "{c}");
        assert_eq!(p.cost("unknown", 10, 10, 0), 0.0);
    }

    #[test]
    fn docs_acl_unions_teams() {
        let acl: DocsAcl = serde_norway::from_str("teams:\n  hr: [hr-*, handbook]\n  sales: [sales-*, handbook]\n").unwrap();
        let docs = ["hr-salaries", "sales-pricing", "handbook", "it-vpn"];
        assert_eq!(acl.allowed(&["hr".into()], docs), vec!["handbook", "hr-salaries"]);
        assert_eq!(acl.allowed(&["hr".into(), "sales".into()], docs), vec!["handbook", "hr-salaries", "sales-pricing"]);
        assert!(acl.allowed(&["nobody".into()], docs).is_empty());
    }
}
