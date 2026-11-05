#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! The browser-facing API around the chat: document page ACL, four-eyes approvals, role
//! changes that apply on the next call, costs and the console.

use std::time::Duration;

use serde_json::{json, Value};
use steward::dev::{dev_app, DevApp, DevOptions};
use steward::stack::{ApproverMode, Stack, StackOptions};
use steward_config::Profile;

struct Env {
    base: String,
    stack: Stack,
    _app: DevApp,
}

async fn env() -> Env {
    std::env::remove_var("OPENROUTER_API_KEY");
    let profile = Profile::load(concat!(env!("CARGO_MANIFEST_DIR"), "/../../profiles/acme")).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let opts = StackOptions {
        approver: ApproverMode::Webhook { url: format!("{base}/hooks/warden/approval"), secret: None },
        ..Default::default()
    };
    let stack = Stack::start(profile, opts).await.unwrap();
    let app = dev_app(&stack, DevOptions { public_url: base.clone(), ui_dir: None, data_dir: None, otlp_traces: None }).await.unwrap();
    let router = steward::app::router(app.state.clone());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    Env { base, stack, _app: app }
}

struct B {
    base: String,
    http: reqwest::Client,
}

impl B {
    async fn login(base: &str, user: &str) -> B {
        let http = reqwest::Client::builder().cookie_store(true).build().unwrap();
        let r = http.post(format!("{base}/api/dev-login")).header("x-steward", "1").json(&json!({"user": user})).send().await.unwrap();
        assert!(r.status().is_success(), "login {user}");
        B { base: base.into(), http }
    }
    async fn get(&self, path: &str) -> reqwest::Response {
        self.http.get(format!("{}{path}", self.base)).send().await.unwrap()
    }
    async fn post(&self, path: &str, body: Value) -> reqwest::Response {
        self.http.post(format!("{}{path}", self.base)).header("x-steward", "1").json(&body).send().await.unwrap()
    }
    async fn chat(&self, msg: &str) -> Vec<Value> {
        let text = self.post("/api/chat", json!({"message": msg})).await.text().await.unwrap();
        text.split("\n\n")
            .filter_map(|b| b.lines().find_map(|l| l.strip_prefix("data:")))
            .filter_map(|d| serde_json::from_str(d.trim()).ok())
            .collect()
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn page_images_are_checked_on_every_fetch() {
    let e = env().await;
    let sven = B::login(&e.base, "sven").await;
    assert_eq!(sven.get("/api/docs/pages/sales-pricing-2026/1.png").await.status(), 200);
    // A guessed URL to an HR document: Warden says no before a byte is read.
    assert_eq!(sven.get("/api/docs/pages/hr-salary-bands/1.png").await.status(), 403);
    assert_eq!(sven.get("/api/docs/pages/..%2Fusers/1.png").await.status(), 400);
    // Not logged in: nothing.
    assert_eq!(reqwest::get(format!("{}/api/docs/pages/sales-pricing-2026/1.png", e.base)).await.unwrap().status(), 401);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn state_changes_need_the_csrf_header() {
    let e = env().await;
    let sven = B::login(&e.base, "sven").await;
    let r = sven.http.post(format!("{}/api/chat", e.base)).json(&json!({"message": "hi"})).send().await.unwrap();
    assert_eq!(r.status(), 403);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn approvals_route_to_leads_and_refuse_self_approval() {
    let e = env().await;
    let sven = B::login(&e.base, "sven").await;
    let sara = B::login(&e.base, "sara").await;
    // Sven asks; while the chat is held, Sven cannot decide his own request, Sara can.
    let chat = tokio::spawn({
        let base = e.base.clone();
        async move {
            let s = B::login(&base, "sven").await;
            s.chat("Setz den Deal d-1007 auf 80.000 Euro").await
        }
    });
    let mut id = None;
    for _ in 0..100 {
        let v: Value = sara.get("/api/approvals").await.json().await.unwrap();
        if let Some(a) = v["to_decide"].as_array().and_then(|a| a.first()) {
            id = Some(a["id"].as_str().unwrap().to_string());
            assert_eq!(a["rule"], "big-deals-need-approval");
            assert_eq!(a["args"]["amount"], 80000);
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let id = id.expect("Sara sees the request");
    let mine: Value = sven.get("/api/approvals").await.json().await.unwrap();
    assert!(mine["to_decide"].as_array().unwrap().is_empty(), "requesters never decide");
    assert_eq!(sven.post(&format!("/api/approvals/{id}"), json!({"decision": "approve"})).await.status(), 403);
    assert_eq!(sara.post(&format!("/api/approvals/{id}"), json!({"decision": "approve"})).await.status(), 200);
    let events = chat.await.unwrap();
    assert!(events.iter().any(|e| e["type"] == "tool_result" && e["ok"] == true), "{events:#?}");
    assert!(e.stack.effects.executed("crm.update_deal"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn role_changes_apply_on_the_next_call() {
    let e = env().await;
    let ines = B::login(&e.base, "ines").await;
    // Ines removes Sven's sales role: his sessions end and his old token is revoked.
    let sven = B::login(&e.base, "sven").await;
    let token = e.stack.user_token("sven").unwrap();
    assert_eq!(sven.get("/api/me").await.status(), 200);
    let r: Value = ines.post("/api/admin/users/sven/roles", json!({"roles": []})).await.json().await.unwrap();
    assert_eq!(r["ok"], true, "{r}");
    assert_eq!(sven.get("/api/me").await.status(), 401, "session ended");
    // The gateway refuses the old token on the next call, long before it expires.
    let gw = reqwest::Client::new()
        .post(&e.stack.gateway_url)
        .bearer_auth(&token)
        .header("accept", "application/json, text/event-stream")
        .json(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}}))
        .send()
        .await
        .unwrap();
    assert_eq!(gw.status(), 401);
    // After logging in again Sven has no CRM tools.
    let again = B::login(&e.base, "sven").await;
    let me: Value = again.get("/api/me").await.json().await.unwrap();
    assert!(me["tools"].as_array().unwrap().iter().all(|t| !t.as_str().unwrap().starts_with("crm.")), "{me}");
    // Only admins change roles.
    assert_eq!(again.post("/api/admin/users/sara/roles", json!({"roles": []})).await.status(), 403);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_as_is_read_only_and_ends_cleanly() {
    let e = env().await;
    let ines = B::login(&e.base, "ines").await;
    let r: Value = ines.post("/api/admin/test-as", json!({"user": "sven"})).await.json().await.unwrap();
    assert_eq!(r["ok"], true, "{r}");
    let me: Value = ines.get("/api/me").await.json().await.unwrap();
    assert_eq!((me["user"].as_str(), me["impersonated_by"].as_str()), (Some("sven"), Some("ines")));
    assert_eq!(me["admin"], false, "no console inside a test session");
    let events = ines.chat("Setz den Deal d-1007 auf 45.000 Euro").await;
    assert!(events.iter().any(|e| e["type"] == "decision" && e["rule"] == "impersonation.read_only"), "{events:#?}");
    assert!(!e.stack.effects.executed("crm.update_deal"));
    // Reads in the test session reach the gateway, whose audit records the operator.
    ines.chat("Welche Deals habe ich in DACH?").await;
    let audit = e.stack.audit.events();
    assert!(audit.iter().any(|a| a["impersonated_by"] == "ines"), "gateway audit records the operator");
    assert_eq!(ines.post("/api/admin/test-as/end", json!({})).await.status(), 200);
    let me: Value = ines.get("/api/me").await.json().await.unwrap();
    assert_eq!(me["user"], "ines");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn costs_are_visible_to_finance_and_admins_only() {
    let e = env().await;
    let sven = B::login(&e.base, "sven").await;
    sven.chat("Welche Deals habe ich in DACH?").await;
    let own: Value = sven.get("/api/costs").await.json().await.unwrap();
    assert_eq!(own["scope"], "me");
    assert!(own["today_eur"].as_f64().unwrap() > 0.0);
    let fiona = B::login(&e.base, "fiona").await;
    let all: Value = fiona.get("/api/costs").await.json().await.unwrap();
    assert_eq!(all["scope"], "all");
    assert!(all["by_user"].as_array().unwrap().iter().any(|t| t["key"] == "sven"), "{all}");
    let sum: f64 = all["by_user"].as_array().unwrap().iter().map(|t| t["eur"].as_f64().unwrap()).sum();
    assert!((sum - all["total_eur"].as_f64().unwrap()).abs() < 1e-9, "cost page = ledger sum");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn console_lists_users_rights_and_connectors() {
    let e = env().await;
    let ines = B::login(&e.base, "ines").await;
    let users: Value = ines.get("/api/admin/users").await.json().await.unwrap();
    assert_eq!(users["users"].as_array().unwrap().len(), 7);
    let hanna: Value = ines.get("/api/admin/effective/hanna").await.json().await.unwrap();
    assert!(!hanna["tools"].as_array().unwrap().iter().any(|t| t == "hr.get_salary"));
    let conns: Value = ines.get("/api/admin/connectors").await.json().await.unwrap();
    assert_eq!(conns["connectors"].as_array().unwrap().len(), 6);
    let audit: Value = ines.get("/api/admin/audit").await.json().await.unwrap();
    assert!(audit["events"].is_array());
    let policy: Value = ines.get("/api/admin/policy").await.json().await.unwrap();
    assert!(policy["catalog"].as_str().unwrap().contains("hr.get_salary"));
    let sven = B::login(&e.base, "sven").await;
    assert_eq!(sven.get("/api/admin/users").await.status(), 403);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_failing_connector_disappears_and_shows_in_the_console() {
    std::env::remove_var("OPENROUTER_API_KEY");
    let profile = Profile::load(concat!(env!("CARGO_MANIFEST_DIR"), "/../../profiles/acme")).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let opts = StackOptions { circuit_open_after: 1, ..Default::default() };
    let stack = Stack::start(profile, opts).await.unwrap();
    let app = dev_app(&stack, DevOptions { public_url: base.clone(), ui_dir: None, data_dir: None, otlp_traces: None }).await.unwrap();
    let router = steward::app::router(app.state.clone());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

    let tools = |token: String| {
        let url = stack.gateway_url.clone();
        async move {
            let c = warden_mcp::McpClient::new(url);
            let v = c.call(Some(&token), "tools/list", json!({})).await.unwrap().result.unwrap();
            v["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect::<Vec<_>>()
        }
    };
    assert!(tools(stack.user_token("sven").unwrap()).await.iter().any(|t| t.starts_with("crm.")));
    stack.outages.set("crm", true);
    // A call to the dead upstream fails and opens the circuit; the tools vanish from the list.
    let sven = B::login(&base, "sven").await;
    sven.chat("Welche Deals habe ich in DACH?").await;
    let after = tools(stack.user_token("sven").unwrap()).await;
    assert!(!after.iter().any(|t| t.starts_with("crm.")), "{after:?}");
    let ines = B::login(&base, "ines").await;
    let conns: Value = ines.get("/api/admin/connectors").await.json().await.unwrap();
    let crm = conns["connectors"].as_array().unwrap().iter().find(|c| c["name"] == "crm").unwrap().clone();
    assert_eq!(crm["health"]["state"], "open", "{crm}");
}
