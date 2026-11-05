//! IT helpdesk tickets. Ticket text is user content and may contain prompt injections; the
//! server returns it unchanged, Warden decides what the assistant can do afterwards.

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::{arg_str, opt_str, schema, Caller, EffectLog, McpServer, ToolDef, ToolError};

pub struct Tickets {
    name: String,
    tickets: Mutex<Vec<Value>>,
    effects: EffectLog,
}

impl Tickets {
    pub fn new(name: &str, data: Value, effects: EffectLog) -> Result<Self, String> {
        let tickets = data.get("tickets").and_then(Value::as_array).cloned().ok_or("ticket data: `tickets` missing")?;
        Ok(Self { name: name.into(), tickets: Mutex::new(tickets), effects })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Vec<Value>>, ToolError> {
        self.tickets.lock().map_err(|_| ToolError::Internal("state poisoned".into()))
    }
}

#[async_trait::async_trait]
impl McpServer for Tickets {
    fn name(&self) -> &str {
        &self.name
    }

    fn tools(&self) -> Vec<ToolDef> {
        vec![
            ToolDef {
                name: "list",
                description: "Tickets, optionally filtered by status (offen, in Arbeit, geschlossen) or assignee.",
                input_schema: schema(json!({"status": {"type": "string"}, "assignee": {"type": "string"}}), &[]),
            },
            ToolDef {
                name: "get",
                description: "One ticket with its text and comments.",
                input_schema: schema(json!({"ticket_id": {"type": "string"}}), &["ticket_id"]),
            },
            ToolDef {
                name: "create",
                description: "Open a new ticket for the calling user.",
                input_schema: schema(
                    json!({"title": {"type": "string"}, "body": {"type": "string"}, "category": {"type": "string"}}),
                    &["title", "body"],
                ),
            },
            ToolDef {
                name: "comment",
                description: "Add a comment to a ticket.",
                input_schema: schema(json!({"ticket_id": {"type": "string"}, "text": {"type": "string"}}), &["ticket_id", "text"]),
            },
            ToolDef {
                name: "close",
                description: "Close a ticket.",
                input_schema: schema(json!({"ticket_id": {"type": "string"}}), &["ticket_id"]),
            },
        ]
    }

    async fn call(&self, caller: &Caller, tool: &str, args: &Value) -> Result<Value, ToolError> {
        match tool {
            "list" => {
                let status = opt_str(args, "status");
                let assignee = opt_str(args, "assignee");
                let rows: Vec<Value> = self
                    .lock()?
                    .iter()
                    .filter(|t| status.is_none_or(|s| t["status"] == s) && assignee.is_none_or(|a| t["assignee"] == a))
                    .map(|t| json!({"id": t["id"], "title": t["title"], "status": t["status"], "priority": t["priority"], "requester": t["requester"]}))
                    .collect();
                Ok(json!({"tickets": rows}))
            }
            "get" => {
                let id = arg_str(args, "ticket_id")?;
                self.lock()?.iter().find(|t| t["id"] == id).cloned().ok_or_else(|| ToolError::NotFound(id.into()))
            }
            "create" => {
                let mut tickets = self.lock()?;
                let next =
                    tickets.iter().filter_map(|t| t["id"].as_str()?.strip_prefix("t-")?.parse::<u32>().ok()).max().unwrap_or(2000) + 1;
                let t = json!({
                    "id": format!("t-{next}"),
                    "title": arg_str(args, "title")?,
                    "body": arg_str(args, "body")?,
                    "category": opt_str(args, "category").unwrap_or("Sonstiges"),
                    "requester": caller.subject().unwrap_or("unknown"),
                    "assignee": Value::Null,
                    "status": "offen",
                    "priority": "mittel",
                    "comments": [],
                });
                tickets.push(t.clone());
                drop(tickets);
                self.effects.push(&self.name, tool, caller, args);
                Ok(json!({"created": t}))
            }
            "comment" | "close" => {
                let id = arg_str(args, "ticket_id")?;
                let mut tickets = self.lock()?;
                let t = tickets.iter_mut().find(|t| t["id"] == id).ok_or_else(|| ToolError::NotFound(id.into()))?;
                if tool == "close" {
                    t["status"] = json!("geschlossen");
                } else {
                    let text = arg_str(args, "text")?;
                    if let Some(c) = t["comments"].as_array_mut() {
                        c.push(json!({"author": caller.subject().unwrap_or("unknown"), "text": text}));
                    }
                }
                let out = t.clone();
                drop(tickets);
                self.effects.push(&self.name, tool, caller, args);
                Ok(json!({"ticket": out}))
            }
            _ => Err(ToolError::Invalid(format!("unknown tool `{tool}`"))),
        }
    }
}
