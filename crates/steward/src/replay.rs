//! Replay a profile's demo scenarios against the full stack over HTTP, exactly as a browser
//! would: dev login, chat over SSE, approvers deciding in the inbox, test-as, kill switch. Each
//! scenario runs on a fresh stack. Used by the end-to-end tests and `steward replay`.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use steward_config::{AgentRole, DemoScenario, Expect, Profile};

use crate::dev::{dev_app, DevOptions};
use crate::stack::{ApproverMode, Stack, StackOptions};

#[derive(Debug, Serialize)]
pub struct ScenarioResult {
    pub id: String,
    pub title: String,
    pub user: String,
    pub passed: bool,
    pub failures: Vec<String>,
    pub events: usize,
    pub decisions: Vec<String>,
    pub eur: f64,
    pub millis: u128,
}

struct Browser {
    base: String,
    http: reqwest::Client,
}

impl Browser {
    fn new(base: &str) -> Result<Self, String> {
        let http = reqwest::Client::builder().cookie_store(true).timeout(Duration::from_secs(120)).build().map_err(|e| e.to_string())?;
        Ok(Self { base: base.into(), http })
    }

    async fn post(&self, path: &str, body: Value) -> Result<reqwest::Response, String> {
        self.http.post(format!("{}{path}", self.base)).header("x-steward", "1").json(&body).send().await.map_err(|e| e.to_string())
    }

    async fn get(&self, path: &str) -> Result<Value, String> {
        self.http.get(format!("{}{path}", self.base)).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())
    }

    async fn login(&self, user: &str) -> Result<(), String> {
        let r = self.post("/api/dev-login", json!({"user": user})).await?;
        if r.status().is_success() {
            Ok(())
        } else {
            Err(format!("login {user}: HTTP {}", r.status()))
        }
    }

    /// One chat turn; returns every SSE event.
    async fn chat(&self, message: &str) -> Result<Vec<Value>, String> {
        let r = self.post("/api/chat", json!({"message": message})).await?;
        if !r.status().is_success() {
            return Err(format!("chat: HTTP {}", r.status()));
        }
        let text = r.text().await.map_err(|e| e.to_string())?;
        Ok(text
            .split("\n\n")
            .filter_map(|block| block.lines().find_map(|l| l.strip_prefix("data:")).map(str::trim))
            .filter_map(|d| serde_json::from_str::<Value>(d).ok())
            .collect())
    }
}

/// Decide the first pending approval for `approver` once it shows up.
async fn approve_when_pending(base: String, approver: String, approve: bool) -> Result<(), String> {
    let b = Browser::new(&base)?;
    b.login(&approver).await?;
    for _ in 0..200 {
        let list = b.get("/api/approvals").await?;
        if let Some(id) = list["to_decide"].as_array().and_then(|a| a.first()).and_then(|a| a["id"].as_str()) {
            let decision = if approve { "approve" } else { "deny" };
            let r = b.post(&format!("/api/approvals/{id}"), json!({"decision": decision, "reason": "replay"})).await?;
            return if r.status().is_success() { Ok(()) } else { Err(format!("decide: HTTP {}", r.status())) };
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err(format!("{approver} never saw an approval request"))
}

/// Answer every call held for `user`'s own confirmation until `stop` fires (the chat is done).
async fn confirm_while_chatting(
    base: String,
    user: String,
    confirm: bool,
    mut stop: tokio::sync::oneshot::Receiver<()>,
) -> Result<usize, String> {
    let b = Browser::new(&base)?;
    b.login(&user).await?;
    let mut answered = 0;
    loop {
        let list = b.get("/api/approvals").await?;
        let mine = list["to_decide"].as_array().cloned().unwrap_or_default();
        for a in mine.iter().filter(|a| a["awaiting"] == "requester" && a["requester"] == user.as_str()) {
            let Some(id) = a["id"].as_str() else { continue };
            let decision = if confirm { "approve" } else { "deny" };
            let r = b.post(&format!("/api/approvals/{id}"), json!({"decision": decision, "reason": "replay"})).await?;
            if !r.status().is_success() {
                return Err(format!("confirm: HTTP {}", r.status()));
            }
            answered += 1;
        }
        tokio::select! {
            _ = &mut stop => return Ok(answered),
            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
        }
    }
}

fn of_type<'a>(events: &'a [Value], t: &str) -> impl Iterator<Item = &'a Value> + 'a {
    let t = t.to_string();
    events.iter().filter(move |e| e["type"] == t.as_str())
}

/// Check a turn's expectations; returns failure messages.
fn check(expect: &[Expect], events: &[Value], stack: &Stack, profile: &Profile) -> Vec<String> {
    let mut failures = Vec::new();
    let answer = of_type(events, "done").last().and_then(|d| d["answer"].as_str()).unwrap_or_default().to_string();
    for e in expect {
        let ok = match e {
            Expect::Decision { tool, effect, rule } => of_type(events, "decision").any(|d| {
                d["tool"] == tool.as_str() && d["effect"] == effect.as_str() && rule.as_ref().is_none_or(|r| d["rule"] == r.as_str())
            }),
            Expect::Approval { .. } => of_type(events, "approval_pending").next().is_some(),
            Expect::Confirm { .. } => of_type(events, "approval_pending").any(|p| p["awaiting"] == "requester"),
            Expect::ToolResult { tool, contains } => of_type(events, "tool_result").any(|r| {
                r["tool"] == tool.as_str() && r["ok"] == true && r["preview"].as_str().is_some_and(|p| p.contains(contains.as_str()))
            }),
            Expect::AnswerContains(t) => answer.contains(t.as_str()),
            Expect::AnswerOmits(t) => !answer.contains(t.as_str()),
            Expect::Citation { doc_id, page } => {
                of_type(events, "citation").any(|c| c["doc_id"] == doc_id.as_str() && page.is_none_or(|p| c["page"] == p))
            }
            Expect::Abstained => of_type(events, "abstained").next().is_some(),
            Expect::Handoff(role) => {
                let client = match role.as_str() {
                    "research" => profile.agent(AgentRole::Research),
                    "action" => profile.agent(AgentRole::Action),
                    _ => None,
                }
                .map(|a| a.client_id.clone())
                .unwrap_or_else(|| role.clone());
                of_type(events, "agent_handoff").any(|h| h["to"] == client.as_str())
            }
            Expect::MemoryUsed => of_type(events, "memory_used").next().is_some(),
            Expect::MemoryStored => of_type(events, "memory_stored").next().is_some(),
            Expect::MemoryRefused => of_type(events, "memory_refused").next().is_some(),
            Expect::BudgetExceeded => of_type(events, "budget_exceeded").next().is_some(),
            Expect::NotExecuted(tool) => !stack.effects.executed(tool),
        };
        if !ok {
            failures.push(format!("expected {e:?}"));
        }
    }
    if let Some(err) = of_type(events, "error").next() {
        failures.push(format!("error event: {}", err["message"]));
    }
    failures
}

/// Run one scenario on a fresh stack.
pub async fn run_scenario(profile: Profile, sc: &DemoScenario) -> Result<ScenarioResult, String> {
    let started = std::time::Instant::now();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let base = format!("http://{}", listener.local_addr().map_err(|e| e.to_string())?);
    let opts = StackOptions {
        approver: ApproverMode::Webhook { url: format!("{base}/hooks/warden/approval"), secret: None },
        ..Default::default()
    };
    let stack = Stack::start(profile, opts).await?;
    let app =
        dev_app(&stack, DevOptions { public_url: base.clone(), ui_dir: None, data_dir: None, otlp_traces: None, offline: true }).await?;
    let router = crate::app::router(app.state.clone());
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    let profile = stack.profile.clone();

    if let Some(mode) = &sc.kill_switch {
        let admin = profile.users.iter().find(|u| u.roles.iter().any(|r| profile.meta.admin_roles.contains(r))).ok_or("no admin user")?;
        let b = Browser::new(&base)?;
        b.login(&admin.id).await?;
        let r = b.post("/api/admin/kill", json!({"mode": mode})).await?;
        if !r.status().is_success() {
            return Err(format!("kill switch: HTTP {}", r.status()));
        }
    }
    let user = Browser::new(&base)?;
    match &sc.impersonated_by {
        Some(op) => {
            user.login(op).await?;
            let r = user.post("/api/admin/test-as", json!({"user": sc.user})).await?;
            if !r.status().is_success() {
                return Err(format!("test-as: HTTP {}", r.status()));
            }
        }
        None => user.login(&sc.user).await?,
    }

    let mut failures = Vec::new();
    let mut all = Vec::new();
    for (i, turn) in sc.turns.iter().enumerate() {
        let mut approvers = Vec::new();
        for e in &turn.expect {
            if let Expect::Approval { approver, decide, second_approver } = e {
                approvers.push(tokio::spawn(approve_when_pending(base.clone(), approver.clone(), decide == "approve")));
                if let Some(s) = second_approver {
                    approvers.push(tokio::spawn(approve_when_pending(base.clone(), s.clone(), decide == "approve")));
                }
            }
        }
        let mut confirmer = None;
        if let Some(Expect::Confirm { decide }) = turn.expect.iter().find(|e| matches!(e, Expect::Confirm { .. })) {
            let (tx, rx) = tokio::sync::oneshot::channel();
            confirmer = Some((tx, tokio::spawn(confirm_while_chatting(base.clone(), sc.user.clone(), decide == "confirm", rx))));
        }
        let events = user.chat(&turn.user).await?;
        if let Some((stop, task)) = confirmer {
            let _ = stop.send(());
            match task.await {
                Ok(Ok(0)) => failures.push(format!("turn {}: nothing was held for {}'s confirmation", i + 1, sc.user)),
                Ok(Err(e)) => failures.push(format!("turn {}: {e}", i + 1)),
                _ => {}
            }
        }
        for a in approvers {
            if let Ok(Err(e)) = a.await {
                failures.push(format!("turn {}: {e}", i + 1));
            }
        }
        for f in check(&turn.expect, &events, &stack, &profile) {
            failures.push(format!("turn {}: {f}", i + 1));
        }
        all.extend(events);
    }
    server.abort();
    let decisions = of_type(&all, "decision")
        .map(|d| {
            format!("{} → {} ({})", d["tool"].as_str().unwrap_or(""), d["effect"].as_str().unwrap_or(""), d["rule"].as_str().unwrap_or(""))
        })
        .collect();
    let eur = of_type(&all, "cost").filter_map(|c| c["eur"].as_f64()).sum();
    drop(app);
    Ok(ScenarioResult {
        id: sc.id.clone(),
        title: sc.title.clone(),
        user: sc.user.clone(),
        passed: failures.is_empty(),
        failures,
        events: all.len(),
        decisions,
        eur,
        millis: started.elapsed().as_millis(),
    })
}

/// Run every demo scenario of a profile.
pub async fn run_all(profile_dir: &Path) -> Result<Vec<ScenarioResult>, String> {
    let profile = Profile::load(profile_dir).map_err(|e| e.to_string())?;
    let scenarios = Arc::new(profile.scenarios.clone());
    let mut out = Vec::new();
    for sc in scenarios.iter() {
        out.push(run_scenario(profile.clone(), sc).await?);
    }
    Ok(out)
}
