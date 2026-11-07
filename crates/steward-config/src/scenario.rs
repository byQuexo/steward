//! Demo scenarios: scripted conversations that double as replay tests and as the offline
//! "scripted" model. The script is what the model does; the expectations are what Warden,
//! the inbox and the bot must produce in response.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DemoScenario {
    /// Stable id, e.g. `03-sven-big-deal`.
    pub id: String,
    pub title: String,
    /// Demo user who chats (seed user id).
    pub user: String,
    /// "Test as user": an operator impersonates `user` (read-only).
    #[serde(default)]
    pub impersonated_by: Option<String>,
    #[serde(default)]
    pub description: String,
    /// Kill switch set before the scenario runs (`writes` or `all`).
    #[serde(default)]
    pub kill_switch: Option<String>,
    /// Token usage the scripted model reports per model call (drives the cost pages and budgets).
    #[serde(default)]
    pub usage: Option<UsageSpec>,
    pub turns: Vec<Turn>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct UsageSpec {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Turn {
    /// What the user types.
    pub user: String,
    /// What the scripted model does, in order.
    #[serde(with = "serde_norway::with::singleton_map_recursive")]
    pub script: Vec<ScriptStep>,
    #[serde(default, with = "serde_norway::with::singleton_map_recursive")]
    pub expect: Vec<Expect>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum ScriptStep {
    /// Call an MCP tool through the gateway: `{ tool: crm.update_deal, args: {...} }`.
    Tool {
        name: String,
        #[serde(default)]
        args: Value,
    },
    /// Delegate to a sub-agent over A2A: `{ delegate: { agent: research, skill: research.deep_search, input: "...", script: [...] } }`.
    /// `script` is what the sub-agent's scripted model does with `input`.
    Delegate {
        agent: String,
        skill: String,
        input: String,
        #[serde(default)]
        script: Vec<ScriptStep>,
    },
    /// Store a fact in memory (`memory.write`).
    Remember { fact: String },
    /// Final answer text.
    Say(String),
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum Expect {
    /// Warden's decision for a call: `{ decision: { tool: hr.get_salary, effect: deny, rule: scope.missing } }`.
    Decision {
        tool: String,
        effect: String,
        #[serde(default)]
        rule: Option<String>,
    },
    /// An approval is requested and answered: `{ approval: { approver: sara, decide: approve } }`.
    Approval {
        approver: String,
        decide: String,
        #[serde(default)]
        second_approver: Option<String>,
    },
    /// The user answers their own held calls in this turn: `{ confirm: { decide: confirm } }` or
    /// `cancel`. Covers Warden confirmations and the confirm-first step of approvals by others.
    Confirm {
        decide: String,
    },
    /// The tool ran and its result contains the text.
    ToolResult {
        tool: String,
        contains: String,
    },
    /// The final answer contains the text.
    AnswerContains(String),
    /// The final answer does not contain the text (e.g. a salary figure).
    AnswerOmits(String),
    /// A verified citation of this document is shown.
    Citation {
        doc_id: String,
        #[serde(default)]
        page: Option<u32>,
    },
    /// The document service abstained.
    Abstained,
    /// A sub-agent took over: `{ handoff: research }`.
    Handoff(String),
    /// A memory fact was used / stored.
    MemoryUsed,
    MemoryStored,
    /// The run was stopped by a budget.
    BudgetExceeded,
    /// Memory refused to store something (PII, impersonation).
    MemoryRefused,
    /// The tool was never executed upstream (denied or held).
    NotExecuted(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scenario_yaml_round_trip() {
        let y = r#"
id: 03-big-deal
title: Big deal
user: sven
turns:
  - user: "Setz d-1 auf 80.000"
    script:
      - tool: { name: crm.update_deal, args: { deal_id: d-1, amount: 80000 } }
      - say: "Liegt zur Freigabe bei Sara."
    expect:
      - decision: { tool: crm.update_deal, effect: require_approval, rule: big-deals-need-approval }
      - approval: { approver: sara, decide: approve }
      - abstained
      - answer_contains: Freigabe
"#;
        let s: DemoScenario = serde_norway::from_str(y).unwrap();
        assert_eq!(s.turns[0].script.len(), 2);
        assert!(matches!(&s.turns[0].script[1], ScriptStep::Say(t) if t.contains("Sara")));
        assert!(matches!(s.turns[0].expect[2], Expect::Abstained));
        let again: DemoScenario = serde_norway::from_str(&serde_norway::to_string(&s).unwrap()).unwrap();
        assert_eq!(again, s);
    }
}
