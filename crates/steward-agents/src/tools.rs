//! The tools an agent gets for one turn: the gateway's (already filtered for this user) and the
//! assistant's own memory and delegation tools.

use std::sync::Arc;

use rig_agent::tool::DynamicTool;
use rig_core::message::{ToolName, ToolResultContent};
use rig_core::tool::{ToolExecutionError, ToolOutput};
use rig_rmcp::{McpConnection, McpTool};
use rmcp::model::ClientConfig;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::ServiceExt;
use serde_json::{json, Value};
use steward_config::AgentRole;
use steward_memory::{Memory, MemoryError};
use warden_core::{Context, Principal};

use crate::events::{ChatEvent, Events};
use crate::names;

/// An MCP session with the Warden gateway, opened with the user's (or delegation) token.
pub struct GatewaySession {
    pub conn: McpConnection,
}

impl GatewaySession {
    pub async fn connect(gateway_url: &str, token: &str) -> Result<Self, String> {
        let cfg = StreamableHttpClientTransportConfig::with_uri(gateway_url.to_string()).auth_header(token.to_string());
        let transport = StreamableHttpClientTransport::from_config(cfg);
        let service = ClientConfig::default().serve(transport).await.map_err(|e| format!("gateway: {e}"))?;
        Ok(Self { conn: McpConnection::new(service) })
    }

    /// The gateway's tool list for this token, renamed for the model (`crm__update_deal`).
    pub async fn tools(&self) -> Result<Vec<DynamicTool>, String> {
        let list = self.conn.tools().await.map_err(|e| format!("gateway tools/list: {e}"))?;
        let mut out = Vec::new();
        for t in list {
            let model_name = names::to_model(t.name());
            let Ok(name) = ToolName::new(model_name) else { continue };
            let tool: McpTool = t.with_name(name).with_timeout(std::time::Duration::from_secs(300));
            if let Ok(d) = DynamicTool::try_from(tool) {
                out.push(d);
            }
        }
        Ok(out)
    }
}

/// Text of a tool result (text items joined; the structured item if there is no text).
pub fn result_text(content: &[ToolResultContent]) -> String {
    let texts: Vec<String> = content
        .iter()
        .filter_map(|c| match c {
            ToolResultContent::Text(t) => Some(t.text.clone()),
            _ => None,
        })
        .collect();
    if texts.is_empty() {
        result_json(content).map(|v| v.to_string()).unwrap_or_default()
    } else {
        texts.join("\n")
    }
}

/// The structured value of a tool result (MCP `structuredContent`, or JSON text).
pub fn result_json(content: &[ToolResultContent]) -> Option<Value> {
    content
        .iter()
        .find_map(|c| match c {
            ToolResultContent::Json { value } => Some(value.clone()),
            _ => None,
        })
        .or_else(|| {
            content.iter().find_map(|c| match c {
                ToolResultContent::Text(t) => serde_json::from_str(&t.text).ok(),
                _ => None,
            })
        })
}

fn refused(msg: impl Into<String>) -> ToolExecutionError {
    ToolExecutionError::refused(msg.into())
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required, "additionalProperties": false})
}

/// Memory tools for the principal; every call is checked by Warden in process.
pub fn memory_tools(memory: Memory, principal: Principal, ctx: Arc<dyn Fn() -> Context + Send + Sync>, events: Events) -> Vec<DynamicTool> {
    let mut out = Vec::new();
    let (m, p, c, e) = (memory.clone(), principal.clone(), ctx.clone(), events.clone());
    if let Ok(name) = ToolName::new(names::MEMORY_RECALL) {
        out.push(DynamicTool::new(name, "List what you remember about the user.", obj(json!({}), &[]), move |_args| {
            let (m, p, c, e) = (m.clone(), p.clone(), c.clone(), e.clone());
            Box::pin(async move {
                match m.recall(&p, &c()) {
                    Ok(facts) => {
                        e.emit(ChatEvent::MemoryUsed { count: facts.len() });
                        Ok(ToolOutput::json(
                            json!({"facts": facts.iter().map(|f| json!({"id": f.id, "text": f.text})).collect::<Vec<_>>()}),
                        ))
                    }
                    Err(err) => Err(refused(err.to_string())),
                }
            })
        }));
    }
    let (m, p, c, e) = (memory.clone(), principal.clone(), ctx.clone(), events.clone());
    if let Ok(name) = ToolName::new(names::MEMORY_REMEMBER) {
        out.push(DynamicTool::new(
            name,
            "Remember a short fact about the user for later conversations (never secrets, IBANs or card numbers).",
            obj(json!({"fact": {"type": "string"}}), &["fact"]),
            move |args| {
                let (m, p, c, e) = (m.clone(), p.clone(), c.clone(), e.clone());
                Box::pin(async move {
                    let fact = args.get("fact").and_then(Value::as_str).unwrap_or_default().to_string();
                    match m.remember(&p, &fact, &c()) {
                        Ok(f) => {
                            e.emit(ChatEvent::MemoryStored { fact: f.text.clone() });
                            Ok(ToolOutput::json(json!({"stored": f.text, "id": f.id})))
                        }
                        Err(err @ MemoryError::Pii(_)) => {
                            e.emit(ChatEvent::MemoryRefused { reason: err.to_string() });
                            Err(refused(format!("not stored: {err}")))
                        }
                        Err(err) => {
                            e.emit(ChatEvent::MemoryRefused { reason: err.to_string() });
                            Err(refused(err.to_string()))
                        }
                    }
                })
            },
        ));
    }
    let (m, p, c) = (memory, principal, ctx);
    if let Ok(name) = ToolName::new(names::MEMORY_FORGET) {
        out.push(DynamicTool::new(
            name,
            "Forget one remembered fact (by id) or everything (no id).",
            obj(json!({"fact_id": {"type": "integer"}}), &[]),
            move |args| {
                let (m, p, c) = (m.clone(), p.clone(), c.clone());
                Box::pin(async move {
                    let id = args.get("fact_id").and_then(Value::as_i64);
                    m.forget(&p, id, &c()).map(|n| ToolOutput::json(json!({"forgotten": n}))).map_err(|err| refused(err.to_string()))
                })
            },
        ));
    }
    out
}

/// Hands work to a sub-agent over A2A (implemented by `steward-a2a`).
#[async_trait::async_trait]
pub trait Delegator: Send + Sync {
    /// Run `skill` on the `agent` for the user behind `user_token`. Returns the agent's answer,
    /// or a refusal / pending-approval message.
    async fn delegate(&self, agent: AgentRole, skill: &str, input: &str, user_token: &str, events: &Events) -> Result<String, String>;
}

pub fn delegate_tools(
    delegator: Arc<dyn Delegator>,
    user_token: String,
    events: Events,
    research_skills: &[String],
    action_skills: &[String],
) -> Vec<DynamicTool> {
    let mut out = Vec::new();
    for (role, tool, skills, desc) in [
        (
            AgentRole::Research,
            names::DELEGATE_RESEARCH,
            research_skills,
            "Hand a read-only research task across documents, CRM and tickets to the research agent.",
        ),
        (
            AgentRole::Action,
            names::DELEGATE_ACTION,
            action_skills,
            "Hand a change (CRM update, Jira issue) to the action agent. It needs approval.",
        ),
    ] {
        if skills.is_empty() {
            continue;
        }
        let Ok(name) = ToolName::new(tool) else { continue };
        let (d, t, e) = (delegator.clone(), user_token.clone(), events.clone());
        let params = obj(json!({"skill": {"type": "string", "enum": skills}, "input": {"type": "string"}}), &["skill", "input"]);
        out.push(DynamicTool::new(name, desc, params, move |args| {
            let (d, t, e) = (d.clone(), t.clone(), e.clone());
            Box::pin(async move {
                let skill = args.get("skill").and_then(Value::as_str).unwrap_or_default().to_string();
                let input = args.get("input").and_then(Value::as_str).unwrap_or_default().to_string();
                d.delegate(role, &skill, &input, &t, &e).await.map(ToolOutput::text).map_err(refused)
            })
        }));
    }
    out
}
