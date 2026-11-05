//! Second line of defense in the agent loop: every gateway tool call is checked in process with
//! the same Warden policy before it leaves the assistant.
//!
//! It mirrors `warden_rig::ScopeHook` with one difference: a `require_approval` decision is
//! not settled here but passed on, because the **gateway owns approvals** (it holds the call,
//! asks the inbox once and forwards exactly the approved arguments). A denial stops the call
//! before any network traffic, and every decision is emitted to the chat stream.

use std::sync::Arc;

use rig_agent::agent::{AgentHook, DispatchAction, DispatchEvent, HookContext};
use rig_agent::run::{InvalidToolCallAction, InvalidToolCallContext};
use warden_core::json::{parse_strict, Limits};
use warden_core::{Action, Context, Effect, Engine, Principal};

use crate::events::{ChatEvent, Events};
use crate::names;

pub type ContextFn = Arc<dyn Fn() -> Context + Send + Sync>;

pub struct GuardHook {
    engine: Arc<Engine>,
    principal: Principal,
    context: ContextFn,
    events: Events,
    denied_message: String,
}

impl GuardHook {
    pub fn new(engine: Arc<Engine>, principal: Principal, context: ContextFn, events: Events, denied_message: impl Into<String>) -> Self {
        Self { engine, principal, context, events, denied_message: denied_message.into() }
    }

    /// Decide a call by model tool name and raw JSON arguments. `None`: not a gateway tool.
    pub fn decide(&self, model_name: &str, raw_args: &str) -> Option<(Effect, String)> {
        if names::is_local(model_name) {
            return None;
        }
        let qualified = names::to_qualified(model_name);
        let Ok(args) = parse_strict(raw_args, Limits::default()) else {
            self.events.emit(ChatEvent::Decision {
                tool: qualified,
                effect: "deny".into(),
                rule: "normalize.args".into(),
                agent: self.principal.agent.clone(),
            });
            return Some((Effect::Deny, "normalize.args".into()));
        };
        let d = self.engine.check(&self.principal, &Action::tool(qualified.clone(), args), &(self.context)());
        self.events.emit(ChatEvent::Decision {
            tool: qualified,
            effect: d.effect.to_string(),
            rule: d.rule.clone(),
            agent: self.principal.agent.clone(),
        });
        Some((d.effect, d.rule))
    }
}

impl AgentHook for GuardHook {
    fn name(&self) -> Option<String> {
        Some(format!("steward:guard:{}", self.engine.version()))
    }

    async fn on_dispatch(&self, _ctx: &HookContext, event: DispatchEvent<'_>) -> DispatchAction {
        let (Some(name), Some(args)) = (event.tool_name(), event.tool_args()) else {
            return DispatchAction::proceed();
        };
        match self.decide(name, args) {
            Some((Effect::Deny, _)) => DispatchAction::skip(self.denied_message.clone()),
            // Allow, or RequireApproval: the gateway decides again and holds for approval.
            _ => DispatchAction::proceed(),
        }
    }

    /// A call to a tool this user is not offered (the gateway hid it), typically provoked by
    /// injected text. It is answered as denied and the run continues: never retried, never run.
    async fn on_invalid_tool_call(&self, _ctx: &HookContext, event: &InvalidToolCallContext) -> Option<InvalidToolCallAction> {
        if !names::is_local(&event.tool_name) {
            let _ = self.decide(&event.tool_name, event.args.as_deref().unwrap_or("{}"));
        }
        Some(InvalidToolCallAction::Skip { reason: self.denied_message.clone() })
    }
}
