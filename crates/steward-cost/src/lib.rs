//! What the assistant costs, per user, team and agent, and the budgets that stop it.
//!
//! * [`Ledger`]: every model call and every paid tool (docrag answers) as a row in SQLite. The
//!   ledger is the source of truth; the cost pages and tests sum it.
//! * [`BudgetHook`]: a rig hook that books each model response and stops the run *before* the
//!   next model call once the run, the user's day or the team's month is over budget.
//! * [`otlp::SpanExporter`]: each model call as an OpenTelemetry span with OpenInference
//!   attributes, so Phoenix (or any OTLP backend) shows tokens and cost next to Warden's
//!   decisions.

mod hook;
mod ledger;
pub mod otlp;

pub use hook::{BudgetHook, RunInfo};
pub use ledger::{CostEntry, Ledger, Totals};

#[derive(Debug, thiserror::Error)]
pub enum CostError {
    #[error("storage: {0}")]
    Storage(String),
}

/// Which budget a run hit.
#[derive(Clone, Debug, PartialEq)]
pub enum BudgetExceeded {
    Run { spent: f64, limit: f64 },
    UserDaily { spent: f64, limit: f64 },
    TeamMonthly { team: String, spent: f64, limit: f64 },
}

impl std::fmt::Display for BudgetExceeded {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BudgetExceeded::Run { spent, limit } => write!(f, "run budget: {spent:.4} of {limit:.2}"),
            BudgetExceeded::UserDaily { spent, limit } => write!(f, "daily budget: {spent:.4} of {limit:.2}"),
            BudgetExceeded::TeamMonthly { team, spent, limit } => write!(f, "monthly budget of team {team}: {spent:.4} of {limit:.2}"),
        }
    }
}

/// Check all budgets for a run that is about to make another model call.
pub fn check_budgets(ledger: &Ledger, budgets: &steward_config::Budgets, run: &RunInfo) -> Result<Option<BudgetExceeded>, CostError> {
    if let Some(limit) = budgets.per_run {
        let spent = ledger.run_total(&run.run_id)?;
        if spent >= limit {
            return Ok(Some(BudgetExceeded::Run { spent, limit }));
        }
    }
    if let Some(limit) = budgets.per_user_daily {
        let spent = ledger.user_today(&run.user)?;
        if spent >= limit {
            return Ok(Some(BudgetExceeded::UserDaily { spent, limit }));
        }
    }
    if let Some(team) = &run.team {
        if let Some(limit) = budgets.team_monthly.get(team) {
            let spent = ledger.team_this_month(team)?;
            if spent >= *limit {
                return Ok(Some(BudgetExceeded::TeamMonthly { team: team.clone(), spent, limit: *limit }));
            }
        }
    }
    Ok(None)
}
