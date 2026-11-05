//! Mock systems from seed data: Jira, team chat and GitHub. They behave like the real tools'
//! MCP servers closely enough for the demo; a profile points a connector at a URL to use the
//! real thing.

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::{arg_str, opt_str, schema, Caller, EffectLog, McpServer, ToolDef, ToolError};

fn list(data: &Value, k: &str) -> Result<Vec<Value>, String> {
    data.get(k).and_then(Value::as_array).cloned().ok_or_else(|| format!("data: `{k}` missing"))
}

fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, ToolError> {
    m.lock().map_err(|_| ToolError::Internal("state poisoned".into()))
}

pub struct Jira {
    name: String,
    projects: Vec<Value>,
    issues: Mutex<Vec<Value>>,
    effects: EffectLog,
}

impl Jira {
    pub fn new(name: &str, data: Value, effects: EffectLog) -> Result<Self, String> {
        Ok(Self { name: name.into(), projects: list(&data, "projects")?, issues: Mutex::new(list(&data, "issues")?), effects })
    }
}

#[async_trait::async_trait]
impl McpServer for Jira {
    fn name(&self) -> &str {
        &self.name
    }
    fn tools(&self) -> Vec<ToolDef> {
        vec![
            ToolDef {
                name: "list_issues",
                description: "Issues of a project.",
                input_schema: schema(json!({"project": {"type": "string"}}), &["project"]),
            },
            ToolDef {
                name: "create_issue",
                description: "Create an issue.",
                input_schema: schema(
                    json!({"project": {"type": "string"}, "summary": {"type": "string"}, "description": {"type": "string"}}),
                    &["project", "summary"],
                ),
            },
        ]
    }
    async fn call(&self, caller: &Caller, tool: &str, args: &Value) -> Result<Value, ToolError> {
        let project = arg_str(args, "project")?;
        if !self.projects.iter().any(|p| p == project) {
            return Err(ToolError::NotFound(format!("project `{project}`")));
        }
        match tool {
            "list_issues" => Ok(json!({"issues": lock(&self.issues)?.iter().filter(|i| i["project"] == project).collect::<Vec<_>>()})),
            "create_issue" => {
                let mut issues = lock(&self.issues)?;
                let n = issues.iter().filter(|i| i["project"] == project).count() + 100;
                let issue = json!({
                    "key": format!("{project}-{n}"),
                    "project": project,
                    "summary": arg_str(args, "summary")?,
                    "description": opt_str(args, "description"),
                    "status": "To Do",
                    "reporter": caller.subject(),
                });
                issues.push(issue.clone());
                drop(issues);
                self.effects.push(&self.name, tool, caller, args);
                Ok(json!({"created": issue}))
            }
            _ => Err(ToolError::Invalid(format!("unknown tool `{tool}`"))),
        }
    }
}

pub struct Chat {
    name: String,
    channels: Vec<Value>,
    messages: Mutex<Vec<Value>>,
    effects: EffectLog,
}

impl Chat {
    pub fn new(name: &str, data: Value, effects: EffectLog) -> Result<Self, String> {
        Ok(Self { name: name.into(), channels: list(&data, "channels")?, messages: Mutex::new(list(&data, "messages")?), effects })
    }
}

#[async_trait::async_trait]
impl McpServer for Chat {
    fn name(&self) -> &str {
        &self.name
    }
    fn tools(&self) -> Vec<ToolDef> {
        vec![
            ToolDef { name: "list_channels", description: "Channels.", input_schema: schema(json!({}), &[]) },
            ToolDef {
                name: "post_message",
                description: "Post a message to a channel.",
                input_schema: schema(json!({"channel": {"type": "string"}, "text": {"type": "string"}}), &["channel", "text"]),
            },
        ]
    }
    async fn call(&self, caller: &Caller, tool: &str, args: &Value) -> Result<Value, ToolError> {
        match tool {
            "list_channels" => Ok(json!({"channels": self.channels})),
            "post_message" => {
                let channel = arg_str(args, "channel")?.trim_start_matches('#');
                if !self.channels.iter().any(|c| c == channel) {
                    return Err(ToolError::NotFound(format!("channel `{channel}`")));
                }
                let mut m = lock(&self.messages)?;
                let msg = json!({"id": format!("m-{:03}", m.len() + 1), "channel": channel, "author": caller.subject(), "text": arg_str(args, "text")?});
                m.push(msg.clone());
                drop(m);
                self.effects.push(&self.name, tool, caller, args);
                Ok(json!({"posted": msg}))
            }
            _ => Err(ToolError::Invalid(format!("unknown tool `{tool}`"))),
        }
    }
}

pub struct Github {
    name: String,
    repos: Vec<Value>,
    issues: Mutex<Vec<Value>>,
    pulls: Mutex<Vec<Value>>,
    effects: EffectLog,
}

impl Github {
    pub fn new(name: &str, data: Value, effects: EffectLog) -> Result<Self, String> {
        Ok(Self {
            name: name.into(),
            repos: list(&data, "repos")?,
            issues: Mutex::new(list(&data, "issues")?),
            pulls: Mutex::new(list(&data, "pulls")?),
            effects,
        })
    }
}

#[async_trait::async_trait]
impl McpServer for Github {
    fn name(&self) -> &str {
        &self.name
    }
    fn tools(&self) -> Vec<ToolDef> {
        let repo = json!({"type": "string", "description": "owner/name"});
        vec![
            ToolDef { name: "list_issues", description: "Issues of a repository.", input_schema: schema(json!({"repo": repo}), &["repo"]) },
            ToolDef {
                name: "create_issue",
                description: "Open an issue.",
                input_schema: schema(json!({"repo": repo, "title": {"type": "string"}, "body": {"type": "string"}}), &["repo", "title"]),
            },
            ToolDef { name: "list_pulls", description: "Open pull requests.", input_schema: schema(json!({"repo": repo}), &["repo"]) },
            ToolDef {
                name: "merge_pull_request",
                description: "Merge a pull request.",
                input_schema: schema(json!({"repo": repo, "number": {"type": "integer"}}), &["repo", "number"]),
            },
        ]
    }
    async fn call(&self, caller: &Caller, tool: &str, args: &Value) -> Result<Value, ToolError> {
        let repo = arg_str(args, "repo")?;
        if !self.repos.iter().any(|r| r == repo) {
            return Err(ToolError::NotFound(format!("repository `{repo}`")));
        }
        match tool {
            "list_issues" => Ok(json!({"issues": lock(&self.issues)?.iter().filter(|i| i["repo"] == repo).collect::<Vec<_>>()})),
            "list_pulls" => {
                Ok(json!({"pulls": lock(&self.pulls)?.iter().filter(|p| p["repo"] == repo && p["state"] == "open").collect::<Vec<_>>()}))
            }
            "create_issue" => {
                let mut issues = lock(&self.issues)?;
                let n = issues.iter().filter(|i| i["repo"] == repo).count() + 1;
                let issue = json!({"repo": repo, "number": n, "title": arg_str(args, "title")?, "body": opt_str(args, "body"), "state": "open", "author": caller.subject()});
                issues.push(issue.clone());
                drop(issues);
                self.effects.push(&self.name, tool, caller, args);
                Ok(json!({"created": issue}))
            }
            "merge_pull_request" => {
                let number = args.get("number").and_then(Value::as_u64).ok_or_else(|| ToolError::Invalid("`number` is required".into()))?;
                let mut pulls = lock(&self.pulls)?;
                let pr = pulls
                    .iter_mut()
                    .find(|p| p["repo"] == repo && p["number"] == number)
                    .ok_or_else(|| ToolError::NotFound(format!("#{number}")))?;
                pr["state"] = json!("merged");
                let out = pr.clone();
                drop(pulls);
                self.effects.push(&self.name, tool, caller, args);
                Ok(json!({"merged": out}))
            }
            _ => Err(ToolError::Invalid(format!("unknown tool `{tool}`"))),
        }
    }
}
