#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Phase 2 acceptance: the Acme profile behind the real Warden gateway, called the way the
//! assistant calls it (MCP over HTTP with the user's token).

use serde_json::{json, Value};
use steward::stack::{ApproverMode, Stack, StackOptions};
use warden_mcp::McpClient;

/// A webhook that plays the user: it confirms every confirmation (the subject answers) and
/// refuses every approval by others.
async fn user_confirms() -> String {
    let app = axum::Router::new().route(
        "/",
        axum::routing::post(|axum::Json(req): axum::Json<Value>| async move {
            let confirm = req["confirmation"] == true;
            axum::Json(json!({
                "decision": if confirm { "approve" } else { "deny" },
                "approver": if confirm { req["subject"].clone() } else { json!("nobody") },
                "args_hash": req["args_hash"],
            }))
        }),
    );
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", l.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    url
}

fn profile() -> steward_config::Profile {
    steward_config::Profile::load(concat!(env!("CARGO_MANIFEST_DIR"), "/../../profiles/acme")).unwrap()
}

async fn tools(c: &McpClient, token: &str) -> Vec<String> {
    let out = c.call(Some(token), "tools/list", json!({})).await.unwrap().result.unwrap();
    let mut names: Vec<String> = out["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
    names.sort();
    names
}

async fn call(c: &McpClient, token: &str, name: &str, args: Value) -> Value {
    c.call(Some(token), "tools/call", json!({"name": name, "arguments": args})).await.unwrap().result.unwrap()
}

fn text(v: &Value) -> String {
    v["content"][0]["text"].as_str().unwrap_or_default().to_string()
}

#[tokio::test]
async fn each_user_sees_and_does_only_what_the_policy_allows() {
    let opts = StackOptions { approver: ApproverMode::Webhook { url: user_confirms().await, secret: None }, ..Default::default() };
    let stack = Stack::start(profile(), opts).await.unwrap();
    let gw = McpClient::new(stack.gateway_url.clone());
    let hanna = stack.user_token("hanna").unwrap();
    let henrik = stack.user_token("henrik").unwrap();
    let sven = stack.user_token("sven").unwrap();

    // Lists are filtered per user: Hanna (HR member) never sees salaries or the CRM.
    let hanna_tools = tools(&gw, &hanna).await;
    assert!(hanna_tools.contains(&"hr.search_employees".to_string()), "{hanna_tools:?}");
    assert!(!hanna_tools.iter().any(|t| t == "hr.get_salary" || t.starts_with("crm.")), "{hanna_tools:?}");
    let r = call(&gw, &hanna, "hr.get_salary", json!({"unit": "hr"})).await;
    assert_eq!(r["isError"], true, "{r}");

    // Henrik (HR lead): own unit yes, other unit no.
    let own = call(&gw, &henrik, "hr.get_salary", json!({"unit": "hr"})).await;
    assert_eq!(own["isError"], false, "{own}");
    assert!(text(&own).contains("salary_eur"));
    let other = call(&gw, &henrik, "hr.get_salary", json!({"unit": "sales"})).await;
    assert_eq!(other["isError"], true, "{other}");
    assert!(!text(&other).contains("salary_eur"));

    // Sven: own tenant only; documents only of his team.
    let deals = call(&gw, &sven, "crm.list_deals", json!({"tenant": "dach"})).await;
    assert!(text(&deals).contains("d-1007"), "{deals}");
    let foreign = call(&gw, &sven, "crm.list_deals", json!({"tenant": "nordics"})).await;
    assert_eq!(foreign["isError"], true);
    let doc =
        call(&gw, &sven, "docs.search", json!({"question": "Wie viel Rabatt dürfen Account Executives gewähren?", "doc_ids": []})).await;
    assert!(text(&doc).contains("sales-pricing-2026"), "{doc}");
    let hr_doc = call(&gw, &sven, "docs.search", json!({"question": "Gehaltsbänder Senior", "doc_ids": ["hr-salary-bands"]})).await;
    assert_eq!(hr_doc["isError"], true, "Warden denies doc_ids outside doc_scope: {hr_doc}");

    // Big deal changes are held for the sales lead; nobody approves here, so they never run.
    let big = call(&gw, &sven, "crm.update_deal", json!({"tenant": "dach", "deal_id": "d-1007", "amount": 80000})).await;
    assert_eq!(big["isError"], true, "{big}");
    assert!(!stack.effects.executed("crm.update_deal"));
    // A small change Sven may make himself runs once he confirms it (approve_by: subject).
    let small = call(&gw, &sven, "crm.update_deal", json!({"tenant": "dach", "deal_id": "d-1007", "amount": 45000})).await;
    assert_eq!(small["isError"], false, "{small}");
    assert!(stack.effects.executed("crm.update_deal"));
    let granted = stack.audit.events_of("approval_granted");
    assert!(granted.iter().any(|g| g["confirmation"] == true && g["approver"] == "sven"), "{granted:#?}");

    // Upstreams saw the user (exchanged token), never the user's own token.
    let effect = stack.effects.all().into_iter().find(|e| e.tool == "update_deal").unwrap();
    assert_eq!(effect.subject.as_deref(), Some("sven"));
    assert!(!stack.audit.events_of("decision").is_empty() || !stack.audit.events().is_empty());
}

#[tokio::test]
async fn revoking_a_user_takes_effect_on_the_next_call() {
    let stack = Stack::start(profile(), StackOptions::default()).await.unwrap();
    let gw = McpClient::new(stack.gateway_url.clone());
    let sven = stack.user_token("sven").unwrap();
    assert_eq!(call(&gw, &sven, "crm.list_deals", json!({"tenant": "dach"})).await["isError"], false);
    let http = reqwest::Client::new();
    let r = http
        .post(format!("{}/revoke", stack.sts_url))
        .basic_auth("steward-console", Some(steward::stack::CONSOLE_SECRET))
        .form(&[("sub", "sven")])
        .send()
        .await
        .unwrap();
    assert!(r.status().is_success());
    let after = c_raw(&gw, &sven).await;
    assert!(after.is_err() || after.unwrap().result.is_err(), "revoked token must be refused");
}

async fn c_raw(gw: &McpClient, token: &str) -> Result<warden_mcp::Outcome, warden_mcp::ClientError> {
    gw.call(Some(token), "tools/call", json!({"name": "crm.list_deals", "arguments": {"tenant": "dach"}})).await
}
