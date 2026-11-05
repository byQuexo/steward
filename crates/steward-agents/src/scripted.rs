//! The scripted model: replays a profile's demo scenarios so the assistant runs without any
//! API key (offline demo, CI). It is a rig model like any other: requests go through the same
//! agent loop, tools, hooks, Warden gateway and budgets; only the "thinking" is a script.
//!
//! For a request it finds the last user message, looks it up among the scenario turns (and
//! sub-agent inputs), counts the tool calls the run has made since, and answers with the next
//! scripted tool call, or the scripted text once the calls are done.

use std::sync::Arc;

use futures::stream;
use rig_core::completion::{CompletionRequest, CompletionResponse, Usage};
use rig_core::driver::{Exchange, Model, Opened, Opening, Transport};
use rig_core::error::ProviderError;
use rig_core::message::{AssistantContent, Message, Origin, ToolName, UserContent};
use rig_core::test_utils::{MockFrame, MockScript};
use serde_json::{json, Value};
use steward_config::{DemoScenario, ScriptStep, UsageSpec};

use crate::names;

struct Entry {
    key: String,
    steps: Vec<ScriptStep>,
    usage: UsageSpec,
}

/// All scripts of a profile, indexed by normalized user text.
pub struct ScriptBook {
    entries: Vec<Entry>,
    fallback: String,
}

const DEFAULT_USAGE: UsageSpec = UsageSpec { input_tokens: 1400, output_tokens: 90 };

pub fn normalize(s: &str) -> String {
    s.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ").trim_end_matches(['?', '.', '!', ' ']).to_string()
}

impl ScriptBook {
    pub fn new(scenarios: &[DemoScenario], fallback: impl Into<String>) -> Self {
        let mut entries = Vec::new();
        fn collect(steps: &[ScriptStep], usage: UsageSpec, out: &mut Vec<Entry>) {
            for s in steps {
                if let ScriptStep::Delegate { input, script, .. } = s {
                    out.push(Entry { key: normalize(input), steps: script.clone(), usage });
                    collect(script, usage, out);
                }
            }
        }
        for sc in scenarios {
            let usage = sc.usage.unwrap_or(DEFAULT_USAGE);
            for t in &sc.turns {
                entries.push(Entry { key: normalize(&t.user), steps: t.script.clone(), usage });
                collect(&t.script, usage, &mut entries);
            }
        }
        Self { entries, fallback: fallback.into() }
    }

    fn find(&self, user_text: &str) -> Option<&Entry> {
        let key = normalize(user_text);
        self.entries.iter().find(|e| e.key == key)
    }

    /// The scripted texts users can type, for the UI's suggestions.
    pub fn prompts(&self) -> Vec<String> {
        self.entries.iter().map(|e| e.key.clone()).collect()
    }
}

/// The state of the run in a request: the last real user text and how many tool calls the
/// assistant has made since.
fn position(req: &CompletionRequest) -> (Option<String>, usize) {
    let mut last_user: Option<(usize, String)> = None;
    for (i, m) in req.chat_history.iter().enumerate() {
        if let Message::User { content } = &**m {
            let text: String = content
                .iter()
                .filter_map(|c| match c {
                    UserContent::Text(t) => Some(t.text.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !text.trim().is_empty() {
                last_user = Some((i, text));
            }
        }
    }
    let Some((idx, text)) = last_user else { return (None, 0) };
    let calls = req.chat_history[idx..]
        .iter()
        .filter_map(|m| match &**m {
            Message::Assistant(a) => Some(a.content.iter().filter(|c| matches!(c, AssistantContent::ToolCall(_))).count()),
            _ => None,
        })
        .sum();
    (Some(text), calls)
}

fn call_of(step: &ScriptStep) -> Option<(String, Value)> {
    match step {
        ScriptStep::Tool { name, args } => Some((names::to_model(name), if args.is_null() { json!({}) } else { args.clone() })),
        ScriptStep::Delegate { agent, skill, input, .. } => {
            let tool = if agent == "action" { names::DELEGATE_ACTION } else { names::DELEGATE_RESEARCH };
            Some((tool.to_string(), json!({"skill": skill, "input": input})))
        }
        ScriptStep::Remember { fact } => Some((names::MEMORY_REMEMBER.to_string(), json!({"fact": fact}))),
        ScriptStep::Say(_) => None,
    }
}

impl ScriptBook {
    /// The scripted reply to a request.
    pub fn answer(&self, req: &CompletionRequest) -> (AssistantContent, Usage) {
        let (text, calls) = position(req);
        let Some(entry) = text.as_deref().and_then(|t| self.find(t)) else {
            let usage = Usage::new().input_tokens(DEFAULT_USAGE.input_tokens).output_tokens(DEFAULT_USAGE.output_tokens);
            return (AssistantContent::text(self.fallback.clone()), usage);
        };
        let tool_steps: Vec<(String, Value)> = entry.steps.iter().filter_map(call_of).collect();
        let usage = Usage::new().input_tokens(entry.usage.input_tokens + 220 * calls as u64).output_tokens(if calls < tool_steps.len() {
            40
        } else {
            entry.usage.output_tokens
        });
        if let Some((name, args)) = tool_steps.get(calls) {
            if let Ok(tool) = ToolName::new(name.clone()) {
                return (AssistantContent::tool_call(format!("call-{calls}"), tool, args.clone()), usage);
            }
        }
        let say: Vec<&str> = entry
            .steps
            .iter()
            .filter_map(|s| match s {
                ScriptStep::Say(t) => Some(t.as_str()),
                _ => None,
            })
            .collect();
        (AssistantContent::text(if say.is_empty() { "Erledigt.".to_string() } else { say.join("\n\n") }), usage)
    }
}

/// rig transport backed by a [`ScriptBook`].
#[derive(Clone)]
pub struct ScriptedTransport(pub Arc<ScriptBook>);

impl Transport<MockScript> for ScriptedTransport {
    fn send(&self, request: CompletionRequest, _exchange: Exchange) -> Opening<MockFrame> {
        let (content, usage) = self.0.answer(&request);
        let response = CompletionResponse::new(vec![content], usage, Origin::new("steward.scripted", "scripted", "scripted"), Value::Null);
        Opening::ready(Opened::new(stream::iter([Ok::<_, ProviderError>(MockFrame::Response(Box::new(response)))])))
    }
}

pub fn scripted_model(book: Arc<ScriptBook>) -> Model<MockScript, ScriptedTransport> {
    Model::new(MockScript::new("scripted"), ScriptedTransport(book))
}
