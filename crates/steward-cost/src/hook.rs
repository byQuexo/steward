use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use rig_agent::agent::{AgentHook, CompletionCallAction, CompletionCallEvent, HookContext, OutcomeAction, OutcomeEvent};
use steward_config::{Budgets, Pricing};

use crate::otlp::{LlmSpan, SpanExporter};
use crate::{check_budgets, CostEntry, Ledger};

/// Who and what a run is booked to.
#[derive(Clone, Debug)]
pub struct RunInfo {
    pub run_id: String,
    pub user: String,
    pub team: Option<String>,
    pub agent: String,
    /// Model route used for pricing (`openrouter/...`, `scripted`).
    pub model: String,
    pub session: Option<String>,
}

type OnCost = Arc<dyn Fn(&CostEntry) + Send + Sync>;
type OnStop = Arc<dyn Fn(&crate::BudgetExceeded) + Send + Sync>;

/// Books every model response and stops the run before the next model call once a budget
/// is used up. One hook per run.
pub struct BudgetHook {
    ledger: Arc<Ledger>,
    pricing: Arc<Pricing>,
    budgets: Budgets,
    run: RunInfo,
    on_cost: Option<OnCost>,
    on_stop: Option<OnStop>,
    spans: Option<SpanExporter>,
    started: Mutex<Option<SystemTime>>,
}

impl BudgetHook {
    pub fn new(ledger: Arc<Ledger>, pricing: Arc<Pricing>, run: RunInfo) -> Self {
        let budgets = pricing.budgets.clone();
        Self { ledger, pricing, budgets, run, on_cost: None, on_stop: None, spans: None, started: Mutex::new(None) }
    }

    pub fn with_budgets(mut self, b: Budgets) -> Self {
        self.budgets = b;
        self
    }

    /// Called after each booking (the chat streams it as a `cost` event).
    pub fn on_cost(mut self, f: impl Fn(&CostEntry) + Send + Sync + 'static) -> Self {
        self.on_cost = Some(Arc::new(f));
        self
    }

    /// Called when a budget stops the run.
    pub fn on_stop(mut self, f: impl Fn(&crate::BudgetExceeded) + Send + Sync + 'static) -> Self {
        self.on_stop = Some(Arc::new(f));
        self
    }

    pub fn with_spans(mut self, e: SpanExporter) -> Self {
        self.spans = Some(e);
        self
    }
}

impl AgentHook for BudgetHook {
    fn name(&self) -> Option<String> {
        Some("steward:budget".into())
    }

    async fn on_completion_call(&self, _ctx: &HookContext, _event: CompletionCallEvent<'_>) -> CompletionCallAction {
        if let Ok(mut s) = self.started.lock() {
            *s = Some(SystemTime::now());
        }
        match check_budgets(&self.ledger, &self.budgets, &self.run) {
            Ok(None) => CompletionCallAction::continue_run(),
            Ok(Some(exceeded)) => {
                if let Some(f) = &self.on_stop {
                    f(&exceeded);
                }
                CompletionCallAction::stop(exceeded.to_string())
            }
            // A ledger that cannot be read cannot enforce budgets: fail closed.
            Err(e) => CompletionCallAction::stop(format!("cost ledger unavailable: {e}")),
        }
    }

    async fn on_outcome(&self, _ctx: &HookContext, event: OutcomeEvent<'_>) -> OutcomeAction {
        let Some(response) = event.completion() else { return OutcomeAction::proceed() };
        let u = response.usage;
        let input = u.input_tokens.unwrap_or(0);
        let output = u.output_tokens.unwrap_or(0);
        let cached = u.cached_input_tokens.unwrap_or(0);
        let eur = self.pricing.cost(&self.run.model, input, output, cached);
        let entry = CostEntry {
            run_id: self.run.run_id.clone(),
            user: self.run.user.clone(),
            team: self.run.team.clone(),
            agent: self.run.agent.clone(),
            model: self.run.model.clone(),
            input_tokens: input,
            output_tokens: output,
            cached_input_tokens: cached,
            eur,
            ts: 0,
        };
        match self.ledger.record(entry) {
            Ok(e) => {
                if let Some(f) = &self.on_cost {
                    f(&e);
                }
                if let Some(spans) = &self.spans {
                    let start = self.started.lock().ok().and_then(|s| *s).unwrap_or_else(SystemTime::now);
                    spans.export(LlmSpan { run: self.run.clone(), start, end: SystemTime::now(), entry: e });
                }
            }
            Err(err) => tracing::error!(error = %err, "cost not booked"),
        }
        OutcomeAction::proceed()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig_agent::AgentBuilder;
    use rig_core::completion::Usage;
    use rig_core::test_utils::{MockCompletionModel, MockTurn};

    #[tokio::test]
    async fn books_each_call_and_stops_at_the_run_budget() {
        let ledger = Arc::new(Ledger::in_memory().unwrap());
        let pricing: Pricing = serde_norway_free("m");
        let run = RunInfo {
            run_id: "r1".into(),
            user: "fiona".into(),
            team: Some("finance".into()),
            agent: "bot".into(),
            model: "m".into(),
            session: None,
        };
        let budgets = Budgets { per_run: Some(0.0005), ..Default::default() };
        let costs = Arc::new(Mutex::new(Vec::new()));
        let seen = costs.clone();
        let hook = BudgetHook::new(ledger.clone(), Arc::new(pricing), run).with_budgets(budgets).on_cost(move |e| {
            if let Ok(mut s) = seen.lock() {
                s.push(e.eur);
            }
        });
        // First call costs 1000 input tokens at 1 EUR/Mtok = 0.001 EUR (> budget); the tool loop
        // would continue, but the hook stops it before the second model call.
        let model = MockCompletionModel::from_turns([
            MockTurn::tool_call("c1", "lookup", serde_json::json!({})).with_usage(Usage::new().input_tokens(1000).output_tokens(0)),
            MockTurn::text("never reached"),
        ]);
        let agent = AgentBuilder::new(model).add_hook(hook).build();
        let result = agent.prompt("hi").await;
        assert!(result.is_err(), "run must stop: {result:?}");
        assert_eq!(costs.lock().unwrap().len(), 1);
        assert!((ledger.run_total("r1").unwrap() - 0.001).abs() < 1e-9);
    }

    fn serde_norway_free(model: &str) -> Pricing {
        serde_json::from_value(serde_json::json!({"models": {model: {"input_per_mtok": 1.0, "output_per_mtok": 2.0}}})).unwrap()
    }
}
