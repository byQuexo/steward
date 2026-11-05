//! One chat turn: model, tools and hooks for this user, run with streaming, mapped to
//! [`ChatEvent`]s.

use std::sync::Arc;

use futures::StreamExt;
use rig_agent::agent::MultiTurnStreamItem;
use rig_agent::streaming::{Item, StreamEvent};
use rig_agent::AgentBuilder;
use rig_core::message::Message;
use serde_json::Value;
use steward_config::{AgentRole, Profile};
use steward_cost::otlp::SpanExporter;
use steward_cost::{check_budgets, BudgetHook, Ledger, RunInfo};
use steward_memory::Memory;
use warden_core::{AttrValue, Context, Engine, KillSwitch, Principal};

use crate::events::{ChatEvent, Events};
use crate::guard::{ContextFn, GuardHook};
use crate::models::ModelFactory;
use crate::names;
use crate::tools::{delegate_tools, memory_tools, result_json, result_text, Delegator, GatewaySession};

/// Everything an agent needs, shared across turns.
#[derive(Clone)]
pub struct Runtime {
    pub profile: Arc<Profile>,
    pub engine: Arc<Engine>,
    pub models: Arc<ModelFactory>,
    pub ledger: Arc<Ledger>,
    pub gateway_url: String,
    pub memory: Option<Memory>,
    pub delegator: Option<Arc<dyn Delegator>>,
    pub spans: Option<SpanExporter>,
    /// Current Warden context (kill switch etc.), as the gateway sees it.
    pub context: ContextFn,
}

pub struct TurnInput {
    pub role: AgentRole,
    pub principal: Principal,
    /// Bearer for the gateway: the user's token, or a delegation / impersonation token.
    pub token: String,
    pub message: String,
    pub history: Vec<Message>,
    pub session_id: Option<String>,
    /// Restrict the agent to these gateway tools (sub-agents executing one skill).
    pub only_tools: Option<Vec<String>>,
}

#[derive(Debug)]
pub struct TurnOutput {
    pub answer: String,
    pub run_id: String,
    pub eur: f64,
    pub budget_exceeded: bool,
}

fn first_team(p: &Principal) -> Option<String> {
    match p.subject.attrs.get("teams") {
        Some(AttrValue::List(l)) => l.first().cloned(),
        Some(AttrValue::String(s)) => Some(s.clone()),
        _ => None,
    }
}

impl Runtime {
    fn preamble(&self, input: &TurnInput, facts: &[String]) -> String {
        let p = &self.profile;
        let user = p.user(&input.principal.subject.id);
        let de = p.meta.locale.starts_with("de");
        let t = |de_text: &'static str, en_text: &'static str| if de { de_text } else { en_text };
        let mut s = p.prompt(input.role).to_string();
        s.push_str(t("\n\n## Kontext\n", "\n\n## Context\n"));
        s.push_str(&format!(
            "- {}: {} ({}), {}: {}\n",
            t("Nutzer", "User"),
            user.map(|u| u.name.as_str()).unwrap_or(&input.principal.subject.id),
            input.principal.subject.id,
            t("Rollen", "roles"),
            input.principal.subject.roles.iter().cloned().collect::<Vec<_>>().join(", ")
        ));
        if let Some(AttrValue::List(ts)) = input.principal.subject.attrs.get("tenants") {
            s.push_str(&format!("- {}: {}\n", t("Mandanten", "Tenants"), ts.join(", ")));
        }
        s.push_str(&format!("- {}: {}\n", t("Heute", "Today"), chrono::Utc::now().format("%Y-%m-%d")));
        s.push_str(&format!("- {}: {}\n", t("Sprache", "Language"), p.meta.locale));
        if input.principal.impersonated_by.is_some() {
            s.push_str(t(
                "- Testsitzung: eine Administratorin sieht den Assistenten wie dieser Nutzer. Nur lesen.\n",
                "- Test session: an administrator sees the assistant as this user. Read only.\n",
            ));
        }
        // The gateway hides blocked tools; say why, so the model does not guess.
        match (self.context)().kill_switch {
            KillSwitch::Writes => s.push_str(t(
                "- Schreibaktionen sind gerade vom Administrator gestoppt (Kill-Switch). Ändern, Anlegen und Senden geht nicht; sag das so. Lesen geht weiter.\n",
                "- Write actions are currently stopped by an administrator (kill switch). Changing, creating and sending is not possible; say so plainly. Reading still works.\n",
            )),
            KillSwitch::All => s.push_str(t(
                "- Alle Werkzeuge sind gerade vom Administrator gestoppt (Kill-Switch); sag das so.\n",
                "- All tools are currently stopped by an administrator (kill switch); say so plainly.\n",
            )),
            _ => {}
        }
        if !facts.is_empty() {
            s.push_str(t("\n## Was du über den Nutzer weißt\n", "\n## What you know about the user\n"));
            for f in facts {
                s.push_str(&format!("- {f}\n"));
            }
        }
        s
    }

    /// Run one turn. Errors are reported as events too; `Err` means nothing could run.
    pub async fn run(&self, input: TurnInput, events: Events) -> Result<TurnOutput, String> {
        let run_id = hex::encode(rand::random::<[u8; 8]>());
        let spec = self.profile.agent(input.role).ok_or("agent not configured")?.clone();
        let connected = self.models.for_role(input.role.as_str())?;
        let run = RunInfo {
            run_id: run_id.clone(),
            user: input.principal.subject.id.clone(),
            team: first_team(&input.principal),
            agent: input.principal.agent.clone(),
            model: connected.route.clone(),
            session: input.session_id.clone(),
        };
        let pricing = Arc::new(self.profile.pricing.clone());

        // A budget that is already exhausted stops the turn before any model call.
        if let Ok(Some(exceeded)) = check_budgets(&self.ledger, &pricing.budgets, &run) {
            events.emit(ChatEvent::BudgetExceeded { reason: exceeded.to_string() });
            let answer = self.profile.meta.messages.budget_exceeded.clone();
            events.emit(ChatEvent::Token { text: answer.clone() });
            events.emit(ChatEvent::Done { answer: answer.clone(), run_id: run_id.clone(), eur: 0.0 });
            return Ok(TurnOutput { answer, run_id, eur: 0.0, budget_exceeded: true });
        }

        // Tools: the gateway's (filtered per user), plus memory and delegation for the orchestrator.
        let session = GatewaySession::connect(&self.gateway_url, &input.token).await?;
        let mut tools = session.tools().await?;
        if let Some(only) = &input.only_tools {
            let allowed: Vec<String> = only.iter().map(|t| names::to_model(t)).collect();
            tools.retain(|t| allowed.iter().any(|a| a == t.name()));
        }
        let mut facts = Vec::new();
        if input.role == AgentRole::Orchestrator {
            if let Some(memory) = &self.memory {
                if let Ok(f) = memory.recall(&input.principal, &(self.context)()) {
                    if !f.is_empty() {
                        events.emit(ChatEvent::MemoryUsed { count: f.len() });
                    }
                    facts = f.into_iter().take(20).map(|f| f.text).collect();
                }
                tools.extend(memory_tools(memory.clone(), input.principal.clone(), self.context.clone(), events.clone()));
            }
            if let Some(d) = &self.delegator {
                let skills = |r: AgentRole| self.profile.agent(r).map(|a| a.skills.clone()).unwrap_or_default();
                tools.extend(delegate_tools(
                    d.clone(),
                    input.token.clone(),
                    events.clone(),
                    &skills(AgentRole::Research),
                    &skills(AgentRole::Action),
                ));
            }
        }

        let guard = GuardHook::new(
            self.engine.clone(),
            input.principal.clone(),
            self.context.clone(),
            events.clone(),
            self.profile.meta.messages.denied.clone(),
        );
        let ev = events.clone();
        let ev2 = events.clone();
        let mut budget = BudgetHook::new(self.ledger.clone(), pricing, run.clone())
            .on_cost(move |e| {
                ev.emit(ChatEvent::Cost {
                    eur: e.eur,
                    input_tokens: e.input_tokens,
                    output_tokens: e.output_tokens,
                    model: e.model.clone(),
                    agent: e.agent.clone(),
                })
            })
            .on_stop(move |x| ev2.emit(ChatEvent::BudgetExceeded { reason: x.to_string() }));
        if let Some(s) = &self.spans {
            budget = budget.with_spans(s.clone());
        }
        let agent = AgentBuilder::new(connected.model)
            .preamble(self.preamble(&input, &facts))
            .dynamic_tools(tools)
            .add_hook(guard)
            .add_hook(budget)
            .default_max_turns(spec.max_turns)
            .build();

        let mut stream = agent.prompt(input.message.clone()).history(input.history.clone()).stream();
        let mut answer = String::new();
        let mut stopped = false;
        while let Some(item) = stream.next().await {
            match item {
                Ok(MultiTurnStreamItem::StreamAssistantItem(Item::Event(StreamEvent::Text { text, .. }))) => {
                    answer.push_str(&text);
                    events.emit(ChatEvent::Token { text });
                }
                Ok(MultiTurnStreamItem::ToolCall { tool_call }) => {
                    events.emit(ChatEvent::ToolCall {
                        id: tool_call.id.to_string(),
                        tool: names::to_qualified(tool_call.function.name.as_ref()),
                        args: Value::Object(tool_call.function.arguments.clone()),
                        agent: input.principal.agent.clone(),
                    });
                }
                Ok(MultiTurnStreamItem::ToolResult { tool_result }) => {
                    let tool = names::to_qualified(tool_result.name.as_ref());
                    let text = result_text(&tool_result.content);
                    if tool == "docs.search" && !tool_result.is_error {
                        if let Some(v) = result_json(&tool_result.content) {
                            emit_citations(&v, &events, &tool);
                        }
                    }
                    events.emit(ChatEvent::ToolResult {
                        id: tool_result.call.to_string(),
                        tool,
                        ok: !tool_result.is_error,
                        preview: text.chars().take(2000).collect(),
                    });
                }
                Ok(_) => {}
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("budget") {
                        stopped = true;
                    } else {
                        events.emit(ChatEvent::Error { message: msg.clone() });
                        tracing::warn!(error = %msg, "turn failed");
                    }
                    break;
                }
            }
        }
        drop(session);
        if stopped {
            let note = self.profile.meta.messages.budget_exceeded.clone();
            if !answer.is_empty() {
                answer.push_str("\n\n");
            }
            answer.push_str(&note);
            events.emit(ChatEvent::Token { text: note });
        }
        let eur = self.ledger.run_total(&run_id).unwrap_or(0.0);
        events.emit(ChatEvent::Done { answer: answer.clone(), run_id: run_id.clone(), eur });
        Ok(TurnOutput { answer, run_id, eur, budget_exceeded: stopped })
    }
}

/// `docs.search` results carry verified sources; surface them as citation events.
fn emit_citations(v: &Value, events: &Events, tool: &str) {
    if v["status"] == "abstained" {
        events.emit(ChatEvent::Abstained { tool: tool.to_string() });
        return;
    }
    for s in v["sources"].as_array().into_iter().flatten() {
        events.emit(ChatEvent::Citation {
            doc_id: s["doc_id"].as_str().unwrap_or_default().to_string(),
            title: s["title"].as_str().unwrap_or_default().to_string(),
            page: s["page"].as_u64().unwrap_or(1) as u32,
            quote: s["quote"].as_str().unwrap_or_default().to_string(),
            url: s["page_image_url"].as_str().unwrap_or_default().to_string(),
        });
    }
}

/// A context function with the kill switch as the gateway reports it.
pub fn static_context(ctx: Context) -> ContextFn {
    Arc::new(move || ctx.clone())
}
